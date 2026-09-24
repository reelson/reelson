/**
 * `reelson publish`: uploads a rendered video to the channels a project lists in reelson.config.json:
 *
 *   {
 *       …,
 *       "channels": {
 *           "youtube": { "type": "youtube", "privacy": "unlisted" },
 *           "shorts": { "type": "youtube", "format": "portrait", "playlist": "PL…" }
 *       }
 *   }
 *
 * Each channel names a `type` — a publisher in PUBLISHERS below. A publisher signs in (tokens are kept
 * outside the project, per project and channel, see credentialsFor) and uploads one render with its
 * metadata. A new service is one more publish-<type>.ts implementing `Publisher`, an entry in
 * PUBLISHERS and a branch in the config schema (reelson-record/schemas/reelson.config.schema.json).
 *
 * What went where is kept in <demo>/published.json, so a second `publish` skips a channel that has
 * the video already (--again uploads it anew; --replace uploads it anew and retires the old one —
 * services cannot swap the file behind a URL, so a stable link of your own points at the new id;
 * --update rewrites the title, description, tags and captions of the one up, keeping its URL).
 */
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, relative, resolve } from 'node:path'
import type { LoadedConfig } from '../../reelson-record/scripts/config.ts'
import { ReelsonError } from './project.ts'
import { youtube } from './publish-youtube.ts'
import type { VideoSpec } from './timeline.ts'
import { textTitle } from './title.ts'

export const PUBLISHED_FILE = 'published.json'

export const FORMATS = ['landscape', 'portrait', 'square'] as const
export type Format = (typeof FORMATS)[number]

/** One entry of reelson.config.json `channels`: the fields every publisher knows, plus its own. */
export interface ChannelConfig {
    type: string
    /** Which render goes up: landscape (default), portrait or square. */
    format?: Format
    /** Tags added to every video on this channel (video.json `publish.tags` adds to them). */
    tags?: string[]
    /** Appended to every description on this channel (links, a call to action). */
    footer?: string
    [key: string]: unknown
}

export interface Channels {
    path: string
    channels: Record<string, ChannelConfig>
}

/** Title, description and tags of one upload. */
export interface Metadata {
    title: string
    description: string
    tags: string[]
}

/** Everything a publisher needs to upload one video to one channel. */
export interface PublishJob {
    slug: string
    demoDir: string
    format: Format
    /** The rendered MP4. */
    file: string
    /** Its SubRip captions (from `reelson render`), when there are any. */
    captions: string | null
    /** The project's language (BCP 47). */
    language: string
    metadata: Metadata
}

/** A signed-in channel's tokens and whatever else its publisher keeps between runs. */
export interface CredentialStore {
    /** Where it lives (for messages). */
    path: string
    read<T>(): T | null
    write(value: unknown): void
    remove(): boolean
}

export interface ChannelContext<C extends ChannelConfig = ChannelConfig> {
    /** The channel's key in reelson.config.json `channels`. */
    name: string
    channel: C
    config: LoadedConfig
    credentials: CredentialStore
    /** Opens a sign-in page in the browser (and prints it). */
    open(url: string): void
    log(message: string): void
}

export interface Published {
    id: string
    url: string
}

/** A service `reelson publish` can upload to. */
export interface Publisher<C extends ChannelConfig = ChannelConfig> {
    /** Its name in messages, e.g. "YouTube". */
    label: string
    /** One line about a channel's settings for `reelson channels`, e.g. "unlisted, landscape". */
    summary(channel: C): string
    /** What this machine is missing before it can sign in (an app's client id, …), or null. */
    missingSetup(ctx: ChannelContext<C>): string | null
    /** The account the channel is signed in to, or null when it is not. */
    account(ctx: ChannelContext<C>): string | null
    /** Signs in (through the browser) and keeps the tokens; returns the account. */
    login(ctx: ChannelContext<C>): Promise<string>
    /** Uploads the job's video; problems after the upload itself are logged, not thrown. */
    publish(job: PublishJob, ctx: ChannelContext<C>): Promise<Published>
    /**
     * Takes a video `--replace` superseded out of sight (YouTube: makes it private) without
     * deleting it; returns what it did, for the log. Without it, --replace leaves the old one as it is.
     */
    retire?(previous: Published, ctx: ChannelContext<C>): Promise<string>
    /**
     * `--update`: gives a video already up the job's title, description and tags, and its captions
     * and playlist like `publish` (problems with those logged, not thrown). The file itself stays;
     * `job.captions` is null when they would not match it.
     */
    update?(previous: Published, job: PublishJob, ctx: ChannelContext<C>): Promise<void>
}

