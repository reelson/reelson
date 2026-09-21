/**
 * The API a demo scenario is written against. A scenario file lives next to
 * its output (<videosDir>/<slug>/scenario.ts) and default-exports a Scenario.
 *
 * `Demo` wraps a Playwright Page with human-paced actions: the cursor glides
 * to the target before every click, typing has a per-key delay, and
 * `marker()` stamps the current video time so the composition can time its
 * callouts. Anything not covered here is available on `demo.page`.
 */
import type { Locator, Page } from '@playwright/test'

export interface Scenario {
    /** Slug used in logs and markers.json. */
    name: string
    /** Origin the scenario runs against, e.g. https://app.test (a local app with seeded data). */
    baseURL: string
    /** Defaults to demo.config.json `record.viewport` (1440x900). Keep 16:10 or 16:9. */
    viewport?: { width: number; height: number }
    /**
     * Capture pixel ratio (default 2): the page is laid out at `viewport` CSS
     * pixels but filmed at 2x, so UI text stays sharp in the 1080p frame and
     * under zooms (and a 4K render has real detail). Defaults to the config's.
     */
    deviceScaleFactor?: number
    /** Silence before the first action / after the last one (ms). */
    leadInMs?: number
    leadOutMs?: number
    run: (demo: Demo) => Promise<void>
}

export interface Marker {
    label: string
    /** Seconds from the start of the recording. */
    at: number
}

/**
 * Where and when the cursor clicked (or clicked into a field to type), in
 * viewport pixels. demo-video's check-zooms.ts uses these to keep zooms still
 * and on target while the viewer watches a click.
 */
export interface Click {
    at: number
    x: number
    y: number
    kind: 'click' | 'type'
    /** When the cursor started gliding towards this target (zooms ride along with it). */
    move: number
    /** The typing ends here (kind 'type' only). */
    until?: number
}

/** A range of the raw capture removed from recording.mp4 (see Demo.cut). */
export interface Cut {
    from: number
    to: number
}

/**
 * A hand-off between two actors (manager → employee). The stretch in between
 * (logout, second login) is cut from recording.mp4; the demo-video scaffold
 * splits the footage at `at` and shows a transition card there.
 */
export interface Transition {
    /** Seconds in the raw capture (record.ts rewrites it to cut-video time). */
    at: number
    /** Big line on the card, e.g. "The employee receives the document". */
    title: string
    /** Optional smaller line under it. */
    subtitle?: string
    /** Role chips on the card: from → to. */
    from?: string
    to?: string
}

/** A believable customer for forms. Email is unique per call (numeric suffix). */
export interface Persona {
    firstName: string
    lastName: string
    fullName: string
    email: string
    phone: string
    company: string
}

type PersonaSeed = { firstName: string; lastName: string; company: string }

/**
 * Name pools per UI language (demo.config.json `language`). Add a language by
 * adding a key; unknown languages fall back to English.
 */
const PERSONAS: Record<string, { phonePrefix: string; people: PersonaSeed[] }> = {
    en: {
        phonePrefix: '+1 555 ',
        people: [
            { firstName: 'Emma', lastName: 'Carter', company: 'Carter Consulting' },
            { firstName: 'Liam', lastName: 'Bennett', company: 'Bennett Design Co.' },
            { firstName: 'Olivia', lastName: 'Hayes', company: 'Hayes Logistics' },
            { firstName: 'Noah', lastName: 'Foster', company: 'Foster Construction' },
            { firstName: 'Ava', lastName: 'Mitchell', company: 'Mitchell Health' },
            { firstName: 'Lucas', lastName: 'Reed', company: 'Reed Tech' },
            { firstName: 'Mia', lastName: 'Collins', company: 'Collins Events' },
            { firstName: 'Ethan', lastName: 'Brooks', company: 'Brooks Farms' },
        ],
    },
    ro: {
        phonePrefix: '07',
        people: [
            { firstName: 'Andrei', lastName: 'Popescu', company: 'Popescu Consulting SRL' },
            { firstName: 'Ioana', lastName: 'Ionescu', company: 'Ionescu Design SRL' },
            { firstName: 'Mihai', lastName: 'Dumitrescu', company: 'Dumitrescu Construct SRL' },
            { firstName: 'Elena', lastName: 'Stan', company: 'Stan Logistic SRL' },
            { firstName: 'Alexandru', lastName: 'Radu', company: 'Radu Tech SRL' },
            { firstName: 'Maria', lastName: 'Constantin', company: 'Constantin Medical SRL' },
            { firstName: 'Cristian', lastName: 'Moldovan', company: 'Moldovan Agro SRL' },
            { firstName: 'Ana', lastName: 'Georgescu', company: 'Georgescu Events SRL' },
        ],
    },
}

