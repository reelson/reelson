/**
 * Square (1080x1080) and portrait (1080x1920) versions of a rendered 16:9 video, for social
 * feeds: the whole video at full width in the middle, over a blurred, darkened copy of
 * itself that fills the rest. Every template and section is designed for the 16:9 stage, so
 * this keeps the video as designed and all of the UI legible, rather than cropping it.
 */
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs'

export const FORMATS = {
    square: { width: 1080, height: 1080 },
    portrait: { width: 1080, height: 1920 },
} as const
export type Format = keyof typeof FORMATS

/** The ffmpeg filter graph for `format` (input: the 1920x1080 render). */
export function reframeFilter(format: Format): string {
    const { width: w, height: h } = FORMATS[format]
    return (
        `[0:v]split[bg][fg];` +
        `[bg]scale=${w}:${h}:force_original_aspect_ratio=increase,crop=${w}:${h},boxblur=40:4,eq=brightness=-0.32:saturation=0.8[back];` +
        `[fg]scale=${w}:-2:flags=lanczos[front];` +
        `[back][front]overlay=(W-w)/2:(H-h)/2,format=yuv420p[v]`
    )
}

/** Writes `output` from `input` unless it is up to date. Returns 'rendered' | 'unchanged' | 'failed'. */
export function reframe(input: string, output: string, format: Format, force = false): 'rendered' | 'unchanged' | 'failed' {
    const { size, mtimeMs } = statSync(input)
    const key = JSON.stringify({ format, size, mtimeMs, filter: reframeFilter(format) })
    const stamp = `${output}.key`
    if (!force && existsSync(output) && existsSync(stamp) && readFileSync(stamp, 'utf8') === key) {
        return 'unchanged'
    }
    const ffmpeg = spawnSync(
        'ffmpeg',
        [
            '-y', '-loglevel', 'error', '-i', input,
            '-filter_complex', reframeFilter(format), '-map', '[v]', '-map', '0:a?',
            '-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-c:a', 'copy', '-movflags', '+faststart',
            output,
        ],
        { stdio: 'inherit' },
    )
    if (ffmpeg.status !== 0) {
        return 'failed'
    }
    writeFileSync(stamp, key)
    return 'rendered'
}
