// TTS abstraction — supports OpenAI TTS, Edge TTS (free), and Gemini TTS

export type TTSProvider = 'openai' | 'edge' | 'gemini';
export type GeminiTTSModel = 'flash' | 'pro';

// Prebuilt Gemini voice names (30 voices)
export const GEMINI_VOICES = [
    'Aoede', 'Puck', 'Charon', 'Fenrir', 'Kore',
    'Leda', 'Orus', 'Perseus', 'Zephyr', 'Achernar',
];

// ─── Helper: PCM (L16 24kHz mono) → WAV ArrayBuffer ────────────────────────
function pcmToWav(pcmBytes: Uint8Array, sampleRate = 24000, channels = 1, bitsPerSample = 16): ArrayBuffer {
    const byteRate = sampleRate * channels * bitsPerSample / 8;
    const blockAlign = channels * bitsPerSample / 8;
    const dataSize = pcmBytes.length;
    const buffer = new ArrayBuffer(44 + dataSize);
    const view = new DataView(buffer);

    const writeStr = (off: number, s: string) => { for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i)); };
    writeStr(0, 'RIFF');
    view.setUint32(4, 36 + dataSize, true);
    writeStr(8, 'WAVE');
    writeStr(12, 'fmt ');
    view.setUint32(16, 16, true);       // chunk size
    view.setUint16(20, 1, true);        // PCM format
    view.setUint16(22, channels, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, byteRate, true);
    view.setUint16(32, blockAlign, true);
    view.setUint16(34, bitsPerSample, true);
    writeStr(36, 'data');
    view.setUint32(40, dataSize, true);
    new Uint8Array(buffer).set(pcmBytes, 44);
    return buffer;
}

// ─── OpenAI TTS ─────────────────────────────────────────────────────────────
export async function ttsOpenAI(
    text: string,
    voice: string,
    openaiKey: string,
    speed = 1.0
): Promise<ArrayBuffer> {
    const res = await fetch('https://api.openai.com/v1/audio/speech', {
        method: 'POST',
        headers: { Authorization: `Bearer ${openaiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: 'tts-1', input: text, voice, speed: Math.max(0.25, Math.min(4.0, speed)), response_format: 'mp3' }),
    });
    if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(`OpenAI TTS failed: ${err.error?.message || res.statusText}`);
    }
    return res.arrayBuffer();
}

// ─── Edge TTS (free, server-side proxy) ─────────────────────────────────────
export async function ttsEdge(text: string, voiceName: string): Promise<ArrayBuffer> {
    const res = await fetch(`/api/tts?text=${encodeURIComponent(text)}&voice=${encodeURIComponent(voiceName)}`);
    if (!res.ok) {
        const errText = await res.text().catch(() => res.statusText);
        throw new Error(`Edge TTS failed: ${errText}`);
    }
    return res.arrayBuffer();
}

// ─── Gemini TTS (gemini-2.5-flash-preview-tts / gemini-2.5-pro-preview-tts) ─
export async function ttsGemini(
    text: string,
    voiceName: string,   // one of GEMINI_VOICES
    geminiKey: string,
    model: GeminiTTSModel = 'flash'
): Promise<ArrayBuffer> {
    const modelId = model === 'pro'
        ? 'gemini-2.5-pro-preview-tts'
        : 'gemini-2.5-flash-preview-tts';

    const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${modelId}:generateContent?key=${geminiKey}`,
        {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: [{ parts: [{ text }] }],
                generationConfig: {
                    responseModalities: ['AUDIO'],
                    speechConfig: {
                        voiceConfig: {
                            prebuiltVoiceConfig: { voiceName },
                        },
                    },
                },
            }),
        }
    );

    if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(`Gemini TTS failed: ${err.error?.message || res.statusText}`);
    }

    const data = await res.json();
    const audioPart = data?.candidates?.[0]?.content?.parts?.find((p: any) => p.inlineData);
    if (!audioPart?.inlineData?.data) throw new Error('Gemini TTS: no audio in response');

    // Decode base64 PCM (L16, 24 kHz, mono) → WAV
    const binary = atob(audioPart.inlineData.data);
    const pcm = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) pcm[i] = binary.charCodeAt(i);
    return pcmToWav(pcm);
}

// ─── Duration estimate ───────────────────────────────────────────────────────
export function estimateAudioDuration(audioBytes: number, isWav = false): number {
    if (isWav) return (audioBytes - 44) / 48000; // 24kHz * 2 bytes
    return audioBytes / 6000; // 48kbps mp3
}
