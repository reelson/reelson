/**
 * Per-project settings shared by reelkit-record and reelkit-compose.
 *
 * Each project that uses the kit keeps a `demo.config.json` at its root (copy
 * demo.config.example.json from the kit). The scripts find it by walking up
 * from the scenario / demo directory, then from the working directory. Every
 * field is optional; DEFAULTS below apply to whatever is missing, so a project
 * without a config still works (neutral brand, English strings, no music).
 */
import { existsSync, readFileSync } from 'node:fs'
import { dirname, isAbsolute, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { stringsFor } from './languages.ts'
import { loadSchema, validate } from './validate.ts'

/** JSON Schema for demo.config.json (editors pick it up through `$schema`). */
export const CONFIG_SCHEMA_PATH = resolve(
    dirname(fileURLToPath(import.meta.url)),
    '../schemas/demo.config.schema.json',
)

/** A noun that follows a number: one string, or forms per Intl.PluralRules category. */
export type Label = string | Partial<Record<Intl.LDMLPluralRule, string>> & { other: string }

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
        /** Logo image (SVG, PNG or WebP) shown instead of the text wordmark; relative to the project root. */
        logo: string | null
    }
    /** Template folder name under reelkit-compose/templates/ (or <videosDir>/_templates/). */
    template: string
    /** Section per slot (intro, recap, outro) over the template's defaults; "recap": "none" drops the recap. */
    sections: { intro?: string; recap?: string; outro?: string }
    /** Every piece of on-card text that is not per-video. */
    strings: {
        recapTitle: string
        /** Chip on the cover: "{steps} {stepsLabel} · {seconds} {secondsLabel}". */
        stepsLabel: Label
        secondsLabel: Label
    }
    music: {
        /** Audio file laid under every video, relative to the project root. null = no music. */
        file: string | null
        /** Integrated loudness of the bed under silent footage / under narration. */
        lufs: number
        lufsUnderNarration: number
    }
    /** Voice-over (video.json "voice": true): each callout spoken by OpenAI text-to-speech. */
    voice: {
        /** OpenAI speech model. */
        model: string
        /** OpenAI voice, e.g. "alloy", "ash", "coral", "nova", "sage". */
        voice: string
        /** How to speak (tone, pace, accent) — for models that take instructions. */
        instructions: string
        /** Integrated loudness of the voice track. */
        lufs: number
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
        /**
         * 'layer': the cursor is logged, not filmed, and the video draws it (constant size under
         * zooms, restyled without re-recording). 'recorded': drawn into the page and filmed.
         */
        cursor: 'layer' | 'recorded'
        /**
         * 'screencast': every frame Chrome paints (up to 60 fps), assembled into a smooth
         * 30 fps recording. 'playwright': Playwright's own 25 fps video (the pre-0.5 way).
         */
        capture: 'screencast' | 'playwright'
        /** `reelkit record --mobile`: the Playwright device the phone take uses. */
        mobile: { device: string }
        /** `reelkit record --square`: the browser the square take uses (CSS px). */
        square: { viewport: { width: number; height: number } }
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
        logo: null,
    },
    template: 'classic',
    sections: {},
    strings: {
        recapTitle: 'In short',
        stepsLabel: { one: 'step', other: 'steps' },
        secondsLabel: { one: 'second', other: 'seconds' },
    },
    music: { file: null, lufs: -28, lufsUnderNarration: -34 },
    voice: {
        model: 'gpt-4o-mini-tts',
        voice: 'alloy',
        instructions: 'A calm, friendly product walkthrough narrator: clear, unhurried, warm; no exaggerated enthusiasm.',
        lufs: -16,
    },
    record: {
        viewport: { width: 1440, height: 900 },
        deviceScaleFactor: 2,
        extraHTTPHeaders: { 'X-Demo-Recording': '1' },
        hideSelectors: [],
        personaDomain: 'example.com',
        cursor: 'layer',
        capture: 'screencast',
        mobile: { device: 'Pixel 7' },
        square: { viewport: { width: 1080, height: 1080 } },
    },
}

/**
 * Local-only UI that should never be filmed, hidden in every project on top of
 * `record.hideSelectors`.
 */
export const COMMON_DEV_CHROME = [
    '.phpdebugbar',
    '.phpdebugbar-openhandler', // Laravel Debugbar
    'form[action*="filament-developer-logins"]', // Filament developer logins (login page buttons)
    '[wire\\:snapshot*="menu-logins"]', // … and its "Switch to" topbar menu
    '.sf-toolbar',
    '.sf-minitoolbar', // Symfony web debug toolbar
    '#djDebug', // Django Debug Toolbar
    '.profiler-results', // rack-mini-profiler
    'vite-error-overlay', // Vite
    'nextjs-portal', // Next.js dev indicator
    '#__next-build-watcher',
    '[data-nextjs-toast]',
    '#nuxt-devtools-container', // Nuxt DevTools
    'astro-dev-toolbar', // Astro dev toolbar
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
    const problems = validate(raw, loadSchema(CONFIG_SCHEMA_PATH))
    if (problems.length) {
        throw new ConfigError(path, problems)
    }

    // The language's built-in strings (plurals, recap title) first; demo.config.json `strings` on top.
    const merged = deepMerge({ ...DEFAULTS, strings: stringsFor(raw.language ?? DEFAULTS.language) }, raw)
    // Plural forms replace the defaults as a whole: merging would leak "step" into { other: "pași" }.
    for (const key of ['stepsLabel', 'secondsLabel'] as const) {
        const own = raw.strings?.[key]
        if (own !== undefined) {
            merged.strings[key] = own
        }
    }

    return { ...merged, root: dirname(path), path }
}

export class ConfigError extends Error {
    file: string
    problems: string[]

    constructor(file: string, problems: string[]) {
        super(`${file} is invalid:\n  ${problems.join('\n  ')}`)
        this.file = file
        this.problems = problems
    }
}

/** "1 step", "4 steps", "20 de pași": the count followed by the right plural form. */
export function countLabel(count: number, label: Label, language: string): string {
    if (typeof label === 'string') {
        return `${count} ${label}`
    }
    const category = new Intl.PluralRules(language).select(count)

    return `${count} ${label[category] ?? label.other}`
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
