import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, beforeEach, describe, it } from 'node:test'
import { authorize, LoginExpired, refresh, type OAuthClient } from '../skills/reelson-compose/scripts/oauth.ts'
import { ReelsonError } from '../skills/reelson-compose/scripts/project.ts'
import {
    channelsTemplate,
    credentialsFor,
    loadChannels,
    metadata,
    pickChannels,
    PUBLISHERS,
    readPublished,
    recordPublished,
    renderProblem,
    type ChannelContext,
    type PublishJob,
} from '../skills/reelson-compose/scripts/publish.ts'
import { backoff, videoResource, youtube, type YouTubeChannel, type YouTubeLogin } from '../skills/reelson-compose/scripts/publish-youtube.ts'
import { CONFIG_SCHEMA_PATH, loadConfig } from '../skills/reelson-record/scripts/config.ts'
import { loadSchema, validate } from '../skills/reelson-record/scripts/validate.ts'
import { kitConfig } from './helpers.ts'

const schema = loadSchema(CONFIG_SCHEMA_PATH)

/** A temporary project: with `config`, its reelson.config.json (loaded); without, no config at all. */
function project(config?: unknown): ReturnType<typeof kitConfig> {
    const root = mkdtempSync(join(tmpdir(), 'reelson-publish-'))
    if (config === undefined) {
        return { ...kitConfig(), root }
    }
    writeFileSync(join(root, 'reelson.config.json'), JSON.stringify(config))
    return loadConfig(root)
}

describe('channels in reelson.config.json', () => {
    it('accepts the starter channels, and every channel type has a publisher', () => {
        assert.deepEqual(validate({ channels: channelsTemplate() }, schema), [])
        const branches = (schema.properties!.channels.additionalProperties as { anyOf: { $ref: string }[] }).anyOf
        const types = branches.map((b) => {
            const branch = schema.definitions![b.$ref.split('/').pop()!] as { properties: { type: { enum: string[] } } }
            return branch.properties.type.enum[0]
        })
        assert.deepEqual(types.sort(), Object.keys(PUBLISHERS).sort())
    })

    it('reports a mistyped key, an unknown type and a bad channel name', () => {
        assert.throws(() => loadChannels(project({ channels: { yt: { type: 'youtube', privcy: 'public' } } })), /channels\.yt\.privcy: unknown key — did you mean "privacy"\?/)
        assert.throws(() => loadChannels(project({ channels: { v: { type: 'vimeo' } } })), /channels\.v\.type: must be one of "youtube"/)
        assert.throws(() => loadChannels(project({ channels: { 'my channel': { type: 'youtube' } } })), /letters, digits/)
        assert.throws(() => loadChannels(project()), /reelson channels init/)
        assert.throws(() => loadChannels(project({ language: 'en' })), /no "channels" in .*reelson\.config\.json/)
    })

    it('picks channels by name, all of them, the only one — or leaves the question to the caller', () => {
        const two = loadChannels(project({ channels: { a: { type: 'youtube' }, b: { type: 'youtube', format: 'portrait' } } }))
        assert.deepEqual(pickChannels(two, 'b, a,b'), ['b', 'a'])
        assert.deepEqual(pickChannels(two, ['b', 'a']), ['b', 'a'])
        assert.deepEqual(pickChannels(two, ['a,b', 'b']), ['a', 'b'])
        assert.throws(() => pickChannels(two, ['a', 'c']), /no channel "c"/)
        assert.deepEqual(pickChannels(two, undefined, true), ['a', 'b'])
        assert.equal(pickChannels(two, undefined), null)
        assert.throws(() => pickChannels(two, 'a,c'), /no channel "c" .* it has a, b/)
        const one = loadChannels(project({ channels: { a: { type: 'youtube' } } }))
        assert.deepEqual(pickChannels(one, undefined), ['a'])
    })
})

