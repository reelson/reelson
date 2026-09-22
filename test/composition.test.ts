import assert from 'node:assert/strict'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, it } from 'node:test'
import { renderComposition, type CompositionInput } from '../skills/reelkit-compose/scripts/composition.ts'
import { portraitLayout } from '../skills/reelkit-compose/scripts/portrait.ts'
import { readSection, resolveDesign } from '../skills/reelkit-compose/scripts/project.ts'
import { computeTimeline, type VideoSpec } from '../skills/reelkit-compose/scripts/timeline.ts'
import { compositionClicks, planZoom } from '../skills/reelkit-compose/scripts/zooms.ts'
import { fixture, kitConfig, TEST_DIR } from './helpers.ts'

function input(name: 'todo' | 'handoff', spec: VideoSpec, overrides: Partial<CompositionInput> = {}): CompositionInput {
    const markers = fixture(name)
    const design = resolveDesign('classic', [spec.sections], kitConfig())
    const { timeline } = computeTimeline(markers, spec, design.timing)
    const clicks = compositionClicks(markers, timeline)

    return {
        stage: readFileSync(resolve(design.template.dir, 'stage.html'), 'utf8'),
        sections: [design.sections.intro, design.sections.recap, design.sections.outro]
            .filter((s) => s !== null)
            .map(readSection),
        timeline,
        zooms: (spec.zooms ?? []).map((z) => planZoom(z, clicks, timeline)),
        narration: false,
        music: true,
        text: {
            language: 'en',
            brand: { name: 'ACME', tagline: 'PLATFORM', eyebrow: 'Acme', color: '#6366f1', colorSoft: '#a5b4fc' },
            logo: '',
            title: spec.title,
            subtitle: spec.subtitle ?? '',
            recapTitle: 'In short',
            stepsChip: '4 steps',
            secondsChip: '27 seconds',
        },
        ...overrides,
    }
}

/** Compares against test/golden/<name>; UPDATE_GOLDEN=1 rewrites it (review the diff!). */
function golden(name: string, actual: string): void {
    const path = resolve(TEST_DIR, 'golden', name)
    if (process.env.UPDATE_GOLDEN || !existsSync(path)) {
        writeFileSync(path, actual)
    }
    assert.equal(actual, readFileSync(path, 'utf8'), `${name} changed — run \`npm run test:update-golden\` if intended`)
}

const example: VideoSpec = {
    title: 'Plan your day',
    subtitle: 'Add tasks and tick them off',
    trim: { start: 2.6 },
    zooms: [{ clicks: [3, 4], scale: 1.7 }],
}

describe('renderComposition', () => {
    it('renders the classic template for the example (golden)', () => {
        golden('classic-todo.html', renderComposition(input('todo', example)))
    })

    it('renders hand-off cards and per-actor clips (golden)', () => {
        golden('classic-handoff.html', renderComposition(input('handoff', { title: 'Hand-off', trim: { start: 1 } })))
    })

    it('mixes sections from different designs, with a logo (golden)', () => {
        const spec = { ...example, sections: { intro: 'split', recap: 'compact', outro: 'endcard' } }
        const t = input('todo', spec)
        golden('classic-mixed.html', renderComposition({ ...t, text: { ...t.text, logo: 'assets/brand-logo.svg' } }))
    })

    it('renders the phone layout (portrait golden)', () => {
        const t = input('todo', example)
        const portrait = portraitLayout(t.timeline)
        golden('classic-portrait.html', renderComposition({ ...t, layout: portrait.layout, cursor: portrait.cursor, zooms: portrait.zooms }))
    })

    it('zooms only sections without their own portrait layout (class "band")', () => {
        const t = input('todo', example)
        const html = renderComposition(t)
        assert.doesNotMatch(html, /class="clip band"/, 'every kit section has a portrait layout')
        const own = { ...t, sections: t.sections.map((s) => (s.slot === 'outro' ? { ...s, portrait: false } : s)) }
        assert.match(renderComposition(own), /<section id="outro" class="clip band"/)
    })

    it('places each slot in the stage and scopes it under its id', () => {
        const html = renderComposition(input('todo', { ...example, sections: { intro: 'minimal', outro: 'compact' } }))
        const at = (s: string) => html.indexOf(s)
        assert.ok(at('<section id="intro"') < at('<section id="screen"'), 'the intro sits under the recording')
        assert.ok(at('<section id="screen"') < at('<section id="recap"'), 'the recap sits over it')
        assert.ok(at('<section id="recap"') < at('<section id="outro"'))
        assert.match(html, /<!-- ── intro: minimal ── -->/)
        assert.match(html, /\}\)\(DEMO\.sections\.outro\);/)
        assert.match(html, /<section id="recap" class="clip" data-start="19.73" data-duration="4.2" data-track-index="2">/) // minimal hands over at 2.6 s
    })

    it('leaves the recap out entirely for "recap": "none"', () => {
        const html = renderComposition(input('todo', { ...example, sections: { recap: 'none' } }))
        assert.ok(!html.includes('id="recap"'))
        assert.match(html, /"recap": null/)
        assert.match(html, /<section id="outro" class="clip" data-start="20.53"/)
    })

    it('escapes text so it cannot break out of attributes or the script', () => {
        const html = renderComposition(
            input('todo', {
                title: 'A <b>bold</b> & "quoted" title',
                callouts: [{ at: 5, text: '</script><img src=x onerror=alert(1)>' }],
            }),
        )
        assert.ok(html.includes('A &lt;b&gt;bold&lt;/b&gt; &amp; &quot;quoted&quot; title'))
        assert.ok(!html.includes('</script><img'))
        assert.ok(html.includes('\\u003c/script>\\u003cimg'))
    })

    it('never fills placeholders inside video text', () => {
        const html = renderComposition(input('todo', { title: 'Costs {{TOTAL}} and {{NOPE}}' }))
        assert.ok(html.includes('Costs {{TOTAL}} and {{NOPE}}'))
    })

    it('leaves the audio tags out when there is no music or narration', () => {
        const html = renderComposition(input('todo', { title: 'T' }, { music: false }))
        assert.ok(!html.includes('<audio'))
    })

    it('fails on a placeholder the stage or a section uses but the builder does not know', () => {
        const base = input('todo', { title: 'T' })
        assert.throws(() => renderComposition({ ...base, stage: `${base.stage}{{NEW_THING}}` }), /placeholders left unfilled: {{NEW_THING}}/)
        const [intro, ...rest] = base.sections
        assert.throws(
            () => renderComposition({ ...base, sections: [{ ...intro, html: `${intro.html}{{OTHER}}` }, ...rest] }),
            /placeholders left unfilled: {{OTHER}}/,
        )
    })
})
