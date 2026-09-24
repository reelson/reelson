/**
 * Checks a demo before rendering:
 *   1. reelson.config.json and video.json match their schemas (typos are errors);
 *   2. the timeline resolves (callouts point at real markers, trims make sense);
 *   3. every zoom rides along with the cursor (style guide #13) — see zooms.ts;
 *   4. `hyperframes check` on each built composition — landscape, portrait, square (lint,
 *      runtime, layout, contrast).
 *
 *   reelson check <slug|dir> [--no-hyperframes]
 */
import { existsSync, statSync } from 'node:fs'
import { resolve } from 'node:path'
import type { LoadedConfig } from '../../reelson-record/scripts/config.ts'
import { plan } from './build.ts'
import { hyperframesOn } from './hyperframes.ts'
import { round } from './timeline.ts'
import { checkZoom, zoomOverlaps } from './zooms.ts'

export interface CheckOptions {
    hyperframes?: boolean
    log?: (line: string) => void
}

/** Returns the number of problems found (0 = ready to render). */
export function check(demoDir: string, config: LoadedConfig, options: CheckOptions = {}): number {
    const log = options.log ?? console.log
    const result = plan(demoDir, config)
    let problems = 0

    if (result.created) {
        log('✗ no video.json yet — run `reelson build` first')
        return 1
    }
    for (const w of result.warnings) {
        log(`! ${w}`)
    }
    for (const edge of ['start', 'end'] as const) {
        if (typeof result.spec.trim?.[edge] === 'number') {
            log(
                `! trim.${edge} is a fixed time — after a re-record it cuts in the wrong place; ` +
                    (edge === 'start' ? 'use "auto" or ' : 'use ') +
                    '{ "marker": "…", "offset": … } / { "click": n, "offset": … } instead',
            )
        }
    }
    if ((result.spec.zooms ?? []).length && !result.clicks.length) {
        log('✗ zooms need logged clicks — re-record with the current reelson-record scripts')
        problems++
    }

    const overlaps = zoomOverlaps(result.zooms)
    result.zooms.forEach((z, i) => {
        const { problems: checked, framed } = checkZoom(z, result.clicks, result.timeline)
        const found = [...checked, ...overlaps.filter((o) => o.index === i).map((o) => o.message)]
        const label = `zoom ${i + 1} (${z.at}–${round(z.at + z.duration)}s, in ${z.in}s / out ${z.out}s, ${z.scale}x at ${z.x},${z.y})`
        if (found.length) {
            problems += found.length
            log(`✗ ${label}`)
            found.forEach((p) => log(`    ${p}`))
        } else {
            log(`✓ ${label}: ${framed.map((c) => `${c.kind} #${c.index} ${c.comp}s`).join(', ')}`)
        }
    })
    if (!result.zooms.length) {
        log('✓ no zooms')
    }

    const videoDir = resolve(demoDir, 'video')
    const index = resolve(videoDir, 'index.html')
    if (!existsSync(index)) {
        log('✗ video/ is not built — run `reelson build`')
        return problems + 1
    }
    if (statSync(resolve(demoDir, 'video.json')).mtimeMs > statSync(index).mtimeMs) {
        log('! video.json changed since the last build — run `reelson build` (render does it for you)')
    }
    if (options.hyperframes !== false) {
        for (const composition of ['index.html', 'portrait.html', 'square.html']) {
            if (!existsSync(resolve(videoDir, composition))) {
                continue
            }
            log(`\n${composition}:`)
            if (hyperframesOn(videoDir, composition, ['check', '.']) !== 0) {
                log(`✗ hyperframes check failed (${composition})`)
                problems++
            }
        }
    }

    log(problems ? `\n${problems} problem(s)` : '\nready to render')
    return problems
}

