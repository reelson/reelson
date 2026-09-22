/**
 * `reelkit studio <slug>`: a local preview and editor for a demo. The built
 * composition plays in the HyperFrames player above a timeline drawn from the
 * same plan the build uses (sections, callouts, zooms, hand-offs, clicks,
 * markers, audio). video.json, markers.json, the recording and every
 * template/section folder are watched: a change rebuilds and the page reloads
 * in place, at the same time.
 *
 * Edits made on the page come back as a whole video.json (PUT /api/video): it
 * is validated and planned before it is written, and refused if video.json
 * changed on disk since the page loaded it.
 *
 *   reelkit studio <slug|dir> [--port 4800] [--no-open]
 */
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, statSync, watch, writeFileSync, type FSWatcher } from 'node:fs'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { basename, extname, resolve, sep } from 'node:path'
import { fromRoot, type LoadedConfig } from '../../reelkit-record/scripts/config.ts'
import { build, planSpec, serializeVideoSpec, type Plan } from './build.ts'
import { hyperframesDist } from './hyperframes.ts'
import { BUILTIN_SECTIONS, BUILTIN_TEMPLATES, catalog, readMarkers, ReelkitError, validateVideoSpec } from './project.ts'
import { defaultCallouts, round, SLOTS, type VideoSpec } from './timeline.ts'
import { checkZoom, zoomOverlaps } from './zooms.ts'

const STUDIO_DIR = resolve(import.meta.dirname, '../studio')

/** What the studio page draws: the plan, flattened to plain JSON in composition seconds. */
export interface StudioData {
    slug: string
    title: string
    total: number
    frame: { width: number; height: number }
    template: string
    /** video.json as on disk (without `$schema`): what the page edits. */
    spec: VideoSpec
    /** The trim window and the recording's length, in recording seconds. */
    media: { start: number; end: number; duration: number }
    /** What a trim edge can be tied to, in recording seconds (click: when its glide starts). */
    anchors: { markers: { label: string; at: number }[]; clicks: { n: number; at: number }[] }
    /** Composition ↔ recording time: one entry per stretch of footage between hand-offs. */
    segments: { start: number; duration: number; mediaStart: number }[]
    sections: { slot: 'intro' | 'recording' | 'recap' | 'outro'; name: string; start: number; end: number; detail: string }[]
    /** `source`: index in `spec.callouts` (or in the default callouts when it has none). */
    callouts: { n: number; source: number; at: number; end: number; text: string; group?: string }[]
    zooms: { n: number; at: number; end: number; in: number; out: number; scale: number; x: number; y: number; problems: string[] }[]
    handOffs: { at: number; end: number; belt: number; title: string; subtitle?: string; from?: string; to?: string }[]
    clicks: { n: number; kind: 'click' | 'type'; glide: number; at: number; until: number }[]
    markers: { label: string; at: number; recordingAt: number; used: boolean }[]
    audio: { narration: { start: number; end: number } | null; music: { start: number; end: number } | null }
    /**
     * 'layer': drawn by the video (size, ripple and `presses` apply); 'hidden': logged but
     * turned off in video.json; 'filmed': part of the footage, nothing to set.
     */
    cursor: { state: 'layer' | 'hidden' | 'filmed'; size: number; ripple: boolean; presses: number[] }
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
    const overlaps = zoomOverlaps(zooms)
    const used = new Set((spec.callouts ?? defaultCallouts(markers)).map((c) => c.marker).filter(Boolean))

