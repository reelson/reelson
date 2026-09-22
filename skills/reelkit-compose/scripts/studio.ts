/**
 * `reelkit studio <slug>`: a local, read-only preview of a demo. The built
 * composition plays in the HyperFrames player above a timeline drawn from the
 * same plan the build uses (sections, callouts, zooms, hand-offs, clicks,
 * markers, audio). video.json, markers.json, the recording and every
 * template/section folder are watched: a change rebuilds and the page reloads
 * in place, at the same time.
 *
 *   reelkit studio <slug|dir> [--port 4800] [--no-open]
 */
import { existsSync, readFileSync, statSync, watch, type FSWatcher } from 'node:fs'
import { createServer, type ServerResponse } from 'node:http'
import { basename, extname, resolve, sep } from 'node:path'
import { fromRoot, type LoadedConfig } from '../../reelkit-record/scripts/config.ts'
import { build, type Plan } from './build.ts'
import { hyperframesDist } from './hyperframes.ts'
import { BUILTIN_SECTIONS, BUILTIN_TEMPLATES, ReelkitError } from './project.ts'
import { defaultCallouts, round } from './timeline.ts'
import { checkZoom } from './zooms.ts'

const STUDIO_PAGE = resolve(import.meta.dirname, '../studio/index.html')

/** What the studio page draws: the plan, flattened to plain JSON in composition seconds. */
export interface StudioData {
    slug: string
    title: string
    total: number
    frame: { width: number; height: number }
    template: string
    sections: { slot: 'intro' | 'recording' | 'recap' | 'outro'; name: string; start: number; end: number; detail: string }[]
    callouts: { n: number; at: number; end: number; text: string; group?: string }[]
    zooms: { n: number; at: number; end: number; in: number; out: number; scale: number; x: number; y: number; problems: string[] }[]
    handOffs: { at: number; end: number; belt: number; title: string; subtitle?: string; from?: string; to?: string }[]
    clicks: { n: number; kind: 'click' | 'type'; glide: number; at: number; until: number }[]
    markers: { label: string; at: number; recordingAt: number; used: boolean }[]
    audio: { narration: { start: number; end: number } | null; music: { start: number; end: number } | null }
    warnings: string[]
}

export function studioData(slug: string, result: Plan, audio: { narration: boolean; music: boolean }): StudioData {
    const { spec, markers, design, timeline: t, clicks, zooms, warnings } = result
    const { intro, recap, outro } = design.sections
    const sections: StudioData['sections'] = [
        { slot: 'intro', name: intro.name, start: 0, end: t.intro.duration, detail: `hands over at ${t.intro.exit}s` },
        {
            slot: 'recording',
            name: 'recording',
            start: t.clipStart,
            end: t.clipEnd,
            detail: `media ${t.mediaStart}–${t.mediaEnd}s of ${markers.durationSeconds}s`,
        },
    ]
    if (recap && t.recap) {
        sections.push({
            slot: 'recap',
            name: recap.name,
            start: t.recap.start,
            end: round(t.recap.start + t.recap.duration),
            detail: `holds ${t.recap.maxSteps} steps`,
        })
    }
    sections.push({ slot: 'outro', name: outro.name, start: t.outro.start, end: t.total, detail: '' })

    // Without callouts in video.json the build makes one per marker, so all of them are used.
    const used = new Set((spec.callouts ?? defaultCallouts(markers)).map((c) => c.marker).filter(Boolean))

    return {
        slug,
        title: spec.title,
        total: t.total,
        frame: t.frame,
        template: design.template.name,
        sections,
        callouts: t.callouts.map((c, i) => ({
            n: i + 1,
            at: c.at,
            end: round(c.at + c.duration),
            text: c.text,
            ...(c.group ? { group: c.group } : {}),
        })),
        zooms: zooms.map((z, i) => ({
            n: i + 1,
            at: z.at,
            end: round(z.at + z.duration),
            in: z.in,
            out: z.out,
            scale: z.scale,
            x: z.x,
            y: z.y,
            problems: checkZoom(z, clicks, t).problems,
        })),
        handOffs: t.transitions.map((tr) => ({
            at: tr.at,
            end: round(tr.at + tr.gap),
            belt: t.belt,
            title: tr.card.title,
            ...(tr.card.subtitle ? { subtitle: tr.card.subtitle } : {}),
            ...(tr.card.from ? { from: tr.card.from } : {}),
            ...(tr.card.to ? { to: tr.card.to } : {}),
        })),
        clicks: clicks.map((c) => ({ n: c.index, kind: c.kind, glide: c.glide, at: c.comp, until: c.until })),
        markers: markers.markers
            .filter((m) => m.at >= t.mediaStart && m.at <= t.mediaEnd)
            .map((m) => ({ label: m.label, at: t.toComposition(m.at), recordingAt: m.at, used: used.has(m.label) })),
        audio: {
            narration: audio.narration ? { start: t.clipStart, end: t.clipEnd } : null,
            music: audio.music ? { start: 0, end: t.total } : null,
        },
        warnings,
    }
}

export interface StudioOptions {
    port?: number
    log?: (line: string) => void
}

