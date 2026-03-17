import { NextRequest, NextResponse } from 'next/server';
import { MsEdgeTTS, OUTPUT_FORMAT } from 'msedge-tts';
import { tmpdir } from 'os';
import { join } from 'path';
import { mkdir, readFile, rm } from 'fs/promises';
import { randomUUID } from 'crypto';

export async function GET(req: NextRequest) {
    const text = req.nextUrl.searchParams.get('text');
    let voice = req.nextUrl.searchParams.get('voice') || 'en-US-AriaNeural';

    // Edge TTS requires voices in format xx-XX-VoiceName
    if (!/^\w{2}-\w{2}-\w/.test(voice)) {
        voice = 'en-US-AriaNeural';
    }

    if (!text) return NextResponse.json({ error: 'No text' }, { status: 400 });

    // toFile() takes a DIRECTORY; it creates audio.mp3 inside it
    const tmpDir = join(tmpdir(), randomUUID());

    try {
        await mkdir(tmpDir, { recursive: true });

        const tts = new MsEdgeTTS();
        // Extract locale from voice name (e.g. "my-MM-ThihaNeural" → "my-MM"), default to "en-US"
        const voiceLocale = voice.match(/^[a-z]{2}-[A-Z]{2}/)?.[0] || 'en-US';
        await tts.setMetadata(voice, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3, { voiceLocale } as any);
        const { audioFilePath } = await tts.toFile(tmpDir, text);

        const audio = await readFile(audioFilePath as string);
        tts.close();

        return new NextResponse(audio, {
            headers: {
                'Content-Type': 'audio/mpeg',
                'Content-Length': audio.length.toString(),
                'Cache-Control': 'no-store',
            },
        });
    } catch (err: any) {
        return NextResponse.json({ error: 'Edge TTS failed: ' + err.message }, { status: 500 });
    } finally {
        await rm(tmpDir, { recursive: true }).catch(() => { });
    }
}
