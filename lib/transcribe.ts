// Transcription using OpenAI Whisper API
export async function transcribeWithOpenAI(
    audioBlob: Blob,
    openaiKey: string
): Promise<TranscriptSegment[]> {
    const formData = new FormData();
    formData.append('file', audioBlob, 'audio.mp3');
    formData.append('model', 'whisper-1');
    formData.append('response_format', 'verbose_json');
    formData.append('timestamp_granularities[]', 'segment');

    const res = await fetch('https://api.openai.com/v1/audio/transcriptions', {
        method: 'POST',
        headers: { Authorization: `Bearer ${openaiKey}` },
        body: formData,
    });

    if (!res.ok) {
        const err = await res.json();
        throw new Error(`Whisper failed: ${err.error?.message || res.statusText}`);
    }

    const data = await res.json();
    return (data.segments || []).map((s: any) => ({
        id: s.id,
        start: s.start,
        end: s.end,
        text: s.text.trim(),
    }));
}

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
        const err = await res.json();
        throw new Error(`Gemini transcription failed: ${err.error?.message || res.statusText}`);
    }

    const data = await res.json();
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '[]';
    try {
        return JSON.parse(text);
    } catch {
        return [{ id: 0, start: 0, end: 30, text: text }];
    }
}

export interface TranscriptSegment {
    id: number;
    start: number;
    end: number;
    text: string;
}
