// Transcription using Gemini (audio file as multimodal input)
export async function transcribeWithGemini(
    audioBase64: string,
    mimeType: string,
    geminiKey: string
): Promise<TranscriptSegment[]> {
    const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${geminiKey}`,
        {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: [{
                    parts: [
                        {
                            inlineData: { mimeType, data: audioBase64 }
                        },
                        {
                            text: `Transcribe the speech in this audio. Return a JSON array of segments with this exact format:
[{"id": 0, "start": 0.0, "end": 2.5, "text": "Hello world"}, ...]
Estimate timestamps based on natural speech rhythm. Return ONLY the JSON array, no other text.`
                        }
                    ]
                }],
                generationConfig: { responseMimeType: 'application/json' }
            }),
        }
    );

    if (!res.ok) {
        const err = await res.json().catch(() => ({} as { error?: { message?: string; status?: string } }));
        const message = err.error?.message || res.statusText;
        if (/api key not valid/i.test(message)) {
            throw new Error('Gemini transcription failed: Invalid Gemini API key. Please update your Gemini key in API Keys.');
        }
        if (/permission denied|access denied|insufficient|forbidden/i.test(message)) {
            throw new Error('Gemini transcription failed: Your Gemini key does not have permission for this model/API.');
        }
        throw new Error(`Gemini transcription failed: ${message}`);
    }

    const data = await res.json();
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '[]';
    try {
        return JSON.parse(text);
    } catch {
        return [{ id: 0, start: 0, end: 30, text: text }];
    }
}

export async function transcribeWithLocal(audioBlob: Blob): Promise<TranscriptSegment[]> {
    const formData = new FormData();
    formData.append('audio', audioBlob, 'audio.mp3');

    const res = await fetch('/api/transcribe-local', {
        method: 'POST',
        body: formData,
    });

    if (!res.ok) {
        const err = await res.json().catch(() => ({} as { error?: string }));
        throw new Error(err.error || `Local transcription failed: ${res.statusText}`);
    }

    const data = await res.json();
    const segments = (data.segments || []) as TranscriptSegment[];
    if (!Array.isArray(segments) || segments.length === 0) {
        throw new Error('Local transcription returned no segments');
    }
    return segments;
}

export interface TranscriptSegment {
    id: number;
    start: number;
    end: number;
    text: string;
}
