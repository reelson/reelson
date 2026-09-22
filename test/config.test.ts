import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { describe, it } from 'node:test'
import { CONFIG_SCHEMA_PATH, ConfigError, countLabel, DEFAULTS, loadConfig } from '../skills/reelkit-record/scripts/config.ts'
import { loadSchema, validate } from '../skills/reelkit-record/scripts/validate.ts'
import { VIDEO_SCHEMA_PATH } from '../skills/reelkit-compose/scripts/project.ts'
import { KIT } from './helpers.ts'

const configSchema = loadSchema(CONFIG_SCHEMA_PATH)
const videoSchema = loadSchema(VIDEO_SCHEMA_PATH)

function projectWith(config: unknown): string {
    const dir = mkdtempSync(join(tmpdir(), 'reelkit-'))
    writeFileSync(join(dir, 'demo.config.json'), JSON.stringify(config))
    return dir
}

describe('schemas', () => {
    it('accept the shipped example config and the example video', () => {
        for (const file of ['demo.config.example.json', 'examples/demo.config.json']) {
            assert.deepEqual(validate(JSON.parse(readFileSync(resolve(KIT, file), 'utf8')), configSchema), [], file)
        }
        const video = JSON.parse(readFileSync(resolve(KIT, 'examples/todo-add-item/video.json'), 'utf8'))
        assert.deepEqual(validate(video, videoSchema), [])
    })

    it('accept sections and a logo in both files, and catch a mistyped slot', () => {
        const sections = { intro: 'minimal', recap: 'none', outro: 'endcard' }
        assert.deepEqual(validate({ sections, brand: { logo: 'docs/logo.svg' } }, configSchema), [])
        assert.deepEqual(validate({ title: 'x', sections, brand: { logo: null } }, videoSchema), [])
        assert.deepEqual(validate({ title: 'x', sections: { outtro: 'compact' } }, videoSchema), [
            'sections.outtro: unknown key — did you mean "outro"?',
        ])
    })

    it('reject a mistyped key with a suggestion', () => {
        assert.deepEqual(validate({ brand: { colour: '#fff' } }, configSchema), ['brand.colour: unknown key — did you mean "color"?'])
        assert.deepEqual(validate({ title: 'x', zoom: [] }, videoSchema), ['zoom: unknown key — did you mean "zooms"?'])
    })

    it('report wrong types, ranges and missing keys with their path', () => {
        assert.deepEqual(validate({ record: { viewport: { width: '1440' } } }, configSchema), [
            'record.viewport: missing required "height"',
            'record.viewport.width: expected integer, got string "1440"',
        ])
        assert.deepEqual(validate({ zooms: [{ clicks: [0], scale: 9 }] }, videoSchema), [
            '(root): missing required "title"',
            'zooms[0].clicks[0]: must be ≥ 1',
            'zooms[0].scale: must be ≤ 4',
        ])
    })

    it('accept plural forms and reject unknown plural categories', () => {
        assert.deepEqual(validate({ strings: { stepsLabel: { one: 'pas', few: 'pași', other: 'de pași' } } }, configSchema), [])
        assert.ok(validate({ strings: { stepsLabel: { one: 'pas', plenty: 'x', other: 'y' } } }, configSchema).length > 0)
    })
})

describe('loadConfig', () => {
    it('falls back to defaults without a config file', () => {
        const config = loadConfig(mkdtempSync(join(tmpdir(), 'reelkit-')))
        // (it walks up from the temp dir; nothing there)
        assert.equal(config.template, DEFAULTS.template)
    })

    it('merges the project config over the defaults', () => {
        const config = loadConfig(projectWith({ brand: { name: 'ACME' }, language: 'ro' }))
        assert.equal(config.brand.name, 'ACME')
        assert.equal(config.brand.color, DEFAULTS.brand.color)
        assert.equal(config.language, 'ro')
    })

    it('replaces plural forms instead of merging them into the English defaults', () => {
        const config = loadConfig(projectWith({ strings: { stepsLabel: { other: 'Schritte' } } }))
        assert.deepEqual(config.strings.stepsLabel, { other: 'Schritte' })
    })

    it('throws a readable error for an invalid config', () => {
        assert.throws(
            () => loadConfig(projectWith({ videoDir: 'x' })),
            (error: unknown) => error instanceof ConfigError && /videoDir: unknown key — did you mean "videosDir"\?/.test(error.message),
        )
    })
})

describe('countLabel', () => {
    it('picks English plural forms', () => {
        const label = { one: 'step', other: 'steps' }
        assert.equal(countLabel(1, label, 'en'), '1 step')
        assert.equal(countLabel(4, label, 'en'), '4 steps')
    })

    it('picks Romanian plural forms (one / few / other)', () => {
        const label = { one: 'pas', few: 'pași', other: 'de pași' }
        assert.equal(countLabel(1, label, 'ro'), '1 pas')
        assert.equal(countLabel(3, label, 'ro'), '3 pași')
        assert.equal(countLabel(20, label, 'ro'), '20 de pași')
    })

    it('uses a plain string for every count', () => {
        assert.equal(countLabel(1, 'Schritte', 'de'), '1 Schritte')
    })
})
