/**
 * `reelkit verify`: does each demo still record, and does its video.json still fit?
 *
 * Apps change under their demos: a column moves, a URL changes, a step is added. verify
 * re-records every scenario headless into a scratch folder — the committed recording and
 * markers.json stay untouched — and checks the new take against video.json: the scenario
 * ran to the end, every marker a callout or trim uses still exists, every click a zoom or
 * trim refers to by number is still the same kind of click in the same place, and the plan
 * (timeline, zoom checks) still holds. `--update` puts a take that passes in place.
 *
 *   reelkit verify <slug...> | --all [--update]
 */
import { spawnSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join, resolve } from 'node:path'
import type { LoadedConfig } from '../../reelkit-record/scripts/config.ts'
import { planSpec } from './build.ts'
import { KIT_ROOT, readMarkers, readVideoSpec, ReelkitError } from './project.ts'
import type { Markers, TrimPoint, VideoSpec } from './timeline.ts'
import { checkZoom, zoomOverlaps } from './zooms.ts'

export interface Drift {
    /** video.json no longer fits the new take. */
    problems: string[]
    /** Worth knowing, nothing broken. */
    notes: string[]
}

const count = (n: number, noun: string): string => `${n} ${noun}${n === 1 ? '' : 's'}`

/** A click that moved more than this (CSS px) is probably a different target. */
const MOVED_PX = 80

/** What a re-record changed that video.json relies on. Pure. */
export function compareRecordings(before: Markers | null, after: Markers, spec: VideoSpec): Drift {
    const problems: string[] = []
    const notes: string[] = []
    const labels = new Set(after.markers.map((m) => m.label))
    const trimPoints = (['start', 'end'] as const)
        .map((edge) => [edge, spec.trim?.[edge]] as [string, TrimPoint | undefined])
        .filter(([, p]) => p !== undefined && typeof p === 'object') as [string, Exclude<TrimPoint, number | 'auto'>][]

    // Markers: the ones video.json uses must still be set.
    for (const c of spec.callouts ?? []) {
        if (c.marker !== undefined && !labels.has(c.marker)) {
            problems.push(`callout "${c.text}" is timed from marker "${c.marker}", which the scenario no longer sets`)
        }
    }
    for (const [edge, p] of trimPoints) {
        if ('marker' in p && !labels.has(p.marker)) {
            problems.push(`trim.${edge} is tied to marker "${p.marker}", which the scenario no longer sets`)
        }
    }
    if (before) {
        const old = new Set(before.markers.map((m) => m.label))
        const added = after.markers.filter((m) => !old.has(m.label)).map((m) => `"${m.label}"`)
        const removed = before.markers.filter((m) => !labels.has(m.label)).map((m) => `"${m.label}"`)
        if (added.length) notes.push(`new marker(s) ${added.join(', ')} — no callout uses them yet`)
        if (removed.length) notes.push(`marker(s) ${removed.join(', ')} are gone`)
    }

    // Clicks are referred to by number: the same number must still be the same click.
    const clicks = after.clicks ?? []
    const used = new Map<number, string>()
    ;(spec.zooms ?? []).forEach((z, i) => {
        if (!z.clicks) return
        const [a, b = a] = z.clicks
        for (let n = a; n <= b; n++) used.set(n, `zoom ${i + 1}`)
    })
    for (const [edge, p] of trimPoints) {
        if ('click' in p) used.set(p.click, `trim.${edge}`)
    }
    for (const [n, user] of [...used].sort((x, y) => x[0] - y[0])) {
        const now = clicks[n - 1]
        if (!now) {
            problems.push(`${user} uses click #${n}, but the new take has ${clicks.length} click(s)`)
            continue
        }
        const then = before?.clicks?.[n - 1]
        if (then) {
            const moved = Math.hypot(now.x - then.x, now.y - then.y)
            if (now.kind !== then.kind || moved > MOVED_PX) {
                problems.push(
                    `${user} uses click #${n}: it was a ${then.kind} at ${then.x},${then.y}, now a ${now.kind} at ${now.x},${now.y} — ` +
                        'a step was probably added or removed before it; renumber the clicks in video.json',
                )
            }
        }
    }
    if (before?.clicks && before.clicks.length !== clicks.length) {
        notes.push(`${before.clicks.length} → ${clicks.length} click(s)`)
    }
    if (before && (before.transitions?.length ?? 0) !== (after.transitions?.length ?? 0)) {
        notes.push(`${before.transitions?.length ?? 0} → ${after.transitions?.length ?? 0} hand-off card(s)`)
    }
    if (before && Math.abs(after.durationSeconds - before.durationSeconds) > Math.max(3, before.durationSeconds * 0.2)) {
        notes.push(`length ${before.durationSeconds.toFixed(1)}s → ${after.durationSeconds.toFixed(1)}s`)
    }

    return { problems, notes }
}