export function persona(
    seed: number = Date.now(),
    domain = 'example.com',
    language = 'en',
): Persona {
    const pool = PERSONAS[language.split('-')[0]] ?? PERSONAS.en
    const base = pool.people[seed % pool.people.length]
    const strip = (v: string): string =>
        v
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .toLowerCase()
    const suffix = (seed % 89) + 10
    const digits = String(seed).padStart(8, '0').slice(-8)

    return {
        ...base,
        fullName: `${base.firstName} ${base.lastName}`,
        email: `${strip(base.firstName)}.${strip(base.lastName)}${suffix}@${domain}`,
        phone:
            pool.phonePrefix === '07'
                ? `07${digits}`
                : `${pool.phonePrefix}${digits.slice(0, 3)} ${digits.slice(3, 7)}`,
        company: base.company,
    }
}

export interface Demo {
    page: Page
    markers: Marker[]
    clicks: Click[]
    /**
     * Realistic customer data for forms (see Persona), in the project's UI
     * language. Domain defaults to demo.config.json `record.personaDomain`.
     */
    persona: (seed?: number, domain?: string) => Persona
    cuts: Cut[]
    /**
     * Everything that happens inside `fn` is removed from recording.mp4 (a
     * hard cut), except the first `keepMs` so the viewer glimpses the waiting
     * state. Use it around slow waits: 3-D Secure, long spinners, emails.
     */
    cut: <T>(fn: () => Promise<T>, opts?: { keepMs?: number }) => Promise<T>
    transitions: Transition[]
    /**
     * Switch actors off camera: `fn` (log out, log in as someone else, open the
     * first page) is cut from the video entirely, and the composition shows a
     * transition card at that point. End `fn` on a settled page.
     */
    transition: <T>(
        fn: () => Promise<T>,
        card: Omit<Transition, 'at'>,
    ) => Promise<T>
    elapsedSeconds: () => number
    /** Record the current time under a label (use for "callout here", "zoom here"). */
    marker: (label: string) => void
    pause: (ms: number) => Promise<void>
    /**
     * Navigate and wait for the page to settle. The cursor is parked at a
     * resting point near the middle first (see rest), so a page that opens the
     * video never starts with the cursor in a corner.
     */
    goto: (path: string) => Promise<void>
    /** Glide the cursor to a random resting point in the middle third of the viewport. */
    rest: () => Promise<void>
    /** Glide the cursor to the element on a curved, eased path (scrolls it into view first). */
    moveTo: (target: Locator) => Promise<void>
    /** moveTo + click + short settle. */
    click: (target: Locator, opts?: { settleMs?: number }) => Promise<void>
    /** moveTo + click + human-paced typing (uneven delays, beats after spaces). */
    type: (target: Locator, text: string) => Promise<void>
    /** Slow wheel scroll so the viewer can follow. */
    scroll: (deltaY: number, opts?: { stepPx?: number }) => Promise<void>
}

