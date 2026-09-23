import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { DEFAULTS, type LoadedConfig } from '../skills/reelson-record/scripts/config.ts'
import { computeTimeline, type VideoSpec } from '../skills/reelson-compose/scripts/timeline.ts'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { commandArgs, missingSetup, piperVoiceURL } from '../skills/reelson-compose/scripts/tts.ts'
import { fetchLines, lineHash, spokenTexts, voiceLines, voiceSettings } from '../skills/reelson-compose/scripts/voice.ts'
import { fixture } from './helpers.ts'

const config = { ...DEFAULTS, root: '/tmp', path: null } as unknown as LoadedConfig
const withVoice = (voice: Partial<LoadedConfig['voice']>, language = 'en'): LoadedConfig =>
    ({ ...config, language, voice: { ...config.voice, ...voice } }) as LoadedConfig

describe('voice-over', () => {
    const spec: VideoSpec = { title: 'T', trim: { start: 2.6 }, voice: true }

    it('is off unless video.json turns it on; an object overrides the voice', () => {
        assert.equal(voiceSettings({ title: 'T' }, config), null)
        assert.equal(voiceSettings({ title: 'T', voice: false }, config), null)
        assert.equal(voiceSettings(spec, config)?.voice, 'alloy')
        assert.equal(voiceSettings({ ...spec, voice: { voice: 'nova' } }, config)?.voice, 'nova')
    })

    it('speaks each callout as it appears, until the next line', () => {
        const { timeline: t } = computeTimeline(fixture('todo'), spec)
        const settings = voiceSettings(spec, config)!
        const lines = voiceLines(t, spec, settings)
        assert.deepEqual(lines.map((l) => l.text), t.callouts.map((c) => c.text))
        lines.forEach((l, i) => {
            assert.ok(l.at > t.callouts[i].at && l.at < t.callouts[i].at + 0.5, 'just after its pill appears')
            assert.equal(l.until, lines[i + 1]?.at ?? t.clipEnd)
            assert.equal(l.file, `${lineHash(l.text, settings)}.mp3`)
        })
    })

    it('uses `say` over the text, skips `say: false`, and adds the intro line', () => {
        const markers = fixture('todo')
        const own: VideoSpec = {
            ...spec,
            voice: { intro: 'Plan your day in four steps.' },
            callouts: [
                { marker: markers.markers[0].label, text: 'Type a task', say: 'Type a task, then press Enter.' },
                { marker: markers.markers[1].label, text: 'Add more', say: false },
            ],
        }
        const { timeline: t } = computeTimeline(markers, own)
        const lines = voiceLines(t, own, voiceSettings(own, config)!)
        assert.deepEqual(lines.map((l) => l.text), ['Plan your day in four steps.', 'Type a task, then press Enter.'])
        assert.ok(lines[0].at < t.clipStart && lines[0].until <= t.clipStart + 1, 'the intro line is over the intro')
        assert.deepEqual(spokenTexts(own, t.callouts), lines.map((l) => l.text))
    })

    it('caches a line by its words and everything that changes its sound (not the loudness)', () => {
        const s = voiceSettings(spec, config)!
        assert.equal(lineHash('Hi', s), lineHash('Hi', s))
        assert.notEqual(lineHash('Hi', s), lineHash('Hello', s))
        assert.notEqual(lineHash('Hi', s), lineHash('Hi', { ...s, voice: 'nova' }))
        assert.notEqual(lineHash('Hi', s), lineHash('Hi', { ...s, speed: 1.1 }))
        assert.notEqual(lineHash('Hi', s), lineHash('Hi', { ...s, provider: 'elevenlabs' }))
        assert.equal(lineHash('Hi', s), lineHash('Hi', { ...s, lufs: -20 }))
    })
})

