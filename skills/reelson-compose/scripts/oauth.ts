/**
 * OAuth 2.0 for a command-line app (RFC 8252): the browser signs in, the provider sends it back to
 * a one-off server on 127.0.0.1, and the code is exchanged with PKCE. Nothing here is specific to
 * one provider — a publisher (publish-youtube.ts, …) passes its endpoints and scopes.
 */
import { createHash, randomBytes } from 'node:crypto'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { ReelsonError } from './project.ts'

export interface OAuthClient {
    /** Shown in messages, e.g. "Google". */
    name: string
    authUrl: string
    tokenUrl: string
    clientId: string
    clientSecret?: string
    scopes: string[]
    /** Extra authorization parameters (Google: access_type=offline, prompt=consent). */
    params?: Record<string, string>
}

export interface TokenSet {
    access_token: string
    refresh_token?: string
    /** Seconds from now. */
    expires_in?: number
    scope?: string
    token_type?: string
}

/** How long the browser has to come back. */
const LOGIN_TIMEOUT_MS = 5 * 60_000

/**
 * Signs in through the browser: `open` is handed the provider's page (and should also print it);
 * resolves with the tokens once the provider redirects back and the code is exchanged.
 */
export async function authorize(client: OAuthClient, open: (url: string) => void): Promise<TokenSet> {
    const state = base64url(randomBytes(16))
    const verifier = base64url(randomBytes(32))
    const challenge = base64url(createHash('sha256').update(verifier).digest())

    let settle: { resolve: (code: string) => void; reject: (error: Error) => void }
    const code = new Promise<string>((resolve, reject) => (settle = { resolve, reject }))
    const server = createServer((request, response) => {
        const url = new URL(request.url ?? '/', 'http://127.0.0.1')
        if (url.pathname !== '/') {
            response.writeHead(404).end()
            return
        }
        const error = url.searchParams.get('error')
        const ok = !error && url.searchParams.get('state') === state && url.searchParams.get('code')
        response.writeHead(ok ? 200 : 400, { 'Content-Type': 'text/html; charset=utf-8' })
        response.end(
            `<!doctype html><title>reelson</title><body style="font:16px system-ui;margin:3em">` +
                (ok ? 'Signed in — you can close this tab and go back to the terminal.' : `Sign-in failed: ${escapeHtml(error ?? 'unexpected answer')}.`),
        )
        if (ok) {
            settle.resolve(ok)
        } else {
            settle.reject(new ReelsonError(`${client.name} sign-in failed: ${error ?? 'the answer did not match this login'}`))
        }
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const redirectUri = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
    const timer = setTimeout(() => settle.reject(new ReelsonError(`${client.name} sign-in timed out — run the login again`)), LOGIN_TIMEOUT_MS)

    try {
        const url = new URL(client.authUrl)
        const params: Record<string, string> = {
            client_id: client.clientId,
            redirect_uri: redirectUri,
            response_type: 'code',
            scope: client.scopes.join(' '),
            state,
            code_challenge: challenge,
            code_challenge_method: 'S256',
            ...client.params,
        }
        for (const [key, value] of Object.entries(params)) {
            url.searchParams.set(key, value)
        }
        open(url.toString())
        return await tokenRequest(client, {
            grant_type: 'authorization_code',
            code: await code,
            redirect_uri: redirectUri,
            code_verifier: verifier,
        })
    } finally {
        clearTimeout(timer)
        server.close()
    }
}

/** A fresh access token from a refresh token. */
export function refresh(client: OAuthClient, refreshToken: string): Promise<TokenSet> {
    return tokenRequest(client, { grant_type: 'refresh_token', refresh_token: refreshToken })
}

/** A refresh token the provider no longer accepts (revoked, expired): the channel must log in again. */
export class LoginExpired extends ReelsonError {}

async function tokenRequest(client: OAuthClient, fields: Record<string, string>): Promise<TokenSet> {
    const body = new URLSearchParams({ client_id: client.clientId, ...(client.clientSecret ? { client_secret: client.clientSecret } : {}), ...fields })
    let response: Response
    try {
        response = await fetch(client.tokenUrl, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body })
    } catch (error) {
        throw new ReelsonError(`cannot reach ${new URL(client.tokenUrl).host} (${(error as Error).message})`)
    }
    const answer = (await response.json().catch(() => ({}))) as TokenSet & { error?: string; error_description?: string }
    if (!response.ok || !answer.access_token) {
        const why = answer.error_description ?? answer.error ?? `HTTP ${response.status}`
        if (answer.error === 'invalid_grant' && fields.grant_type === 'refresh_token') {
            throw new LoginExpired(`${client.name} no longer accepts this login (${why})`)
        }
        throw new ReelsonError(`${client.name} refused the sign-in: ${why}`)
    }
    return answer
}

function base64url(bytes: Buffer): string {
    return bytes.toString('base64url')
}

function escapeHtml(text: string): string {
    return text.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`)
}
