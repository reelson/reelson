import assert from 'node:assert/strict'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, it } from 'node:test'
import { renderComposition, type CompositionInput } from '../skills/reelkit-compose/scripts/composition.ts'
import { BUILTIN_TEMPLATES } from '../skills/reelkit-compose/scripts/project.ts'
import { computeTimeline, type VideoSpec } from '../skills/reelkit-compose/scripts/timeline.ts'
import { compositionClicks, planZoom } from '../skills/reelkit-compose/scripts/zooms.ts'
import { fixture, TEST_DIR } from './helpers.ts'

const template = readFileSync(resolve(BUILTIN_TEMPLATES, 'classic/index.html'), 'utf8')

function input(name: 'todo' | 'handoff', spec: VideoSpec, overrides: Partial<CompositionInput> = {}): CompositionInput {
    const markers = fixture(name)
    const { timeline } = computeTimeline(markers, spec)
    const clicks = compositionClicks(markers, timeline)

    return {
        template,
        timeline,
        zooms: (spec.zooms ?? []).map((z) => planZoom(z, clicks, timeline)),
        maxSteps: 10,
        narration: false,
        music: true,
        text: {
            language: 'en',
            brand: { name: 'ACME', tagline: 'PLATFORM', eyebrow: 'Acme', color: '#6366f1', colorSoft: '#a5b4fc' },
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

describe('renderComposition', () => {
    it('renders the classic template for the example (golden)', () => {
        const spec: VideoSpec = {
            title: 'Plan your day',
            subtitle: 'Add tasks and tick them off',
            trim: { start: 2.6 },
            zooms: [{ clicks: [3, 4], scale: 1.7 }],
        }
        golden('classic-todo.html', renderComposition(input('todo', spec)))
    })

    it('renders hand-off cards and per-actor clips (golden)', () => {
        golden('classic-handoff.html', renderComposition(input('handoff', { title: 'Hand-off', trim: { start: 1 } })))
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

    it('leaves the audio tags out when there is no music or narration', () => {
        const html = renderComposition(input('todo', { title: 'T' }, { music: false }))
        assert.ok(!html.includes('<audio'))
    })

    it('fails on a placeholder the template uses but the builder does not know', () => {
        assert.throws(
            () => renderComposition(input('todo', { title: 'T' }, { template: `${template}{{NEW_THING}}` })),
            /placeholders left unfilled: {{NEW_THING}}/,
        )
    })
})