export function createDemo(
    page: Page,
    seed: number = 1,
    personaDefaults: { domain?: string; language?: string } = {},
): Demo {
    const startedAt = Date.now()
    const markers: Marker[] = []
    const clicks: Click[] = []
    const cuts: Cut[] = []
    const transitions: Transition[] = []
    const elapsedSeconds = (): number => (Date.now() - startedAt) / 1000
    const stamp = (): number => Number(elapsedSeconds().toFixed(2))

    // Deterministic per scenario, so a re-record moves and types the same way.
    const rng = mulberry32(seed)
    const viewport = page.viewportSize() ?? { width: 1440, height: 900 }
    // A believable place for a hand to rest: somewhere in the middle third, never a corner.
    const restingPoint = (): { x: number; y: number } => ({
        x: Math.round(viewport.width * (0.38 + rng() * 0.24)),
        y: Math.round(viewport.height * (0.38 + rng() * 0.24)),
    })
    let pos = restingPoint()

    /**
     * Human-like glide: a gently curved path (quadratic bezier with a random
     * perpendicular bow), ease-in-out speed, a little tremor that dies out as
     * the cursor settles, and a landing point slightly off the exact centre.
     */
    const glide = async (to: { x: number; y: number }): Promise<void> => {
        const from = pos
        const dx = to.x - from.x
        const dy = to.y - from.y
        const dist = Math.hypot(dx, dy)
        if (dist < 2) {
            return
        }
        const bow = (0.1 + rng() * 0.18) * (rng() < 0.5 ? -1 : 1)
        const cx = from.x + dx / 2 - dy * bow
        const cy = from.y + dy / 2 + dx * bow
        const steps = Math.round(Math.min(42, Math.max(14, dist / 16)))
        const durationMs = Math.min(720, Math.max(260, 200 + dist * 0.55))
        for (let i = 1; i <= steps; i++) {
            const u = i / steps
            const e = u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2
            const tremor = (1 - e) * 1.2
            const x =
                (1 - e) * (1 - e) * from.x +
                2 * (1 - e) * e * cx +
                e * e * to.x +
                (rng() - 0.5) * tremor
            const y =
                (1 - e) * (1 - e) * from.y +
                2 * (1 - e) * e * cy +
                e * e * to.y +
                (rng() - 0.5) * tremor
            await page.mouse.move(x, y)
            await page.waitForTimeout(durationMs / steps)
        }
        pos = to
    }

    const rest: Demo['rest'] = async () => {
        await glide(restingPoint())
        await page.mouse.move(pos.x, pos.y)
    }

    const moveTo: Demo['moveTo'] = async (target) => {
        await target.first().scrollIntoViewIfNeeded()
        const box = await target.first().boundingBox()
        if (!box) {
            throw new Error(`moveTo: target has no bounding box: ${target}`)
        }
        // Land near, not exactly on, the centre — people don't hit the middle.
        const jx = (rng() - 0.5) * Math.min(24, box.width * 0.3)
        const jy = (rng() - 0.5) * Math.min(10, box.height * 0.3)
        await glide({
            x: box.x + box.width / 2 + jx,
            y: box.y + box.height / 2 + jy,
        })
        await page.waitForTimeout(120 + rng() * 120)
    }

    /**
     * Human-like typing: uneven per-key delay, a beat after spaces and
     * punctuation, the odd longer hesitation — but never slow overall.
     */
    const typeNaturally = async (text: string): Promise<void> => {
        for (const ch of text) {
            await page.keyboard.type(ch)
            let delay = 38 + rng() * 60
            if (ch === ' ') {
                delay += 50 + rng() * 80
            } else if ('.,@-_'.includes(ch)) {
                delay += 60 + rng() * 60
            }
            if (rng() < 0.05) {
                delay += 120 + rng() * 160
            }
            await page.waitForTimeout(delay)
        }
    }

    return {
        page,
        markers,
        clicks,
        persona: (personaSeed, domain) =>
            persona(
                personaSeed,
                domain ?? personaDefaults.domain,
                personaDefaults.language,
            ),
        cuts,
        cut: async (fn, opts = {}) => {
            const from = elapsedSeconds() + (opts.keepMs ?? 600) / 1000
            const result = await fn()
            const to = elapsedSeconds()
            if (to > from) {
                cuts.push({
                    from: Number(from.toFixed(2)),
                    to: Number(to.toFixed(2)),
                })
            }

            return result
        },
        transitions,
        transition: async (fn, card) => {
            const from = elapsedSeconds()
            const result = await fn()
            // Re-assert the cursor on the new page so the first kept frame has it.
            await page.mouse.move(pos.x, pos.y)
            await page.waitForTimeout(300)
            const to = elapsedSeconds()
            cuts.push({
                from: Number(from.toFixed(2)),
                to: Number(to.toFixed(2)),
            })
            transitions.push({ ...card, at: Number(from.toFixed(2)) })

            return result
        },
        elapsedSeconds,
        marker: (label) => {
            markers.push({ label, at: Number(elapsedSeconds().toFixed(2)) })
        },
        pause: (ms) => page.waitForTimeout(ms),
        goto: async (path) => {
            // Park the cursor mid-screen BEFORE leaving: the overlay carries the position
            // into the next page, and the trimmed video usually starts right after this.
            await rest()
            await page.goto(path, { waitUntil: 'networkidle' })
            // Re-assert on the new document (a new origin has no saved overlay position).
            await page.mouse.move(pos.x, pos.y)
            await page.waitForTimeout(600)
        },
        rest,
        moveTo,
        click: async (target, opts = {}) => {
            const move = stamp()
            await moveTo(target)
            clicks.push({
                move,
                at: stamp(),
                x: Math.round(pos.x),
                y: Math.round(pos.y),
                kind: 'click',
            })
            await target.first().click()
            await page.waitForTimeout(opts.settleMs ?? 700)
        },
        type: async (target, text) => {
            const move = stamp()
            await moveTo(target)
            const click: Click = {
                move,
                at: stamp(),
                x: Math.round(pos.x),
                y: Math.round(pos.y),
                kind: 'type',
            }
            clicks.push(click)
            await target.first().click()
            await typeNaturally(text)
            click.until = stamp()
            await page.waitForTimeout(300 + rng() * 200)
        },
        scroll: async (deltaY, opts = {}) => {
            const step = opts.stepPx ?? 80
            const steps = Math.max(1, Math.round(Math.abs(deltaY) / step))
            const sign = Math.sign(deltaY)
            for (let i = 0; i < steps; i++) {
                await page.mouse.wheel(0, sign * step)
                await page.waitForTimeout(40)
            }
            await page.waitForTimeout(300)
        },
    }
}

/** Small seeded PRNG so recordings are reproducible. */
function mulberry32(seed: number): () => number {
    let a = seed >>> 0
    return () => {
        a = (a + 0x6d2b79f5) >>> 0
        let t = a
        t = Math.imul(t ^ (t >>> 15), t | 1)
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    }
}
