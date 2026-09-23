/**
 * Voice-over: each callout spoken as it appears (video.json "voice": true).
 *
 * Lines are spoken by a text-to-speech provider (demo.config.json `voice.provider`: OpenAI,
 * ElevenLabs, a local Piper voice or any local command — see tts.ts), trimmed of the silence
 * around them and cached in <demo>/voice/<hash>.mp3 — the hash covers the words and every
 * setting that changes the sound, so a line is only made once and a re-render never calls the
 * provider. `reelkit voice <slug>` (and `render`) make the missing lines; the build (sync)
 * mixes whatever is cached into one track per version (landscape, portrait, square: each has
 * its own timing), and says what is missing.
 *
 * What is spoken: a callout's `say` (false: nothing), else its text; plus video.json
 * `voice.intro` over the intro, when given.
 */
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import type { LoadedConfig } from '../../reelkit-record/scripts/config.ts'
import { ReelkitError } from './project.ts'
import { round, type Timeline, type VideoSpec } from './timeline.ts'
import { missingSetup, providerDefaults, speak, type SpeechSettings } from './tts.ts'

export interface VoiceSettings extends SpeechSettings {
    /** Loudness of the voice track. */
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
    /** The line over the intro (the steps' lines are checked by the timeline). */
    intro?: true
}

/** A line starts this long after its callout appears (the pill is read, then heard). */
const LEAD_IN = 0.25

/** The voice settings for a video, or null when it has no voice-over. */
export function voiceSettings(spec: VideoSpec, config: LoadedConfig): VoiceSettings | null {
    if (!spec.voice) {
        return null
    }
    const own = typeof spec.voice === 'object' ? spec.voice : {}
    const project = config.voice
    const provider = own.provider ?? project.provider
    // A video switching provider starts from that provider's defaults, not the project's voice.
    const same = provider === project.provider
    const defaults = providerDefaults(provider, config.language)
    return {
        provider,
        model: own.model ?? (same ? project.model : undefined) ?? defaults.model,
        voice: own.voice ?? (same ? project.voice : undefined) ?? defaults.voice,
        instructions: own.instructions ?? project.instructions,
        ...((own.speed ?? project.speed) !== undefined ? { speed: own.speed ?? project.speed } : {}),
        language: config.language,
        ...(same && project.baseURL ? { baseURL: project.baseURL } : {}),
        ...(same && project.command ? { command: project.command } : {}),
        ...(same && project.options ? { options: project.options } : {}),
        lufs: project.lufs,
    }
}

/** Everything spoken in this video, in order, timed to `t`. Pure. */
export function voiceLines(t: Timeline, spec: VideoSpec, settings: VoiceSettings): VoiceLine[] {
    const intro = typeof spec.voice === 'object' ? spec.voice.intro : undefined
    const spoken: { at: number; text: string; intro?: true }[] = [
        ...(intro ? [{ at: round(t.intro.start + 0.4), text: intro, intro: true as const }] : []),
        ...t.callouts.map((c) => ({ at: round(c.at + LEAD_IN), text: lineOf(c) })),
    ].filter((l) => l.text)
    return spoken.map((line, i) => ({
        ...line,
        file: `${lineHash(line.text, settings)}.mp3`,
        // The intro line runs until the recording comes in; a step's, until the next line.
        until: round(i === 0 && intro ? t.clipStart + 0.6 : (spoken[i + 1]?.at ?? t.clipEnd)),
    }))
}

/** Bumped when the post-processing (the trim) changes, so cached lines are made again. */
const CACHE_VERSION = 2

/** The cache name of a line: everything that changes how it sounds (not the loudness: the mix sets it). */
export function lineHash(text: string, s: VoiceSettings): string {
    const { lufs: _, ...sound } = s
    return createHash('sha1')
        .update(JSON.stringify([CACHE_VERSION, sound, text]))
        .digest('hex')
        .slice(0, 16)
}

/** What a callout says (its `say`, else its text); '' when it is silent. */
function lineOf(c: { text: string; say?: string | false }): string {
    return c.say === false ? '' : (c.say || c.text).trim()
}

/**
 * For the timeline: seconds from a callout appearing until its cached line is done (the lead-in
 * plus the line); 0 when it is silent or not spoken yet.
 */
export function spokenLength(settings: VoiceSettings, cacheDir: string): (c: { text: string; say?: string | false }) => number {
    const lengths = new Map<string, number>()
    return (c) => {
        const text = lineOf(c)
        const file = resolve(cacheDir, `${lineHash(text, settings)}.mp3`)
        if (!text || !existsSync(file)) {
            return 0
        }
        if (!lengths.has(file)) {
            lengths.set(file, lengthOf(file))
        }
        return round(LEAD_IN + (lengths.get(file) as number))
    }
}

