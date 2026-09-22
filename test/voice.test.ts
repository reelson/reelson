import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { DEFAULTS, type LoadedConfig } from '../skills/reelkit-record/scripts/config.ts'
import { computeTimeline, type VideoSpec } from '../skills/reelkit-compose/scripts/timeline.ts'
import { lineHash, spokenTexts, voiceLines, voiceSettings } from '../skills/reelkit-compose/scripts/voice.ts'
import { fixture } from './helpers.ts'

const config = { ...DEFAULTS, root: '/tmp', path: null } as unknown as LoadedConfig

describe('voice-over', () => {
    const spec: VideoSpec = { title: 'T', trim: { start: 2.6 }, voice: true }

    it('is off unless video.json turns it on; an object overrides the voice', () => {
        assert.equal(voiceSettings({ title: 'T' }, config), null)
        assert.equal(voiceSettings({ title: 'T', voice: false }, config), null)
        assert.equal(voiceSettings(spec, config)?.voice, DEFAULTS.voice.voice)
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

    it('caches a line by its words and voice', () => {
        const s = voiceSettings(spec, config)!
        assert.equal(lineHash('Hi', s), lineHash('Hi', s))
        assert.notEqual(lineHash('Hi', s), lineHash('Hello', s))
        assert.notEqual(lineHash('Hi', s), lineHash('Hi', { ...s, voice: 'nova' }))
    })
})
