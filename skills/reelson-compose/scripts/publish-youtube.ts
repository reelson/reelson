/**
 * YouTube publisher (a reelson.config.json channel with `"type": "youtube"`), through the YouTube
 * Data API v3: a resumable upload (videos.insert), then optionally the captions `reelson render`
 * wrote (captions.insert) and a playlist (playlistItems.insert). `--replace` makes the video it
 * supersedes private (videos.update) — YouTube cannot swap the file behind a URL. `--update` rewrites
 * the snippet of the video up (videos.update) and replaces reelson's caption track (captions.update).
 *
 * Sign-in is Google OAuth with a "Desktop app" client of your own Google Cloud project:
 * YOUTUBE_CLIENT_ID and YOUTUBE_CLIENT_SECRET (environment or the .env next to reelson.config.json).
 * Uploads from a project Google has not audited stay private — see the reelson-compose skill.
 */
import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { authorize, LoginExpired, refresh, type OAuthClient, type TokenSet } from './oauth.ts'
import { ReelsonError } from './project.ts'
import type { ChannelConfig, ChannelContext, Publisher, PublishJob } from './publish.ts'

export interface YouTubeChannel extends ChannelConfig {
    type: 'youtube'
    /** private (default), unlisted or public. */
    privacy?: 'private' | 'unlisted' | 'public'
    /** Video category id; 28 = Science & Technology (default), 27 = Education. */
    category?: string
    /** Playlist id (PL…) each video is added to. */
    playlist?: string
    /** Language of the title and the audio (default: reelson.config.json `language`). */
    language?: string
    /** Upload the captions `reelson render` wrote (default true). */
    captions?: boolean
    madeForKids?: boolean
    /** Tell subscribers about the upload (default true). */
    notifySubscribers?: boolean
    /** The YouTube channel id (UC…) the sign-in must belong to — a guard against the wrong account. */
    channelId?: string
}

/** What a signed-in channel keeps (in its CredentialStore). */
export interface YouTubeLogin {
    refreshToken: string
    accessToken: string
    /** ms since epoch. */
    expiresAt: number
    channel: { id: string; title: string }
}

const API = 'https://www.googleapis.com/youtube/v3'
const UPLOAD_API = 'https://www.googleapis.com/upload/youtube/v3'
/** Uploads, captions and playlists; channels.list (the account's name) is covered by force-ssl. */
const SCOPES = ['https://www.googleapis.com/auth/youtube.upload', 'https://www.googleapis.com/auth/youtube.force-ssl']
const TITLE_MAX = 100
const DESCRIPTION_MAX_BYTES = 5000
const RETRIES = 4

/** The wait before retry `attempt` (1, 2, …) of a broken upload; tests shorten it. */
export const backoff = { ms: (attempt: number) => 1000 * 2 ** (attempt - 1) }

function client(): OAuthClient {
    return {
        name: 'Google',
        authUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
        tokenUrl: 'https://oauth2.googleapis.com/token',
        clientId: process.env.YOUTUBE_CLIENT_ID ?? '',
        clientSecret: process.env.YOUTUBE_CLIENT_SECRET,
        scopes: SCOPES,
        // A refresh token every time, so the login keeps working after the first hour.
        params: { access_type: 'offline', prompt: 'consent' },
    }
}

