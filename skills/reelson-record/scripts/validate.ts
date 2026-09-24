/**
 * A small JSON Schema walker for reelson.config.json and video.json — enough of
 * the spec for our two schemas (type, properties, additionalProperties,
 * required, enum, items, minimum/maximum, minItems/maxItems, anyOf), with
 * "did you mean" hints for mistyped keys. Keys starting with `$` ($schema,
 * $comment) are always allowed.
 */
import { readFileSync } from 'node:fs'

export interface Schema {
    type?: string | string[]
    properties?: Record<string, Schema>
    additionalProperties?: boolean | Schema
    required?: string[]
    enum?: unknown[]
    items?: Schema
    minimum?: number
    maximum?: number
    exclusiveMinimum?: number
    minItems?: number
    maxItems?: number
    anyOf?: Schema[]
    $ref?: string
    definitions?: Record<string, Schema>
    description?: string
    [key: string]: unknown
}

export function loadSchema(path: string): Schema {
    return JSON.parse(readFileSync(path, 'utf8')) as Schema
}

/** Returns human-readable problems; empty when the value matches. */
export function validate(
    value: unknown,
    schema: Schema,
    at = '',
    root: Schema = schema,
): string[] {
    const where = at || '(root)'

    if (schema.$ref) {
        const name = schema.$ref.replace('#/definitions/', '')
        const target = root.definitions?.[name]
        if (!target) {
            throw new Error(`schema: unresolved $ref ${schema.$ref}`)
        }
        return validate(value, target, at, root)
    }

    if (schema.anyOf) {
        const branches = schema.anyOf.map((s) => validate(value, s, at, root))
        if (branches.some((b) => b.length === 0)) {
            return []
        }
        // Report the branch that got furthest (fewest problems) — usually the intended one.
        return branches.sort((a, b) => a.length - b.length)[0]
    }

    if (schema.type !== undefined) {
        const types = Array.isArray(schema.type) ? schema.type : [schema.type]
        if (!types.some((t) => matchesType(value, t))) {
            return [`${where}: expected ${types.join(' or ')}, got ${describe(value)}`]
        }
    }
    if (schema.enum && !schema.enum.some((e) => e === value)) {
        return [`${where}: must be one of ${schema.enum.map((e) => JSON.stringify(e)).join(', ')}`]
    }

    const problems: string[] = []
    if (typeof value === 'number') {
        if (schema.minimum !== undefined && value < schema.minimum) {
            problems.push(`${where}: must be ≥ ${schema.minimum}`)
        }
        if (schema.exclusiveMinimum !== undefined && value <= schema.exclusiveMinimum) {
            problems.push(`${where}: must be > ${schema.exclusiveMinimum}`)
        }
        if (schema.maximum !== undefined && value > schema.maximum) {
            problems.push(`${where}: must be ≤ ${schema.maximum}`)
        }
    }

    if (Array.isArray(value)) {
        if (schema.minItems !== undefined && value.length < schema.minItems) {
            problems.push(`${where}: needs at least ${schema.minItems} item(s)`)
        }
        if (schema.maxItems !== undefined && value.length > schema.maxItems) {
            problems.push(`${where}: takes at most ${schema.maxItems} item(s)`)
        }
        if (schema.items) {
            value.forEach((item, i) => problems.push(...validate(item, schema.items as Schema, `${at}[${i}]`, root)))
        }
    }

    if (isObject(value)) {
        for (const key of schema.required ?? []) {
            if (!(key in value)) {
                problems.push(`${where}: missing required "${key}"`)
            }
        }
        const known = Object.keys(schema.properties ?? {})
        for (const [key, child] of Object.entries(value)) {
            if (key.startsWith('$')) {
                continue
            }
            const path = at ? `${at}.${key}` : key
            const propSchema = schema.properties?.[key]
            if (propSchema) {
                problems.push(...validate(child, propSchema, path, root))
            } else if (schema.additionalProperties === false) {
                const hint = closest(key, known)
                problems.push(`${path}: unknown key${hint ? ` — did you mean "${hint}"?` : ''}`)
            } else if (isObject(schema.additionalProperties)) {
                problems.push(...validate(child, schema.additionalProperties, path, root))
            }
        }
    }

    return problems
}

function matchesType(value: unknown, type: string): boolean {
    switch (type) {
        case 'null':
            return value === null
        case 'array':
            return Array.isArray(value)
        case 'object':
            return isObject(value)
        case 'integer':
            return Number.isInteger(value)
        case 'number':
            return typeof value === 'number' && Number.isFinite(value)
        default:
            return typeof value === type
    }
}

function isObject(v: unknown): v is Record<string, unknown> {
    return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function describe(v: unknown): string {
    if (v === null) {
        return 'null'
    }
    if (Array.isArray(v)) {
        return 'array'
    }
    return typeof v === 'string' ? `string ${JSON.stringify(v)}` : typeof v
}

/** The known key within edit distance 3 of `key`, if any. */
export function closest(key: string, known: string[]): string | null {
    let best: string | null = null
    let bestDistance = 4
    for (const candidate of known) {
        const d = distance(key.toLowerCase(), candidate.toLowerCase())
        if (d < bestDistance) {
            best = candidate
            bestDistance = d
        }
    }
    return best
}

function distance(a: string, b: string): number {
    const row = Array.from({ length: b.length + 1 }, (_, i) => i)
    for (let i = 1; i <= a.length; i++) {
        let previous = row[0]
        row[0] = i
        for (let j = 1; j <= b.length; j++) {
            const current = row[j]
            row[j] = Math.min(row[j] + 1, row[j - 1] + 1, previous + (a[i - 1] === b[j - 1] ? 0 : 1))
            previous = current
        }
    }
    return row[b.length]
}