describe('publish metadata', () => {
    it('describes a video by its subtitle and steps, with the channel footer and tags', () => {
        const m = metadata({ title: 'Add a task', subtitle: 'In two clicks.', publish: { tags: ['todo', 'demo'] } }, ['Open', 'Type', 'Save'], {
            type: 'youtube',
            tags: ['demo', 'acme'],
            footer: 'https://acme.test',
        })
        assert.equal(m.title, 'Add a task')
        assert.equal(m.description, 'In two clicks.\n\n1. Open\n2. Type\n3. Save\n\nhttps://acme.test')
        assert.deepEqual(m.tags, ['demo', 'acme', 'todo'])
    })

    it('takes video.json publish.title / description as they are', () => {
        const m = metadata({ title: 'T', subtitle: 'S', publish: { title: 'Upload title', description: 'Own words' } }, ['a', 'b'], { type: 'youtube' })
        assert.deepEqual(m, { title: 'Upload title', description: 'Own words', tags: [] })
    })

    it('keeps YouTube limits: 100-character title, no angle brackets', () => {
        const job = { slug: 's', metadata: { title: `<b>${'x'.repeat(200)}`, description: 'a < b', tags: ['<t>'] } } as PublishJob
        const { snippet, status } = videoResource(job, { type: 'youtube', privacy: 'unlisted' }, 'ro') as {
            snippet: Record<string, unknown>
            status: Record<string, unknown>
        }
        assert.equal((snippet.title as string).length, 100)
        assert.ok(!(snippet.title as string).includes('<'))
        assert.equal(snippet.description, 'a  b')
        assert.deepEqual(snippet.tags, ['t'])
        assert.equal(snippet.defaultLanguage, 'ro')
        assert.deepEqual(status, { privacyStatus: 'unlisted', selfDeclaredMadeForKids: false })
    })
})

describe('publish bookkeeping', () => {
    it('needs a render newer than video.json', () => {
        const demo = mkdtempSync(join(tmpdir(), 'reelson-demo-'))
        assert.match(renderProblem(demo, 'd', 'portrait')!, /no video\/renders\/d\.portrait\.mp4 — run `reelson render d --only portrait`/)
        mkdirSync(join(demo, 'video/renders'), { recursive: true })
        writeFileSync(join(demo, 'video/renders/d.mp4'), '')
        writeFileSync(join(demo, 'video.json'), '{}')
        utimesSync(join(demo, 'video/renders/d.mp4'), new Date(1000), new Date(1000))
        assert.match(renderProblem(demo, 'd', 'landscape')!, /video\.json changed after/)
        utimesSync(join(demo, 'video.json'), new Date(500), new Date(500))
        assert.equal(renderProblem(demo, 'd', 'landscape'), null)
    })

    it('remembers what went where', () => {
        const demo = mkdtempSync(join(tmpdir(), 'reelson-demo-'))
        assert.deepEqual(readPublished(demo), {})
        const record = { type: 'youtube', id: 'abc', url: 'https://youtu.be/abc', at: '2026-09-24T10:00:00.000Z', file: 'video/renders/d.mp4' }
        recordPublished(demo, 'yt', record)
        recordPublished(demo, 'shorts', { ...record, id: 'def' })
        assert.deepEqual(Object.keys(readPublished(demo)), ['yt', 'shorts'])
        assert.equal(readPublished(demo).yt.id, 'abc')
    })

    it('keeps sign-ins outside the project, one per project and channel, private to the user', () => {
        const home = mkdtempSync(join(tmpdir(), 'reelson-home-'))
        const saved = process.env.XDG_CONFIG_HOME
        process.env.XDG_CONFIG_HOME = home
        try {
            const a = credentialsFor(project(), 'youtube')
            const b = credentialsFor(project(), 'youtube')
            assert.notEqual(a.path, b.path)
            assert.ok(a.path.startsWith(resolve(home, 'reelson/credentials/')))
            a.write({ token: 1 })
            assert.deepEqual(a.read(), { token: 1 })
            assert.equal(b.read(), null)
            assert.equal(readFileSync(a.path).length > 0, true)
            assert.equal(a.remove(), true)
            assert.equal(a.remove(), false)
        } finally {
            if (saved === undefined) delete process.env.XDG_CONFIG_HOME
            else process.env.XDG_CONFIG_HOME = saved
        }
    })
})

/** Replaces fetch for requests to other hosts than 127.0.0.1; records each one. */
function mockFetch(answer: (url: URL, init: RequestInit) => Response | Promise<Response>): { calls: { url: URL; init: RequestInit }[]; restore: () => void } {
    const original = globalThis.fetch
    const calls: { url: URL; init: RequestInit }[] = []
    globalThis.fetch = (async (input: string | URL | Request, init: RequestInit = {}) => {
        const url = new URL(input instanceof Request ? input.url : input)
        if (url.hostname === '127.0.0.1') {
            return original(input, init)
        }
        calls.push({ url, init })
        return answer(url, init)
    }) as typeof fetch
    return { calls, restore: () => (globalThis.fetch = original) }
}

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
    new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } })

