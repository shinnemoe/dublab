import type { TranscriptSegment } from './transcribe';

export interface TranslatedSegment extends TranscriptSegment {
    translatedText: string;
}

// Translate all segments using Gemini Flash
export async function translateWithGemini(
    segments: TranscriptSegment[],
    targetLanguage: string,
    guidelines: string,
    geminiKey: string
): Promise<TranslatedSegment[]> {
    const segmentsJson = JSON.stringify(segments.map(s => ({ id: s.id, text: s.text })));
    const guidelineNote = guidelines.trim()
        ? `\n\nAdditional translation guidelines from the user:\n${guidelines}`
        : '';

    const prompt = `You are a professional translator. Translate the following speech segments to ${targetLanguage}.
Keep translations natural and conversational, suitable for dubbing (lip-sync awareness).
Preserve the meaning and tone of the original.${guidelineNote}

Input segments (JSON):
${segmentsJson}

Return ONLY a JSON array with the same IDs plus a "translatedText" field. Example:
[{"id": 0, "translatedText": "translated text here"}, ...]`;

    const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${geminiKey}`,
        {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: [{ parts: [{ text: prompt }] }],
                generationConfig: { responseMimeType: 'application/json' }
            }),
        }
    );

    if (!res.ok) {
        const err = await res.json();
        throw new Error(`Gemini translation failed: ${err.error?.message || res.statusText}`);
    }

    const data = await res.json();
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '[]';
    const translations: { id: number; translatedText: string }[] = JSON.parse(text);

    return segments.map(seg => {
        const t = translations.find(t => t.id === seg.id);
        return { ...seg, translatedText: t?.translatedText || seg.text };
    });
}

// Translate using OpenAI GPT-4o mini
export async function translateWithOpenAI(
    segments: TranscriptSegment[],
    targetLanguage: string,
    guidelines: string,
    openaiKey: string
): Promise<TranslatedSegment[]> {
    const segmentsJson = JSON.stringify(segments.map(s => ({ id: s.id, text: s.text })));
    const guidelineNote = guidelines.trim()
        ? `\n\nAdditional translation guidelines:\n${guidelines}`
        : '';

    const res = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${openaiKey}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            model: 'gpt-4o-mini',
            response_format: { type: 'json_object' },
            messages: [
                {
                    role: 'system',
                    content: `You are a professional translator specializing in dubbing. Translate speech segments to ${targetLanguage}. Keep translations natural for spoken audio.${guidelineNote}`,
                },
                {
                    role: 'user',
                    content: `Translate these segments. Return JSON: {"segments": [{"id": 0, "translatedText": "..."}]}\n\n${segmentsJson}`,
                },
            ],
        }),
    });

    if (!res.ok) {
        const err = await res.json();
        throw new Error(`OpenAI translation failed: ${err.error?.message || res.statusText}`);
    }

    const data = await res.json();
    const result = JSON.parse(data.choices[0].message.content);
    const translations = result.segments || [];

    return segments.map(seg => {
        const t = translations.find((t: any) => t.id === seg.id);
        return { ...seg, translatedText: t?.translatedText || seg.text };
    });
}
