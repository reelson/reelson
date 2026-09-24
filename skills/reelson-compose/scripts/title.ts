/**
 * A title can hold a rotating phrase: "Automate {anything|workflows|approvals} in Filament". A
 * template may animate the options on screen; everywhere a title leaves the video as text
 * (captions, the upload's title) it reads with the first option. One parser for both, so the
 * two cannot drift apart: templates get its output as DEMO.title.parts. Pure.
 */

/** Plain text, and one array of options per {a|b|…} group (trimmed, never empty). */
export type TitlePart = string | string[]

/**
 * Splits a title into text and rotating groups. A group is "{" … "}" with at least one "|" and no
 * braces inside; anything else ("{draft}", a lone "{" or "|") stays text.
 */
export function titleParts(title: string): TitlePart[] {
    const parts: TitlePart[] = []
    let text = ''
    let last = 0
    for (const match of title.matchAll(/\{([^{}]*\|[^{}]*)\}/g)) {
        const options = match[1].split('|').map((o) => o.trim())
        if (options.some((o) => !o)) {
            continue
        }
        text += title.slice(last, match.index)
        if (text) parts.push(text)
        parts.push(options)
        text = ''
        last = match.index + match[0].length
    }
    text += title.slice(last)
    if (text) parts.push(text)
    return parts
}

/** The title as text: each rotating group read as its first option. */
export function plainTitle(title: string): string {
    return titleParts(title)
        .map((p) => (typeof p === 'string' ? p : p[0]))
        .join('')
}

/** How a video's title reads as text: video.json `captionTitle`, else its plain title. */
export function textTitle(spec: { title: string; captionTitle?: string }): string {
    return spec.captionTitle ?? plainTitle(spec.title)
}
