import assert from 'node:assert/strict'
import { cpSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it } from 'node:test'
import { BUILTIN_SECTIONS, catalog, resolveDesign } from '../skills/reelson-compose/scripts/project.ts'
import { DEFAULTS, type LoadedConfig } from '../skills/reelson-record/scripts/config.ts'
import { kitConfig } from './helpers.ts'

/** A project with its own videos dir, for project-local templates and sections. */
function project(): LoadedConfig {
    const root = mkdtempSync(join(tmpdir(), 'reelson-design-'))
    mkdirSync(join(root, 'videos'))
    return { ...DEFAULTS, root, path: join(root, 'reelson.config.json'), videosDir: 'videos' }
}

describe('resolveDesign', () => {
    it("uses the template's sections by default", () => {
        const d = resolveDesign('classic', [], kitConfig())
        assert.deepEqual(
            [d.sections.intro.name, d.sections.recap?.name, d.sections.outro.name],
            ['poster', 'steps', 'wordmark'],
        )
        assert.deepEqual(d.timing.intro, { duration: 4, exit: 3 })
        assert.equal(d.timing.stage.overlap, 0.4)
    })

    it('lets reelson.config.json, then video.json, pick each slot', () => {
        const d = resolveDesign('classic', [{ intro: 'minimal', outro: 'compact' }, { outro: 'endcard' }], kitConfig())
        assert.deepEqual(
            [d.sections.intro.name, d.sections.recap?.name, d.sections.outro.name],
            ['minimal', 'steps', 'endcard'],
        )
        assert.deepEqual(d.timing.intro, { duration: 2.7, exit: 2.6 })
        assert.deepEqual(d.timing.outro, { duration: 4 })
    })

    it('drops the recap for "none", but never the intro or outro', () => {
        const d = resolveDesign('classic', [{ recap: 'none' }], kitConfig())
        assert.equal(d.sections.recap, null)
        assert.equal(d.timing.recap, null)
        assert.throws(() => resolveDesign('classic', [{ intro: 'none' }], kitConfig()), /intro can't be "none"/)
        assert.throws(() => resolveDesign('classic', [{ outro: 'none' }], kitConfig()), /outro can't be "none"/)
    })

    it('suggests the closest name for a typo', () => {
        assert.throws(() => resolveDesign('classic', [{ intro: 'minimall' }], kitConfig()), /intro section "minimall" not found — did you mean "minimal"\?/)
        assert.throws(() => resolveDesign('clasic', [], kitConfig()), /template "clasic" not found — did you mean "classic"\?/)
    })

    it('prefers a project section and validates its timing keys', () => {
        const config = project()
        const dir = join(config.root, 'videos/_sections/outro/wordmark')
        cpSync(join(BUILTIN_SECTIONS, 'outro/wordmark'), dir, { recursive: true })
        writeFileSync(join(dir, 'section.json'), JSON.stringify({ timing: { duration: 3.3 } }))
        assert.equal(resolveDesign('classic', [], config).sections.outro.dir, dir)
        assert.equal(resolveDesign('classic', [], config).timing.outro.duration, 3.3)

        writeFileSync(join(dir, 'section.json'), JSON.stringify({ timing: { durations: 3 } }))
        assert.throws(() => resolveDesign('classic', [], config), /unknown key\(s\) "durations" — did you mean "duration"\?/)
    })
})

describe('catalog', () => {
    it('lists the kit templates and three sections per slot', () => {
        const { templates, sections } = catalog(kitConfig())
        assert.deepEqual(templates.map((t) => t.name), ['classic'])
        assert.deepEqual(sections.intro.map((s) => s.name), ['minimal', 'poster', 'showcase', 'split'])
        assert.deepEqual(sections.recap.map((s) => s.name), ['compact', 'steps', 'none'])
        assert.deepEqual(sections.outro.map((s) => s.name), ['compact', 'endcard', 'wordmark'])
        assert.ok([...templates, ...sections.intro, ...sections.recap, ...sections.outro].every((s) => s.description))
    })
})
