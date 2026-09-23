import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it } from 'node:test'
import { GIF, gifIfChanged, RENDER_FLAGS, renderKey } from '../skills/reelson-compose/scripts/hyperframes.ts'

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

describe('gifIfChanged', () => {
    const noFfmpeg = spawnSync('ffmpeg', ['-version']).status !== 0 && 'needs ffmpeg'
    it('cuts a README-sized GIF from the MP4, again only once the MP4 is re-rendered', { skip: noFfmpeg }, () => {
        const dir = mkdtempSync(join(tmpdir(), 'reelson-gif-'))
        try {
            mkdirSync(join(dir, 'renders'))
            const mp4 = 'renders/x.mp4'
            spawnSync('ffmpeg', ['-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=1920x1080:rate=30:duration=1', '-pix_fmt', 'yuv420p', join(dir, mp4)])
            writeFileSync(join(dir, `${mp4}.key`), 'render 1')
            assert.equal(gifIfChanged(dir, mp4, 'renders/x.gif'), 'rendered')
            const probe = spawnSync('ffprobe', ['-v', 'error', '-select_streams', 'v', '-show_entries', 'stream=width', '-of', 'csv=p=0', join(dir, 'renders/x.gif')], { encoding: 'utf8' })
            assert.equal(Number(probe.stdout), GIF.width)
            assert.equal(gifIfChanged(dir, mp4, 'renders/x.gif'), 'unchanged')
            writeFileSync(join(dir, `${mp4}.key`), 'render 2')
            assert.equal(gifIfChanged(dir, mp4, 'renders/x.gif'), 'rendered')
        } finally {
            rmSync(dir, { recursive: true, force: true })
        }
    })
})
