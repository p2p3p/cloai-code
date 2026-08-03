export const OPENAI_OFFICIAL_BASE_URL = 'https://api.openai.com'
export const GEMINI_AI_STUDIO_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta'

export const GEMINI_CLI_OFFICIAL_MODELS = [
  'gemini-2.0-flash',
  'gemini-2.5-flash',
  'gemini-2.5-pro',
  'gemini-3-flash-preview',
  'gemini-3-pro-preview',
  'gemini-3.1-pro-preview',
] as const

export const ANTIGRAVITY_OFFICIAL_MODELS = [
  'claude-opus-4-5-thinking',
  'claude-opus-4-6-thinking',
  'claude-sonnet-4-5',
  'claude-sonnet-4-5-thinking',
  'claude-sonnet-4-6',
  'gemini-3-flash',
  'gemini-3.1-pro-high',
  'gemini-3.1-pro-low',
  'gpt-oss-120b-medium',
] as const

export async function fetchGoogleAiStudioModels(apiKey: string): Promise<string[]> {
  const trimmedKey = apiKey.trim()
  if (!trimmedKey) {
    throw new Error('Google AI Studio API key is required')
  }

  const response = await fetch(
    `${GEMINI_AI_STUDIO_BASE_URL}/models?key=${encodeURIComponent(trimmedKey)}`,
    {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
    },
  )

  if (!response.ok) {
    const errorText = await response.text().catch(() => '')
    throw new Error(
      `Failed to fetch Gemini models: ${response.status}${errorText ? `: ${errorText}` : ''}`,
    )
  }

  const data = (await response.json()) as {
    models?: Array<{
      name?: string
      supportedGenerationMethods?: string[]
    }>
  }

  return [...new Set(
    (data.models ?? [])
      .filter(model =>
        Array.isArray(model.supportedGenerationMethods) &&
        model.supportedGenerationMethods.includes('generateContent') &&
        typeof model.name === 'string' &&
        model.name.startsWith('models/'),
      )
      .map(model => model.name!.slice('models/'.length))
      .filter(Boolean),
  )]
}

export async function fetchOpenAIOfficialModels(apiKey: string): Promise<string[]> {
  const trimmedKey = apiKey.trim()
  if (!trimmedKey) {
    throw new Error('OpenAI API key is required')
  }

  const response = await fetch(`${OPENAI_OFFICIAL_BASE_URL}/v1/models`, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${trimmedKey}`,
      'Content-Type': 'application/json',
    },
  })

  if (!response.ok) {
    const errorText = await response.text().catch(() => '')
    throw new Error(
      `Failed to fetch OpenAI models: ${response.status}${errorText ? `: ${errorText}` : ''}`,
    )
  }

  const data = (await response.json()) as {
    data?: Array<{
      id?: string
    }>
  }

  return [...new Set(
    (data.data ?? [])
      .map(model => model.id?.trim())
      .filter((model): model is string => Boolean(model)),
  )].sort((a, b) => a.localeCompare(b))
}
