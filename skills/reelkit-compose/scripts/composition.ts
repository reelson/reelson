/**
 * Fills a template's index.html from a computed timeline. Pure (string in,
 * string out), so the output is golden-tested. See templates/README.md for the
 * placeholder contract.
 */
import type { Timeline } from './timeline.ts'
import { round } from './timeline.ts'
import type { Zoom } from './zooms.ts'

export interface CompositionText {
    language: string
    brand: { name: string; tagline: string; eyebrow: string; color: string; colorSoft: string }
    title: string
    subtitle: string
    recapTitle: string
    /** Cover chip halves, already pluralised: "4 steps", "27 seconds". */
    stepsChip: string
    secondsChip: string
}

export interface CompositionInput {
    template: string
    timeline: Timeline
    zooms: Zoom[]
    text: CompositionText
    maxSteps: number
    /** assets/narration.m4a exists (the recording had an audio track). */
    narration: boolean
    /** assets/music.m4a exists. */
    music: boolean
}

export function renderComposition(input: CompositionInput): string {
    const { timeline: t, text } = input

    // Everything the template's builder script animates from. Times are composition seconds.
    const demo = {
        total: t.total,
        coverDuration: t.cover,
        coverExit: t.coverExit,
        clipStart: t.clipStart,
        clipDuration: t.clipDuration,
        mediaStart: t.mediaStart,
        recapStart: t.recapStart,
        recapDuration: t.recapDuration,
        brandOutStart: t.brandOutStart,
        brandOutDuration: t.brandOutDuration,
        callouts: t.callouts,
        zooms: input.zooms,
        transitions: t.transitions.map(({ at, gap }) => ({ at, gap })),
        chip: { steps: text.stepsChip, seconds: text.secondsChip },
        maxSteps: input.maxSteps,
    }

    const replacements: Record<string, string> = {
        LANG: escapeHtml(text.language),
        BRAND_COLOR: escapeHtml(text.brand.color),
        BRAND_COLOR_SOFT: escapeHtml(text.brand.colorSoft),
        BRAND: escapeHtml(text.brand.name),
        BRAND_SUB: escapeHtml(text.brand.tagline),
        EYEBROW: escapeHtml(text.brand.eyebrow),
        TITLE: escapeHtml(text.title),
        SUBTITLE: escapeHtml(text.subtitle),
        OUTRO_TITLE: escapeHtml(text.recapTitle),
        TOTAL: String(t.total),
        COVER_DURATION: String(t.cover),
        RECAP_START: String(t.recapStart),
        RECAP_DURATION: String(t.recapDuration),
        BRAND_OUT_START: String(t.brandOutStart),
        BRAND_OUT_DURATION: String(t.brandOutDuration),
        FRAME_W: String(t.frame.width),
        FRAME_H: String(t.frame.height),
        VIDEOS: renderVideoSegments(t),
        TRANSITIONS: t.transitions.map((tr, i) => renderTransitionCard(tr, i, t.belt)).join('\n'),
        AUDIO: input.narration ? renderNarration(t) : '',
        MUSIC: input.music ? renderMusic(t) : '',
        // JSON is valid JS; escaping "<" keeps "</script>" in a callout from closing the tag.
        DEMO: JSON.stringify(demo, null, 2).replace(/</g, '\\u003c').replace(/\n/g, '\n      '),
    }

    let html = input.template
    for (const [key, value] of Object.entries(replacements)) {
        html = html.replaceAll(`{{${key}}}`, () => value)
    }
    const leftover = html.match(/{{[A-Z_]+}}/g)
    if (leftover) {
        throw new Error(`template placeholders left unfilled: ${[...new Set(leftover)].join(', ')}`)
    }

    return html
}

/**
 * One <video> clip per stretch of footage between hand-offs (same file,
 * different data-media-start), so the footage pauses while a card is on screen.
 */
function renderVideoSegments(t: Timeline): string {
    return t.segments
        .map((s, i) => {
            const id = i === 0 ? 'recording' : `recording-${i + 1}`

            return `          <video id="${id}" class="clip" src="assets/recording.mp4" muted playsinline
            data-start="${s.start}" data-duration="${s.duration}" data-media-start="${s.mediaStart}" data-track-index="1"></video>`
        })
        .join('\n')
}

/** Markup for a hand-off card; the template's builder animates it from DEMO.transitions. */
function renderTransitionCard(tr: Timeline['transitions'][number], i: number, belt: number): string {
    const { card } = tr
    const roles =
        card.from && card.to
            ? `
          <div class="roles">
            <div class="role from">${escapeHtml(card.from)}</div>
            <div class="arrow"></div>
            <div class="role to"><div class="fill"></div><span>${escapeHtml(card.to)}</span></div>
          </div>`
            : ''
    const subtitle = card.subtitle
        ? `
          <p class="subtitle">${escapeHtml(card.subtitle)}</p>`
        : ''

    return `      <!-- Hand-off ${i + 1}: demo.transition() in the scenario -->
      <section id="transition-${i}" class="clip transition-card" data-start="${round(tr.at - belt)}" data-duration="${round(tr.gap + 2 * belt)}" data-track-index="2">
        <div class="stack">${roles}
          <h1 class="title">${escapeHtml(card.title)}</h1>${subtitle}
        </div>
      </section>`
}

function renderNarration(t: Timeline): string {
    return `      <!-- Narration from the recording (kept in sync via the same start/media-start) -->
      <audio id="narration" class="clip" src="assets/narration.m4a" data-start="${t.clipStart}" data-duration="${round(t.mediaEnd - t.mediaStart)}" data-media-start="${t.mediaStart}" data-track-index="3"></audio>`
}

function renderMusic(t: Timeline): string {
    return `      <!-- Music bed, pre-rendered by reelkit build (trim + loudnorm + fades) -->
      <audio id="music" class="clip" src="assets/music.m4a" data-start="0" data-duration="${t.total}" data-track-index="4"></audio>`
}

export function escapeHtml(s: string): string {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}