describe('oauth', () => {
    const client: OAuthClient = { name: 'Test', authUrl: 'https://auth.test/authorize', tokenUrl: 'https://auth.test/token', clientId: 'id', clientSecret: 'secret', scopes: ['a', 'b'] }

    it('signs in through a loopback redirect with PKCE', async () => {
        const mock = mockFetch(() => json({ access_token: 'at', refresh_token: 'rt', expires_in: 3600 }))
        try {
            const tokens = await authorize(client, (page) => {
                const url = new URL(page)
                assert.equal(url.searchParams.get('scope'), 'a b')
                assert.equal(url.searchParams.get('code_challenge_method'), 'S256')
                // The "browser" comes back with a code.
                void fetch(`${url.searchParams.get('redirect_uri')}/?code=the-code&state=${url.searchParams.get('state')}`)
            })
            assert.equal(tokens.refresh_token, 'rt')
            const form = new URLSearchParams(mock.calls[0].init.body as URLSearchParams)
            assert.equal(form.get('code'), 'the-code')
            assert.equal(form.get('grant_type'), 'authorization_code')
            assert.ok(form.get('code_verifier')!.length >= 43)
        } finally {
            mock.restore()
        }
    })

    it('fails on a denied sign-in and tells a revoked refresh token apart', async () => {
        const mock = mockFetch(() => json({ error: 'invalid_grant', error_description: 'Token has been revoked.' }, 400))
        try {
            await assert.rejects(
                authorize(client, (page) => void fetch(`${new URL(page).searchParams.get('redirect_uri')}/?error=access_denied`)),
                /sign-in failed: access_denied/,
            )
            await assert.rejects(refresh(client, 'old'), LoginExpired)
        } finally {
            mock.restore()
        }
    })
})