export const youtube: Publisher<YouTubeChannel> = {
    label: 'YouTube',

    summary(channel) {
        return [
            channel.privacy ?? 'private',
            channel.format ?? 'landscape',
            ...(channel.playlist ? [`playlist ${channel.playlist}`] : []),
            ...(channel.captions === false ? ['no captions'] : []),
        ].join(', ')
    },

    missingSetup() {
        const missing = ['YOUTUBE_CLIENT_ID', 'YOUTUBE_CLIENT_SECRET'].filter((name) => !process.env[name])
        return missing.length
            ? `no ${missing.join(' or ')} — create a Google Cloud OAuth client ("Desktop app", YouTube Data API v3 enabled) and put its id and secret in the .env next to reelson.config.json`
            : null
    },

    account(ctx) {
        const login = ctx.credentials.read<YouTubeLogin>()
        return login ? `${login.channel.title} (${login.channel.id})` : null
    },

    async login(ctx) {
        const setup = this.missingSetup(ctx)
        if (setup) {
            throw new ReelsonError(setup)
        }
        const tokens = await authorize(client(), ctx.open)
        if (!tokens.refresh_token) {
            throw new ReelsonError('Google sent no refresh token — remove reelson from https://myaccount.google.com/permissions and log in again')
        }
        const channel = await myChannel(tokens.access_token)
        if (ctx.channel.channelId && ctx.channel.channelId !== channel.id) {
            throw new ReelsonError(
                `that Google account manages "${channel.title}" (${channel.id}), not ${ctx.channel.channelId} (channels.${ctx.name}.channelId) — log in again and pick the right account or brand channel`,
            )
        }
        ctx.credentials.write({ refreshToken: tokens.refresh_token, ...access(tokens), channel } satisfies YouTubeLogin)
        return `${channel.title} (${channel.id})`
    },

    async publish(job, ctx) {
        const token = await accessToken(ctx)
        const channel = ctx.channel
        const language = channel.language ?? job.language
        const video = await uploadVideo(job, channel, language, token, ctx.log)
        const url = `https://youtu.be/${video.id}`

        // The video is up: what follows only warns, so the upload is still recorded.
        await extras(video.id, job, ctx, token, false)
        if (video.status?.privacyStatus && video.status.privacyStatus !== (channel.privacy ?? 'private')) {
            ctx.log(`  note: YouTube made it ${video.status.privacyStatus} (asked: ${channel.privacy}) — uploads from an unaudited API project stay private`)
        }
        return { id: video.id, url }
    },

    async retire(previous, ctx) {
        const token = await accessToken(ctx)
        // videos.update clears the status fields it is not sent: send back what is there, private.
        const answer = (await api('GET', `${API}/videos?part=status&id=${encodeURIComponent(previous.id)}`, token)) as { items?: { status: Record<string, unknown> }[] }
        const status = answer.items?.[0]?.status
        if (!status) {
            return `${previous.url} is gone already`
        }
        if (status.privacyStatus === 'private' && !status.publishAt) {
            return `${previous.url} was private already`
        }
        const { uploadStatus: _u, failureReason: _f, rejectionReason: _r, madeForKids: _m, publishAt: _p, ...writable } = status
        await api('PUT', `${API}/videos?part=status`, token, { id: previous.id, status: { ...writable, privacyStatus: 'private' } })
        return `${previous.url} is private now (it was ${status.privacyStatus}${status.publishAt ? `, due ${status.publishAt}` : ''})`
    },

    async update(previous, job, ctx) {
        const token = await accessToken(ctx)
        const answer = (await api('GET', `${API}/videos?part=snippet&id=${encodeURIComponent(previous.id)}`, token)) as { items?: { snippet: Snippet }[] }
        const current = answer.items?.[0]?.snippet
        if (!current) {
            throw new ReelsonError(`${previous.url} is not on the channel any more — \`--again\` uploads the video anew`)
        }
        // Privacy stays as it is (it may have gone public in YouTube Studio): only the snippet is sent.
        const { snippet } = videoResource(job, ctx.channel, ctx.channel.language ?? job.language)
        const fields = ['title', 'description', 'categoryId', 'defaultLanguage', 'defaultAudioLanguage'] as const
        const same = fields.every((field) => (current[field] ?? '') === snippet[field]) && (current.tags ?? []).join('\n') === snippet.tags.join('\n')
        if (same) {
            ctx.log('  title, description and tags unchanged')
        } else {
            // videos.update clears what the snippet leaves out; ours has every field reelson sets.
            await api('PUT', `${API}/videos?part=snippet`, token, { id: previous.id, snippet })
            ctx.log('  title, description and tags updated')
        }
        await extras(previous.id, job, ctx, token, true)
    },
}