export const PUBLISHERS: Record<string, Publisher<any>> = {
    youtube,
}

/** The config's `channels` (loadConfig validated them); throws with a hint when there are none. */
export function loadChannels(config: LoadedConfig): Channels {
    const where = config.path ?? config.root
    if (!config.channels) {
        throw new ReelsonError(`no "channels" in ${where} — run \`reelson channels init\` to add them`)
    }
    const problems = Object.keys(config.channels)
        .filter((name) => !/^[a-z0-9][a-z0-9_-]*$/i.test(name))
        .map((name) => `channels.${name}: a channel name takes letters, digits, "-" and "_"`)
    if (problems.length) {
        throw new ReelsonError(`${where} is invalid:\n  ${problems.join('\n  ')}`)
    }
    return { path: where, channels: config.channels as Record<string, ChannelConfig> }
}

export function publisherFor(channel: ChannelConfig): Publisher {
    const publisher = PUBLISHERS[channel.type]
    if (!publisher) {
        throw new ReelsonError(`no publisher for channel type "${channel.type}" (known: ${Object.keys(PUBLISHERS).join(', ')})`)
    }
    return publisher
}

/**
 * The channels named in `wanted` ("a,b", or one per --to), or every one with `all`; null when neither — the caller asks.
 * Unknown names are an error that lists the known ones.
 */
export function pickChannels(channels: Channels, wanted: string | string[] | undefined, all = false): string[] | null {
    const known = Object.keys(channels.channels)
    if (!known.length) {
        throw new ReelsonError(`${channels.path} lists no channels`)
    }
    if (all) {
        return known
    }
    if (wanted === undefined) {
        return known.length === 1 ? known : null
    }
    // --to repeats and takes commas: `--to a --to b` is `--to a,b`
    const names = [...new Set([wanted].flat().flatMap((w) => w.split(',')).map((n) => n.trim()).filter(Boolean))]
    const unknown = names.filter((n) => !known.includes(n))
    if (unknown.length || !names.length) {
        throw new ReelsonError(`no channel ${unknown.map((n) => `"${n}"`).join(', ') || '(empty)'} in ${channels.path} — it has ${known.join(', ')}`)
    }
    return names
}

/**
 * The upload's title, description and tags: video.json `publish` when it words them, else the title,
 * and a description made of the subtitle and the steps (the callouts); the channel's footer and tags on top.
 */
export function metadata(spec: VideoSpec, steps: string[], channel: ChannelConfig): Metadata {
    const own = spec.publish ?? {}
    const list = steps.length > 1 ? steps.map((step, i) => `${i + 1}. ${step}`).join('\n') : ''
    const description = own.description ?? [spec.subtitle, list].filter(Boolean).join('\n\n')
    return {
        title: own.title ?? textTitle(spec),
        description: [description, channel.footer].filter(Boolean).join('\n\n'),
        tags: [...new Set([...(channel.tags ?? []), ...(own.tags ?? [])])],
    }
}

/** The render a format uploads (under <demo>/video/renders/), and its captions. */
export function renderFiles(demoDir: string, slug: string, format: Format): { file: string; captions: string } {
    const base = resolve(demoDir, 'video/renders', format === 'landscape' ? slug : `${slug}.${format}`)
    return { file: `${base}.mp4`, captions: `${base}.srt` }
}

/**
 * Why the render is not ready to go up — missing, or older than the video.json / markers.json it
 * was made from — or null.
 */
