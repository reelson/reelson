/**
 * Text-to-speech providers for the voice-over (demo.config.json `voice.provider`):
 *
 *   openai      OpenAI's speech API (OPENAI_API_KEY) — or, with `baseURL`, any local server
 *               speaking the same API (Kokoro-FastAPI, Speaches, LocalAI, …)
 *   elevenlabs  ElevenLabs (ELEVENLABS_API_KEY); `voice` is a voice id or a voice's name
 *   piper       Piper, a local neural voice (`pipx install piper-tts`); the voice model is
 *               downloaded once into ~/.cache/reelkit/piper
 *   command     any local program: `command` is its argv, with {text} {out} {voice} {model}
 *               {speed} {language} filled in (the text also comes on stdin); it writes {out}
 *
 * Each speaks one line into a file ffmpeg can read; voice.ts trims and caches it.
 */
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { resolve } from 'node:path'
import { ReelkitError } from './project.ts'

export const PROVIDERS = ['openai', 'elevenlabs', 'piper', 'command'] as const
export type Provider = (typeof PROVIDERS)[number]

export interface SpeechSettings {
    provider: Provider
    model: string
    voice: string
    /** How to speak (tone, pace) — OpenAI's gpt-4o-mini-tts; other providers ignore it. */
    instructions: string
    /** Speaking rate, 1 = the provider's normal pace; undefined: not sent. */
    speed?: number
    /** The project's language (Piper's default voice, ElevenLabs' language_code). */
    language: string
    /** openai: the API root (a local OpenAI-compatible server). */
    baseURL?: string
    /** command: argv with placeholders. */
    command?: string[]
    /** Extra request fields (openai, elevenlabs) or --flags (piper), passed through. */
    options?: Record<string, unknown>
}

const OPENAI_URL = 'https://api.openai.com/v1'

/** The model and voice each provider uses unless demo.config.json / video.json name one. */
export function providerDefaults(provider: Provider, language: string): { model: string; voice: string } {
    switch (provider) {
        case 'openai':
            return { model: 'gpt-4o-mini-tts', voice: 'alloy' }
        case 'elevenlabs':
            // "George", one of ElevenLabs' default voices; the multilingual model speaks 29 languages.
            return { model: 'eleven_multilingual_v2', voice: 'JBFqnCBsd6RMkjVDRZzb' }
        case 'piper':
            return { model: '', voice: PIPER_VOICES[language.split('-')[0].toLowerCase()] ?? '' }
        case 'command':
            return { model: '', voice: '' }
    }
}

/** A good Piper voice per language (https://rhasspy.github.io/piper-samples/). */
const PIPER_VOICES: Record<string, string> = {
    en: 'en_US-lessac-medium',
    ro: 'ro_RO-mihai-medium',
    de: 'de_DE-thorsten-medium',
    fr: 'fr_FR-siwis-medium',
    es: 'es_ES-davefx-medium',
    it: 'it_IT-paola-medium',
    pl: 'pl_PL-gosia-medium',
    pt: 'pt_BR-faber-medium',
    ru: 'ru_RU-irina-medium',
    uk: 'uk_UA-ukrainian_tts-medium',
}

/** Speaks `text` into `out` (any format ffmpeg reads). Throws a ReelkitError on failure. */
export async function speak(text: string, s: SpeechSettings, out: string): Promise<void> {
    switch (s.provider) {
        case 'openai':
            return openai(text, s, out)
        case 'elevenlabs':
            return elevenlabs(text, s, out)
        case 'piper':
            return piper(text, s, out)
        case 'command':
            return command(text, s, out)
    }
}

/** Why this provider cannot speak on this machine (a missing key or program), or null. */
export function missingSetup(s: SpeechSettings): string | null {
    switch (s.provider) {
        case 'openai':
            return !process.env.OPENAI_API_KEY && isOpenAI(s)
                ? 'no OPENAI_API_KEY — export it or put it in a .env next to demo.config.json'
                : null
        case 'elevenlabs':
            return process.env.ELEVENLABS_API_KEY ? null : 'no ELEVENLABS_API_KEY — export it or put it in a .env next to demo.config.json'
        case 'piper':
            if (!s.voice) {
                return `no Piper voice for language "${s.language}" — set voice.voice in demo.config.json (e.g. "en_US-lessac-medium")`
            }
            return found('piper') ? null : 'piper not found — pipx install piper-tts'
        case 'command':
            if (!s.command?.length) {
                return 'voice.provider "command" needs voice.command (argv with {text} and {out})'
            }
            return found(s.command[0]) ? null : `${s.command[0]} not found (voice.command)`
    }
}