/** Builds the demo, then serves the studio until the process exits. Resolves with its URL. */
export async function studio(demoDir: string, config: LoadedConfig, options: StudioOptions = {}): Promise<string> {
    const log = options.log ?? console.log
    const slug = basename(demoDir)
    const videoDir = resolve(demoDir, 'video')
    const dist = hyperframesDist()

    let data: StudioData | null = null
    let error: string | null = null
    let version = 0
    const clients = new Set<ServerResponse>()
    const rebuild = (): void => {
        try {
            const result = build(demoDir, config, { log: () => {} })
            const has = (file: string) => existsSync(resolve(videoDir, 'assets', file))
            data = studioData(slug, result, { narration: has('narration.m4a'), music: has('music.m4a') })
            error = null
        } catch (e) {
            // Keep serving the last good build; the page shows the error until the next save fixes it.
            error = (e as Error).message
        }
        version++
        for (const client of clients) {
            client.write(`data: ${JSON.stringify({ version, error })}\n\n`)
        }
    }
    rebuild()
    if (!data) {
        throw new ReelkitError(error ?? 'build failed')
    }

    const server = createServer((req, res) => {
        const url = new URL(req.url ?? '/', 'http://localhost')
        const path = decodeURIComponent(url.pathname)
        if (path === '/') {
            return send(res, 200, 'text/html', readFileSync(STUDIO_PAGE))
        }
        if (path === '/api/plan') {
            return send(res, 200, 'application/json', JSON.stringify({ version, error, data }))
        }
        if (path === '/api/events') {
            res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' })
            res.write(': connected\n\n')
            clients.add(res)
            req.on('close', () => clients.delete(res))
            return
        }
        if (path === '/hf/player.js') {
            return sendFile(res, resolve(dist, 'hyperframes-player.global.js'))
        }
        if (path === '/hf/runtime.js') {
            return sendFile(res, resolve(dist, 'hyperframe.runtime.iife.js'))
        }
        if (path === '/video/index.html') {
            // The runtime ships with the page instead of the player fetching it from a CDN.
            const html = readFileSync(resolve(videoDir, 'index.html'), 'utf8').replace(
                '</head>',
                '    <script src="/hf/runtime.js"></script>\n  </head>',
            )
            return send(res, 200, 'text/html', html)
        }
        if (path.startsWith('/video/')) {
            const file = resolve(videoDir, `.${path.slice('/video'.length)}`)
            if (file.startsWith(videoDir + sep)) {
                return sendFile(res, file, req.headers.range)
            }
        }
        send(res, 404, 'text/plain', 'not found')
    })

    // Rebuild on any input the build reads; editors write in bursts, so settle first.
    let timer: NodeJS.Timeout | undefined
    const schedule = (): void => {
        clearTimeout(timer)
        timer = setTimeout(() => {
            rebuild()
            log(error ? `rebuild failed: ${error}` : `rebuilt (${new Date().toLocaleTimeString()})`)
        }, 250)
    }
    const inputs = new Set(['video.json', 'markers.json', 'recording.mp4'])
    const watchers: FSWatcher[] = [
        watch(demoDir, (_event, file) => file && inputs.has(file.toString()) && schedule()),
        ...[
            BUILTIN_TEMPLATES,
            BUILTIN_SECTIONS,
            resolve(fromRoot(config, config.videosDir), '_templates'),
            resolve(fromRoot(config, config.videosDir), '_sections'),
        ]
            .filter((dir) => existsSync(dir))
            .map((dir) => watch(dir, { recursive: true }, schedule)),
    ]
    if (config.path) {
        watchers.push(watch(config.path, schedule))
    }
    server.on('close', () => watchers.forEach((w) => w.close()))

    const port = options.port ?? 4800
    await new Promise<void>((done, fail) => {
        server.once('error', (e: NodeJS.ErrnoException) =>
            fail(e.code === 'EADDRINUSE' ? new ReelkitError(`port ${port} is in use — pass --port`) : e),
        )
        server.listen(port, '127.0.0.1', done)
    })

    return `http://localhost:${port}/`
}

const TYPES: Record<string, string> = {
    '.html': 'text/html',
    '.js': 'text/javascript',
    '.css': 'text/css',
    '.json': 'application/json',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.webp': 'image/webp',
    '.woff2': 'font/woff2',
    '.mp4': 'video/mp4',
    '.m4a': 'audio/mp4',
}

function send(res: ServerResponse, status: number, type: string, body: string | Buffer): void {
    res.writeHead(status, { 'content-type': type, 'cache-control': 'no-store' })
    res.end(body)
}

/** A file, with byte ranges so the browser can seek video and audio. */
function sendFile(res: ServerResponse, file: string, range?: string): void {
    if (!existsSync(file) || !statSync(file).isFile()) {
        return send(res, 404, 'text/plain', 'not found')
    }
    const type = TYPES[extname(file).toLowerCase()] ?? 'application/octet-stream'
    const body = readFileSync(file)
    const match = range?.match(/^bytes=(\d*)-(\d*)$/)
    if (!match) {
        res.writeHead(200, { 'content-type': type, 'content-length': body.length, 'accept-ranges': 'bytes', 'cache-control': 'no-store' })
        return void res.end(body)
    }
    const start = match[1] ? Number(match[1]) : Math.max(0, body.length - Number(match[2]))
    const end = match[1] && match[2] ? Math.min(Number(match[2]), body.length - 1) : body.length - 1
    res.writeHead(206, {
        'content-type': type,
        'content-length': end - start + 1,
        'content-range': `bytes ${start}-${end}/${body.length}`,
        'accept-ranges': 'bytes',
        'cache-control': 'no-store',
    })
    res.end(body.subarray(start, end + 1))
}
