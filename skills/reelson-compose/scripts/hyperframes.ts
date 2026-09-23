/**
 * The one place the HyperFrames version is pinned. Everything that renders or
 * checks goes through `hyperframes()`, so an upgrade is a one-line change here
 * (verified by the CI smoke test).
 */
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { copyFileSync, existsSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, resolve } from 'node:path'

export const HYPERFRAMES_VERSION = '0.8.46'

/** Runs `npx hyperframes@<pinned> <args>` in `cwd`; returns the exit code. */
export function hyperframes(args: string[], cwd: string): number {
    const run = spawnSync('npx', ['--yes', `hyperframes@${HYPERFRAMES_VERSION}`, ...args], {
        cwd,
        stdio: 'inherit',
    })

    return run.status ?? 1
}

/**
 * Runs `hyperframes <args>` on one composition of a built video (index.html, portrait.html,
 * square.html). `check` and `snapshot` only look at index.html, and lint a project with several
 * root compositions as an error — so the composition runs alone, as the index.html of a scratch
 * project that links the built assets. Output paths in `args` must be absolute.
 */
export function hyperframesOn(videoDir: string, composition: string, args: string[]): number {
    if (composition === 'index.html' && args[0] !== 'check') {
        return hyperframes(args, videoDir)
    }
    const scratch = mkdtempSync(resolve(tmpdir(), 'reelson-hf-'))
    try {
        symlinkSync(resolve(videoDir, 'assets'), resolve(scratch, 'assets'))
        copyFileSync(resolve(videoDir, 'hyperframes.json'), resolve(scratch, 'hyperframes.json'))
        copyFileSync(resolve(videoDir, composition), resolve(scratch, 'index.html'))
        writeFileSync(resolve(scratch, 'package.json'), '{ "private": true }\n')
        return hyperframes(args, scratch)
    } finally {
        rmSync(scratch, { recursive: true, force: true })
    }
}

/** HyperFrames' default frame rate (renders and snapshots): a video's last frame is at total − 1/FPS. */
export const FPS = 30

/** Render flags that keep the 2x capture sharp (see the reelson-compose skill). */
export const RENDER_FLAGS = ['--video-frame-format', 'jpg', '-q', 'delivery']

/** A quick look: half the frames, draft encoding — about twice as fast. */
export const DRAFT_FLAGS = ['--video-frame-format', 'jpg', '-q', 'draft', '--fps', '15']

/**
 * Renders `videoDir` to `output` (relative to it) with `flags`, unless nothing it depends on
 * changed since the last render there: index.html, every asset (by size and mtime), the
 * flags and the pinned HyperFrames version. Returns 'rendered' | 'unchanged' | 'failed'.
 */
export function renderIfChanged(
    videoDir: string,
    output: string,
    flags: string[],
    force = false,
    composition = 'index.html',
): 'rendered' | 'unchanged' | 'failed' {
    const target = resolve(videoDir, output)
    const stamp = `${target}.key`
    const key = renderKey(videoDir, [...flags, output], composition)
    if (!force && existsSync(target) && existsSync(stamp) && readFileSync(stamp, 'utf8') === key) {
        return 'unchanged'
    }
    const which = composition === 'index.html' ? [] : ['-c', composition]
    if (hyperframes(['render', '.', ...which, ...flags, '-o', output], videoDir) !== 0) {
        return 'failed'
    }
    writeFileSync(stamp, key)
    return 'rendered'
}

/** The README-sized GIF `render --gif` makes: width (px), frame rate and palette size. */
export const GIF = { width: 720, fps: 12, colors: 128 }

/**
 * Converts a rendered MP4 (relative to `videoDir`) to `output` with ffmpeg — a palette made for this
 * video, no dithering (it turns the soft backgrounds into noise and doubles the size). Skipped when the
 * MP4 has not been re-rendered since (its .key is unchanged). HyperFrames' own GIF encoder is not used:
 * it fails with ffmpeg 7.0 and renders every frame a second time.
 */
export function gifIfChanged(videoDir: string, source: string, output: string, force = false): 'rendered' | 'unchanged' | 'failed' {
    const target = resolve(videoDir, output)
    const stamp = `${target}.key`
    const sourceKey = resolve(videoDir, `${source}.key`)
    const key = createHash('sha1')
        .update(existsSync(sourceKey) ? readFileSync(sourceKey) : String(statSync(resolve(videoDir, source)).mtimeMs))
        .update(JSON.stringify(GIF))
        .digest('hex')
    if (!force && existsSync(target) && existsSync(stamp) && readFileSync(stamp, 'utf8') === key) {
        return 'unchanged'
    }
    const filter =
        `fps=${GIF.fps},scale=${GIF.width}:-2:flags=lanczos,split[a][b];` +
        `[a]palettegen=stats_mode=diff:max_colors=${GIF.colors}[p];[b][p]paletteuse=dither=none:diff_mode=rectangle`
    const run = spawnSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', resolve(videoDir, source), '-vf', filter, '-loop', '0', target], {
        stdio: 'inherit',
    })
    if (run.status !== 0) {
        return 'failed'
    }
    writeFileSync(stamp, key)
    return 'rendered'
}

export function renderKey(videoDir: string, args: string[], composition = 'index.html'): string {
    const hash = createHash('sha1').update(HYPERFRAMES_VERSION).update(JSON.stringify(args))
    hash.update(readFileSync(resolve(videoDir, composition)))
    const walk = (dir: string): void => {
        for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
            const path = resolve(dir, entry.name)
            if (entry.isDirectory()) {
                walk(path)
            } else if (!entry.name.endsWith('.key')) {
                const { size, mtimeMs } = statSync(path)
                hash.update(`${path}:${size}:${mtimeMs}\n`)
            }
        }
    }
    if (existsSync(resolve(videoDir, 'assets'))) {
        walk(resolve(videoDir, 'assets'))
    }
    return hash.digest('hex')
}

let dist: string | null = null

/**
 * The pinned HyperFrames package's dist/ (player + runtime), from the npx cache.
 * The studio serves both from here, so the preview works offline.
 */
export function hyperframesDist(): string {
    if (dist) {
        return dist
    }
    const which = spawnSync('npm', ['exec', '--yes', `--package=hyperframes@${HYPERFRAMES_VERSION}`, '-c', 'which hyperframes'], {
        encoding: 'utf8',
    })
    const bin = which.stdout.trim().split('\n').at(-1)
    if (which.status !== 0 || !bin) {
        throw new Error(`could not install hyperframes@${HYPERFRAMES_VERSION}: ${which.stderr.trim()}`)
    }
    dist = resolve(dirname(realpathSync(bin)), '..', 'dist')
    if (!existsSync(resolve(dist, 'hyperframes-player.global.js'))) {
        throw new Error(`no HyperFrames player in ${dist}`)
    }

    return dist
}
