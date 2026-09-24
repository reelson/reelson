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
    /** Defaults to reelson.config.json `record.viewport` (1440x900). Keep 16:10 or 16:9. */
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
 * viewport pixels. reelson-compose's check-zooms.ts uses these to keep zooms still
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

/**
 * What the demo was working on: the element it moved to (`box`) and the compact block
 * around it (`area`: e.g. a form field with its label), viewport CSS px, from `at` (the
 * glide towards it). A portrait video frames `area` so the element is never cut.
 */
export interface Focus {
    at: number
    box: { x: number; y: number; width: number; height: number }
    area: { x: number; y: number; width: number; height: number }
}

/** A range of the raw capture removed from recording.mp4 (see Demo.cut). */
export interface Cut {
    from: number
    to: number
}

/**
 * A hand-off between two actors (manager → employee). The stretch in between
 * (logout, second login) is cut from recording.mp4; the reelson-compose scaffold
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
 * Name pools per UI language (reelson.config.json `language`). Add a language by
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
    /** Every element moveTo/click/type went to, with its surroundings (see Focus). */
    focus: Focus[]
    /**
     * Realistic customer data for forms (see Persona), in the project's UI
     * language. Domain defaults to reelson.config.json `record.personaDomain`.
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
    /** Date.now() at the start of the recording clock (elapsedSeconds() = 0). */
    startedAt: number
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
    /**
     * Glide the cursor to the element on a curved, eased path. An element out of sight is
     * scrolled into view first, smoothly (its container glides), so the viewer can follow.
     */
    moveTo: (target: Locator) => Promise<void>
    /** moveTo + click + short settle. */
    click: (target: Locator, opts?: { settleMs?: number }) => Promise<void>
    /** moveTo + click + human-paced typing (uneven delays, beats after spaces). */
    type: (target: Locator, text: string) => Promise<void>
    /** Slow wheel scroll so the viewer can follow. */
    scroll: (deltaY: number, opts?: { stepPx?: number }) => Promise<void>
    /**
     * Runs `action` (e.g. a click on a target="_blank" link), waits for the tab or pop-up it
     * opens, and continues there: `demo.page` and every demo action now use it, and the video
     * films it. When it closes, the demo (and the video) return to the page that opened it.
     */
    popup: (action: () => Promise<unknown>) => Promise<Page>
    /** Continue on another page of the context (see popup); the video follows. */
    switchTo: (next: Page) => Promise<void>
    /**
     * True when recording the phone version (`reelson record --mobile`): branch where the
     * mobile UI differs, e.g. open the menu behind the hamburger button first.
     */
    mobile: boolean
    /**
     * True when recording the square version (`reelson record --square`, a square browser):
     * branch where the narrower window changes the UI.
     */
    square: boolean
}

/** What the recorder tells the demo, and hears from it. */
export interface DemoHooks {
    /** The page the demo acts on (and the video shows) changed. */
    onSwitch?: (page: Page) => void
    /** Recording on a phone (`reelson record --mobile`). */
    mobile?: boolean
    /** Recording in a square browser (`reelson record --square`). */
    square?: boolean
}

