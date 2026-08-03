import { openBrowser } from '../../utils/browser.js'
import { AuthCodeListener } from './auth-code-listener.js'
import * as crypto from './crypto.js'
import type { OAuthTokens } from './types.js'

type AntigravityTokens = OAuthTokens & {
  projectId?: string
  email?: string
}

const decode = (value: string): string => Buffer.from(value, 'base64').toString('utf8')
const ANTIGRAVITY_CLIENT_ID = decode(
  'MTA3MTAwNjA2MDU5MS10bWhzc2luMmgyMWxjcmUyMzV2dG9sb2poNGc0MDNlcC5hcHBzLmdvb2dsZXVzZXJjb250ZW50LmNvbQ==',
)
const ANTIGRAVITY_CLIENT_SECRET = decode(
  'R09DU1BYLUs1OEZXUjQ4NkxkTEoxbUxCOHNYQzR6NnFEQWY=',
)
const ANTIGRAVITY_REDIRECT_PATH = '/oauth-callback'
const ANTIGRAVITY_REDIRECT_PORT = 51121
const ANTIGRAVITY_REDIRECT_URL = `http://localhost:${ANTIGRAVITY_REDIRECT_PORT}${ANTIGRAVITY_REDIRECT_PATH}`
const ANTIGRAVITY_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth'
const ANTIGRAVITY_TOKEN_URL = 'https://oauth2.googleapis.com/token'
const ANTIGRAVITY_SCOPES = [
  'https://www.googleapis.com/auth/cloud-platform',
  'https://www.googleapis.com/auth/userinfo.email',
  'https://www.googleapis.com/auth/userinfo.profile',
  'https://www.googleapis.com/auth/cclog',
  'https://www.googleapis.com/auth/experimentsandconfigs',
] as const
const ANTIGRAVITY_PROJECT_FALLBACK = 'rising-fact-p41fc'
const ANTIGRAVITY_ENDPOINTS = [
  'https://cloudcode-pa.googleapis.com',
  'https://daily-cloudcode-pa.sandbox.googleapis.com',
] as const

async function getUserEmail(accessToken: string): Promise<string | undefined> {
  try {
    const response = await fetch('https://www.googleapis.com/oauth2/v1/userinfo?alt=json', {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    })
    if (!response.ok) return undefined
    const data = (await response.json()) as { email?: string }
    return data.email
  } catch {
    return undefined
  }
}

async function discoverProject(accessToken: string): Promise<string> {
  const headers = {
    Authorization: `Bearer ${accessToken}`,
    'Content-Type': 'application/json',
    'User-Agent': 'google-api-nodejs-client/9.15.1',
    'X-Goog-Api-Client': 'google-cloud-sdk vscode_cloudshelleditor/0.1',
    'Client-Metadata': JSON.stringify({
      ideType: 'IDE_UNSPECIFIED',
      platform: 'PLATFORM_UNSPECIFIED',
      pluginType: 'GEMINI',
    }),
  }

  for (const endpoint of ANTIGRAVITY_ENDPOINTS) {
    try {
      const response = await fetch(`${endpoint}/v1internal:loadCodeAssist`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          metadata: {
            ideType: 'IDE_UNSPECIFIED',
            platform: 'PLATFORM_UNSPECIFIED',
            pluginType: 'GEMINI',
          },
        }),
      })
      if (!response.ok) continue
      const data = (await response.json()) as {
        cloudaicompanionProject?: string | { id?: string }
      }
      if (typeof data.cloudaicompanionProject === 'string' && data.cloudaicompanionProject) {
        return data.cloudaicompanionProject
      }
      if (
        data.cloudaicompanionProject &&
        typeof data.cloudaicompanionProject === 'object' &&
        typeof data.cloudaicompanionProject.id === 'string'
      ) {
        return data.cloudaicompanionProject.id
      }
    } catch {
      // try next endpoint
    }
  }

  return ANTIGRAVITY_PROJECT_FALLBACK
}

export async function refreshAntigravityTokens(input: {
  refreshToken: string
  projectId: string
}): Promise<AntigravityTokens> {
  const response = await fetch(ANTIGRAVITY_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: ANTIGRAVITY_CLIENT_ID,
      client_secret: ANTIGRAVITY_CLIENT_SECRET,
      refresh_token: input.refreshToken,
      grant_type: 'refresh_token',
    }),
  })

  if (!response.ok) {
    const errorText = await response.text().catch(() => '')
    throw new Error(`Antigravity token refresh failed${errorText ? `: ${errorText}` : ''}`)
  }

  const data = (await response.json()) as {
    access_token: string
    expires_in: number
    refresh_token?: string
  }

  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token || input.refreshToken,
    expiresAt: Date.now() + data.expires_in * 1000 - 5 * 60 * 1000,
    projectId: input.projectId,
  }
}

