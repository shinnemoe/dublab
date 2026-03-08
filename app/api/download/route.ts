import { NextRequest, NextResponse } from 'next/server';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { tmpdir } from 'os';
import { join } from 'path';
import { readFile, unlink } from 'fs/promises';
import { randomUUID } from 'crypto';

export const runtime = 'nodejs';

const execFileAsync = promisify(execFile);

function isYouTubeUrl(url: string): boolean {
    return /youtube\.com|youtu\.be/.test(url);
}

export async function GET(req: NextRequest) {
    const url = req.nextUrl.searchParams.get('url');
    if (!url) return NextResponse.json({ error: 'No URL provided' }, { status: 400 });

    // ── YouTube (includes Shorts) ─────────────────────────────────────────────
    // Note: MP4 format requires seekable output, cannot stream to stdout.
    // We download to a temp file then serve it — reliable for Shorts (< 100MB).
    if (isYouTubeUrl(url)) {
        const tmpPath = join(tmpdir(), `yt-${randomUUID()}.mp4`);
        try {
            // 720p mp4 + best m4a audio, merged into mp4 file
            await execFileAsync('yt-dlp', [
                '-f', 'bestvideo[height<=720][ext=mp4]+bestaudio[ext=m4a]/best[height<=720][ext=mp4]/best[height<=720]',
                '--merge-output-format', 'mp4',
                '-o', tmpPath,
                '--no-playlist',
                url,
            ], { maxBuffer: 10 * 1024 * 1024 }); // 10MB for stderr/stdout

            const videoData = await readFile(tmpPath);
            return new NextResponse(videoData, {
                headers: {
                    'Content-Type': 'video/mp4',
                    'Content-Length': videoData.length.toString(),
                    'Cache-Control': 'no-store',
                    'Access-Control-Allow-Origin': '*',
                },
            });
        } catch (err: any) {
            return NextResponse.json({ error: 'yt-dlp failed: ' + err.message }, { status: 500 });
        } finally {
            await unlink(tmpPath).catch(() => { });
        }
    }

    // ── Other CDN/direct video URLs ──────────────────────────────────────────
    let referer = 'https://www.google.com/';
    try {
        const parsed = new URL(url);
        if (parsed.hostname.includes('xhscdn') || parsed.hostname.includes('xiaohongshu')) {
            referer = 'https://www.xiaohongshu.com/';
        } else {
            referer = parsed.origin + '/';
        }
    } catch { }

    const headers: Record<string, string> = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        'Accept': 'video/mp4,video/webm,video/*,*/*;q=0.9',
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept-Encoding': 'identity',
        'Referer': referer,
        'Origin': new URL(referer).origin,
        'Sec-Fetch-Dest': 'video',
        'Sec-Fetch-Mode': 'no-cors',
        'Sec-Fetch-Site': 'cross-site',
        'Range': req.headers.get('range') || '',
    };
    Object.keys(headers).forEach(k => { if (!headers[k]) delete headers[k]; });

    try {
        const upstream = await fetch(url, { headers, redirect: 'follow' });
        if (!upstream.ok && upstream.status !== 206) {
            return NextResponse.json(
                { error: `Upstream returned ${upstream.status} ${upstream.statusText}` },
                { status: upstream.status === 403 ? 403 : 500 }
            );
        }

        const contentType = upstream.headers.get('content-type') || 'video/mp4';
        const contentLength = upstream.headers.get('content-length');
        const contentRange = upstream.headers.get('content-range');

        const responseHeaders: Record<string, string> = {
            'Content-Type': contentType,
            'Accept-Ranges': 'bytes',
            'Access-Control-Allow-Origin': '*',
            'Cache-Control': 'no-store',
        };
        if (contentLength) responseHeaders['Content-Length'] = contentLength;
        if (contentRange) responseHeaders['Content-Range'] = contentRange;

        return new NextResponse(upstream.body, { status: upstream.status, headers: responseHeaders });
    } catch (err: any) {
        return NextResponse.json({ error: 'Download failed: ' + err.message }, { status: 500 });
    }
}