describe('YouTube publisher', () => {
    let saved: Record<string, string | undefined>
    beforeEach(() => {
        saved = { XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME, YOUTUBE_CLIENT_ID: process.env.YOUTUBE_CLIENT_ID, YOUTUBE_CLIENT_SECRET: process.env.YOUTUBE_CLIENT_SECRET }
        process.env.XDG_CONFIG_HOME = mkdtempSync(join(tmpdir(), 'reelson-home-'))
        process.env.YOUTUBE_CLIENT_ID = 'cid'
        process.env.YOUTUBE_CLIENT_SECRET = 'csecret'
        backoff.ms = () => 0
    })
    afterEach(() => {
        for (const [key, value] of Object.entries(saved)) {
            if (value === undefined) delete process.env[key]
            else process.env[key] = value
        }
    })

    function setup(channel: Partial<YouTubeChannel> = {}): { ctx: ChannelContext<YouTubeChannel>; job: PublishJob; logs: string[] } {
        const cfg = project()
        const logs: string[] = []
        const ctx: ChannelContext<YouTubeChannel> = {
            name: 'yt',
            channel: { type: 'youtube', ...channel },
            config: cfg,
            credentials: credentialsFor(cfg, 'yt'),
            open: () => assert.fail('no sign-in expected'),
            log: (m) => logs.push(m),
        }
        const file = join(cfg.root, 'd.mp4')
        writeFileSync(file, Buffer.alloc(1000, 7))
        const captions = join(cfg.root, 'd.srt')
        writeFileSync(captions, '1\n00:00:00,000 --> 00:00:01,000\nHi\n')
        const job: PublishJob = { slug: 'd', demoDir: cfg.root, format: 'landscape', file, captions, language: 'en', metadata: { title: 'T', description: 'D', tags: [] } }
        return { ctx, job, logs }
    }

    const login = (expiresAt: number): YouTubeLogin => ({ refreshToken: 'rt', accessToken: 'old', expiresAt, channel: { id: 'UC1', title: 'Acme' } })

    it('refreshes the token, uploads, adds captions and the playlist', async () => {
        const { ctx, job, logs } = setup({ playlist: 'PL1', privacy: 'unlisted' })
        ctx.credentials.write(login(Date.now() - 1000))
        const mock = mockFetch((url, init) => {
            if (url.host === 'oauth2.googleapis.com') return json({ access_token: 'fresh', expires_in: 3600 })
            if (url.pathname === '/upload/youtube/v3/videos') return new Response(null, { status: 200, headers: { Location: 'https://upload.test/session' } })
            if (url.host === 'upload.test') return json({ id: 'vid1', status: { privacyStatus: 'unlisted' } })
            if (url.pathname.endsWith('/captions')) return json({ id: 'cap' })
            if (url.pathname.endsWith('/playlistItems')) return json({ id: 'item' })
            throw new Error(`unexpected ${init.method} ${url}`)
        })
        try {
            assert.deepEqual(await youtube.publish(job, ctx), { id: 'vid1', url: 'https://youtu.be/vid1' })
        } finally {
            mock.restore()
        }
        assert.deepEqual(
            mock.calls.map((c) => `${c.init.method} ${c.url.host}${c.url.pathname}`),
            [
                'POST oauth2.googleapis.com/token',
                'POST www.googleapis.com/upload/youtube/v3/videos',
                'PUT upload.test/session',
                'POST www.googleapis.com/upload/youtube/v3/captions',
                'POST www.googleapis.com/youtube/v3/playlistItems',
            ],
        )
        const opened = mock.calls[1]
        assert.equal((opened.init.headers as Record<string, string>).Authorization, 'Bearer fresh')
        assert.equal((opened.init.headers as Record<string, string>)['X-Upload-Content-Length'], '1000')
        assert.equal(JSON.parse(opened.init.body as string).status.privacyStatus, 'unlisted')
        assert.equal(ctx.credentials.read<YouTubeLogin>()!.accessToken, 'fresh')
        assert.deepEqual(logs.slice(1), ['  captions (en) added', '  added to playlist PL1'])
    })

    it('tries the captions again while YouTube does not know the new video yet', async () => {
        const { ctx, job, logs } = setup()
        ctx.credentials.write(login(Date.now() + 3_600_000))
        let tries = 0
        const mock = mockFetch((url) => {
            if (url.host === 'upload.test') return json({ id: 'vid3' })
            if (url.pathname.endsWith('/captions')) return ++tries < 3 ? json({ error: { message: 'video not found' } }, 404) : json({ id: 'cap' })
            return new Response(null, { status: 200, headers: { Location: 'https://upload.test/session' } })
        })
        try {
            assert.equal((await youtube.publish(job, ctx)).id, 'vid3')
        } finally {
            mock.restore()
        }
        assert.equal(tries, 3)
        assert.deepEqual(logs.slice(1), ['  captions (en) added'])
    })

    it('resumes an upload that broke off where YouTube says it stopped', async () => {
        const { ctx, job } = setup({ captions: false })
        ctx.credentials.write(login(Date.now() + 3_600_000))
        let puts = 0
        const mock = mockFetch((url, init) => {
            if (url.host !== 'upload.test') return new Response(null, { status: 200, headers: { Location: 'https://upload.test/session' } })
            const range = (init.headers as Record<string, string>)['Content-Range']
            puts++
            if (puts === 1) return new Response('busy', { status: 503 })
            if (range === 'bytes */1000') return new Response(null, { status: 308, headers: { Range: 'bytes=0-399' } })
            assert.equal(range, 'bytes 400-999/1000')
            assert.equal((init.body as Uint8Array).length, 600)
            return json({ id: 'vid2' })
        })
        try {
            assert.equal((await youtube.publish(job, ctx)).id, 'vid2')
        } finally {
            mock.restore()
        }
    })

    it('refuses a login to another channel than channelId, and explains quota errors', async () => {
        const { ctx, job } = setup({ channelId: 'UC2' })
        ctx.credentials.write(login(Date.now() + 3_600_000))
        await assert.rejects(youtube.publish(job, ctx), /logged in to Acme \(UC1\), not UC2/)

        ctx.channel.channelId = undefined
        const mock = mockFetch(() => json({ error: { message: 'Quota exceeded.', errors: [{ reason: 'quotaExceeded' }] } }, 403))
        try {
            await assert.rejects(youtube.publish(job, ctx), (error: Error) => error instanceof ReelsonError && /403 starting the upload: Quota exceeded\. — .*daily YouTube quota/.test(error.message))
        } finally {
            mock.restore()
        }
    })

    it('says what is missing before a sign-in, and who a channel is logged in as', () => {
        const { ctx } = setup()
        delete process.env.YOUTUBE_CLIENT_SECRET
        assert.match(youtube.missingSetup(ctx)!, /no YOUTUBE_CLIENT_SECRET/)
        assert.equal(youtube.account(ctx), null)
        ctx.credentials.write(login(0))
        assert.equal(youtube.account(ctx), 'Acme (UC1)')
    })
})