/**
 * After an upload or on `--update`: the captions and the playlist. They only warn, so the video
 * is still recorded. An update replaces reelson's caption track and skips a playlist it is in.
 */
async function extras(videoId: string, job: PublishJob, ctx: ChannelContext<YouTubeChannel>, token: string, updating: boolean): Promise<void> {
    const channel = ctx.channel
    const language = channel.language ?? job.language
    if (job.captions && channel.captions !== false) {
        try {
            const track = updating ? await captionTrack(videoId, language, token) : null
            await uploadCaptions(videoId, job.captions, language, token, track)
            ctx.log(`  captions (${language}) ${track ? 'replaced' : 'added'}`)
        } catch (error) {
            ctx.log(`  warning: captions not ${updating ? 'updated' : 'added'} — ${(error as Error).message}`)
        }
    }
    if (channel.playlist) {
        try {
            const query = `playlistId=${encodeURIComponent(channel.playlist)}&videoId=${encodeURIComponent(videoId)}`
            if (updating && ((await api('GET', `${API}/playlistItems?part=id&${query}`, token)) as { items?: unknown[] }).items?.length) {
                ctx.log(`  in playlist ${channel.playlist} already`)
                return
            }
            const body = JSON.stringify({ snippet: { playlistId: channel.playlist, resourceId: { kind: 'youtube#video', videoId } } })
            await untilKnown('adding to the playlist', () =>
                call(`${API}/playlistItems?part=snippet`, {
                    method: 'POST',
                    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json; charset=UTF-8' },
                    body,
                }),
            )
            ctx.log(`  added to playlist ${channel.playlist}`)
        } catch (error) {
            ctx.log(`  warning: not added to playlist ${channel.playlist} — ${(error as Error).message}`)
        }
    }
}

/** The id of the caption track reelson adds (the language's unnamed standard track), or null. */
async function captionTrack(videoId: string, language: string, token: string): Promise<string | null> {
    const answer = (await api('GET', `${API}/captions?part=snippet&videoId=${encodeURIComponent(videoId)}`, token)) as {
        items?: { id: string; snippet: { language: string; name?: string; trackKind?: string } }[]
    }
    const track = answer.items?.find(({ snippet }) => snippet.language === language && !snippet.name && snippet.trackKind !== 'asr')
    return track?.id ?? null
}

interface Snippet {
    title: string
    description: string
    tags: string[]
    categoryId: string
    defaultLanguage: string
    defaultAudioLanguage: string
}

/** The snippet + status of videos.insert: YouTube's limits applied (100-char title, no "<" or ">"). */
export function videoResource(job: PublishJob, channel: YouTubeChannel, language: string): { snippet: Snippet; status: { privacyStatus: string; selfDeclaredMadeForKids: boolean } } {
    const clean = (text: string) => text.replace(/[<>]/g, '')
    let description = clean(job.metadata.description)
    while (Buffer.byteLength(description) > DESCRIPTION_MAX_BYTES) {
        description = description.slice(0, -100)
    }
    return {
        snippet: {
            title: [...clean(job.metadata.title).trim()].slice(0, TITLE_MAX).join('') || job.slug,
            description,
            tags: job.metadata.tags.map(clean),
            categoryId: channel.category ?? '28',
            defaultLanguage: language,
            defaultAudioLanguage: language,
        },
        status: {
            privacyStatus: channel.privacy ?? 'private',
            selfDeclaredMadeForKids: channel.madeForKids ?? false,
        },
    }
}

interface VideoAnswer {
    id: string
    status?: { privacyStatus?: string; uploadStatus?: string }
}

