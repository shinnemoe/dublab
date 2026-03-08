import { NextRequest, NextResponse } from 'next/server';
import { execFile } from 'child_process';
import { promisify } from 'util';

export const runtime = 'nodejs';

const execFileAsync = promisify(execFile);

function isYouTubeUrl(url: string): boolean {
    return /youtube\.com|youtu\.be/.test(url);
}

export async function GET(req: NextRequest) {
    const url = req.nextUrl.searchParams.get('url');
    if (!url) return NextResponse.json({ error: 'No URL' }, { status: 400 });

    // ── YouTube (including Shorts) ───────────────────────────────────────────
    if (isYouTubeUrl(url)) {
        try {
            const { stdout } = await execFileAsync('yt-dlp', [
                '--print', 'title',
                '--no-download',
                '--no-playlist',
                url,
            ]);
            const title = stdout.trim();
            return NextResponse.json({
                videoUrl: '/api/download?url=' + encodeURIComponent(url),
                pageTitle: title,
                isYoutube: true,
            });
        } catch (err: any) {
            return NextResponse.json({ videoUrl: null, error: 'YouTube error: ' + err.message });
        }
    }

    // ── Other sites ──────────────────────────────────────────────────────────
    const headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,video/*,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Referer': 'https://www.google.com/',
    };

    try {
        const res = await fetch(url, { headers, redirect: 'follow' });
        if (!res.ok) return NextResponse.json({ error: 'HTTP ' + res.status, videoUrl: null }, { status: 200 });

        const contentType = res.headers.get('content-type') || '';
        const finalUrl = res.url;

        if (contentType.startsWith('video/') || contentType === 'application/octet-stream') {
            return NextResponse.json({ videoUrl: '/api/download?url=' + encodeURIComponent(finalUrl), direct: true });
        }

        if (contentType.includes('text/html')) {
            const html = await res.text();
            const rawVideoUrl = extractVideoFromHtml(html, finalUrl);
            if (rawVideoUrl) {
                return NextResponse.json({
                    videoUrl: '/api/download?url=' + encodeURIComponent(rawVideoUrl),
                    rawVideoUrl,
                    pageTitle: extractTitle(html),
                });
            }
            return NextResponse.json({
                videoUrl: null,
                pageTitle: extractTitle(html),
                error: 'No video found in page. Please download the video and upload it manually.',
            });
        }

        return NextResponse.json({ videoUrl: null, error: 'Not a video or HTML page' });
    } catch (err: any) {
        return NextResponse.json({ videoUrl: null, error: err.message });
    }
}

function extractVideoFromHtml(html: string, baseUrl: string): string | null {
    const ogVideo = html.match(/<meta[^>]+property=["']og:video["'][^>]+content=["']([^"']+)["'][^>]*>/i)
        || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:video["'][^>]*>/i);
    if (ogVideo) return ogVideo[1];

    const ogVideoUrl = html.match(/<meta[^>]+property=["']og:video:url["'][^>]+content=["']([^"']+)["'][^>]*>/i)
        || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:video:url["'][^>]*>/i);
    if (ogVideoUrl) return ogVideoUrl[1];

    const ogSecure = html.match(/<meta[^>]+property=["']og:video:secure_url["'][^>]+content=["']([^"']+)["'][^>]*>/i)
        || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:video:secure_url["'][^>]*>/i);
    if (ogSecure) return ogSecure[1];

    const videoSrc = html.match(/<video[^>]+src=["']([^"']+\.(?:mp4|webm|m3u8)[^"']*)['"]/i);
    if (videoSrc) return resolveUrl(videoSrc[1], baseUrl);

    const jsonVideo = html.match(/["']videoUrl["']\s*:\s*["']([^"']+)["']/i);
    if (jsonVideo) return jsonVideo[1];

    const mp4 = html.match(/["'](https?:\/\/[^"']+\.mp4[^"']*?)['"]/);
    if (mp4) return mp4[1];

    return null;
}

function extractTitle(html: string): string {
    const m = html.match(/<title[^>]*>([^<]+)<\/title>/i);
    return m ? m[1].trim() : '';
}

function resolveUrl(url: string, base: string): string {
    if (url.startsWith('http')) return url;
    try {
        const b = new URL(base);
        return url.startsWith('/') ? b.origin + url : b.origin + '/' + url;
    } catch { return url; }
}
