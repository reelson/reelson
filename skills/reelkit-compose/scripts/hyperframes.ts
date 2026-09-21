/**
 * The one place the HyperFrames version is pinned. Everything that renders or
 * checks goes through `hyperframes()`, so an upgrade is a one-line change here
 * (verified by the CI smoke test).
 */
import { spawnSync } from 'node:child_process'

export const HYPERFRAMES_VERSION = '0.8.46'

/** Runs `npx hyperframes@<pinned> <args>` in `cwd`; returns the exit code. */
export function hyperframes(args: string[], cwd: string): number {
    const run = spawnSync('npx', ['--yes', `hyperframes@${HYPERFRAMES_VERSION}`, ...args], {
        cwd,
        stdio: 'inherit',
    })

    return run.status ?? 1
}

/** Render flags that keep the 2x capture sharp (see the reelkit-compose skill). */
export const RENDER_FLAGS = ['--video-frame-format', 'jpg', '-q', 'delivery']
