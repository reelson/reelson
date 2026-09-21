/**
 * Checks the zooms in a composition against the cursor moves and clicks the
 * recorder logged.
 *
 *   node <skills>/demo-video/scripts/check-zooms.ts <videosDir>/<slug>
 *
 * Rule: a zoom rides along with the cursor and is done before the click.
 *   1. zoom in while the cursor glides to the first click it frames: start at
 *      most EARLY s before the glide starts, and finish the ease SETTLE s
 *      before the click;
 *   2. zoom out while the cursor glides to the next target outside the zoom:
 *      start the ease-out at most EARLY s before that glide, and finish it
 *      SETTLE s before that click;
 *   3. never ease during a click, and every click in the hold is inside the view.
 * Ease durations are per zoom (`in`/`out`, default 0.8 s, at least MIN_EASE);
 * glides are short (~0.4-1 s), so they usually need shortening. Exits 1 with
 * the exact values to use. Needs markers.json `clicks` with `move` (re-record
 * older videos).
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const DEFAULT_EASE = 0.8 // the template's default zoom in/out duration
const MIN_EASE = 0.4 // shorter reads as a jump
const SETTLE = 0.1 // the zoom is done this long before the click
const EARLY = 0.35 // may start this long before the glide (not more: no waiting)
const EPS = 0.005 // float slack (13.03 + 4.36 must not fail against 17.39)
const MARGIN = 0.03 // keep clicks this far (fraction of the frame) inside the view

interface Zoom {
    at: number
    duration: number
    x: number
    y: number
    scale: number
    in?: number
    out?: number
}
interface Click {
    at: number
    move?: number
    x: number
    y: number
    kind: 'click' | 'type'
}

const demoDir = resolve(process.argv[2] ?? '')
const markers = JSON.parse(
    readFileSync(resolve(demoDir, 'markers.json'), 'utf8'),
) as {
    viewport: { width: number; height: number }
    clicks?: Click[]
    transitions?: { at: number }[]
}
if (!markers.clicks || markers.clicks.some((c) => c.move === undefined)) {
    console.error(
        'markers.json has no clicks with cursor-move times — re-record with the current demo-record scripts',
    )
    process.exit(1)
}

// The DEMO block is pure literals; evaluate it rather than re-parsing JS by hand.
const html = readFileSync(resolve(demoDir, 'video/index.html'), 'utf8')
const block = html.match(/const DEMO = (\{[\s\S]*?\n {6}\});/)
if (!block) {
    console.error('could not find the DEMO block in video/index.html')
    process.exit(1)
}
const DEMO = new Function(`return ${block[1]}`)() as {
    clipStart: number
    clipDuration: number
    mediaStart: number
    zooms: Zoom[]
    transitions: { at: number; gap: number }[]
}

const gap = DEMO.transitions[0]?.gap ?? 0
const handOffs = (markers.transitions ?? []).filter(
    (t) => t.at > DEMO.mediaStart,
)
const toComposition = (t: number): number =>
    DEMO.clipStart +
    (t - DEMO.mediaStart) +
    gap * handOffs.filter((h) => h.at <= t).length
const round = (n: number): number => Math.round(n * 100) / 100

const clicks = markers.clicks
    .filter((c) => c.at >= DEMO.mediaStart)
    .map((c) => ({
        ...c,
        comp: round(toComposition(c.at)),
        glide: round(toComposition(c.move ?? c.at)),
        fx: c.x / markers.viewport.width,
        fy: c.y / markers.viewport.height,
    }))

let violations = 0
DEMO.zooms.forEach((z, i) => {
    const zoomIn = z.in ?? DEFAULT_EASE
    const zoomOut = z.out ?? DEFAULT_EASE
    const end = round(z.at + z.duration)
    // The part of the frame visible at full zoom (transform-origin = focus point).
    const view = {
        left: z.x - z.x / z.scale,
        right: z.x + (1 - z.x) / z.scale,
        top: z.y - z.y / z.scale,
        bottom: z.y + (1 - z.y) / z.scale,
    }
    const isVisible = (c: (typeof clicks)[number]): boolean =>
        c.fx >= view.left + MARGIN &&
        c.fx <= view.right - MARGIN &&
        c.fy >= view.top + MARGIN &&
        c.fy <= view.bottom - MARGIN
    const describe = (c: (typeof clicks)[number]): string =>
        `${c.kind} at ${c.comp}s (glide from ${c.glide}s, ${Math.round(c.fx * 100)}%, ${Math.round(c.fy * 100)}%)`

    const problems: string[] = []
    const inside = clicks.filter((c) => c.comp >= z.at && c.comp <= end)
    const framed = inside.filter(isVisible)
    const first = framed[0]
    const last = framed.at(-1)
    // The first click after the zoom's clicks that the zoom does not show: zoom out on its glide.
    const next = clicks.find(
        (c) =>
            c.comp > (last?.comp ?? z.at) && !(c.comp <= end && isVisible(c)),
    )

    if (!first) {
        problems.push('frames no click — zoom on a click, or drop the zoom')
    } else {
        // Ideal timing, printed with every problem so the fix is a copy-paste.
        const idealAt = round(
            Math.max(first.glide - EARLY, first.comp - SETTLE - DEFAULT_EASE),
        )
        const idealIn = round(
            Math.max(
                MIN_EASE,
                Math.min(DEFAULT_EASE, first.comp - SETTLE - idealAt),
            ),
        )
        let ideal = `at: ${idealAt}, in: ${idealIn}`
        if (next) {
            const outEnd = round(next.comp - SETTLE)
            const outStart = round(
                Math.max(
                    next.glide - EARLY,
                    outEnd - DEFAULT_EASE,
                    (last?.comp ?? 0) + 0.2,
                ),
            )
            ideal += `, duration: ${round(outEnd - idealAt)}, out: ${round(Math.max(MIN_EASE, outEnd - outStart))}`
        }
        const fix = ` → use { ${ideal} }`

        if (z.at + zoomIn > first.comp - SETTLE + EPS) {
            problems.push(
                `zoom-in not done before the ${describe(first)}${fix}`,
            )
        } else if (z.at < first.glide - EARLY - EPS) {
            problems.push(
                `zoom-in starts before the cursor moves (the viewer waits) — ride along with the glide${fix}`,
            )
        }
        for (const c of inside) {
            if (!isVisible(c)) {
                problems.push(`${describe(c)} is outside the zoomed view${fix}`)
            } else if (c.comp > end - zoomOut + EPS) {
                problems.push(
                    `${describe(c)} happens while the zoom eases out${fix}`,
                )
            }
        }
        if (next && end > next.comp - SETTLE + EPS && !inside.includes(next)) {
            problems.push(
                `zoom-out not done before the ${describe(next)}${fix}`,
            )
        } else if (next && end - zoomOut < next.glide - EARLY - EPS) {
            problems.push(
                `zoom-out starts before the cursor heads for the next target — ride along with the glide${fix}`,
            )
        }
        if (zoomIn < MIN_EASE || zoomOut < MIN_EASE) {
            problems.push(
                `ease shorter than ${MIN_EASE}s reads as a jump — add a beat in the scenario instead`,
            )
        }
    }

    const label = `zoom ${i + 1} (${z.at}–${round(end)}s, in ${zoomIn}s / out ${zoomOut}s, ${z.scale}x at ${z.x},${z.y})`
    if (problems.length) {
        violations += problems.length
        console.log(`✗ ${label}`)
        problems.forEach((p) => console.log(`    ${p}`))
    } else {
        console.log(
            `✓ ${label}: ${framed.map((c) => `${c.kind} ${c.comp}s`).join(', ')}`,
        )
    }
})

if (violations) {
    console.log(`\n${violations} zoom problem(s)`)
    process.exit(1)
}