function isOpenAI(s: SpeechSettings): boolean {
    return (s.baseURL ?? OPENAI_URL).replace(/\/+$/, '') === OPENAI_URL
}

function found(program: string): boolean {
    const probe = spawnSync(program, ['--help'], { stdio: 'ignore' })
    return !(probe.error && (probe.error as NodeJS.ErrnoException).code === 'ENOENT')
}

async function post(url: string, headers: Record<string, string>, body: unknown, what: string, out: string): Promise<void> {
    let response: Response
    try {
        response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) })
    } catch (error) {
        throw new ReelkitError(`voice-over: cannot reach ${new URL(url).origin} (${(error as Error).message})`)
    }
    if (!response.ok) {
        throw new ReelkitError(`voice-over: ${new URL(url).host} answered ${response.status} for "${what}": ${(await response.text()).slice(0, 300)}`)
    }
    writeFileSync(out, Buffer.from(await response.arrayBuffer()))
}

async function openai(text: string, s: SpeechSettings, out: string): Promise<void> {
    const key = process.env.OPENAI_API_KEY
    await post(
        `${(s.baseURL ?? OPENAI_URL).replace(/\/+$/, '')}/audio/speech`,
        key ? { Authorization: `Bearer ${key}` } : {},
        {
            model: s.model,
            voice: s.voice,
            input: text,
            response_format: 'mp3',
            ...(s.instructions ? { instructions: s.instructions } : {}),
            ...(s.speed !== undefined ? { speed: s.speed } : {}),
            ...s.options,
        },
        text,
        out,
    )
}

/** ElevenLabs voice ids are 20 letters and digits; anything else is a voice's name. */
const ELEVEN_ID = /^[A-Za-z0-9]{20}$/
const ELEVEN_URL = 'https://api.elevenlabs.io'
const elevenVoices = new Map<string, string>()

async function elevenVoiceId(voice: string, key: string): Promise<string> {
    if (ELEVEN_ID.test(voice)) {
        return voice
    }
    if (!elevenVoices.size) {
        const response = await fetch(`${ELEVEN_URL}/v1/voices`, { headers: { 'xi-api-key': key } })
        if (!response.ok) {
            const why = (await response.text()).slice(0, 300)
            throw new ReelkitError(
                response.status === 401 && why.includes('voices_read')
                    ? `voice-over: finding the ElevenLabs voice "${voice}" by name needs the key's Voices (read) permission — give it that, or use the voice id (ElevenLabs → Voices → ⋯ → Copy voice ID)`
                    : `voice-over: ElevenLabs answered ${response.status} listing voices: ${why}`,
            )
        }
        const { voices } = (await response.json()) as { voices: { voice_id: string; name: string }[] }
        for (const v of voices) {
            elevenVoices.set(v.name.toLowerCase(), v.voice_id)
            // "George - Warm, Captivating Storyteller" is found as "George" too.
            elevenVoices.set(v.name.split(/\s[-–]\s/)[0].toLowerCase(), v.voice_id)
        }
    }
    const id = elevenVoices.get(voice.toLowerCase())
    if (!id) {
        throw new ReelkitError(`voice-over: no ElevenLabs voice named "${voice}" in your account — use its voice id, or add it in the Voice Library`)
    }
    return id
}

async function elevenlabs(text: string, s: SpeechSettings, out: string): Promise<void> {
    const key = process.env.ELEVENLABS_API_KEY as string
    const id = await elevenVoiceId(s.voice, key)
    const { voice_settings: own, ...rest } = (s.options ?? {}) as { voice_settings?: Record<string, unknown> }
    const voiceSettings = { ...(s.speed !== undefined ? { speed: s.speed } : {}), ...own }
    await post(
        `${ELEVEN_URL}/v1/text-to-speech/${id}?output_format=mp3_44100_128`,
        { 'xi-api-key': key },
        {
            text,
            model_id: s.model,
            // Only the Flash / Turbo v2.5 models take a language; the others detect it.
            ...(/_v2_5$/.test(s.model) ? { language_code: s.language.split('-')[0] } : {}),
            ...(Object.keys(voiceSettings).length ? { voice_settings: voiceSettings } : {}),
            ...rest,
        },
        text,
        out,
    )
}

