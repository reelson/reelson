import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { plainTitle, textTitle, titleParts } from '../skills/reelson-compose/scripts/title.ts'

describe('title', () => {
    it('reads a title without a rotating phrase as it is', () => {
        assert.equal(plainTitle('Plan your day'), 'Plan your day')
        assert.deepEqual(titleParts('Plan your day'), ['Plan your day'])
        assert.deepEqual(titleParts(''), [])
    })

    it('reads each rotating phrase as its first option', () => {
        const title = 'Automate {anything|workflows|approvals} in Filament'
        assert.deepEqual(titleParts(title), ['Automate ', ['anything', 'workflows', 'approvals'], ' in Filament'])
        assert.equal(plainTitle(title), 'Automate anything in Filament')
        assert.equal(plainTitle('{Build|Ship} {forms|flows} fast'), 'Build forms fast')
        assert.deepEqual(titleParts('{Build|Ship} {forms|flows}'), [['Build', 'Ship'], ' ', ['forms', 'flows']])
    })

    it('trims the options', () => {
        assert.deepEqual(titleParts('Automate { anything | workflows }!'), ['Automate ', ['anything', 'workflows'], '!'])
        assert.equal(plainTitle('Automate { anything | workflows }!'), 'Automate anything!')
    })

    it('leaves a brace or bar that is not a phrase alone', () => {
        for (const title of ['Use { to open', 'Tabs | Spaces', 'A {draft} title', 'Empty {|x} option', 'Close } then {', '{a|{b|c}']) {
            assert.equal(plainTitle(title), title.replace('{b|c}', 'b'), title)
        }
        assert.deepEqual(titleParts('Tabs | Spaces'), ['Tabs | Spaces'])
    })

    it('prefers captionTitle', () => {
        assert.equal(textTitle({ title: 'Automate {anything|workflows}' }), 'Automate anything')
        assert.equal(textTitle({ title: 'Automate {anything|workflows}', captionTitle: 'Automate your work' }), 'Automate your work')
    })
})