/** A resumable upload: opens a session, sends the file, and resumes where it broke off (network, 5xx). */
async function uploadVideo(job: PublishJob, channel: YouTubeChannel, language: string, token: string, log: (message: string) => void): Promise<VideoAnswer> {
    const data = readFileSync(job.file)
    const notify = channel.notifySubscribers === false ? '&notifySubscribers=false' : ''
    const opened = await call(`${UPLOAD_API}/videos?uploadType=resumable&part=snippet,status${notify}`, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json; charset=UTF-8',
            'X-Upload-Content-Length': String(data.length),
            'X-Upload-Content-Type': 'video/mp4',
        },
        body: JSON.stringify(videoResource(job, channel, language)),
    })
    if (!opened.ok) {
        throw await apiError(opened, 'starting the upload')
    }
    const session = opened.headers.get('Location')
    if (!session) {
        throw new ReelsonError('YouTube started no upload session')
    }
    log(`  uploading ${(data.length / 1e6).toFixed(1)} MB…`)

    let offset = 0
    for (let attempt = 0; ; attempt++) {
        let response: Response | null = null
        try {
            response = await fetch(session, {
                method: 'PUT',
                headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'video/mp4', 'Content-Range': `bytes ${offset}-${data.length - 1}/${data.length}` },
                body: data.subarray(offset),
            })
            if (response.ok) {
                return (await response.json()) as VideoAnswer
            }
        } catch {
            // The connection broke: ask below how much arrived.
        }
        if ((response && response.status < 500 && response.status !== 308) || attempt >= RETRIES) {
            throw response ? await apiError(response, 'uploading') : new ReelsonError(`the upload to YouTube kept breaking off (${RETRIES + 1} tries)`)
        }
        await new Promise((resolve) => setTimeout(resolve, backoff.ms(attempt + 1)))
        const probe = await fetch(session, { method: 'PUT', headers: { Authorization: `Bearer ${token}`, 'Content-Range': `bytes */${data.length}` } })
        if (probe.ok) {
            return (await probe.json()) as VideoAnswer
        }
        if (probe.status !== 308) {
            throw await apiError(probe, 'resuming the upload')
        }
        // "Range: bytes=0-12345" — what YouTube has; none yet: from the start.
        const range = /-(\d+)$/.exec(probe.headers.get('Range') ?? '')
        offset = range ? Number(range[1]) + 1 : 0
        log(`  the upload broke off — resuming at ${(offset / 1e6).toFixed(1)} MB`)
    }
}

