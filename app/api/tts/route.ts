import { NextRequest, NextResponse } from 'next/server';
import { MsEdgeTTS, OUTPUT_FORMAT } from 'msedge-tts';
import { tmpdir } from 'os';
import { join } from 'path';
import { mkdir, readFile, rm } from 'fs/promises';
import { randomUUID } from 'crypto';

export async function GET(req: NextRequest) {
    const text = req.nextUrl.searchParams.get('text');
    const voice = req.nextUrl.searchParams.get('voice') || 'en-US-AriaNeural';

    if (!text) return NextResponse.json({ error: 'No text' }, { status: 400 });

    // toFile() takes a DIRECTORY; it creates audio.mp3 inside it
    const tmpDir = join(tmpdir(), randomUUID());

    try {
        await mkdir(tmpDir, { recursive: true });

        const tts = new MsEdgeTTS();
        await tts.setMetadata(voice, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3);
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
