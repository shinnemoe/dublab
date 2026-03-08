import { NextRequest, NextResponse } from 'next/server';
import { execFile, spawn } from 'child_process';
import { Readable } from 'stream';

export const runtime = 'nodejs';

function isYouTubeUrl(url: string): boolean {
    return /youtube\.com|youtu\.be/.test(url);
}

export async function GET(req: NextRequest) {
    const url = req.nextUrl.searchParams.get('url');
    if (!url) return NextResponse.json({ error: 'No URL provided' }, { status: 400 });

    // ── YouTube (includes Shorts, youtu.be, etc.) ─────────────────────────────
    if (isYouTubeUrl(url)) {
        try {
            // Stream video via yt-dlp piped to stdout
            const ytProcess = spawn('yt-dlp', [
                '-f', 'bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best',
                '--merge-output-format', 'mp4',
                '-o', '-',          // pipe output to stdout
                '--no-playlist',
                url,
            ]);

            const webStream = Readable.toWeb(ytProcess.stdout) as ReadableStream;

            // Collect stderr for error reporting if needed
            // ytProcess.stderr is not piped so it goes to server logs

            return new NextResponse(webStream, {
                headers: {
                    'Content-Type': 'video/mp4',
                    'Cache-Control': 'no-store',
                    'Access-Control-Allow-Origin': '*',
                },
            });
        } catch (err: any) {
            return NextResponse.json({ error: 'yt-dlp failed: ' + err.message }, { status: 500 });
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