export interface VerifyOptions {
    /** Put a take that passes in place of the committed recording + markers.json. */
    update?: boolean
    log?: (line: string) => void
}

/** Re-records one demo and checks it; returns the number of problems. */
export function verify(demoDir: string, config: LoadedConfig, options: VerifyOptions = {}): number {
    const log = options.log ?? console.log
    const slug = basename(demoDir)
    const scenario = resolve(demoDir, 'scenario.ts')
    if (!existsSync(scenario)) {
        throw new ReelkitError(`${demoDir} has no scenario.ts`)
    }
    const take = mkdtempSync(join(tmpdir(), `reelkit-verify-${slug}-`))
    log(`${slug}: recording…`)
    const run = spawnSync(process.execPath, [resolve(KIT_ROOT, 'skills/reelkit-record/scripts/record.ts'), scenario, '--out', take], {
        encoding: 'utf8',
    })
    if (run.status !== 0) {
        const output = `${run.stdout}${run.stderr}`.trim().split('\n').filter((l) => !/^\s+at /.test(l))
        log(`✗ ${slug}: the scenario failed`)
        output.slice(-8).forEach((line) => log(`    ${line}`))
        const failed = resolve(take, 'recording.failed.mp4')
        if (existsSync(failed)) log(`    partial take: ${failed}`)
        return 1
    }

    const after = JSON.parse(readFileSync(resolve(take, 'markers.json'), 'utf8')) as Markers
    const before = existsSync(resolve(demoDir, 'markers.json')) ? readMarkers(demoDir) : null
    const spec = readVideoSpec(demoDir)
    const problems: string[] = []
    const notes: string[] = []
    if (!spec) {
        notes.push('no video.json yet — nothing to check against (run `reelkit build`)')
    } else {
        const drift = compareRecordings(before, after, spec)
        problems.push(...drift.problems)
        notes.push(...drift.notes)
        try {
            const plan = planSpec(demoDir, spec, after, config)
            notes.push(...plan.warnings)
            const overlaps = zoomOverlaps(plan.zooms)
            plan.zooms.forEach((z, i) => {
                for (const p of [...checkZoom(z, plan.clicks, plan.timeline).problems, ...overlaps.filter((o) => o.index === i).map((o) => o.message)]) {
                    problems.push(`zoom ${i + 1}: ${p}`)
                }
            })
        } catch (error) {
            problems.push((error as Error).message)
        }
    }

    for (const p of problems) log(`✗ ${slug}: ${p}`)
    for (const n of notes) log(`! ${slug}: ${n}`)
    if (!problems.length) {
        log(`✓ ${slug}: records fine and video.json still fits (${after.durationSeconds.toFixed(1)}s, ${count(after.markers.length, 'marker')}, ${count(after.clicks?.length ?? 0, 'click')})`)
        if (options.update) {
            copyFileSync(resolve(take, 'recording.mp4'), resolve(demoDir, 'recording.mp4'))
            copyFileSync(resolve(take, 'markers.json'), resolve(demoDir, 'markers.json'))
            log(`  updated ${slug}/recording.mp4 and markers.json — rebuild to use them`)
        }
        rmSync(take, { recursive: true, force: true })
    } else {
        log(`  new take kept for a look: ${take}`)
    }

    return problems.length
}
