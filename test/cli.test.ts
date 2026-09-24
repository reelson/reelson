import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { describe, it } from 'node:test'
import { KIT } from './helpers.ts'

const COMMANDS = [
    'install', 'init', 'doctor', 'new', 'record', 'build', 'voice', 'voices', 'check', 'verify',
    'snapshot', 'studio', 'preview', 'templates', 'render', 'publish', 'channels',
]

/** Runs the CLI in an empty folder (no reelson.config.json, nothing to act on). */
function reelson(...args: string[]) {
    const run = spawnSync(process.execPath, [resolve(KIT, 'bin/reelson.ts'), ...args], {
        cwd: mkdtempSync(join(tmpdir(), 'reelson-cli-')),
        encoding: 'utf8',
    })
    return { status: run.status, stdout: run.stdout, stderr: run.stderr }
}

describe('cli', () => {
    for (const cmd of COMMANDS) {
        it(`${cmd} --help prints its usage`, () => {
            const run = reelson(cmd, '--help')
            assert.equal(run.status, 0, run.stderr)
            assert.ok(run.stdout.startsWith(`usage: reelson ${cmd}`), run.stdout)
        })
    }

    it('takes -h and `help <command>` too', () => {
        assert.ok(reelson('render', 'my-demo', '-h').stdout.startsWith('usage: reelson render'))
        assert.ok(reelson('help', 'publish').stdout.startsWith('usage: reelson publish'))
    })

    it('reports an unknown option in one line', () => {
        const run = reelson('render', 'my-demo', '--foo')
        assert.equal(run.status, 2)
        assert.equal(run.stderr.trim(), 'reelson render: unknown option --foo, see reelson render --help')
    })
})