/** Where a Piper voice lives on Hugging Face (rhasspy/piper-voices), e.g. ro/ro_RO/mihai/medium/. */
export function piperVoiceURL(voice: string): string {
    const match = /^(([a-z]{2,3})_[A-Z]{2})-(.+)-(x_low|low|medium|high)$/.exec(voice)
    if (!match) {
        throw new ReelkitError(`voice-over: "${voice}" is not a Piper voice name (like "en_US-lessac-medium")`)
    }
    const [, locale, lang, speaker, quality] = match
    return `https://huggingface.co/rhasspy/piper-voices/resolve/main/${lang}/${locale}/${speaker}/${quality}/${voice}.onnx`
}

export const PIPER_DIR = resolve(homedir(), '.cache/reelkit/piper')

async function piperModel(voice: string, log: (l: string) => void): Promise<string> {
    const model = resolve(PIPER_DIR, `${voice}.onnx`)
    if (existsSync(model) && existsSync(`${model}.json`)) {
        return model
    }
    mkdirSync(PIPER_DIR, { recursive: true })
    log(`  voice: downloading the Piper voice ${voice} into ${PIPER_DIR}`)
    const url = piperVoiceURL(voice)
    for (const [from, to] of [[`${url}.json`, `${model}.json`], [url, model]]) {
        const response = await fetch(from)
        if (!response.ok) {
            throw new ReelkitError(`voice-over: cannot download the Piper voice ${voice} (${response.status} ${from})`)
        }
        writeFileSync(to, Buffer.from(await response.arrayBuffer()))
    }
    return model
}

async function piper(text: string, s: SpeechSettings, out: string): Promise<void> {
    const model = await piperModel(s.voice, console.log)
    const flags = Object.entries(s.options ?? {}).flatMap(([k, v]) => [`--${k}`, String(v)])
    const args = ['-m', model, '-f', out, ...(s.speed ? ['--length-scale', String(1 / s.speed)] : []), ...flags]
    const run = spawnSync('piper', args, { input: text, encoding: 'utf8' })
    if (run.status !== 0 || !existsSync(out)) {
        throw new ReelkitError(`voice-over: piper failed for "${text}": ${(run.stderr || run.error?.message || '').trim().slice(-300)}`)
    }
}

/** voice.command's argv with the placeholders filled in. */
export function commandArgs(s: SpeechSettings, text: string, out: string): string[] {
    const values: Record<string, string> = {
        text,
        out,
        voice: s.voice,
        model: s.model,
        speed: String(s.speed ?? 1),
        language: s.language,
    }
    return (s.command ?? []).map((arg) => arg.replace(/\{(text|out|voice|model|speed|language)\}/g, (_, name: string) => values[name]))
}

async function command(text: string, s: SpeechSettings, out: string): Promise<void> {
    const [program, ...args] = commandArgs(s, text, out)
    const run = spawnSync(program, args, { input: text, encoding: 'utf8' })
    if (run.status !== 0 || !existsSync(out)) {
        throw new ReelkitError(
            `voice-over: \`${program}\` did not write the line "${text}" (exit ${run.status}): ${(run.stderr || run.error?.message || '').trim().slice(-300)}`,
        )
    }
}

export interface VoiceInfo {
    /** What goes in voice.voice. */
    id: string
    name: string
    /** Accent, gender, style, languages — whatever the provider tells. */
    about: string
}

/** OpenAI's built-in voices (marin and cedar sound the most natural with gpt-4o-mini-tts). */
const OPENAI_VOICES = ['alloy', 'ash', 'ballad', 'cedar', 'coral', 'echo', 'fable', 'marin', 'nova', 'onyx', 'sage', 'shimmer', 'verse']

/**
 * The voices a provider offers: for Piper, those for `language` unless `all`; for ElevenLabs,
 * the account's — or with `library`, the shared Voice Library's for `language` (usable over the
 * API on a paid plan).
 */
