import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Markers } from '../skills/reelkit-compose/scripts/timeline.ts'
import { DEFAULTS, type LoadedConfig } from '../skills/reelkit-record/scripts/config.ts'

export const TEST_DIR = dirname(fileURLToPath(import.meta.url))
export const KIT = resolve(TEST_DIR, '..')

/** A fresh copy each call, so tests can't leak mutations into each other. */
export function fixture(name: 'todo' | 'handoff'): Markers {
    return JSON.parse(readFileSync(resolve(TEST_DIR, `fixtures/markers-${name}.json`), 'utf8')) as Markers
}

/** The kit's defaults, as if run in a project without its own templates or sections. */
export function kitConfig(): LoadedConfig {
    return { ...DEFAULTS, root: TEST_DIR, path: null, videosDir: 'no-such-videos-dir' }
}
