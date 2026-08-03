import type { OAuthTokens } from './types.js'

type GitHubCopilotTokens = OAuthTokens & {
  enterpriseDomain?: string
}

const decode = (value: string): string => Buffer.from(value, 'base64').toString('utf8')
const GITHUB_COPILOT_CLIENT_ID = decode('SXYxLmI1MDdhMDhjODdlY2ZlOTg=')
const INITIAL_POLL_INTERVAL_MULTIPLIER = 1.2
const SLOW_DOWN_POLL_INTERVAL_MULTIPLIER = 1.4

export const GITHUB_COPILOT_HEADERS = {
  'User-Agent': 'GitHubCopilotChat/0.35.0',
  'Editor-Version': 'vscode/1.107.0',
  'Editor-Plugin-Version': 'copilot-chat/0.35.0',
  'Copilot-Integration-Id': 'vscode-chat',
} as const

export const GITHUB_COPILOT_MODEL_IDS = [
  'claude-haiku-4.5',
  'claude-opus-4.5',
  'claude-opus-4.6',
  'claude-sonnet-4',
  'claude-sonnet-4.5',
  'claude-sonnet-4.6',
  'gemini-2.5-pro',
  'gemini-3-flash-preview',
  'gemini-3-pro-preview',
  'gemini-3.1-pro-preview',
  'gpt-4.1',
  'gpt-4o',
  'gpt-5',
  'gpt-5-mini',
  'gpt-5.1',
  'gpt-5.1-codex',
  'gpt-5.1-codex-max',
  'gpt-5.1-codex-mini',
  'gpt-5.2',
  'gpt-5.2-codex',
  'gpt-5.3-codex',
  'gpt-5.4',
  'gpt-5.4-mini',
  'grok-code-fast-1',
] as const

type DeviceCodeResponse = {
  device_code: string
  user_code: string
  verification_uri: string
  interval: number
  expires_in: number
}

type DeviceTokenSuccessResponse = {
  access_token: string
}

type DeviceTokenErrorResponse = {
  error: string
  error_description?: string
  interval?: number
}

export function normalizeGitHubEnterpriseDomain(input: string): string | undefined {
  const trimmed = input.trim()
  if (!trimmed) return undefined
  try {
    const url = trimmed.includes('://') ? new URL(trimmed) : new URL(`https://${trimmed}`)
    return url.hostname
  } catch {
    return undefined
  }
}

function getGitHubCopilotUrls(domain: string): {
  deviceCodeUrl: string
  accessTokenUrl: string
  copilotTokenUrl: string
} {
  return {
    deviceCodeUrl: `https://${domain}/login/device/code`,
    accessTokenUrl: `https://${domain}/login/oauth/access_token`,
    copilotTokenUrl: `https://api.${domain}/copilot_internal/v2/token`,
  }
}

function getBaseUrlFromToken(token: string): string | undefined {
  const match = token.match(/proxy-ep=([^;]+)/)
  if (!match) return undefined
  return `https://${match[1].replace(/^proxy\./, 'api.')}`
}

export function getGitHubCopilotBaseUrl(
  token?: string,
  enterpriseDomain?: string,
): string {
  const tokenBaseUrl = token ? getBaseUrlFromToken(token) : undefined
  if (tokenBaseUrl) return tokenBaseUrl
  if (enterpriseDomain) return `https://copilot-api.${enterpriseDomain}`
  return 'https://api.individual.githubcopilot.com'
}

async function fetchJson(url: string, init: RequestInit): Promise<unknown> {
  const response = await fetch(url, init)
  if (!response.ok) {
    const text = await response.text().catch(() => '')
    throw new Error(`${response.status} ${response.statusText}${text ? `: ${text}` : ''}`)
  }
  return response.json()
}

async function startDeviceFlow(domain: string): Promise<DeviceCodeResponse> {
  const urls = getGitHubCopilotUrls(domain)
  const data = await fetchJson(urls.deviceCodeUrl, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': GITHUB_COPILOT_HEADERS['User-Agent'],
    },
    body: new URLSearchParams({
      client_id: GITHUB_COPILOT_CLIENT_ID,
      scope: 'read:user',
    }),
  })

  if (!data || typeof data !== 'object') {
    throw new Error('Invalid GitHub Copilot device code response')
  }

  const record = data as Record<string, unknown>
  if (
    typeof record.device_code !== 'string' ||
    typeof record.user_code !== 'string' ||
    typeof record.verification_uri !== 'string' ||
    typeof record.interval !== 'number' ||
    typeof record.expires_in !== 'number'
  ) {
    throw new Error('Invalid GitHub Copilot device code response fields')
  }

  return {
    device_code: record.device_code,
    user_code: record.user_code,
    verification_uri: record.verification_uri,
    interval: record.interval,
    expires_in: record.expires_in,
  }
}

function abortableSleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