export async function listVoices(provider: Provider, language: string, all = false, library = false): Promise<VoiceInfo[]> {
    switch (provider) {
        case 'openai':
            return OPENAI_VOICES.map((id) => ({
                id,
                name: id,
                about: ['marin', 'cedar'].includes(id) ? 'most natural (gpt-4o-mini-tts)' : ['ballad', 'verse', 'marin', 'cedar'].includes(id) ? 'gpt-4o-mini-tts only' : '',
            }))
        case 'elevenlabs': {
            const key = process.env.ELEVENLABS_API_KEY
            if (!key) {
                throw new ReelkitError('no ELEVENLABS_API_KEY — export it or put it in a .env next to demo.config.json')
            }
            if (library) {
                return elevenLibrary(key, language)
            }
            const response = await fetch(`${ELEVEN_URL}/v1/voices`, { headers: { 'xi-api-key': key } })
            if (!response.ok) {
                throw new ReelkitError(`ElevenLabs answered ${response.status} listing voices: ${(await response.text()).slice(0, 300)}`)
            }
            const { voices } = (await response.json()) as {
                voices: { voice_id: string; name: string; category?: string; labels?: Record<string, string>; verified_languages?: { language: string }[] }[]
            }
            return voices.map((v) => {
                const labels = v.labels ?? {}
                const languages = [...new Set((v.verified_languages ?? []).map((l) => l.language))]
                const [name, tagline] = v.name.split(/\s[-–]\s/)
                return {
                    id: v.voice_id,
                    name,
                    about: [
                        tagline,
                        labels.gender,
                        labels.age?.replace(/_/g, ' '),
                        labels.accent,
                        labels.descriptive ?? labels.description,
                        labels.use_case?.replace(/_/g, ' '),
                        v.category && v.category !== 'premade' ? v.category : '',
                        languages.length > 1 ? `${languages.length} languages` : '',
                        languages.includes(language.split('-')[0].toLowerCase()) ? `verified in "${language}"` : '',
                    ]
                        .filter(Boolean)
                        .join(', '),
                }
            })
        }
        case 'piper': {
            const response = await fetch('https://huggingface.co/rhasspy/piper-voices/resolve/main/voices.json')
            if (!response.ok) {
                throw new ReelkitError(`cannot fetch Piper's voice list (${response.status})`)
            }
            const voices = (await response.json()) as Record<string, { language: { family: string; name_english: string; country_english: string }; quality: string; num_speakers: number }>
            const family = language.split('-')[0].toLowerCase()
            return Object.entries(voices)
                .filter(([, v]) => all || v.language.family === family)
                .map(([id, v]) => ({
                    id,
                    name: id,
                    about: [`${v.language.name_english} (${v.language.country_english})`, v.quality, v.num_speakers > 1 ? `${v.num_speakers} speakers` : '']
                        .filter(Boolean)
                        .join(', '),
                }))
                .sort((a, b) => a.id.localeCompare(b.id))
        }
        case 'command':
            throw new ReelkitError('voice.provider "command": its voices are whatever your program offers')
    }
}

/** The Voice Library's voices for `language`, most used first. */
async function elevenLibrary(key: string, language: string): Promise<VoiceInfo[]> {
    const lang = language.split('-')[0].toLowerCase()
    const response = await fetch(`${ELEVEN_URL}/v1/shared-voices?language=${lang}&page_size=50&sort=usage_character_count_1y`, { headers: { 'xi-api-key': key } })
    if (!response.ok) {
        throw new ReelkitError(`ElevenLabs answered ${response.status} listing the Voice Library: ${(await response.text()).slice(0, 300)}`)
    }
    const { voices } = (await response.json()) as {
        voices: { voice_id: string; name: string; gender?: string; age?: string; accent?: string; use_case?: string; description?: string }[]
    }
    return voices.map((v) => {
        const [name, tagline] = v.name.split(/\s[-–]\s/)
        return {
            id: v.voice_id,
            name: name.trim(),
            about: [tagline, v.gender, v.age?.replace(/_/g, ' '), v.accent !== 'standard' ? v.accent : '', v.use_case?.replace(/_/g, ' ')]
                .filter(Boolean)
                .join(', '),
        }
    })
}
