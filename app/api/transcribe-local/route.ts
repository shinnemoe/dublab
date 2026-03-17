import { NextRequest, NextResponse } from 'next/server';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { tmpdir } from 'os';
import { join } from 'path';
import { randomUUID } from 'crypto';
import { writeFile, rm, mkdir } from 'fs/promises';

const execFileAsync = promisify(execFile);

export const runtime = 'nodejs';

type TranscriptSegment = {
    id: number;
    start: number;
    end: number;
    text: string;
};

export async function POST(req: NextRequest) {
    const tempDir = join(tmpdir(), `dublab-${randomUUID()}`);
    const audioPath = join(tempDir, 'audio.mp3');

    try {
        const form = await req.formData();
        const audio = form.get('audio');
        if (!(audio instanceof File)) {
            return NextResponse.json({ error: 'No audio file provided' }, { status: 400 });
        }

        const bytes = Buffer.from(await audio.arrayBuffer());
        await mkdir(tempDir, { recursive: true });
        await writeFile(audioPath, bytes);

        const modelSize = process.env.LOCAL_WHISPER_MODEL || 'tiny';
        const timeoutMs = Number(process.env.LOCAL_WHISPER_TIMEOUT_MS || 120000);
        const cpuThreads = Number(process.env.LOCAL_WHISPER_THREADS || 4);
        const language = (form.get('language') as string) || '';
        const pyCode = [
            'import json,sys',
            'from faster_whisper import WhisperModel',
            `model=WhisperModel("${modelSize}", device="cpu", compute_type="int8", cpu_threads=${cpuThreads})`,
            'kwargs={"vad_filter": False, "beam_size": 1, "best_of": 1, "temperature": 0.0}',
            'lang=sys.argv[2] if len(sys.argv)>2 else ""',
            'if lang: kwargs["language"]=lang',
            'segments,info=model.transcribe(sys.argv[1], **kwargs)',
            'out=[]',
            'for i,s in enumerate(segments):',
            '    out.append({"id": i, "start": float(s.start), "end": float(s.end), "text": (s.text or "").strip()})',
            'print(json.dumps(out, ensure_ascii=False))',
        ].join('\n');

        const { stdout, stderr } = await execFileAsync('python', ['-c', pyCode, audioPath, language], {
            maxBuffer: 20 * 1024 * 1024,
            timeout: timeoutMs,
        });

        if (!stdout?.trim()) {
            return NextResponse.json({ error: `Local transcription failed: ${stderr || 'No output'}` }, { status: 500 });
        }

        const parsed = JSON.parse(stdout) as TranscriptSegment[];
        return NextResponse.json({ segments: parsed });
    } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        return NextResponse.json({ error: `Local transcription failed: ${message}` }, { status: 500 });
    } finally {
        await rm(tempDir, { recursive: true, force: true }).catch(() => { });
    }
}