export function renderProblem(demoDir: string, slug: string, format: Format): string | null {
    const { file } = renderFiles(demoDir, slug, format)
    const flag = format === 'landscape' ? '' : ` --only ${format}`
    if (!existsSync(file)) {
        return `no ${relative(demoDir, file)} — run \`reelson render ${slug}${flag}\` first`
    }
    const rendered = statSync(file).mtimeMs
    for (const source of ['video.json', 'markers.json']) {
        const path = resolve(demoDir, source)
        if (existsSync(path) && statSync(path).mtimeMs > rendered) {
            return `${source} changed after ${relative(demoDir, file)} was rendered — run \`reelson render ${slug}${flag}\` again`
        }
    }
    return null
}

export interface PublishRecord extends Published {
    type: string
    /** When it went up (ISO 8601). */
    at: string
    /** The render uploaded, relative to the demo folder. */
    file: string
    /** Its SHA-1, so `--update` can tell whether the render is still the one up (older records have none). */
    sha1?: string
    /** When `--update` last rewrote it (ISO 8601). */
    updated?: string
    /** Earlier uploads `--replace` superseded, oldest first. */
    replaced?: (Published & { at: string })[]
}

/** The record of a new upload; with `replace`, it carries the one it supersedes into `replaced`. */
export function nextRecord(previous: PublishRecord | undefined, record: PublishRecord, replace: boolean): PublishRecord {
    if (!replace || !previous) {
        return record
    }
    return { ...record, replaced: [...(previous.replaced ?? []), { id: previous.id, url: previous.url, at: previous.at }] }
}

export function fileSha1(file: string): string {
    return createHash('sha1').update(readFileSync(file)).digest('hex')
}

/**
 * Why `--update` must leave the captions alone — the render changed since the upload, so its
 * captions may not match the video up — or null. Records made before `sha1` was kept cannot tell.
 */
export function captionsMismatch(demoDir: string, record: PublishRecord): string | null {
    if (!record.sha1) {
        return null
    }
    const file = resolve(demoDir, record.file)
    if (!existsSync(file)) {
        return `${record.file} is gone, so reelson cannot tell whether its captions match the video up`
    }
    return fileSha1(file) === record.sha1 ? null : `${record.file} was rendered again after the upload, so its captions may not match the video up — \`--replace\` uploads the new render`
}

export function readPublished(demoDir: string): Record<string, PublishRecord> {
    const path = resolve(demoDir, PUBLISHED_FILE)
    return existsSync(path) ? (JSON.parse(readFileSync(path, 'utf8')) as Record<string, PublishRecord>) : {}
}

export function recordPublished(demoDir: string, channel: string, record: PublishRecord): void {
    const all = { ...readPublished(demoDir), [channel]: record }
    writeFileSync(resolve(demoDir, PUBLISHED_FILE), JSON.stringify(all, null, 4) + '\n')
}

/**
 * Where a channel's sign-in is kept: ~/.config/reelson/credentials/, one file per project and channel
 * (a "youtube" channel in two projects may be two different accounts). Never inside the project.
 */
export function credentialsFor(config: LoadedConfig, name: string): CredentialStore {
    const base = process.env.XDG_CONFIG_HOME || resolve(homedir(), '.config')
    const project = createHash('sha1').update(config.root).digest('hex').slice(0, 10)
    const path = resolve(base, 'reelson/credentials', `${project}-${name}.json`)
    return {
        path,
        read<T>(): T | null {
            return existsSync(path) ? (JSON.parse(readFileSync(path, 'utf8')) as T) : null
        },
        write(value: unknown): void {
            mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
            writeFileSync(path, JSON.stringify(value, null, 2) + '\n', { mode: 0o600 })
        },
        remove(): boolean {
            const had = existsSync(path)
            rmSync(path, { force: true })
            return had
        },
    }
}

/** The starter `channels` that `reelson channels init` adds to the config. */
export function channelsTemplate(): Record<string, ChannelConfig> {
    return {
        youtube: { type: 'youtube', format: 'landscape', privacy: 'private', tags: [], footer: '' },
        shorts: { type: 'youtube', format: 'portrait', privacy: 'private' },
    }
}
