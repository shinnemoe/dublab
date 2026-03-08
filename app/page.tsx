'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import {
  DEFAULT_LANGUAGES, OPENAI_VOICES, EDGE_TTS_VOICES,
  getKey, setKey, STORAGE_KEYS
} from '@/lib/config';
import { transcribeWithOpenAI, transcribeWithGemini, TranscriptSegment } from '@/lib/transcribe';
import { translateWithGemini, translateWithOpenAI, TranslatedSegment } from '@/lib/translate';
import { ttsOpenAI, ttsEdge, ttsGemini, GEMINI_VOICES, GeminiTTSModel } from '@/lib/tts';
import { FFmpeg } from '@ffmpeg/ffmpeg';
import { fetchFile, toBlobURL } from '@ffmpeg/util';

type Step = 'idle' | 'extracting' | 'transcribing' | 'translating' | 'tts' | 'syncing' | 'merging' | 'done' | 'error';

interface ProgressInfo {
  step: Step;
  message: string;
  percent: number;
}

export default function DubberPage() {
  // Auth/keys
  const [geminiKey, setGeminiKeyState] = useState('');
  const [openaiKey, setOpenaiKeyState] = useState('');
  const [showKeys, setShowKeys] = useState(false);

  // Settings
  const [ttsProvider, setTtsProvider] = useState<'openai' | 'edge' | 'gemini'>('openai');
  const [targetLang, setTargetLang] = useState('my');
  const [selectedVoice, setSelectedVoice] = useState('alloy');
  const [geminiTtsModel, setGeminiTtsModel] = useState<GeminiTTSModel>('flash');
  const [guidelines, setGuidelines] = useState('');
  const [customLangs, setCustomLangs] = useState<{ code: string; name: string; flag: string }[]>([]);
  const [newLangName, setNewLangName] = useState('');
  const [showAddLang, setShowAddLang] = useState(false);

  // Video input
  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [videoUrl, setVideoUrl] = useState('');
  const [videoObjectUrl, setVideoObjectUrl] = useState('');

  // Processing
  const [progress, setProgress] = useState<ProgressInfo>({ step: 'idle', message: '', percent: 0 });
  const [outputUrl, setOutputUrl] = useState('');
  const [transcript, setTranscript] = useState<TranscriptSegment[]>([]);
  const [translated, setTranslated] = useState<TranslatedSegment[]>([]);
  const [error, setError] = useState('');

  // URL preview state
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewVideoUrl, setPreviewVideoUrl] = useState('');
  const [previewTitle, setPreviewTitle] = useState('');
  const [previewError, setPreviewError] = useState('');
  const urlDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const resolvedVideoUrl = useRef(''); // the actual fetchable video URL

  const ffmpegRef = useRef<FFmpeg | null>(null);
  const ffmpegLoaded = useRef(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // All available languages
  const allLanguages = [...DEFAULT_LANGUAGES, ...customLangs];

  // Load settings from localStorage
  useEffect(() => {
    setGeminiKeyState(getKey(STORAGE_KEYS.GEMINI_KEY));
    setOpenaiKeyState(getKey(STORAGE_KEYS.OPENAI_KEY));
    const savedProvider = getKey(STORAGE_KEYS.TTS_PROVIDER) as 'openai' | 'edge' | 'gemini';
    if (savedProvider) setTtsProvider(savedProvider);
    const savedLang = getKey(STORAGE_KEYS.TARGET_LANG) || 'my';
    if (savedLang) setTargetLang(savedLang);
    const savedCustom = getKey(STORAGE_KEYS.CUSTOM_LANGS);
    if (savedCustom) {
      try { setCustomLangs(JSON.parse(savedCustom)); } catch { }
    }
    // Reset voice if saved voice is incompatible with saved provider
    const savedVoice = selectedVoice;
    if (savedProvider === 'edge' && !/^[a-z]{2}-[A-Z]{2}-/.test(savedVoice)) {
      const edgeVoices = EDGE_TTS_VOICES[savedLang] || EDGE_TTS_VOICES['en'];
      setSelectedVoice(edgeVoices[0]?.voice || 'en-US-AriaNeural');
    }
  }, []);

  const saveGeminiKey = (k: string) => { setGeminiKeyState(k); setKey(STORAGE_KEYS.GEMINI_KEY, k); };
  const saveOpenaiKey = (k: string) => { setOpenaiKeyState(k); setKey(STORAGE_KEYS.OPENAI_KEY, k); };
  const saveProvider = (p: 'openai' | 'edge' | 'gemini') => {
    setTtsProvider(p);
    setKey(STORAGE_KEYS.TTS_PROVIDER, p);
    // Reset voice to first valid option for this provider
    if (p === 'openai') setSelectedVoice(OPENAI_VOICES[0]);
    else if (p === 'edge') {
      const voices = EDGE_TTS_VOICES[targetLang] || EDGE_TTS_VOICES['en'];
      setSelectedVoice(voices[0]?.voice || 'en-US-AriaNeural');
    } else {
      setSelectedVoice(`${targetLang}-Wavenet-A`);
    }
  };
  const saveLang = (l: string) => { setTargetLang(l); setKey(STORAGE_KEYS.TARGET_LANG, l); };

  const addCustomLanguage = () => {
    if (!newLangName.trim()) return;
    const code = newLangName.trim().toLowerCase().replace(/\s+/g, '-');
    const newLang = { code, name: newLangName.trim(), flag: '🌐' };
    const updated = [...customLangs, newLang];
    setCustomLangs(updated);
    setKey(STORAGE_KEYS.CUSTOM_LANGS, JSON.stringify(updated));
    setNewLangName('');
    setShowAddLang(false);
    saveLang(code);
  };

  // Get voices for current language/provider
  const getVoiceOptions = () => {
    if (ttsProvider === 'openai') return OPENAI_VOICES.map(v => ({ value: v, label: v.charAt(0).toUpperCase() + v.slice(1) }));
    if (ttsProvider === 'edge') {
      const voices = EDGE_TTS_VOICES[targetLang] || EDGE_TTS_VOICES['en'];
      return voices.map(v => ({ value: v.voice, label: v.name }));
    }
    // Gemini uses Google TTS voice names
    return [
      { value: `${targetLang}-Wavenet-A`, label: 'Voice A' },
      { value: `${targetLang}-Wavenet-B`, label: 'Voice B' },
      { value: `${targetLang}-Wavenet-C`, label: 'Voice C' },
    ];
  };

  const loadFFmpeg = async () => {
    if (ffmpegLoaded.current) return ffmpegRef.current!;
    const ffmpeg = new FFmpeg();
    ffmpegRef.current = ffmpeg;
    setProgress({ step: 'extracting', message: 'Loading ffmpeg.wasm (first time only)...', percent: 2 });
    const baseURL = 'https://unpkg.com/@ffmpeg/core@0.12.6/dist/umd';
    await ffmpeg.load({
      coreURL: await toBlobURL(`${baseURL}/ffmpeg-core.js`, 'text/javascript'),
      wasmURL: await toBlobURL(`${baseURL}/ffmpeg-core.wasm`, 'application/wasm'),
    });
    ffmpegLoaded.current = true;
    return ffmpeg;
  };

  const handleFileSelect = (file: File) => {
    setVideoFile(file);
    setVideoObjectUrl(URL.createObjectURL(file));
    setOutputUrl('');
    setError('');
    setPreviewVideoUrl('');
    setPreviewError('');
    setVideoUrl('');
    setProgress({ step: 'idle', message: '', percent: 0 });
  };

  const handleUrlChange = (url: string) => {
    setVideoUrl(url);
    setPreviewVideoUrl('');
    setPreviewError('');
    setPreviewTitle('');
    resolvedVideoUrl.current = '';
    if (urlDebounceRef.current) clearTimeout(urlDebounceRef.current);
    if (!url.trim()) return;
    urlDebounceRef.current = setTimeout(() => fetchPreview(url), 800);
  };

  const fetchPreview = async (url: string) => {
    setPreviewLoading(true);
    setPreviewError('');
    try {
      const res = await fetch(`/api/preview?url=${encodeURIComponent(url)}`);
      const data = await res.json();
      if (data.videoUrl) {
        setPreviewVideoUrl(data.videoUrl);        // proxied URL for <video> element
        setPreviewTitle(data.pageTitle || '');
        // Store the RAW CDN url for download — not the proxied path
        resolvedVideoUrl.current = data.rawVideoUrl || data.videoUrl;
      } else {
        setPreviewError(data.error || 'Could not extract video. This site may block external access — please download and upload the video manually.');
      }
    } catch {
      setPreviewError('Preview failed. Please upload the video file manually.');
    } finally {
      setPreviewLoading(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file && file.type.startsWith('video/')) handleFileSelect(file);
  };

  const startDubbing = async () => {
    if (!videoFile && !videoUrl) { setError('Please upload a video or paste a URL first.'); return; }
    if (ttsProvider !== 'edge' && !geminiKey && !openaiKey) {
      setError('Please add an API key in the settings panel, or switch to Edge TTS (free).'); return;
    }

    setError('');
    setOutputUrl('');
    setTranscript([]);
    setTranslated([]);

    if (!geminiKey && !openaiKey) {
      setError('Please add at least one API key (Gemini or OpenAI) in the API Keys panel. Edge TTS is free for voice — but a key is still needed for transcription and translation.');
      return;
    }

    try {
      // Step 1: Load and write video to ffmpeg
      setProgress({ step: 'extracting', message: 'Loading video...', percent: 5 });
      const ffmpeg = await loadFFmpeg();

      let videoData: Uint8Array;
      if (videoFile) {
        videoData = await fetchFile(videoFile);
      } else {
        setProgress({ step: 'extracting', message: 'Downloading video...', percent: 5 });
        // Use the proxied preview URL first (already piped through /api/download)
        // or build the proxy URL from the raw CDN URL we extracted
        const rawOrResolved = resolvedVideoUrl.current || videoUrl;
        const proxyUrl = rawOrResolved.startsWith('/api/')
          ? rawOrResolved  // already proxied, use as-is
          : `/api/download?url=${encodeURIComponent(rawOrResolved)}`;
        const res = await fetch(proxyUrl);
        if (!res.ok) {
          const errText = await res.text().catch(() => '');
          throw new Error(
            `Video download failed (${res.status}). The site may block server-side access. ` +
            `Please download the video manually and upload it. Details: ${errText.slice(0, 120)}`
          );
        }
        videoData = new Uint8Array(await res.arrayBuffer());
      }

      await ffmpeg.writeFile('input.mp4', videoData);

      // Step 2: Extract audio as mp3
      setProgress({ step: 'extracting', message: 'Extracting audio from video...', percent: 15 });
      await ffmpeg.exec(['-i', 'input.mp4', '-vn', '-ar', '16000', '-ac', '1', '-b:a', '64k', 'audio.mp3']);
      const audioData = await ffmpeg.readFile('audio.mp3');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const audioBlob = new Blob([audioData as any], { type: 'audio/mp3' });

      // Step 3: Transcribe — OpenAI Whisper first (most accurate), Gemini as fallback
      setProgress({ step: 'transcribing', message: 'Transcribing audio...', percent: 30 });
      let segments: TranscriptSegment[];

      const tryGeminiTranscribe = async () => {
        const arrayBuf = await audioBlob.arrayBuffer();
        const bytes = new Uint8Array(arrayBuf);
        let binary = '';
        const chunkSize = 8192;
        for (let i = 0; i < bytes.length; i += chunkSize) {
          binary += String.fromCharCode(...(bytes.subarray(i, i + chunkSize) as unknown as number[]));
        }
        const base64 = btoa(binary);
        return transcribeWithGemini(base64, 'audio/mp3', geminiKey);
      };

      if (openaiKey) {
        try {
          segments = await transcribeWithOpenAI(audioBlob, openaiKey);
        } catch (err: any) {
          if (geminiKey) {
            setProgress({ step: 'transcribing', message: 'OpenAI Whisper failed — retrying with Gemini...', percent: 32 });
            segments = await tryGeminiTranscribe();
          } else {
            throw err; // no fallback available
          }
        }
      } else if (geminiKey) {
        segments = await tryGeminiTranscribe();
      } else {
        throw new Error('No API key for transcription. Please add a Gemini or OpenAI key.');
      }
      setTranscript(segments);

      // Step 4: Translate — Gemini first (better quality), OpenAI as fallback
      setProgress({ step: 'translating', message: `Translating to ${allLanguages.find(l => l.code === targetLang)?.name || targetLang}...`, percent: 50 });
      const langName = allLanguages.find(l => l.code === targetLang)?.name || targetLang;
      let translatedSegs;
      if (geminiKey) {
        translatedSegs = await translateWithGemini(segments, langName, guidelines, geminiKey);
      } else if (openaiKey) {
        translatedSegs = await translateWithOpenAI(segments, langName, guidelines, openaiKey);
      } else {
        throw new Error('No API key for translation.');
      }
      setTranslated(translatedSegs);

      // Step 5: TTS
      setProgress({ step: 'tts', message: 'Generating dubbed audio...', percent: 60 });

      // Get video duration first (needed for Gemini speed-adjust mode)
      const videoDuration = await new Promise<number>((resolve) => {
        (async () => {
          let dur = 0;
          ffmpeg.on('log', ({ message }) => {
            const m = message.match(/Duration: (\d+):(\d+):([\d.]+)/);
            if (m) dur = parseInt(m[1]) * 3600 + parseInt(m[2]) * 60 + parseFloat(m[3]);
          });
          await ffmpeg.exec(['-i', 'input.mp4', '-f', 'null', '-']);
          resolve(dur);
        })();
      });

      if (ttsProvider === 'gemini' && geminiKey) {
        // ── Whole-text Gemini TTS: one consistent audio, speed-adjust to fit video ──
        setProgress({ step: 'tts', message: 'Generating dubbed audio (Gemini, whole text)...', percent: 65 });
        const fullText = translatedSegs.map(s => s.translatedText).join('\n\n');
        const wholeAudio = await ttsGemini(fullText, selectedVoice, geminiKey, geminiTtsModel);

        // WAV duration: (bytes - 44 header) / (24000Hz * 2 bytes * 1 channel)
        const ttsDuration = (wholeAudio.byteLength - 44) / 48000;
        const targetDuration = videoDuration || ttsDuration;
        const ratio = ttsDuration / Math.max(targetDuration, 0.1);

        const buildAtempo = (r: number): string => {
          if (r >= 0.5 && r <= 2.0) return `atempo=${r.toFixed(4)}`;
          if (r > 2.0) return `atempo=2.0,${buildAtempo(r / 2.0)}`;
          return `atempo=0.5,${buildAtempo(r / 0.5)}`;
        };

        setProgress({ step: 'syncing', message: `Adjusting audio speed (${ratio.toFixed(2)}x)...`, percent: 82 });
        await ffmpeg.writeFile('dubbed.wav', new Uint8Array(wholeAudio));
        const atempoFilter = Math.abs(ratio - 1.0) > 0.02 ? buildAtempo(ratio) : 'acopy';
        await ffmpeg.exec(['-i', 'dubbed.wav', '-filter:a', atempoFilter, '-y', 'dubbed_adj.wav']);

        setProgress({ step: 'merging', message: 'Merging with video...', percent: 90 });
        await ffmpeg.exec([
          '-i', 'input.mp4', '-i', 'dubbed_adj.wav',
          '-map', '0:v', '-map', '1:a',
          '-c:v', 'copy', '-c:a', 'aac', '-shortest', '-y', 'output.mp4',
        ]);

      } else {
        // ── Per-segment mode for OpenAI / Edge TTS ──
        const segmentBuffers: { seg: TranslatedSegment; buffer: ArrayBuffer }[] = [];
        for (let i = 0; i < translatedSegs.length; i++) {
          const seg = translatedSegs[i];
          setProgress({ step: 'tts', message: `Speech ${i + 1}/${translatedSegs.length}...`, percent: 60 + Math.round((i / translatedSegs.length) * 20) });
          let buffer: ArrayBuffer;
          if (ttsProvider === 'openai' && openaiKey) {
            buffer = await ttsOpenAI(seg.translatedText, selectedVoice, openaiKey);
          } else {
            buffer = await ttsEdge(seg.translatedText, selectedVoice);
          }
          segmentBuffers.push({ seg, buffer });
        }

        // Build synced timeline
        setProgress({ step: 'syncing', message: 'Syncing audio to video timeline...', percent: 82 });
        const filterParts: string[] = [];
        const inputArgs: string[] = ['-i', 'input.mp4'];
        for (let i = 0; i < segmentBuffers.length; i++) {
          const { seg, buffer } = segmentBuffers[i];
          const filename = `seg_${i}.mp3`;
          await ffmpeg.writeFile(filename, new Uint8Array(buffer));
          inputArgs.push('-i', filename);
          const ratio = (buffer.byteLength / 4000) / Math.max(seg.end - seg.start, 0.1);
          let filter = `[${i + 1}:a]`;
          if (ratio > 1.05) filter += `atempo=${Math.min(ratio, 1.8).toFixed(3)},`;
          else if (ratio < 0.8) filter += `atempo=${Math.max(ratio, 0.5).toFixed(3)},`;
          filter += `adelay=${Math.round(seg.start * 1000)}|${Math.round(seg.start * 1000)},apad[a${i}]`;
          filterParts.push(filter);
        }
        const mixInputs = segmentBuffers.map((_, i) => `[a${i}]`).join('');
        const filterComplex = [...filterParts, `${mixInputs}amix=inputs=${segmentBuffers.length}:normalize=0[aout]`].join('; ');

        setProgress({ step: 'merging', message: 'Merging with video...', percent: 90 });
        await ffmpeg.exec([
          ...inputArgs, '-filter_complex', filterComplex,
          '-map', '0:v', '-map', '[aout]',
          '-c:v', 'copy', '-c:a', 'aac', '-shortest', '-y', 'output.mp4',
        ]);
      }

      const outputData = await ffmpeg.readFile('output.mp4');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const blob = new Blob([outputData as any], { type: 'video/mp4' });
      setOutputUrl(URL.createObjectURL(blob));
      setProgress({ step: 'done', message: '✅ Dubbing complete! Your video is ready.', percent: 100 });

    } catch (err: any) {
      console.error(err);
      setError(err.message || 'Something went wrong during processing.');
      setProgress({ step: 'error', message: '', percent: 0 });
    }
  };

  const currentVoiceOptions = getVoiceOptions();
  const isProcessing = ['extracting', 'transcribing', 'translating', 'tts', 'syncing', 'merging'].includes(progress.step);

  return (
    <div className="min-h-screen bg-gray-950 text-white" style={{ fontFamily: "'Inter', sans-serif" }}>
      {/* Header */}
      <header className="border-b border-gray-800 px-6 py-4">
        <div className="max-w-5xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-violet-600 to-fuchsia-600 flex items-center justify-center text-xl">🎙️</div>
            <div>
              <h1 className="text-xl font-bold text-white">DubCast</h1>
              <p className="text-xs text-gray-400">AI Video Dubbing — Zero Cost</p>
            </div>
          </div>
          <button
            onClick={() => setShowKeys(!showKeys)}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-gray-800 hover:bg-gray-700 text-sm text-gray-300 transition-colors"
          >
            🔑 API Keys {showKeys ? '▲' : '▼'}
          </button>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-6 py-8 space-y-6">

        {/* API Keys Panel */}
        {showKeys && (
          <div className="bg-gray-900 border border-gray-700 rounded-2xl p-6 space-y-4">
            <h2 className="font-semibold text-gray-200">🔐 API Keys (stored in your browser only)</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="text-xs text-gray-400 mb-1 block">Gemini API Key (for transcription, translation & TTS)</label>
                <input
                  type="password"
                  value={geminiKey}
                  onChange={e => saveGeminiKey(e.target.value)}
                  placeholder="AIzaSy..."
                  className="w-full px-3 py-2 rounded-lg bg-gray-800 border border-gray-600 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-violet-500"
                />
              </div>
              <div>
                <label className="text-xs text-gray-400 mb-1 block">OpenAI API Key (for Whisper transcription & TTS)</label>
                <input
                  type="password"
                  value={openaiKey}
                  onChange={e => saveOpenaiKey(e.target.value)}
                  placeholder="sk-proj-..."
                  className="w-full px-3 py-2 rounded-lg bg-gray-800 border border-gray-600 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-violet-500"
                />
              </div>
            </div>
            <p className="text-xs text-gray-500">💡 Keys are stored in browser localStorage only — never sent to our servers. Use Edge TTS for fully free operation (no key needed).</p>
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Left: Video Input */}
          <div className="lg:col-span-2 space-y-4">
            {/* URL Input */}
            <div className="bg-gray-900 border border-gray-700 rounded-2xl p-5">
              <h2 className="font-semibold text-gray-200 mb-3">📹 Video Source</h2>
              <div className="relative mb-3">
                <input
                  type="url"
                  value={videoUrl}
                  onChange={e => handleUrlChange(e.target.value)}
                  onPaste={e => {
                    const pasted = e.clipboardData.getData('text');
                    if (pasted) setTimeout(() => fetchPreview(pasted), 100);
                  }}
                  placeholder="Paste video URL (YouTube, XiaoHongShu, Instagram, etc.)"
                  className="w-full px-3 py-3 rounded-xl bg-gray-800 border border-gray-600 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-violet-500 pr-10"
                  disabled={!!videoFile}
                />
                {previewLoading && (
                  <div className="absolute right-3 top-3 w-5 h-5 border-2 border-violet-500 border-t-transparent rounded-full animate-spin" />
                )}
              </div>

              {/* URL Preview Result */}
              {previewVideoUrl && !videoFile && (
                <div className="mb-3 rounded-xl overflow-hidden border border-green-700 bg-gray-800">
                  <video
                    src={previewVideoUrl}
                    className="w-full max-h-52"
                    controls
                    muted
                    autoPlay
                    onError={() => setPreviewError('Video loaded but cannot play in browser. Dubbing may still work — try Start Dubbing.')}
                  />
                  {previewTitle && <p className="text-xs text-gray-400 px-3 py-1 truncate">{previewTitle}</p>}
                  <p className="text-xs text-green-400 px-3 pb-2">✅ Video found — ready to dub!</p>
                </div>
              )}

              {previewError && !videoFile && (
                <div className="mb-3 p-3 bg-amber-900/30 border border-amber-700 rounded-xl text-xs text-amber-300">
                  ⚠️ {previewError}
                </div>
              )}

              <p className="text-xs text-gray-500 mb-3 text-center">— or upload directly —</p>
              {/* File Drop Zone */}
              <div
                onDrop={handleDrop}
                onDragOver={e => e.preventDefault()}
                onClick={() => fileInputRef.current?.click()}
                className="border-2 border-dashed border-gray-600 rounded-xl p-6 text-center cursor-pointer hover:border-violet-500 hover:bg-gray-800/50 transition-all"
              >
                {videoObjectUrl ? (
                  <div>
                    <video src={videoObjectUrl} className="max-h-36 mx-auto rounded-lg mb-2" muted controls />
                    <p className="text-sm text-green-400">✅ {videoFile?.name}</p>
                    <button onClick={e => { e.stopPropagation(); setVideoFile(null); setVideoObjectUrl(''); setVideoUrl(''); setPreviewVideoUrl(''); setPreviewError(''); }}
                      className="mt-2 text-xs text-gray-400 hover:text-red-400">Remove</button>
                  </div>
                ) : (
                  <div>
                    <div className="text-3xl mb-2">📂</div>
                    <p className="text-gray-300 font-medium text-sm">Drop video here</p>
                    <p className="text-gray-500 text-xs mt-1">MP4, MOV, AVI, WebM</p>
                  </div>
                )}
              </div>
              <input ref={fileInputRef} type="file" accept="video/*" className="hidden"
                onChange={e => { if (e.target.files?.[0]) handleFileSelect(e.target.files[0]); }} />
            </div>

            {/* Translation Guidelines */}
            <div className="bg-gray-900 border border-gray-700 rounded-2xl p-5">
              <h2 className="font-semibold text-gray-200 mb-1">📝 Translation Guidelines <span className="text-gray-500 font-normal text-sm">(optional)</span></h2>
              <p className="text-xs text-gray-500 mb-3">Tell the AI how to translate. E.g.: "Use formal Burmese", "Keep character names in English", "Translate idioms naturally"</p>
              <textarea
                value={guidelines}
                onChange={e => setGuidelines(e.target.value)}
                placeholder='e.g. "Use formal tone. Keep technical terms in English. The speaker is a young woman — use appropriate Burmese pronouns."'
                className="w-full px-3 py-2 rounded-lg bg-gray-800 border border-gray-600 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-violet-500 resize-none"
                rows={4}
              />
            </div>
          </div>

          {/* Right: Settings */}
          <div className="space-y-4">
            {/* Target Language */}
            <div className="bg-gray-900 border border-gray-700 rounded-2xl p-5">
              <h2 className="font-semibold text-gray-200 mb-3">🌍 Target Language</h2>
              <div className="space-y-2 max-h-56 overflow-y-auto">
                {allLanguages.map(lang => (
                  <button
                    key={lang.code}
                    onClick={() => saveLang(lang.code)}
                    className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-all ${targetLang === lang.code
                      ? 'bg-violet-600 text-white'
                      : 'bg-gray-800 text-gray-300 hover:bg-gray-700'
                      }`}
                  >
                    <span className="text-xl">{lang.flag}</span>
                    <span>{lang.name}</span>
                  </button>
                ))}
                {showAddLang ? (
                  <div className="flex gap-1">
                    <input
                      value={newLangName}
                      onChange={e => setNewLangName(e.target.value)}
                      onKeyDown={e => e.key === 'Enter' && addCustomLanguage()}
                      placeholder="Language name..."
                      autoFocus
                      className="flex-1 px-2 py-1.5 rounded-lg bg-gray-800 border border-gray-600 text-xs text-white focus:outline-none focus:border-violet-500"
                    />
                    <button onClick={addCustomLanguage} className="px-2 py-1.5 bg-violet-600 rounded-lg text-xs">Add</button>
                    <button onClick={() => setShowAddLang(false)} className="px-2 py-1.5 bg-gray-700 rounded-lg text-xs">✕</button>
                  </div>
                ) : (
                  <button
                    onClick={() => setShowAddLang(true)}
                    className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-gray-400 hover:text-white hover:bg-gray-800 border border-dashed border-gray-600 transition-all"
                  >
                    <span>+</span> Add Language
                  </button>
                )}
              </div>
            </div>

            {/* TTS Provider */}
            <div className="bg-gray-900 border border-gray-700 rounded-2xl p-5">
              <h2 className="font-semibold text-gray-200 mb-3">🔊 Voice Engine</h2>
              <div className="space-y-2">
                {[
                  { id: 'openai', label: 'OpenAI TTS', badge: 'BYOK', desc: 'Best quality, needs key' },
                  { id: 'gemini', label: 'Google Flash TTS', badge: 'BYOK', desc: 'gemini-2.5-flash-preview-tts', model: 'flash' as const },
                  { id: 'gemini', label: 'Google Pro TTS', badge: 'BYOK', desc: 'gemini-2.5-pro-preview-tts', model: 'pro' as const },
                  { id: 'edge', label: 'Edge TTS', badge: 'FREE', desc: 'No key needed' },
                ].map((p, i) => {
                  const isActive = ttsProvider === p.id && (!p.model || geminiTtsModel === p.model);
                  return (
                    <button
                      key={i}
                      onClick={() => {
                        saveProvider(p.id as 'openai' | 'edge' | 'gemini');
                        if (p.model) { setGeminiTtsModel(p.model); setSelectedVoice(GEMINI_VOICES[0]); }
                      }}
                      className={`w-full flex items-center justify-between px-3 py-2 rounded-lg text-sm transition-all ${isActive ? 'bg-violet-600' : 'bg-gray-800 hover:bg-gray-700'}`}
                    >
                      <div className="text-left">
                        <span className="font-medium">{p.label}</span>
                        <span className="text-xs text-gray-400 block">{p.desc}</span>
                      </div>
                      <span className={`text-xs px-2 py-0.5 rounded-full font-bold ${p.badge === 'FREE' ? 'bg-green-600' : 'bg-gray-600'}`}>{p.badge}</span>
                    </button>
                  );
                })}
              </div>

              {/* Voice selector */}
              <div className="mt-3">
                <label className="text-xs text-gray-400 mb-1 block">Voice Style</label>
                <select
                  value={selectedVoice}
                  onChange={e => setSelectedVoice(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg bg-gray-800 border border-gray-600 text-sm text-white focus:outline-none focus:border-violet-500"
                >
                  {ttsProvider === 'gemini'
                    ? GEMINI_VOICES.map(v => <option key={v} value={v}>{v}</option>)
                    : currentVoiceOptions.map(v => <option key={v.value} value={v.value}>{v.label}</option>)
                  }
                </select>
              </div>

              {/* Speech style prompt for Gemini TTS */}
              {ttsProvider === 'gemini' && (
                <div className="mt-2 p-2 bg-gray-800 rounded-lg text-xs text-gray-400">
                  💡 Tip: You can include style instructions in your <strong>Translation Guidelines</strong> — e.g. "Speak in a warm, friendly tone" — and Gemini TTS will follow them.
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Progress & Start */}
        <div className="bg-gray-900 border border-gray-700 rounded-2xl p-6">
          {error && (
            <div className="mb-4 px-4 py-3 bg-red-900/40 border border-red-700 rounded-xl text-red-300 text-sm">
              ❌ {error}
            </div>
          )}

          {isProcessing && (
            <div className="mb-4 space-y-3">
              <div className="flex justify-between text-sm">
                <span className="text-gray-300">{progress.message}</span>
                <span className="text-violet-400 font-bold">{progress.percent}%</span>
              </div>
              <div className="w-full bg-gray-800 rounded-full h-3 overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-violet-600 to-fuchsia-600 rounded-full transition-all duration-500"
                  style={{ width: `${progress.percent}%` }}
                />
              </div>
              <div className="flex gap-4 text-xs text-gray-500">
                {['extracting', 'transcribing', 'translating', 'tts', 'syncing', 'merging'].map((s, i) => (
                  <span key={s} className={
                    progress.step === s ? 'text-violet-400 font-semibold' :
                      ['extracting', 'transcribing', 'translating', 'tts', 'syncing', 'merging'].indexOf(progress.step) > i ? 'text-green-400' : ''
                  }>
                    {['Extract', 'Transcribe', 'Translate', 'TTS', 'Sync', 'Merge'][i]}
                  </span>
                ))}
              </div>
              <p className="text-xs text-gray-600">💡 Processing in background — you can work in other tabs!</p>
            </div>
          )}

          {progress.step === 'done' && outputUrl && (
            <div className="mb-4 space-y-3">
              <p className="text-green-400 font-semibold">✅ Dubbing complete!</p>
              <video src={outputUrl} controls className="w-full rounded-xl max-h-64" />
              <a
                href={outputUrl}
                download="dubbed_video.mp4"
                className="flex items-center justify-center gap-2 w-full px-6 py-3 bg-gradient-to-r from-green-600 to-teal-600 hover:from-green-500 hover:to-teal-500 text-white font-semibold rounded-xl transition-all"
              >
                ⬇️ Download Dubbed Video
              </a>
            </div>
          )}

          {/* Transcript preview */}
          {transcript.length > 0 && (
            <details className="mb-4">
              <summary className="text-sm text-gray-400 cursor-pointer hover:text-gray-300 mb-2">
                📄 Transcript ({transcript.length} segments)
              </summary>
              <div className="max-h-48 overflow-y-auto bg-gray-800 rounded-xl p-3 space-y-1">
                {translated.length > 0 ? translated.map((s, i) => (
                  <div key={i} className="text-xs border-b border-gray-700 pb-1">
                    <span className="text-gray-500">[{s.start.toFixed(1)}s] </span>
                    <span className="text-gray-300">{s.text}</span>
                    <span className="text-gray-500"> → </span>
                    <span className="text-violet-300">{s.translatedText}</span>
                  </div>
                )) : transcript.map((s, i) => (
                  <div key={i} className="text-xs">
                    <span className="text-gray-500">[{s.start.toFixed(1)}s] </span>
                    <span className="text-gray-300">{s.text}</span>
                  </div>
                ))}
              </div>
            </details>
          )}

          <button
            onClick={startDubbing}
            disabled={isProcessing}
            className="w-full py-4 px-6 bg-gradient-to-r from-violet-600 to-fuchsia-600 hover:from-violet-500 hover:to-fuchsia-500 disabled:from-gray-700 disabled:to-gray-700 disabled:text-gray-500 text-white font-bold text-lg rounded-xl transition-all transform hover:scale-[1.01] active:scale-[0.99] shadow-lg shadow-violet-900/30"
          >
            {isProcessing ? '⏳ Processing...' : '🎙️ Start Dubbing'}
          </button>
        </div>
      </main>

      {/* Font */}
      <link rel="preconnect" href="https://fonts.googleapis.com" />
      <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
      {/* eslint-disable-next-line @next/next/no-page-custom-font */}
      <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet" />
    </div>
  );
}