    return {
        slug,
        title: spec.title,
        total: t.total,
        frame: t.frame,
        template: design.template.name,
        // The page edits callouts by index, so the default ones are spelled out.
        spec: { ...withoutSchema(spec), callouts: spec.callouts ?? defaultCallouts(markers) },
        media: { start: t.mediaStart, end: t.mediaEnd, duration: markers.durationSeconds },
        anchors: {
            markers: markers.markers.map((m) => ({ label: m.label, at: m.at })),
            clicks: (markers.clicks ?? []).map((c, i) => ({ n: i + 1, at: c.move ?? c.at })),
        },
        segments: t.segments,
        sections,
        callouts: t.callouts.map((c, i) => ({
            n: i + 1,
            source: c.source,
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
            problems: [...checkZoom(z, clicks, t).problems, ...overlaps.filter((o) => o.index === i).map((o) => o.message)],
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
        cursor: t.cursor
            ? { state: 'layer', size: t.cursor.size, ripple: t.cursor.ripple, presses: t.cursor.presses.map(([at]) => at) }
            : {
                  state: markers.cursor && !markers.cursor.drawn ? 'hidden' : 'filmed',
                  size: spec.cursor ? (spec.cursor.size ?? 44) : 44,
                  ripple: spec.cursor ? (spec.cursor.ripple ?? true) : true,
                  presses: [],
              },
        warnings,
    }
}

/** A short hash of video.json as it is on disk ('' when there is none). */
export function specRevision(demoDir: string): string {
    const path = resolve(demoDir, 'video.json')
    return existsSync(path) ? createHash('sha1').update(readFileSync(path)).digest('hex').slice(0, 12) : ''
}

/**
 * The page's edit (PUT /api/video): refused (409) if video.json changed since the page read
 * it (`base` is the revision it read), refused (422) if it fails the schema or the plan —
 * nothing is written then — else written as the build would write it. The caller rebuilds.
 */
export function applyEdit(
    demoDir: string,
    config: LoadedConfig,
    body: { base?: string; spec?: unknown },
): { status: number; body: { error?: string; warnings?: string[] }; written?: string } {
    if (body.base !== specRevision(demoDir)) {
        return { status: 409, body: { error: 'video.json changed on disk since the page loaded it — reloaded; redo the edit' } }
    }
    try {
        const spec = validateVideoSpec(body.spec, 'the edit')
        const { warnings } = planSpec(demoDir, spec, readMarkers(demoDir), config)
        const written = serializeVideoSpec(spec, demoDir, config)
        writeFileSync(resolve(demoDir, 'video.json'), written)
        return { status: 200, body: { warnings }, written }
    } catch (e) {
        return { status: 422, body: { error: (e as Error).message } }
    }
}

function withoutSchema(spec: VideoSpec): VideoSpec {
    const { $schema: _schema, ...rest } = spec as VideoSpec & { $schema?: string }
    return rest
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

    const specPath = resolve(demoDir, 'video.json')
    const revision = (): string => specRevision(demoDir)
    // What the page can pick from: re-read per request, so a new section shows up without a restart.
    const choices = () => {
        const found = catalog(config)
        return {
            templates: found.templates.map((t) => t.name),
            ...Object.fromEntries(SLOTS.map((slot) => [slot, found.sections[slot].map((s) => s.name)])),
        }
    }
    /** The page's edit: checked like a build would, then written and built. */
    let written: string | null = null
    const edit = (body: { base?: string; spec?: unknown }): { status: number; body: object } => {
        const result = applyEdit(demoDir, config, body)
        if (result.written === undefined) {
            return result
        }
        written = result.written
        rebuild()
        // Written either way; a failed build shows on the page like any other.
        return { status: 200, body: { ...result.body, error, revision: revision() } }
    }

    const server = createServer((req, res) => {
        const url = new URL(req.url ?? '/', 'http://localhost')
        const path = decodeURIComponent(url.pathname)
        if (path === '/') {
            return sendFile(res, resolve(STUDIO_DIR, 'index.html'))
        }
        if (path.startsWith('/studio/')) {
            const file = resolve(STUDIO_DIR, `.${path.slice('/studio'.length)}`)
            if (file.startsWith(STUDIO_DIR + sep)) {
                return sendFile(res, file)
            }
        }
        if (path === '/api/plan') {
            return send(res, 200, 'application/json', JSON.stringify({ version, error, revision: revision(), choices: choices(), data }))
        }
        if (path === '/api/video' && req.method === 'PUT') {
            readBody(req).then(
                (raw) => {
                    let body
                    try {
                        body = JSON.parse(raw)
                    } catch {
                        return send(res, 400, 'application/json', JSON.stringify({ error: 'the edit is not JSON' }))
                    }
                    const result = edit(body)
                    send(res, result.status, 'application/json', JSON.stringify(result.body))
                },
                () => send(res, 400, 'application/json', JSON.stringify({ error: 'unreadable request' })),
            )
            return
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
    // The page's own writes are already built; only a change from elsewhere rebuilds.
    const ownWrite = (file: string): boolean =>
        file === 'video.json' && written !== null && existsSync(specPath) && readFileSync(specPath, 'utf8') === written
    const watchers: FSWatcher[] = [
        watch(demoDir, (_event, file) => file && inputs.has(file.toString()) && !ownWrite(file.toString()) && schedule()),
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

function readBody(req: IncomingMessage): Promise<string> {
    return new Promise((done, fail) => {
        const chunks: Buffer[] = []
        req.on('data', (chunk: Buffer) => chunks.push(chunk))
        req.on('end', () => done(Buffer.concat(chunks).toString('utf8')))
        req.on('error', fail)
    })
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
