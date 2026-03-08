// API keys and settings — stored only in localStorage, never sent to our servers

export const STORAGE_KEYS = {
    GEMINI_KEY: 'dubber_gemini_key',
    OPENAI_KEY: 'dubber_openai_key',
    TTS_PROVIDER: 'dubber_tts_provider',
    TARGET_LANG: 'dubber_target_lang',
    CUSTOM_LANGS: 'dubber_custom_langs',
};

export function getKey(key: string): string {
    if (typeof window === 'undefined') return '';
    return localStorage.getItem(key) || '';
}

export function setKey(key: string, value: string) {
    if (typeof window === 'undefined') return;
    localStorage.setItem(key, value);
}

export const DEFAULT_LANGUAGES = [
    { code: 'my', name: 'Burmese', flag: '🇲🇲' },
    { code: 'en', name: 'English', flag: '🇺🇸' },
    { code: 'es', name: 'Spanish', flag: '🇪🇸' },
    { code: 'th', name: 'Thai', flag: '🇹🇭' },
    { code: 'de', name: 'German', flag: '🇩🇪' },
    { code: 'ja', name: 'Japanese', flag: '🇯🇵' },
    { code: 'zh', name: 'Chinese', flag: '🇨🇳' },
    { code: 'ko', name: 'Korean', flag: '🇰🇷' },
];

export const OPENAI_VOICES = ['alloy', 'echo', 'fable', 'onyx', 'nova', 'shimmer'];

export const EDGE_TTS_VOICES: Record<string, { name: string; voice: string }[]> = {
    en: [
        { name: 'Jenny (Female)', voice: 'en-US-JennyNeural' },
        { name: 'Guy (Male)', voice: 'en-US-GuyNeural' },
        { name: 'Aria (Female)', voice: 'en-US-AriaNeural' },
    ],
    my: [
        { name: 'Thiha (Male)', voice: 'my-MM-ThihaNeural' },
        { name: 'Nilar (Female)', voice: 'my-MM-NilarNeural' },
    ],
    es: [
        { name: 'Elvira (Female)', voice: 'es-ES-ElviraNeural' },
        { name: 'Alvaro (Male)', voice: 'es-ES-AlvaroNeural' },
    ],
    th: [
        { name: 'Niwat (Male)', voice: 'th-TH-NiwatNeural' },
        { name: 'Premwadee (Female)', voice: 'th-TH-PremwadeeNeural' },
    ],
    de: [
        { name: 'Katja (Female)', voice: 'de-DE-KatjaNeural' },
        { name: 'Conrad (Male)', voice: 'de-DE-ConradNeural' },
    ],
    ja: [
        { name: 'Nanami (Female)', voice: 'ja-JP-NanamiNeural' },
        { name: 'Keita (Male)', voice: 'ja-JP-KeitaNeural' },
    ],
    zh: [
        { name: 'Xiaoxiao (Female)', voice: 'zh-CN-XiaoxiaoNeural' },
        { name: 'Yunxi (Male)', voice: 'zh-CN-YunxiNeural' },
    ],
    ko: [
        { name: 'Sun-Hi (Female)', voice: 'ko-KR-SunHiNeural' },
        { name: 'InJoon (Male)', voice: 'ko-KR-InJoonNeural' },
    ],
};
