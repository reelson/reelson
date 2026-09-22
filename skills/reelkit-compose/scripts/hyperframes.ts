/**
 * The one place the HyperFrames version is pinned. Everything that renders or
 * checks goes through `hyperframes()`, so an upgrade is a one-line change here
 * (verified by the CI smoke test).
 */
import { spawnSync } from 'node:child_process'
import { existsSync, realpathSync } from 'node:fs'
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
