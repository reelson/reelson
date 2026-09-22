/**
 * Assembles a template's stage.html and the chosen sections into one
 * composition, filled from a computed timeline. Pure (strings in, string out),
 * so the output is golden-tested. See templates/README.md for the contract.
 */
import type { Slot, Timeline } from './timeline.ts'
import { round } from './timeline.ts'
import type { Zoom } from './zooms.ts'

export interface CompositionText {
    language: string
    brand: { name: string; tagline: string; eyebrow: string; color: string; colorSoft: string }
    /** assets/ path of the brand logo, or '' to draw the text wordmark. */
    logo: string
    title: string
    subtitle: string
    recapTitle: string
    /** Intro chip halves, already pluralised: "4 steps", "27 seconds". */
    stepsChip: string
    secondsChip: string
}

/** One section's files, read by the build. */
export interface SectionSource {
    slot: Slot
    name: string
    html: string
    css: string
    js: string
    /** Where the section's own assets/ were copied, relative to video/ ('' if it has none). */
    assets: string
}

export interface CompositionInput {
    stage: string
    /** In slot order; the recap is left out when the video has none. */
    sections: SectionSource[]
    timeline: Timeline
    zooms: Zoom[]
    text: CompositionText
    /** assets/narration.m4a exists (the recording had an audio track). */
    narration: boolean
    /** assets/music.m4a exists. */
    music: boolean
}

/** HyperFrames track per slot: the recap cross-fades with the outro, so they sit on different tracks. */
const TRACKS: Record<Slot, number> = { intro: 3, recap: 2, outro: 3 }

export function renderComposition(input: CompositionInput): string {
    const { timeline: t, text } = input

    // Everything the stage and section scripts animate from. Times are composition seconds.
    const demo = {
        total: t.total,
        clipStart: t.clipStart,
        clipDuration: t.clipDuration,
        mediaStart: t.mediaStart,
        sections: { intro: t.intro, recap: t.recap, outro: t.outro },
        callouts: t.callouts,
        zooms: input.zooms,
        transitions: t.transitions.map(({ at, gap }) => ({ at, gap })),
        chip: { steps: text.stepsChip, seconds: text.secondsChip },
    }

    const shared: Record<string, string> = {
        LANG: escapeHtml(text.language),
        BRAND_COLOR: escapeHtml(text.brand.color),
        BRAND_COLOR_SOFT: escapeHtml(text.brand.colorSoft),
        BRAND: escapeHtml(text.brand.name),
        BRAND_SUB: escapeHtml(text.brand.tagline),
        BRAND_LOGO: escapeHtml(text.logo),
        EYEBROW: escapeHtml(text.brand.eyebrow),
        TITLE: escapeHtml(text.title),
        SUBTITLE: escapeHtml(text.subtitle),
        OUTRO_TITLE: escapeHtml(text.recapTitle),
        TOTAL: String(t.total),
        FRAME_W: String(t.frame.width),
        FRAME_H: String(t.frame.height),
    }
    const unfilled = new Set<string>()
    const fill = (source: string, values: Record<string, string>): string =>
        source.replace(/{{([A-Z_]+)}}/g, (match, key: string) => {
            if (key in values) {
                return values[key]
            }
            unfilled.add(match)
            return match
        })

    const parts = input.sections.map((s) => {
        const slot = t[s.slot]
        if (!slot) {
            throw new Error(`the timeline has no ${s.slot} (recap "none") but a ${s.slot} section was given`)
        }
        const values = {
            ...shared,
            START: String(slot.start),
            DURATION: String(slot.duration),
            TRACK: String(TRACKS[s.slot]),
            ASSETS: s.assets,
        }
        const label = `${s.slot}: ${s.name}`
        return {
            slot: s.slot,
            css: `      /* ── ${label} ── */\n${indent(fill(s.css, values).trim(), 6)}`,
            html: `      <!-- ── ${label} ── -->\n${indent(fill(s.html, values).trim(), 6)}`,
            js:
                `      // ── ${label} ──\n      ;((section) => {\n${indent(fill(s.js, values).trim(), 8)}\n` +
                `      })(DEMO.sections.${s.slot});`,
        }
    })

    const part = (slot: Slot) => parts.find((p) => p.slot === slot) ?? { html: '', css: '', js: '' }
    const html = fill(input.stage, {
        ...shared,
        SECTION_STYLES: parts.map((p) => p.css).join('\n\n'),
        // Each slot has its own place in the stage: the intro sits under #screen, recap and outro above it.
        INTRO: part('intro').html,
        RECAP: part('recap').html,
        OUTRO: part('outro').html,
        SECTION_SCRIPTS: parts.map((p) => p.js).join('\n\n'),
        VIDEOS: renderVideoSegments(t),
        TRANSITIONS: t.transitions.map((tr, i) => renderTransitionCard(tr, i, t.belt)).join('\n'),
        AUDIO: input.narration ? renderNarration(t) : '',
        MUSIC: input.music ? renderMusic(t) : '',
        // JSON is valid JS; escaping "<" keeps "</script>" in a callout from closing the tag.
        DEMO: JSON.stringify(demo, null, 2).replace(/</g, '\\u003c').replace(/\n/g, '\n      '),
    })
    if (unfilled.size) {
        throw new Error(`template placeholders left unfilled: ${[...unfilled].join(', ')}`)
    }

    return html
}

function indent(block: string, spaces: number): string {
    const pad = ' '.repeat(spaces)
    return block
        .split('\n')
        .map((line) => (line.trim() ? pad + line : ''))
        .join('\n')
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