/** captions.insert, or captions.update of `track`: the .srt as a multipart upload (metadata + file). */
async function uploadCaptions(videoId: string, srtFile: string, language: string, token: string, track: string | null = null): Promise<void> {
    const boundary = `reelson-${randomUUID()}`
    const metadata = JSON.stringify(track ? { id: track, snippet: { isDraft: false } } : { snippet: { videoId, language, name: '', isDraft: false } })
    const body = Buffer.concat([
        Buffer.from(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n--${boundary}\r\nContent-Type: application/octet-stream\r\n\r\n`),
        readFileSync(srtFile),
        Buffer.from(`\r\n--${boundary}--\r\n`),
    ])
    await untilKnown(track ? 'replacing captions' : 'adding captions', () =>
        call(`${UPLOAD_API}/captions?uploadType=multipart&part=snippet`, {
            method: track ? 'PUT' : 'POST',
            headers: { Authorization: `Bearer ${token}`, 'Content-Type': `multipart/related; boundary=${boundary}` },
            body,
        }),
    )
}

/**
 * A request about the video just uploaded (captions, playlist). Right after the upload YouTube
 * may not know the video yet (404) — tried again a few times, like a server error.
 */
async function untilKnown(doing: string, send: () => Promise<Response>): Promise<void> {
    for (let attempt = 0; ; attempt++) {
        const response = await send()
        if (response.ok) {
            await response.body?.cancel()
            return
        }
        if ((response.status !== 404 && response.status < 500) || attempt >= RETRIES) {
            throw await apiError(response, doing)
        }
        await response.body?.cancel()
        await new Promise((resolve) => setTimeout(resolve, backoff.ms(attempt + 1)))
    }
}

/** A valid access token, refreshed when it expires within a minute; the login is dropped once Google revokes it. */
async function accessToken(ctx: ChannelContext<YouTubeChannel>): Promise<string> {
    const login = ctx.credentials.read<YouTubeLogin>()
    if (!login) {
        throw new ReelsonError(`channel "${ctx.name}" is not logged in — run \`reelson channels login ${ctx.name}\``)
    }
    if (ctx.channel.channelId && ctx.channel.channelId !== login.channel.id) {
        throw new ReelsonError(`channel "${ctx.name}" is logged in to ${login.channel.title} (${login.channel.id}), not ${ctx.channel.channelId} — run \`reelson channels login ${ctx.name}\``)
    }
    if (login.expiresAt - Date.now() > 60_000) {
        return login.accessToken
    }
    try {
        const tokens = await refresh(client(), login.refreshToken)
        ctx.credentials.write({ ...login, ...access(tokens), refreshToken: tokens.refresh_token ?? login.refreshToken } satisfies YouTubeLogin)
        return tokens.access_token
    } catch (error) {
        if (error instanceof LoginExpired) {
            ctx.credentials.remove()
            throw new ReelsonError(`${error.message} — run \`reelson channels login ${ctx.name}\``)
        }
        throw error
    }
}

function access(tokens: TokenSet): { accessToken: string; expiresAt: number } {
    return { accessToken: tokens.access_token, expiresAt: Date.now() + (tokens.expires_in ?? 3600) * 1000 }
}

async function myChannel(token: string): Promise<{ id: string; title: string }> {
    const answer = (await api('GET', `${API}/channels?part=snippet&mine=true`, token)) as { items?: { id: string; snippet: { title: string } }[] }
    const channel = answer.items?.[0]
    if (!channel) {
        throw new ReelsonError('that Google account has no YouTube channel — create one at https://www.youtube.com/create_channel, then log in again')
    }
    return { id: channel.id, title: channel.snippet.title }
}

async function api(method: string, url: string, token: string, body?: unknown): Promise<unknown> {
    const response = await call(url, {
        method,
        headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json; charset=UTF-8' } : {}) },
        body: body ? JSON.stringify(body) : undefined,
    })
    if (!response.ok) {
        throw await apiError(response, `${method} ${new URL(url).pathname.split('/').pop()}`)
    }
    return response.json()
}

async function call(url: string, init: RequestInit): Promise<Response> {
    try {
        return await fetch(url, init)
    } catch (error) {
        throw new ReelsonError(`cannot reach ${new URL(url).host} (${(error as Error).message})`)
    }
}

/** Google's error answer as one line, with a hint for the ones a first upload runs into. */
async function apiError(response: Response, doing: string): Promise<ReelsonError> {
    const text = await response.text()
    let reason = ''
    let message = text.slice(0, 300)
    try {
        const { error } = JSON.parse(text) as { error: { message?: string; errors?: { reason?: string }[] } }
        reason = error.errors?.[0]?.reason ?? ''
        message = error.message ?? message
    } catch {
        // Not JSON: the text as it is.
    }
    const hints: Record<string, string> = {
        quotaExceeded: ' — the Google Cloud project used up its daily YouTube quota (uploads cost the most of it); try again tomorrow',
        uploadLimitExceeded: ' — this YouTube channel reached its upload limit for now',
        youtubeSignupRequired: ' — that Google account has no YouTube channel yet',
        accessNotConfigured: ' — enable the YouTube Data API v3 in the Google Cloud project',
    }
    return new ReelsonError(`YouTube answered ${response.status} ${doing}: ${message}${hints[reason] ?? ''}`)
}