/** Every line the video would speak, without a timeline (for fetching). */
export function spokenTexts(spec: VideoSpec, callouts: { text: string; say?: string | false }[]): string[] {
    const intro = typeof spec.voice === 'object' ? spec.voice.intro : undefined
    return [intro, ...callouts.map(lineOf)].filter((t): t is string => !!t)
}

/**
 * Speaks the lines missing from `cacheDir` (see tts.ts). Returns how many it made.
 * Throws a ReelkitError when the provider cannot speak here (only when something is missing).
 */
export async function fetchLines(texts: string[], settings: VoiceSettings, cacheDir: string, log: (l: string) => void): Promise<number> {
    const missing = [...new Set(texts)].filter((text) => !existsSync(resolve(cacheDir, `${lineHash(text, settings)}.mp3`)))
    if (!missing.length) {
        return 0
    }
    const problem = missingSetup(settings)
    if (problem) {
        throw new ReelkitError(`voice-over: ${missing.length} line(s) to speak with ${settings.provider} and ${problem} (or turn "voice" off in video.json)`)
    }
    mkdirSync(cacheDir, { recursive: true })
    const scratch = mkdtempSync(join(tmpdir(), 'reelkit-voice-'))
    try {
        for (const text of missing) {
            const raw = resolve(scratch, settings.provider === 'openai' || settings.provider === 'elevenlabs' ? 'line.mp3' : 'line.wav')
            rmSync(raw, { force: true })
            await speak(text, settings, raw)
            trimInto(raw, resolve(cacheDir, `${lineHash(text, settings)}.mp3`))
            log(`  voice: spoke "${text}" (${settings.provider})`)
        }
    } finally {
        rmSync(scratch, { recursive: true, force: true })
    }
    return missing.length
}

/** The silence around a line, cut (a breath of it kept) and saved as mp3. */
const TRIM = 'silenceremove=start_periods=1:start_threshold=-50dB:start_silence=0.05'

function trimInto(raw: string, target: string): void {
    const run = spawnSync(
        'ffmpeg',
        ['-y', '-loglevel', 'error', '-i', raw, '-af', `${TRIM},areverse,${TRIM},areverse`, '-ar', '48000', '-c:a', 'libmp3lame', '-q:a', '2', target],
        { stdio: 'inherit' },
    )
    if (run.status !== 0 || !existsSync(target)) {
        throw new ReelkitError(`ffmpeg could not read the spoken line ${raw}`)
    }
}

/** Seconds of audio in `file` (ffprobe). */
function lengthOf(file: string): number {
    const probe = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file], { encoding: 'utf8' })
    return Number.parseFloat(probe.stdout.trim()) || 0
}

/**
 * Mixes the cached lines into one track as long as the video (`target`, m4a). Returns false
 * when none is cached. Warns about missing lines and an intro line that outlasts the intro.
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
    for (const line of cached.filter((l) => l.intro)) {
        const length = lengthOf(resolve(cacheDir, line.file))
        if (line.at + length > line.until + 0.05) {
            log(`  warning: voice-over: "${line.text}" (${length.toFixed(1)}s) runs ${(line.at + length - line.until).toFixed(1)}s into the recording — shorten \`voice.intro\``)
        }
    }
    const key = JSON.stringify({ lines: cached.map((l) => [l.at, l.file]), total, lufs: settings.lufs, v: 2 })
    const stamp = `${target}.key`
    if (existsSync(target) && existsSync(stamp) && readFileSync(stamp, 'utf8') === key) {
        return true
    }
    const inputs = cached.flatMap((l) => ['-i', resolve(cacheDir, l.file)])
    const delayed = cached.map((l, i) => `[${i}:a]aresample=48000,adelay=${Math.round(l.at * 1000)}:all=1[v${i}]`).join(';')
    // 0.1 s past the video: AAC's encoder padding would otherwise leave the track a frame or
    // two short of its slot. loudnorm works at 192 kHz, hence the resample back.
    const mix =
        `${delayed};${cached.map((_, i) => `[v${i}]`).join('')}amix=inputs=${cached.length}:normalize=0,` +
        `loudnorm=I=${settings.lufs}:TP=-1.5:LRA=11,aresample=48000,apad,atrim=0:${round(total + 0.1)}[out]`
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
