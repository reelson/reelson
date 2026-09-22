/**
 * Captions for a rendered video: the title while the intro is on screen, then one cue per
 * callout, in composition time — the same words the viewer reads on the cards, as a
 * subtitle track for players, social uploads and screen readers. Pure.
 */
import type { Timeline } from './timeline.ts'

export interface Cue {
    start: number
    end: number
    text: string
}

export function captionCues(timeline: Timeline, title: string, subtitle?: string): Cue[] {
    const intro = subtitle ? `${title}\n${subtitle}` : title
    return [
        { start: 0, end: timeline.intro.exit, text: intro },
        ...timeline.callouts.map((c) => ({ start: c.at, end: c.at + c.duration, text: c.text })),
    ].filter((c) => c.end > c.start && c.text.trim())
}

export function toSrt(cues: Cue[]): string {
    const time = (s: number) => clock(s, ',')
    return cues.map((c, i) => `${i + 1}\n${time(c.start)} --> ${time(c.end)}\n${c.text}\n`).join('\n')
}

export function toVtt(cues: Cue[]): string {
    const time = (s: number) => clock(s, '.')
    return `WEBVTT\n\n${cues.map((c) => `${time(c.start)} --> ${time(c.end)}\n${c.text}\n`).join('\n')}`
}

/** 00:01:02,345 (SRT) / 00:01:02.345 (WebVTT). */
function clock(seconds: number, separator: ',' | '.'): string {
    const ms = Math.max(0, Math.round(seconds * 1000))
    const pad = (n: number, width = 2) => String(n).padStart(width, '0')
    const h = Math.floor(ms / 3_600_000)
    const m = Math.floor((ms % 3_600_000) / 60_000)
    const s = Math.floor((ms % 60_000) / 1000)
    return `${pad(h)}:${pad(m)}:${pad(s)}${separator}${pad(ms % 1000, 3)}`
}
