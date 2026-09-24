/**
 * Example demo: Orbit, a pretend project board (examples/orbit/, one static page, no server) —
 * add a task, assign it, drag it to Done. CI records it on every push and cuts the README clip from it.
 *
 *   npm run example:record      # desktop, phone and square takes
 *   npm run example:build && npm run example:render
 *
 * Desktop and square drag the card; the phone take taps it and picks Done.
 */
import type { Scenario } from '../../skills/reelson-record/scripts/scenario.ts'

export default {
    name: 'orbit-ship-it',
    // the app is a single file next to this folder, so the example needs no server
    baseURL: new URL('../orbit/', import.meta.url).href,
    async run(demo) {
        const page = demo.page
        await demo.goto('index.html')
        await demo.pause(400)

        await demo.click(page.locator(demo.mobile ? '#new-task-m' : '#new-task'))
        await demo.type(page.locator('#nt-title'), 'Ship the launch video')
        demo.marker('Add a task')

        await demo.click(page.locator('.who[data-av="MA"]'), { settleMs: 300 })
        await demo.click(page.locator('#nt-create'), { settleMs: 900 })
        demo.marker('Assign it to yourself')

        const card = page.locator('.card', { hasText: 'Ship the launch video' })
        if (demo.mobile) {
            await demo.click(card)
            await demo.click(page.locator('.mv[data-to="3"]'), { settleMs: 1600 })
        } else {
            // moveTo's mousemove events drive the app's drag (and the cursor layer)
            await demo.moveTo(card)
            await page.mouse.down()
            await demo.pause(180)
            await demo.moveTo(page.locator('.board .col').nth(3).locator('.colh'))
            await demo.pause(150)
            await page.mouse.up()
            await demo.pause(1600)
        }
        demo.marker('Drag it to Done')
        // Leave the last callout time to be read before the recording ends.
        await demo.pause(2200)
    },
} satisfies Scenario
