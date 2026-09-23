import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it } from 'node:test'
import { RENDER_FLAGS, renderKey } from '../skills/reelson-compose/scripts/hyperframes.ts'

describe('renderKey', () => {
    it('changes with the page, any asset or the flags — and only then', () => {
        const dir = mkdtempSync(join(tmpdir(), 'reelson-render-'))
        mkdirSync(join(dir, 'assets/vendor'), { recursive: true })
        writeFileSync(join(dir, 'index.html'), '<html>1</html>')
        writeFileSync(join(dir, 'assets/recording.mp4'), 'footage')
        writeFileSync(join(dir, 'assets/vendor/gsap.js'), 'gsap')
        const key = () => renderKey(dir, [...RENDER_FLAGS, 'renders/x.mp4'])
        const first = key()
        assert.equal(key(), first, 'stable')

        writeFileSync(join(dir, 'assets/recording.mp4.key'), 'ignored') // our own stamps don't count
        assert.equal(key(), first)

        writeFileSync(join(dir, 'index.html'), '<html>2</html>')
        const second = key()
        assert.notEqual(second, first, 'page changed')

        utimesSync(join(dir, 'assets/vendor/gsap.js'), new Date(1000), new Date(1000))
        const third = key()
        assert.notEqual(third, second, 'an asset changed')

        assert.notEqual(renderKey(dir, ['-q', 'draft', 'renders/x.draft.mp4']), third, 'other flags')
    })
})