export function createDemo(
    first: Page,
    seed: number = 1,
    personaDefaults: { domain?: string; language?: string } = {},
    hooks: DemoHooks = {},
): Demo {
    // The page every action uses; demo.popup / demo.switchTo move it, a close moves it back.
    let page = first
    const openers: Page[] = []
    const startedAt = Date.now()
    const markers: Marker[] = []
    const clicks: Click[] = []
    const focus: Focus[] = []
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
        if (await revealSmoothly(target.first())) {
            // Let the viewer see where the scroll landed before the cursor sets off.
            await page.waitForTimeout(250)
        }
        await target.first().scrollIntoViewIfNeeded()
        const box = await target.first().boundingBox()
        if (!box) {
            throw new Error(`moveTo: target has no bounding box: ${target}`)
        }
        focus.push({ at: stamp(), box: rounded(box), area: rounded(await areaAround(target.first(), box)) })
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
     * An element out of sight is scrolled into view the way a person would (its scrolling
     * container glides, eased, over 0.5–1.4 s by distance), not in one jump — so the viewer
     * can follow a menu or a list moving. Returns whether it scrolled.
     */
    const revealSmoothly = async (el: Locator): Promise<boolean> =>
        el.evaluate(async (node) => {
            const r = node.getBoundingClientRect()
            const x = Math.min(Math.max(r.left + r.width / 2, 0), innerWidth - 1)
            const y = Math.min(Math.max(r.top + r.height / 2, 0), innerHeight - 1)
            const hit = document.elementFromPoint(x, y)
            const inView = r.top >= 0 && r.bottom <= innerHeight && !!hit && (node.contains(hit) || hit.contains(node))
            if (inView) {
                return false
            }
            // The nearest ancestor that scrolls vertically, else the page.
            let box: Element | null = node.parentElement
            while (box && !(/(auto|scroll)/.test(getComputedStyle(box).overflowY) && box.scrollHeight > box.clientHeight)) {
                box = box.parentElement
            }
            const scroller = (box ?? document.scrollingElement ?? document.documentElement) as HTMLElement
            const isPage = !box
            const view = isPage ? { top: 0, height: innerHeight } : { top: scroller.getBoundingClientRect().top, height: scroller.clientHeight }
            const start = scroller.scrollTop
            const max = scroller.scrollHeight - scroller.clientHeight
            const target = Math.min(Math.max(start + (r.top + r.height / 2) - (view.top + view.height / 2), 0), max)
            const distance = target - start
            if (Math.abs(distance) < 2) {
                return false
            }
            const duration = Math.min(1400, Math.max(500, 400 + Math.abs(distance) * 0.8))
            const began = performance.now()
            await new Promise<void>((done) => {
                const step = (now: number) => {
                    const t = Math.min(1, (now - began) / duration)
                    const eased = t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2
                    scroller.scrollTop = start + distance * eased
                    if (t < 1) requestAnimationFrame(step)
                    else done()
                }
                requestAnimationFrame(step)
            })
            return true
        })

    /**
     * Clicks where the cursor landed, not at the element's exact centre (Playwright's
     * default would snap the cursor there). If the element moved since the glide, the
     * point is kept inside it.
     */
    const clickWhereLanded = async (target: Locator): Promise<void> => {
        const el = target.first()
        const box = await el.boundingBox()
        if (!box) {
            throw new Error(`click: target has no bounding box: ${target}`)
        }
        const inside = (v: number, size: number): number => Math.min(Math.max(v, Math.min(2, size / 2)), size - Math.min(2, size / 2))
        const position = { x: inside(pos.x - box.x, box.width), y: inside(pos.y - box.y, box.height) }
        pos = { x: box.x + position.x, y: box.y + position.y }
        await el.click({ position })
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

    const switchTo: Demo['switchTo'] = async (next) => {
        if (next === page) {
            return
        }
        openers.push(page)
        page = next
        await next.waitForLoadState('domcontentloaded').catch(() => {})
        await next.bringToFront().catch(() => {})
        // The new page's mouse starts where the cursor is, so the video shows no jump.
        await next.mouse.move(pos.x, pos.y)
        hooks.onSwitch?.(next)
        next.once('close', () => {
            if (page === next) {
                page = openers.pop() ?? first
                hooks.onSwitch?.(page)
            }
        })
    }

    return {
        get page() {
            return page
        },
        markers,
        clicks,
        focus,
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
        startedAt,
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
            const at = stamp()
            await clickWhereLanded(target)
            clicks.push({ move, at, x: Math.round(pos.x), y: Math.round(pos.y), kind: 'click' })
            await page.waitForTimeout(opts.settleMs ?? 700)
        },
        type: async (target, text) => {
            const move = stamp()
            await moveTo(target)
            const at = stamp()
            await clickWhereLanded(target)
            const click: Click = { move, at, x: Math.round(pos.x), y: Math.round(pos.y), kind: 'type' }
            clicks.push(click)
            await typeNaturally(text)
            click.until = stamp()
            await page.waitForTimeout(300 + rng() * 200)
        },
        switchTo,
        mobile: hooks.mobile ?? false,
        square: hooks.square ?? false,
        popup: async (action) => {
            const [opened] = await Promise.all([page.context().waitForEvent('page'), action()])
            await switchTo(opened)
            return opened
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

type Box = { x: number; y: number; width: number; height: number }

const rounded = (b: Box): Box => ({ x: Math.round(b.x), y: Math.round(b.y), width: Math.round(b.width), height: Math.round(b.height) })

/**
 * The compact block around an element: the largest ancestor that is still about one row
 * (at most 3x the element's height, or 180 px) and narrower than the viewport — e.g. a form
 * field with its label and hint, a table row, a toolbar. Falls back to the element itself.
 */
async function areaAround(element: Locator, box: Box): Promise<Box> {
    return element
        .evaluate((node, own) => {
            const maxHeight = Math.max(own.height * 3, 180)
            const maxWidth = window.innerWidth * 0.9
            let best = own
            for (let el = node.parentElement; el && el !== document.body; el = el.parentElement) {
                const r = el.getBoundingClientRect()
                if (r.height > maxHeight || r.width > maxWidth) break
                if (r.width >= best.width && r.height >= best.height) best = { x: r.x, y: r.y, width: r.width, height: r.height }
            }
            return best
        }, box)
        .catch(() => box)
}
