/**
 * On-card text per UI language: the recap title and the plural forms of the cover chip
 * ("4 steps · 27 seconds"), keyed by Intl.PluralRules category. reelson.config.json `language`
 * picks one; `strings` in reelson.config.json still overrides any of it. Forms are the ones
 * used right after a number (Hungarian and Turkish keep the singular, Finnish the partitive).
 */
import type { DemoConfig } from './config.ts'

type Strings = DemoConfig['strings']

const table = (recapTitle: string, steps: Record<string, string>, seconds: Record<string, string>): Strings => ({
    recapTitle,
    stepsLabel: steps as Strings['stepsLabel'],
    secondsLabel: seconds as Strings['secondsLabel'],
})

export const LANGUAGE_STRINGS: Record<string, Strings> = {
    en: table('In short', { one: 'step', other: 'steps' }, { one: 'second', other: 'seconds' }),
    ro: table('Pe scurt', { one: 'pas', few: 'pași', other: 'de pași' }, { one: 'secundă', few: 'secunde', other: 'de secunde' }),
    de: table('Kurz gesagt', { one: 'Schritt', other: 'Schritte' }, { one: 'Sekunde', other: 'Sekunden' }),
    fr: table('En bref', { one: 'étape', other: 'étapes' }, { one: 'seconde', other: 'secondes' }),
    es: table('En resumen', { one: 'paso', other: 'pasos' }, { one: 'segundo', other: 'segundos' }),
    it: table('In breve', { one: 'passaggio', other: 'passaggi' }, { one: 'secondo', other: 'secondi' }),
    pt: table('Em resumo', { one: 'passo', other: 'passos' }, { one: 'segundo', other: 'segundos' }),
    nl: table('Kort gezegd', { one: 'stap', other: 'stappen' }, { one: 'seconde', other: 'seconden' }),
    pl: table('W skrócie', { one: 'krok', few: 'kroki', many: 'kroków', other: 'kroku' }, { one: 'sekunda', few: 'sekundy', many: 'sekund', other: 'sekundy' }),
    ru: table('Коротко', { one: 'шаг', few: 'шага', many: 'шагов', other: 'шага' }, { one: 'секунда', few: 'секунды', many: 'секунд', other: 'секунды' }),
    uk: table('Коротко', { one: 'крок', few: 'кроки', many: 'кроків', other: 'кроку' }, { one: 'секунда', few: 'секунди', many: 'секунд', other: 'секунди' }),
    cs: table('Ve zkratce', { one: 'krok', few: 'kroky', many: 'kroku', other: 'kroků' }, { one: 'sekunda', few: 'sekundy', many: 'sekundy', other: 'sekund' }),
    sv: table('I korthet', { one: 'steg', other: 'steg' }, { one: 'sekund', other: 'sekunder' }),
    da: table('Kort fortalt', { one: 'trin', other: 'trin' }, { one: 'sekund', other: 'sekunder' }),
    nb: table('Kort oppsummert', { one: 'steg', other: 'steg' }, { one: 'sekund', other: 'sekunder' }),
    fi: table('Lyhyesti', { one: 'vaihe', other: 'vaihetta' }, { one: 'sekunti', other: 'sekuntia' }),
    hu: table('Röviden', { one: 'lépés', other: 'lépés' }, { one: 'másodperc', other: 'másodperc' }),
    tr: table('Kısaca', { one: 'adım', other: 'adım' }, { one: 'saniye', other: 'saniye' }),
}

/** The built-in strings for `language` ("pt-BR" falls back to "pt"), or English. */
export function stringsFor(language: string): Strings {
    return LANGUAGE_STRINGS[language] ?? LANGUAGE_STRINGS[language.split('-')[0]] ?? LANGUAGE_STRINGS.en
}
