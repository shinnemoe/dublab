import { NextRequest, NextResponse } from 'next/server';
import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

export const runtime = 'nodejs';

function isYouTubeUrl(url: string): boolean {
    return /youtube\.com|youtu\.be/.test(url);
}

export async function GET(req: NextRequest) {
    const url = req.nextUrl.searchParams.get('url');
    if (!url) return NextResponse.json({ error: 'No URL provided' }, { status: 400 });

    if (isYouTubeUrl(url)) {
        try {
            const { stdout, stderr } = await execFileAsync('yt-dlp', [
                '--no-warnings',
                '--get-url',
                '-f',
                'best[ext=mp4]/best',
                url,
            ]);
            const videoUrl = stdout.trim();
            if (!videoUrl) {
                throw new Error(stderr?.trim() || 'yt-dlp returned no URL');
            }
            const range = req.headers.get('range') || '';
            const upstream = await fetch(videoUrl, {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
                    'Accept': 'video/mp4,video/webm,video/*,*/*;q=0.9',
                    'Accept-Language': 'en-US,en;q=0.9',
                    'Accept-Encoding': 'identity',
                    ...(range ? { 'Range': range } : {}),
                },
                redirect: 'follow',
            });
            if (!upstream.ok && upstream.status !== 206) {
                return NextResponse.json(
                    { error: `YouTube upstream returned ${upstream.status} ${upstream.statusText}` },
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
            return NextResponse.json({ error: 'YouTube download failed: ' + err.message }, { status: 500 });
        }
    }

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