describe('voice-over providers', () => {
    const spec: VideoSpec = { title: 'T', voice: true }

    it("fills in each provider's model and voice unless the config names them", () => {
        assert.deepEqual(pick(voiceSettings(spec, config)!), ['openai', 'gpt-4o-mini-tts', 'alloy'])
        assert.deepEqual(pick(voiceSettings(spec, withVoice({ provider: 'elevenlabs' }))!), ['elevenlabs', 'eleven_multilingual_v2', 'JBFqnCBsd6RMkjVDRZzb'])
        assert.deepEqual(pick(voiceSettings(spec, withVoice({ provider: 'piper' }, 'ro'))!), ['piper', '', 'ro_RO-mihai-medium'])
        assert.equal(voiceSettings(spec, withVoice({ provider: 'elevenlabs', voice: 'Aria' }))!.voice, 'Aria')
    })

    it("lets a video switch provider, starting from that provider's defaults", () => {
        const project = withVoice({ provider: 'openai', voice: 'marin', baseURL: 'http://localhost:8880/v1', speed: 1.1 })
        const own = voiceSettings({ ...spec, voice: { provider: 'elevenlabs' } }, project)!
        assert.deepEqual(pick(own), ['elevenlabs', 'eleven_multilingual_v2', 'JBFqnCBsd6RMkjVDRZzb'])
        assert.equal(own.baseURL, undefined, "the project's server is for its own provider")
        assert.equal(own.speed, 1.1)
        assert.equal(voiceSettings({ ...spec, voice: { speed: 0.9 } }, project)!.speed, 0.9)
    })

    it('says what is missing to speak here', () => {
        const saved = { openai: process.env.OPENAI_API_KEY, eleven: process.env.ELEVENLABS_API_KEY }
        delete process.env.OPENAI_API_KEY
        delete process.env.ELEVENLABS_API_KEY
        try {
            assert.match(missingSetup(voiceSettings(spec, config)!) ?? '', /no OPENAI_API_KEY/)
            assert.equal(missingSetup(voiceSettings(spec, withVoice({ baseURL: 'http://localhost:8880/v1' }))!), null, 'a local server needs no key')
            assert.match(missingSetup(voiceSettings(spec, withVoice({ provider: 'elevenlabs' }))!) ?? '', /no ELEVENLABS_API_KEY/)
            assert.match(missingSetup(voiceSettings(spec, withVoice({ provider: 'piper' }, 'xx'))!) ?? '', /no Piper voice for language "xx"/)
            assert.match(missingSetup(voiceSettings(spec, withVoice({ provider: 'command' }))!) ?? '', /needs voice.command/)
            assert.match(missingSetup(voiceSettings(spec, withVoice({ provider: 'command', command: ['no-such-tts-xyz'] }))!) ?? '', /not found/)
        } finally {
            if (saved.openai !== undefined) process.env.OPENAI_API_KEY = saved.openai
            if (saved.eleven !== undefined) process.env.ELEVENLABS_API_KEY = saved.eleven
        }
    })

    it('finds a Piper voice on Hugging Face by its name', () => {
        assert.equal(
            piperVoiceURL('ro_RO-mihai-medium'),
            'https://huggingface.co/rhasspy/piper-voices/resolve/main/ro/ro_RO/mihai/medium/ro_RO-mihai-medium.onnx',
        )
        assert.equal(piperVoiceURL('uk_UA-ukrainian_tts-medium').split('/main/')[1], 'uk/uk_UA/ukrainian_tts/medium/uk_UA-ukrainian_tts-medium.onnx')
        assert.throws(() => piperVoiceURL('mihai'), /not a Piper voice name/)
    })

    it("fills in a command's placeholders", () => {
        const command = ['tts', '--voice={voice}', '-o', '{out}', '{text}', '{speed}', '{language}']
        const s = voiceSettings(spec, withVoice({ provider: 'command', voice: 'v1', speed: 1.2, command }))!
        assert.deepEqual(commandArgs(s, 'Hello {out}', '/tmp/x.wav'), ['tts', '--voice=v1', '-o', '/tmp/x.wav', 'Hello {out}', '1.2', 'en'])
    })

    const noFfmpeg = spawnSync('ffmpeg', ['-version']).status !== 0 && 'needs ffmpeg'
    it('speaks with a local command and trims the silence around the line', { skip: noFfmpeg }, async () => {
        const dir = mkdtempSync(join(tmpdir(), 'reelson-voice-test-'))
        try {
            // Half a second of silence, one second of tone, half a second of silence: the cached line keeps the tone.
            const tone = 'sine=frequency=440:duration=1,adelay=500:all=1,apad=pad_dur=0.5'
            const command = ['ffmpeg', '-loglevel', 'error', '-f', 'lavfi', '-i', tone, '{out}']
            const s = voiceSettings(spec, withVoice({ provider: 'command', command }))!
            assert.equal(await fetchLines(['Hello'], s, dir, () => {}), 1)
            const file = join(dir, `${lineHash('Hello', s)}.mp3`)
            assert.ok(existsSync(file))
            const length = Number(spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file], { encoding: 'utf8' }).stdout)
            assert.ok(length > 0.95 && length < 1.25, `trimmed to about the tone (${length}s)`)
            assert.equal(await fetchLines(['Hello'], s, dir, () => {}), 0, 'cached')
        } finally {
            rmSync(dir, { recursive: true, force: true })
        }
    })
})

function pick(s: { provider: string; model: string; voice: string }): string[] {
    return [s.provider, s.model, s.voice]
}
