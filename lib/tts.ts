// TTS abstraction — supports OpenAI TTS, Edge TTS (free), and Gemini TTS

export type TTSProvider = 'openai' | 'edge' | 'gemini';

// OpenAI TTS — high quality, supports Burmese
export async function ttsOpenAI(
    text: string,
    voice: string,
    openaiKey: string,
    speed: number = 1.0
): Promise<ArrayBuffer> {
    const res = await fetch('https://api.openai.com/v1/audio/speech', {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${openaiKey}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            model: 'tts-1',
            input: text,
            voice,
            speed: Math.max(0.25, Math.min(4.0, speed)),
            response_format: 'mp3',
        }),
    });

    if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(`OpenAI TTS failed: ${err.error?.message || res.statusText}`);
    }

    return res.arrayBuffer();
}

// Edge TTS — free, no API key needed, uses Microsoft Azure neural voices
// Routes through our own /api/tts server-side proxy (handles MS WebSocket protocol)
export async function ttsEdge(
    text: string,
    voiceName: string
): Promise<ArrayBuffer> {
    const url = `/api/tts?text=${encodeURIComponent(text)}&voice=${encodeURIComponent(voiceName)}`;
    const res = await fetch(url);

    if (!res.ok) {
        const errText = await res.text().catch(() => res.statusText);
        throw new Error(`Edge TTS failed: ${errText}`);
    }

    return res.arrayBuffer();
}

// Gemini TTS via Google AI TTS (text-to-speech API with Gemini key)
export async function ttsGemini(
    text: string,
    voiceName: string,
    geminiKey: string
): Promise<ArrayBuffer> {
    const res = await fetch(
        `https://texttospeech.googleapis.com/v1/text:synthesize?key=${geminiKey}`,
        {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                input: { text },
                voice: {
                    languageCode: voiceName.split('-').slice(0, 2).join('-'),
                    name: voiceName,
                },
                audioConfig: {
                    audioEncoding: 'MP3',
                    speakingRate: 1.0,
                },
            }),
        }
    );

    if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(`Gemini TTS failed: ${err.error?.message || res.statusText}`);
    }

    const data = await res.json();
    const base64Audio = data.audioContent;
    const binary = atob(base64Audio);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes.buffer;
}

// Get duration of audio ArrayBuffer (mp3) in seconds
// Used to calculate speed adjustment needed
export function estimateAudioDuration(audioBytes: number): number {
    // mp3 at 48kbps: 48000 bits/s = 6000 bytes/s
    return audioBytes / 6000;
}
