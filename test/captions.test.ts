import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { captionCues, toSrt, toVtt } from '../skills/reelkit-compose/scripts/captions.ts'
import { FORMATS, reframeFilter } from '../skills/reelkit-compose/scripts/formats.ts'
import { computeTimeline } from '../skills/reelkit-compose/scripts/timeline.ts'
import { fixture } from './helpers.ts'

describe('captions', () => {
    const { timeline } = computeTimeline(fixture('todo'), { title: 'Plan your day', trim: { start: 2.6 } })

    it('has the title over the intro, then one cue per callout, in video time', () => {
        const cues = captionCues(timeline, 'Plan your day', 'Add tasks')
        assert.deepEqual(cues[0], { start: 0, end: timeline.intro.exit, text: 'Plan your day\nAdd tasks' })
        assert.equal(cues.length, 1 + timeline.callouts.length)
        assert.deepEqual(cues.slice(1).map((c) => c.start), timeline.callouts.map((c) => c.at))
    })

    it('writes SRT and WebVTT', () => {
        const cues = [{ start: 0, end: 3, text: 'Title' }, { start: 61.25, end: 64.5, text: 'Step' }]
        assert.equal(toSrt(cues), '1\n00:00:00,000 --> 00:00:03,000\nTitle\n\n2\n00:01:01,250 --> 00:01:04,500\nStep\n')
        assert.equal(toVtt(cues), 'WEBVTT\n\n00:00:00.000 --> 00:00:03.000\nTitle\n\n00:01:01.250 --> 00:01:04.500\nStep\n')
    })
})

describe('reframe', () => {
    it('fills each format and centres the full-width video', () => {
        for (const [format, { width, height }] of Object.entries(FORMATS)) {
            const filter = reframeFilter(format as keyof typeof FORMATS)
            assert.match(filter, new RegExp(`crop=${width}:${height}`))
            assert.match(filter, new RegExp(`\\[fg\\]scale=${width}:-2`))
            assert.match(filter, /overlay=\(W-w\)\/2:\(H-h\)\/2/)
        }
    })
})
