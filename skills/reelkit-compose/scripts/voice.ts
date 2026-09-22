/**
 * Voice-over: each callout spoken as it appears (video.json "voice": true).
 *
 * Lines are spoken by OpenAI text-to-speech and cached in <demo>/voice/<hash>.mp3 — the hash
 * covers the words, model, voice and instructions, so a line is only paid for once and a
 * re-render never calls the API. `reelkit voice <slug>` (and `render`) fetch the missing
 * lines; the build (sync) mixes whatever is cached into one track per version (landscape,
 * portrait, square: each has its own timing), and says what is missing.
 *
 * What is spoken: a callout's `say` (false: nothing), else its text; plus video.json
 * `voice.intro` over the intro, when given.
 */
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { LoadedConfig } from '../../reelkit-record/scripts/config.ts'
import { ReelkitError } from './project.ts'
import { round, type Timeline, type VideoSpec } from './timeline.ts'

export interface VoiceSettings {
    model: string
    voice: string
    instructions: string
    lufs: number
}

export interface VoiceLine {
    /** Composition seconds the line starts. */
    at: number
    text: string
    /** Cache file name: <hash>.mp3 in <demo>/voice/. */
    file: string
    /** When the next line (or the end of the recording) comes — the line should be done by then. */
    until: number
}

/** A line starts this long after its callout appears (the pill is read, then heard). */
const LEAD_IN = 0.25

/** The voice settings for a video, or null when it has no voice-over. */
export function voiceSettings(spec: VideoSpec, config: LoadedConfig): VoiceSettings | null {
    if (!spec.voice) {
        return null
    }
    const own = typeof spec.voice === 'object' ? spec.voice : {}
    return {
        model: config.voice.model,
        voice: own.voice ?? config.voice.voice,
        instructions: own.instructions ?? config.voice.instructions,
        lufs: config.voice.lufs,
    }
}

/** Everything spoken in this video, in order, timed to `t`. Pure. */
export function voiceLines(t: Timeline, spec: VideoSpec, settings: VoiceSettings): VoiceLine[] {
    const intro = typeof spec.voice === 'object' ? spec.voice.intro : undefined
    const spoken: { at: number; text: string }[] = [
        ...(intro ? [{ at: round(t.intro.start + 0.4), text: intro }] : []),
        ...t.callouts.filter((c) => c.say !== false).map((c) => ({ at: round(c.at + LEAD_IN), text: (c.say || c.text).trim() })),
    ].filter((l) => l.text)
    return spoken.map((line, i) => ({
        ...line,
        file: `${lineHash(line.text, settings)}.mp3`,
        // The intro line runs until the recording comes in; a step's, until the next line.
        until: round(i === 0 && intro ? t.clipStart + 0.6 : (spoken[i + 1]?.at ?? t.clipEnd)),
    }))
}

export function lineHash(text: string, s: VoiceSettings): string {
    return createHash('sha1').update(JSON.stringify([s.model, s.voice, s.instructions, text])).digest('hex').slice(0, 16)
}

/** Every line the video would speak, without a timeline (for fetching). */
export function spokenTexts(spec: VideoSpec, callouts: { text: string; say?: string | false }[]): string[] {
    const intro = typeof spec.voice === 'object' ? spec.voice.intro : undefined
    return [intro, ...callouts.filter((c) => c.say !== false).map((c) => (c.say || c.text).trim())].filter((t): t is string => !!t)
}

/**
 * Fetches the lines missing from `cacheDir` from OpenAI. Returns how many it fetched.
 * Throws a ReelkitError without OPENAI_API_KEY (only when something is missing).
 */
export async function fetchLines(texts: string[], settings: VoiceSettings, cacheDir: string, log: (l: string) => void): Promise<number> {
    const missing = [...new Set(texts)].filter((text) => !existsSync(resolve(cacheDir, `${lineHash(text, settings)}.mp3`)))
    if (!missing.length) {
        return 0
    }
    const key = process.env.OPENAI_API_KEY
    if (!key) {
        throw new ReelkitError(`voice-over: ${missing.length} line(s) to speak and no OPENAI_API_KEY — set it (export OPENAI_API_KEY=…) or turn "voice" off in video.json`)
    }
    mkdirSync(cacheDir, { recursive: true })
    for (const text of missing) {
        const response = await fetch('https://api.openai.com/v1/audio/speech', {
            method: 'POST',
            headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model: settings.model,
                voice: settings.voice,
                input: text,
                response_format: 'mp3',
                ...(settings.instructions ? { instructions: settings.instructions } : {}),
            }),
        })
        if (!response.ok) {
            throw new ReelkitError(`voice-over: OpenAI answered ${response.status} for "${text}": ${(await response.text()).slice(0, 300)}`)
        }
        writeFileSync(resolve(cacheDir, `${lineHash(text, settings)}.mp3`), Buffer.from(await response.arrayBuffer()))
        log(`  voice: spoke "${text}"`)
    }
    return missing.length
}

/** Seconds of audio in `file` (ffprobe). */
function lengthOf(file: string): number {
    const probe = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file], { encoding: 'utf8' })
    return Number.parseFloat(probe.stdout.trim()) || 0
}

/**
 * Mixes the cached lines into one track as long as the video (`target`, m4a). Returns false
 * when none is cached. Warns about missing lines and lines that run into the next one.
 */
export function renderVoiceTrack(
    lines: VoiceLine[],
    settings: VoiceSettings,
    cacheDir: string,
    total: number,
    target: string,
    log: (l: string) => void,
): boolean {
    const cached = lines.filter((l) => existsSync(resolve(cacheDir, l.file)))
    const missing = lines.length - cached.length
    if (missing) {
        log(`  warning: voice-over: ${missing} line(s) not spoken yet — run \`reelkit voice <slug>\` (render does it for you)`)
    }
    if (!cached.length) {
        return false
    }
    for (const line of cached) {
        const length = lengthOf(resolve(cacheDir, line.file))
        if (line.at + length > line.until + 0.05) {
            log(`  warning: voice-over: "${line.text}" (${length.toFixed(1)}s) runs ${(line.at + length - line.until).toFixed(1)}s into the next step — shorten its \`say\`, or pause longer in the scenario`)
        }
    }
    const key = JSON.stringify({ lines: cached.map((l) => [l.at, l.file]), total, lufs: settings.lufs })
    const stamp = `${target}.key`
    if (existsSync(target) && existsSync(stamp) && readFileSync(stamp, 'utf8') === key) {
        return true
    }
    const inputs = cached.flatMap((l) => ['-i', resolve(cacheDir, l.file)])
    const delayed = cached.map((l, i) => `[${i}:a]aresample=48000,adelay=${Math.round(l.at * 1000)}:all=1[v${i}]`).join(';')
    const mix =
        `${delayed};${cached.map((_, i) => `[v${i}]`).join('')}amix=inputs=${cached.length}:normalize=0,` +
        `loudnorm=I=${settings.lufs}:TP=-1.5:LRA=11,apad,atrim=0:${total}[out]`
    const render = spawnSync(
        'ffmpeg',
        ['-y', '-loglevel', 'error', ...inputs, '-filter_complex', mix, '-map', '[out]', '-c:a', 'aac', '-b:a', '160k', target],
        { stdio: 'inherit' },
    )
    if (render.status !== 0) {
        throw new ReelkitError('ffmpeg could not mix the voice-over')
    }
    writeFileSync(stamp, key)
    return true
}
