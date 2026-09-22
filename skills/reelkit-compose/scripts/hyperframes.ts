/**
 * The one place the HyperFrames version is pinned. Everything that renders or
 * checks goes through `hyperframes()`, so an upgrade is a one-line change here
 * (verified by the CI smoke test).
 */
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, readdirSync, readFileSync, realpathSync, statSync, writeFileSync } from 'node:fs'
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

/** HyperFrames' default frame rate (renders and snapshots): a video's last frame is at total − 1/FPS. */
export const FPS = 30

/** Render flags that keep the 2x capture sharp (see the reelkit-compose skill). */
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