export class AntigravityOAuthService {
  private codeVerifier: string
  private authCodeListener: AuthCodeListener | null = null
  private manualAuthCodeResolver: ((authorizationCode: string) => void) | null = null

  constructor() {
    this.codeVerifier = crypto.generateCodeVerifier()
  }

  async startOAuthFlow(
    authURLHandler: (url: string) => Promise<void>,
  ): Promise<AntigravityTokens> {
    this.authCodeListener = new AuthCodeListener(ANTIGRAVITY_REDIRECT_PATH)
    await this.authCodeListener.start(ANTIGRAVITY_REDIRECT_PORT)

    const codeChallenge = crypto.generateCodeChallenge(this.codeVerifier)
    const state = crypto.generateState()
    const authUrl = new URL(ANTIGRAVITY_AUTH_URL)
    authUrl.searchParams.append('client_id', ANTIGRAVITY_CLIENT_ID)
    authUrl.searchParams.append('response_type', 'code')
    authUrl.searchParams.append('redirect_uri', ANTIGRAVITY_REDIRECT_URL)
    authUrl.searchParams.append('scope', ANTIGRAVITY_SCOPES.join(' '))
    authUrl.searchParams.append('code_challenge', codeChallenge)
    authUrl.searchParams.append('code_challenge_method', 'S256')
    authUrl.searchParams.append('state', state)
    authUrl.searchParams.append('access_type', 'offline')
    authUrl.searchParams.append('prompt', 'consent')

    const authorizationCode = await this.waitForAuthorizationCode(state, async () => {
      await authURLHandler(authUrl.toString())
      await openBrowser(authUrl.toString())
    })

    const isAutomaticFlow = this.authCodeListener?.hasPendingResponse() ?? false

    try {
      const tokenResponse = await fetch(ANTIGRAVITY_TOKEN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: ANTIGRAVITY_CLIENT_ID,
          client_secret: ANTIGRAVITY_CLIENT_SECRET,
          code: authorizationCode,
          grant_type: 'authorization_code',
          redirect_uri: ANTIGRAVITY_REDIRECT_URL,
          code_verifier: this.codeVerifier,
        }),
      })

      if (!tokenResponse.ok) {
        const errorText = await tokenResponse.text().catch(() => '')
        throw new Error(`Antigravity token exchange failed${errorText ? `: ${errorText}` : ''}`)
      }

      const data = (await tokenResponse.json()) as {
        access_token: string
        refresh_token: string
        expires_in: number
      }

      const [email, projectId] = await Promise.all([
        getUserEmail(data.access_token),
        discoverProject(data.access_token),
      ])

      if (isAutomaticFlow) {
        this.authCodeListener?.handleSuccessRedirect([], res => {
          res.writeHead(200, {
            'Content-Type': 'text/html; charset=utf-8',
          })
          res.end('Google authentication completed. You can close this window.')
        })
      }

      return {
        accessToken: data.access_token,
        refreshToken: data.refresh_token,
        expiresAt: Date.now() + data.expires_in * 1000 - 5 * 60 * 1000,
        projectId,
        email,
      }
    } finally {
      this.authCodeListener?.close()
    }
  }

  private async waitForAuthorizationCode(
    state: string,
    onReady: () => Promise<void>,
  ): Promise<string> {
    return new Promise((resolve, reject) => {
      this.manualAuthCodeResolver = resolve
      this.authCodeListener
        ?.waitForAuthorization(state, onReady)
        .then(authorizationCode => {
          this.manualAuthCodeResolver = null
          resolve(authorizationCode)
        })
        .catch(error => {
          this.manualAuthCodeResolver = null
          reject(error)
        })
    })
  }

  handleManualAuthCodeInput(params: {
    authorizationCode: string
    state: string
  }): void {
    if (this.manualAuthCodeResolver) {
      this.manualAuthCodeResolver(params.authorizationCode)
      this.manualAuthCodeResolver = null
      this.authCodeListener?.close()
    }
  }

  cleanup(): void {
    this.authCodeListener?.close()
    this.manualAuthCodeResolver = null
  }
}