async function pollForGitHubAccessToken(
  domain: string,
  deviceCode: string,
  intervalSeconds: number,
  expiresIn: number,
): Promise<string> {
  const urls = getGitHubCopilotUrls(domain)
  const deadline = Date.now() + expiresIn * 1000
  let intervalMs = Math.max(1000, Math.floor(intervalSeconds * 1000))
  let intervalMultiplier = INITIAL_POLL_INTERVAL_MULTIPLIER
  let slowDownResponses = 0

  while (Date.now() < deadline) {
    const remainingMs = deadline - Date.now()
    const waitMs = Math.min(Math.ceil(intervalMs * intervalMultiplier), remainingMs)
    await abortableSleep(waitMs)

    const raw = await fetchJson(urls.accessTokenUrl, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': GITHUB_COPILOT_HEADERS['User-Agent'],
      },
      body: new URLSearchParams({
        client_id: GITHUB_COPILOT_CLIENT_ID,
        device_code: deviceCode,
        grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
      }),
    })

    if (raw && typeof raw === 'object' && typeof (raw as DeviceTokenSuccessResponse).access_token === 'string') {
      return (raw as DeviceTokenSuccessResponse).access_token
    }

    if (raw && typeof raw === 'object' && typeof (raw as DeviceTokenErrorResponse).error === 'string') {
      const { error, error_description: description, interval } = raw as DeviceTokenErrorResponse
      if (error === 'authorization_pending') {
        continue
      }
      if (error === 'slow_down') {
        slowDownResponses += 1
        intervalMs = typeof interval === 'number' && interval > 0
          ? interval * 1000
          : Math.max(1000, intervalMs + 5000)
        intervalMultiplier = SLOW_DOWN_POLL_INTERVAL_MULTIPLIER
        continue
      }
      throw new Error(`GitHub Copilot device flow failed: ${error}${description ? `: ${description}` : ''}`)
    }
  }

  if (slowDownResponses > 0) {
    throw new Error('GitHub Copilot device flow timed out after slow_down responses')
  }
  throw new Error('GitHub Copilot device flow timed out')
}

export async function refreshGitHubCopilotToken(
  refreshToken: string,
  enterpriseDomain?: string,
): Promise<GitHubCopilotTokens> {
  const domain = enterpriseDomain || 'github.com'
  const urls = getGitHubCopilotUrls(domain)
  const raw = await fetchJson(urls.copilotTokenUrl, {
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${refreshToken}`,
      ...GITHUB_COPILOT_HEADERS,
    },
  })

  if (!raw || typeof raw !== 'object') {
    throw new Error('Invalid GitHub Copilot token response')
  }

  const record = raw as Record<string, unknown>
  if (typeof record.token !== 'string' || typeof record.expires_at !== 'number') {
    throw new Error('Invalid GitHub Copilot token response fields')
  }

  return {
    accessToken: record.token,
    refreshToken,
    expiresAt: record.expires_at * 1000 - 5 * 60 * 1000,
    enterpriseDomain,
  }
}

async function enableGitHubCopilotModel(
  token: string,
  modelId: string,
  enterpriseDomain?: string,
): Promise<boolean> {
  const baseUrl = getGitHubCopilotBaseUrl(token, enterpriseDomain)
  const response = await fetch(`${baseUrl}/models/${modelId}/policy`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      ...GITHUB_COPILOT_HEADERS,
      'openai-intent': 'chat-policy',
      'x-interaction-type': 'chat-policy',
    },
    body: JSON.stringify({ state: 'enabled' }),
  }).catch(() => undefined)
  return response?.ok ?? false
}

export async function enableAllGitHubCopilotModels(
  token: string,
  enterpriseDomain?: string,
): Promise<string[]> {
  const results = await Promise.all(
    GITHUB_COPILOT_MODEL_IDS.map(async modelId => {
      const success = await enableGitHubCopilotModel(token, modelId, enterpriseDomain)
      return success ? modelId : null
    }),
  )
  const enabled = results.filter((modelId): modelId is string => modelId !== null)
  return enabled.length > 0 ? enabled : [...GITHUB_COPILOT_MODEL_IDS]
}

export class GitHubCopilotOAuthService {
  async startOAuthFlow(options: {
    enterpriseDomain?: string
    onAuth: (url: string, instructions?: string) => Promise<void>
  }): Promise<GitHubCopilotTokens> {
    const enterpriseDomain = options.enterpriseDomain
    const domain = enterpriseDomain || 'github.com'
    const device = await startDeviceFlow(domain)
    await options.onAuth(device.verification_uri, `Enter code: ${device.user_code}`)
    const githubAccessToken = await pollForGitHubAccessToken(
      domain,
      device.device_code,
      device.interval,
      device.expires_in,
    )
    return refreshGitHubCopilotToken(githubAccessToken, enterpriseDomain)
  }

  cleanup(): void {}
}
