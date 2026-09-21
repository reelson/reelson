/**
 * Example demo: adding and completing items in the public TodoMVC app.
 * Runs anywhere with internet access, so it doubles as the kit's smoke test.
 *
 *   node skills/reelkit-record/scripts/record.ts examples/todo-add-item/scenario.ts
 *   node skills/reelkit-compose/scripts/scaffold.ts examples/todo-add-item \
 *       --title "Plan your day" --subtitle "Add tasks and tick them off"
 *
 * Every `demo.marker()` becomes a timed callout placeholder in the composition.
 */
import type { Scenario } from '../../skills/reelkit-record/scripts/scenario.ts'

export default {
    name: 'todo-add-item',
    baseURL: 'https://demo.playwright.dev',
    async run(demo) {
        await demo.goto('/todomvc/#/')
        const input = demo.page.getByPlaceholder('What needs to be done?')

        await demo.type(input, 'Book the team offsite')
        await demo.page.keyboard.press('Enter')
        await demo.pause(600)
        demo.marker('Type a task and press Enter')

        await demo.type(input, 'Send the weekly report')
        await demo.page.keyboard.press('Enter')
        await demo.pause(900)
        demo.marker('Add as many as you need')

        await demo.click(
            demo.page
                .getByTestId('todo-item')
                .filter({ hasText: 'Send the weekly report' })
                .getByRole('checkbox'),
        )
        await demo.pause(900)
        demo.marker('Tick a task when it is done')

        await demo.click(demo.page.getByRole('link', { name: 'Active' }))
        await demo.pause(1200)
        demo.marker('Filter what is left')
        // Leave the last callout time to be read before the recording ends.
        await demo.pause(2000)
    },
} satisfies Scenario
