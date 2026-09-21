/**
 * Per-project settings shared by demo-record and demo-video.
 *
 * Each project that uses the kit keeps a `demo.config.json` at its root (copy
 * demo.config.example.json from the kit). The scripts find it by walking up
 * from the scenario / demo directory, then from the working directory. Every
 * field is optional; DEFAULTS below apply to whatever is missing, so a project
 * without a config still works (neutral brand, English strings, no music).
 */
import { existsSync, readFileSync } from 'node:fs'
import { dirname, isAbsolute, resolve } from 'node:path'

export interface DemoConfig {
    /** Where demo folders live, relative to the project root. */
    videosDir: string
    /** BCP 47 language of the product UI; drives <html lang> and persona names. */
    language: string
    /** Browser locale while recording (Accept-Language, Intl formatting). */
    locale: string
    brand: {
        /** Wordmark on the cover and the closing card, e.g. "ACME". */
        name: string
        /** Small spaced line under the wordmark, e.g. "PLATFORM". Empty hides it. */
        tagline: string
        /** Label above the recap title, e.g. "Acme". */
        eyebrow: string
        /** Primary accent (numbers, lines, click ring). Any CSS color. */
        color: string
        /** Lighter accent for gradients. */
        colorSoft: string
    }
    /** Template folder name under demo-video/templates/ (or <videosDir>/_templates/). */
    template: string
    /** Every piece of on-card text that is not per-video. */
    strings: {
        recapTitle: string
        /** Chip on the cover: "{steps} {stepsLabel} · {seconds} {secondsLabel}". */
        stepsLabel: string
        secondsLabel: string
    }
    music: {
        /** Audio file laid under every video, relative to the project root. null = no music. */
        file: string | null
        /** Integrated loudness of the bed under silent footage / under narration. */
        lufs: number
        lufsUnderNarration: number
    }
    record: {
        viewport: { width: number; height: number }
        /** Capture pixel ratio; 2 keeps UI text sharp in the 1080p frame and under zooms. */
        deviceScaleFactor: number
        /** Sent with every request so the app can switch off local-only prefills on camera. */
        extraHTTPHeaders: Record<string, string>
        /** CSS selectors hidden in every recorded page (dev toolbars, env badges). */
        hideSelectors: string[]
        /** Email domain for demo.persona(). Use one that resolves if a gateway validates emails. */
        personaDomain: string
    }
}

export const DEFAULTS: DemoConfig = {
    videosDir: 'docs/videos',
    language: 'en',
    locale: 'en-US',
    brand: {
        name: 'YOUR BRAND',
        tagline: 'PRODUCT',
        eyebrow: 'Your Brand',
        color: '#dc2626',
        colorSoft: '#f87171',
    },
    template: 'classic',
    strings: {
        recapTitle: 'In short',
        stepsLabel: 'steps',
        secondsLabel: 'seconds',
    },
    music: { file: null, lufs: -28, lufsUnderNarration: -34 },
    record: {
        viewport: { width: 1440, height: 900 },
        deviceScaleFactor: 2,
        extraHTTPHeaders: { 'X-Demo-Recording': '1' },
        hideSelectors: [],
        personaDomain: 'example.com',
    },
}

/**
 * Local-only UI that should never be filmed, hidden in every project on top of
 * `record.hideSelectors`.
 */
export const COMMON_DEV_CHROME = [
    '.phpdebugbar',
    '.phpdebugbar-openhandler', // Laravel Debugbar
    'vite-error-overlay', // Vite
    'nextjs-portal', // Next.js dev indicator
    '#__next-build-watcher',
    '[data-nextjs-toast]',
    '#webpack-dev-server-client-overlay',
]

export interface LoadedConfig extends DemoConfig {
    /** Directory holding demo.config.json (or the working directory without one). */
    root: string
    /** Path of the config file, when one was found. */
    path: string | null
}

export function loadConfig(...startDirs: string[]): LoadedConfig {
    const path = [...startDirs, process.cwd()]
        .map((dir) => findUp(resolve(dir), 'demo.config.json'))
        .find((p): p is string => p !== null)
    if (!path) {
        return { ...DEFAULTS, root: process.cwd(), path: null }
    }
    const raw = JSON.parse(readFileSync(path, 'utf8')) as Partial<DemoConfig>

    return {
        ...deepMerge(DEFAULTS, raw),
        root: dirname(path),
        path,
    }
}

/** Resolves a path from the config against the project root. */
export function fromRoot(config: LoadedConfig, path: string): string {
    return isAbsolute(path) ? path : resolve(config.root, path)
}

function findUp(dir: string, name: string): string | null {
    let current = dir
    while (true) {
        const candidate = resolve(current, name)
        if (existsSync(candidate)) {
            return candidate
        }
        const parent = dirname(current)
        if (parent === current) {
            return null
        }
        current = parent
    }
}

function deepMerge<T>(base: T, override: unknown): T {
    if (!isPlainObject(base) || !isPlainObject(override)) {
        return (override === undefined ? base : override) as T
    }
    const out: Record<string, unknown> = { ...base }
    for (const [key, value] of Object.entries(override)) {
        if (key.startsWith('$')) {
            continue
        }
        out[key] = deepMerge((base as Record<string, unknown>)[key], value)
    }

    return out as T
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
    return typeof v === 'object' && v !== null && !Array.isArray(v)
}
