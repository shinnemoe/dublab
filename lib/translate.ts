import type { TranscriptSegment } from './transcribe';

export interface TranslatedSegment extends TranscriptSegment {
    translatedText: string;
}

// Strip markdown code fences and extract JSON array/object
function cleanJson(raw: string): string {
    // Remove ```json ... ``` or ``` ... ```
    let s = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim();
    // Find first [ or { to start of JSON
    const start = Math.min(
        s.indexOf('[') === -1 ? Infinity : s.indexOf('['),
        s.indexOf('{') === -1 ? Infinity : s.indexOf('{')
    );
    if (start > 0 && start !== Infinity) s = s.slice(start);
    return s;
}

// Translate a small batch via Gemini
async function translateBatchGemini(
    batch: { id: number; text: string }[],
    targetLanguage: string,
    guidelineNote: string,
    geminiKey: string,
    isRetry = false
): Promise<{ id: number; translatedText: string }[]> {
    const retryNote = isRetry
        ? '\n\nIMPORTANT: Some segments were NOT translated in the previous attempt. You MUST translate ALL of them this time. Do NOT leave any segment in its original language.'
        : '';
    const prompt = `You are a professional dubbing translator. Your job is to translate EVERY SINGLE segment below into ${targetLanguage}.

RULES:
- Translate ALL ${batch.length} segments — no exceptions, no skipping.
- Output ONLY a JSON array. No markdown, no code fences, no explanation text.
- Keep translations natural and conversational for spoken audio dubbing.
- Preserve meaning and tone.${guidelineNote}${retryNote}

Input (JSON array of segments to translate):
${JSON.stringify(batch)}

Required output format (translate every id):
[{"id": 0, "translatedText": "..."}, {"id": 1, "translatedText": "..."}, ...]`;

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
        const err = await res.json().catch(() => ({}));
        throw new Error(`Gemini translation failed: ${err.error?.message || res.statusText}`);
    }

    const data = await res.json();
    const rawText = data.candidates?.[0]?.content?.parts?.[0]?.text || '[]';
    try {
        return JSON.parse(cleanJson(rawText));
    } catch {
        // Last resort: try to extract partial array
        const partial = rawText.match(/\{[^}]+\}/g);
        if (partial) {
            return partial.map((item: string) => {
                try { return JSON.parse(item); } catch { return null; }
            }).filter(Boolean);
        }
        throw new Error(`Failed to parse Gemini translation JSON: ${rawText.slice(0, 200)}`);
    }
}

// Translate all segments using Gemini Flash — batched to avoid token limit truncation
export async function translateWithGemini(
    segments: TranscriptSegment[],
    targetLanguage: string,
    guidelines: string,
    geminiKey: string
): Promise<TranslatedSegment[]> {
    const guidelineNote = guidelines.trim()
        ? `\n\nAdditional translation guidelines:\n${guidelines}`
        : '';

    const BATCH_SIZE = 20;
    const allTranslations: { id: number; translatedText: string }[] = [];

    for (let i = 0; i < segments.length; i += BATCH_SIZE) {
        const batch = segments.slice(i, i + BATCH_SIZE).map(s => ({ id: s.id, text: s.text }));
        const results = await translateBatchGemini(batch, targetLanguage, guidelineNote, geminiKey);
        allTranslations.push(...results);
    }

    // Retry any segments that weren't translated (translatedText === original text)
    const missed = segments.filter(seg => {
        const t = allTranslations.find(t => t.id === seg.id);
        return !t || t.translatedText === seg.text || t.translatedText.trim() === '';
    });

    if (missed.length > 0) {
        const retryBatch = missed.map(s => ({ id: s.id, text: s.text }));
        const retried = await translateBatchGemini(retryBatch, targetLanguage, guidelineNote, geminiKey, true);
        // Merge retried results (overwrite previous for those ids)
        for (const r of retried) {
            const idx = allTranslations.findIndex(t => t.id === r.id);
            if (idx >= 0) allTranslations[idx] = r;
            else allTranslations.push(r);
        }
    }

    return segments.map(seg => {
        const t = allTranslations.find(t => t.id === seg.id);
        return { ...seg, translatedText: t?.translatedText || seg.text };
    });
}

// Translate using OpenAI GPT-4o mini — batched for consistency
export async function translateWithOpenAI(
    segments: TranscriptSegment[],
    targetLanguage: string,
    guidelines: string,
    openaiKey: string
): Promise<TranslatedSegment[]> {
    const guidelineNote = guidelines.trim()
        ? `\n\nAdditional translation guidelines:\n${guidelines}`
        : '';

    const BATCH_SIZE = 30;
    const allTranslations: { id: number; translatedText: string }[] = [];

    for (let i = 0; i < segments.length; i += BATCH_SIZE) {
        const batch = segments.slice(i, i + BATCH_SIZE).map(s => ({ id: s.id, text: s.text }));

        const res = await fetch('https://api.openai.com/v1/chat/completions', {
            method: 'POST',
            headers: { Authorization: `Bearer ${openaiKey}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model: 'gpt-4o-mini',
                response_format: { type: 'json_object' },
                messages: [
                    {
                        role: 'system',
                        content: `You are a professional translator for dubbing. Translate speech segments to ${targetLanguage}. Keep translations natural for spoken audio.${guidelineNote}`,
                    },
                    {
                        role: 'user',
                        content: `Translate these segments. Return JSON: {"segments": [{"id": 0, "translatedText": "..."}]}\n\n${JSON.stringify(batch)}`,
                    },
                ],
            }),
        });

        if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            throw new Error(`OpenAI translation failed: ${err.error?.message || res.statusText}`);
        }

        const data = await res.json();
        const rawContent = data.choices[0].message.content;
        try {
            const result = JSON.parse(cleanJson(rawContent));
            allTranslations.push(...(result.segments || result));
        } catch {
            throw new Error(`Failed to parse OpenAI translation JSON: ${rawContent.slice(0, 200)}`);
        }
    }

    return segments.map(seg => {
        const t = allTranslations.find(t => t.id === seg.id);
        return { ...seg, translatedText: t?.translatedText || seg.text };
    });
}
