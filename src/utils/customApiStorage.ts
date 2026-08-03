import { getSecureStorage } from './secureStorage/index.js'

export type CompatibleProviderKind =
  | 'anthropic-like'
  | 'openai-like'
  | 'gemini-like'
export type OpenAIAuthMode = 'chat-completions' | 'responses' | 'oauth'
export type AnthropicAuthMode = 'api-key'
export type GeminiAuthMode = 'vertex-compatible' | 'gemini-cli-oauth'
export type ProviderAuthMode = AnthropicAuthMode | OpenAIAuthMode | GeminiAuthMode

export type ProviderVariant =
  | 'claude-official'
  | 'openai-official-responses'
  | 'openai-oauth'
  | 'gemini-cli-oauth'
  | 'gemini-antigravity-oauth'
  | 'gemini-ai-studio'
  | 'github-copilot-oauth'
  | 'custom-anthropic-like'
  | 'custom-openai-chat'
  | 'custom-openai-responses'
  | 'custom-google-vertex-like'

export type GeminiOAuthConfig = {
  accessToken?: string
  refreshToken?: string
  expiresAt?: number
  projectId?: string
  email?: string
}

export type OpenAIOAuthConfig = {
  accessToken?: string
  refreshToken?: string
  expiresAt?: number
  accountId?: string
  enterpriseDomain?: string
}

export type ActiveCustomApiEndpoint = {
  kind?: CompatibleProviderKind
  variant?: ProviderVariant
  providerId?: string
  authMode?: ProviderAuthMode
  baseURL?: string
  apiKey?: string
  model?: string
  savedModels?: string[]
}

export type ProviderReasoningConfig = {
  reasoningEffort?: string
  reasoningSummary?: string | null
  textVerbosity?: string | null
}

export type ProviderConfig = {
  id: string
  kind: CompatibleProviderKind
  variant?: ProviderVariant
  authMode: ProviderAuthMode
  baseURL?: string
  apiKey?: string
  models: string[]
  reasoning?: ProviderReasoningConfig
  oauth?: GeminiOAuthConfig | OpenAIOAuthConfig
}

export type CustomApiStorageData = {
  activeProviderKey?: string
  activeProvider?: string
  activeModel?: string
  activeAuthMode?: ProviderAuthMode
  providers?: ProviderConfig[]
  provider?: 'anthropic' | 'openai' | 'gemini'
  providerKind?: CompatibleProviderKind
  variant?: ProviderVariant
  providerId?: string
  authMode?: ProviderAuthMode
  baseURL?: string
  apiKey?: string
  model?: string
  savedModels?: string[]
}

const CUSTOM_API_STORAGE_KEY = 'customApiEndpoint'

export function getProviderKeyFromConfig(
  provider:
    | ProviderConfig
    | Pick<ProviderConfig, 'id' | 'kind' | 'authMode' | 'baseURL' | 'variant'>,
): string {
  return `${provider.kind}::${provider.variant ?? ''}::${provider.id}::${provider.authMode}::${provider.baseURL ?? ''}`
}

export function normalizeCompatibleBaseURL(
  baseURL: string | undefined,
): string | undefined {
  if (!baseURL) return undefined
  const trimmed = baseURL.trim()
  if (!trimmed) return undefined

  // Repair common manual-entry forms like "http:host:port" so URL parsing and
  // provider routing do not silently degrade to the wrong compat path.
  if (/^https?:[^/]/i.test(trimmed)) {
    return trimmed.replace(/^([a-z]+):/i, '$1://')
  }

  return trimmed
}

function dedupeModels(models: unknown): string[] {
  if (!Array.isArray(models)) return []
  return [...new Set(models.filter((item): item is string => typeof item === 'string').map(item => item.trim()).filter(Boolean))]
}

export function deriveProviderId(
  baseURL: string | undefined,
  kind: CompatibleProviderKind,
): string {
  if (!baseURL) {
    return kind === 'openai-like'
      ? 'openai'
      : kind === 'gemini-like'
        ? 'gemini'
        : 'anthropic'
  }

  try {
    const url = new URL(baseURL)
    let host = url.hostname
      .replace(/^api[.-]/, '')
      .replace(/^openai[.-]/, '')
      .replace(/^claude[.-]/, '')
      .replace(/^generativelanguage[.-]/, '')
      .replace(/^googleapis[.-]/, '')
      .replace(/^www\./, '')

    const parts = host.split('.').filter(Boolean)
    const providerId = parts[0]?.toLowerCase()

    return providerId || (kind === 'openai-like' ? 'openai' : kind === 'gemini-like' ? 'gemini' : 'anthropic')
  } catch {
    return (baseURL
      .replace(/^https?:\/\//, '')
      .replace(/[:/].*$/, '')
      .replace(/^api[.-]/, '')
      .replace(/^openai[.-]/, '')
      .replace(/^claude[.-]/, '')
      .replace(/^generativelanguage[.-]/, '')
      .replace(/^googleapis[.-]/, '')
      .replace(/^www\./, '')
      .split('.')[0] ||
      (kind === 'openai-like' ? 'openai' : kind === 'gemini-like' ? 'gemini' : 'anthropic'))
      .toLowerCase()
  }
}

function normalizeProviderKind(value: unknown): CompatibleProviderKind | null {
  return value === 'anthropic-like' || value === 'openai-like' || value === 'gemini-like' ? value : null
}

function normalizeLegacyProviderKind(value: unknown): CompatibleProviderKind {
  return value === 'openai' ? 'openai-like' : value === 'gemini' ? 'gemini-like' : 'anthropic-like'
}

function normalizeProviderVariant(value: unknown): ProviderVariant | undefined {
  switch (value) {
    case 'claude-official':
    case 'openai-official-responses':
    case 'openai-oauth':
    case 'gemini-cli-oauth':
    case 'gemini-antigravity-oauth':
    case 'gemini-ai-studio':
    case 'github-copilot-oauth':
    case 'custom-anthropic-like':
    case 'custom-openai-chat':
    case 'custom-openai-responses':
    case 'custom-google-vertex-like':
      return value
    default:
      return undefined
  }
}

export function inferProviderVariant(input: {
  kind: CompatibleProviderKind
  authMode: ProviderAuthMode
  baseURL?: string
  id?: string
  provider?: 'anthropic' | 'openai' | 'gemini'
}): ProviderVariant {
  const baseURL = input.baseURL?.toLowerCase()
  const id = input.id?.toLowerCase()

  if (input.kind === 'anthropic-like') {
    if (!baseURL && (!id || id === 'anthropic')) {
      return 'claude-official'
    }
    return 'custom-anthropic-like'
  }

  if (input.kind === 'openai-like') {
    if (input.authMode === 'oauth') {
      return id === 'github-copilot' ? 'github-copilot-oauth' : 'openai-oauth'
    }
    if (
      baseURL?.includes('api.openai.com') ||
      (!baseURL && id === 'openai' && input.authMode === 'responses')
    ) {
      return 'openai-official-responses'
    }
    return input.authMode === 'responses'
      ? 'custom-openai-responses'
      : 'custom-openai-chat'
  }

  if (
    baseURL?.includes('generativelanguage.googleapis.com') ||
    id === 'gemini-ai-studio'
  ) {
    return 'gemini-ai-studio'
  }
  if (id === 'antigravity') {
    return 'gemini-antigravity-oauth'
  }
  if (input.authMode === 'gemini-cli-oauth') {
    return 'gemini-cli-oauth'
  }
  return 'custom-google-vertex-like'
}

function normalizeProviderReasoning(value: unknown): ProviderReasoningConfig | undefined {
  if (!value || typeof value !== 'object') return undefined
  const record = value as Record<string, unknown>
  const reasoningEffort = typeof record.reasoningEffort === 'string' ? record.reasoningEffort : undefined
  const reasoningSummary =
    typeof record.reasoningSummary === 'string' || record.reasoningSummary === null
      ? (record.reasoningSummary as string | null)
      : undefined
  const textVerbosity =
    typeof record.textVerbosity === 'string' || record.textVerbosity === null
      ? (record.textVerbosity as string | null)
      : undefined
  if (
    reasoningEffort === undefined &&
    reasoningSummary === undefined &&
    textVerbosity === undefined
  ) {
    return undefined
  }
  return {
    ...(reasoningEffort !== undefined ? { reasoningEffort } : {}),
    ...(reasoningSummary !== undefined ? { reasoningSummary } : {}),
    ...(textVerbosity !== undefined ? { textVerbosity } : {}),
  }
}

function normalizeGeminiOAuth(value: unknown): GeminiOAuthConfig | undefined {
  if (!value || typeof value !== 'object') return undefined
  const record = value as Record<string, unknown>
  const accessToken =
    typeof record.accessToken === 'string' ? record.accessToken : undefined
  const refreshToken =
    typeof record.refreshToken === 'string' ? record.refreshToken : undefined
  const expiresAt =
    typeof record.expiresAt === 'number' ? record.expiresAt : undefined
  const projectId =
    typeof record.projectId === 'string' ? record.projectId : undefined
  const email = typeof record.email === 'string' ? record.email : undefined
  if (
    accessToken === undefined &&
    refreshToken === undefined &&
    expiresAt === undefined &&
    projectId === undefined &&
    email === undefined
  ) {
    return undefined
  }
  return {
    ...(accessToken !== undefined ? { accessToken } : {}),
    ...(refreshToken !== undefined ? { refreshToken } : {}),
    ...(expiresAt !== undefined ? { expiresAt } : {}),
    ...(projectId !== undefined ? { projectId } : {}),
    ...(email !== undefined ? { email } : {}),
  }
}

function normalizeOpenAIOAuth(value: unknown): OpenAIOAuthConfig | undefined {
  if (!value || typeof value !== 'object') return undefined
  const record = value as Record<string, unknown>
  const accessToken =
    typeof record.accessToken === 'string' ? record.accessToken : undefined
  const refreshToken =
    typeof record.refreshToken === 'string' ? record.refreshToken : undefined
  const expiresAt =
    typeof record.expiresAt === 'number' ? record.expiresAt : undefined
  const accountId =
    typeof record.accountId === 'string' ? record.accountId : undefined
  const enterpriseDomain =
    typeof record.enterpriseDomain === 'string' ? record.enterpriseDomain : undefined
  if (
    accessToken === undefined &&
    refreshToken === undefined &&
    expiresAt === undefined &&
    accountId === undefined &&
    enterpriseDomain === undefined
  ) {
    return undefined
  }
  return {
    ...(accessToken !== undefined ? { accessToken } : {}),
    ...(refreshToken !== undefined ? { refreshToken } : {}),
    ...(expiresAt !== undefined ? { expiresAt } : {}),
    ...(accountId !== undefined ? { accountId } : {}),
    ...(enterpriseDomain !== undefined ? { enterpriseDomain } : {}),
  }
}

function buildProviderSummary(
  provider: ProviderConfig | undefined,
  activeModel: string | undefined,
): Pick<
  CustomApiStorageData,
  'provider' | 'providerKind' | 'variant' | 'providerId' | 'authMode' | 'baseURL' | 'apiKey' | 'model' | 'savedModels'
> {
  return {
    provider:
      provider?.kind === 'openai-like'
        ? 'openai'
        : provider?.kind === 'anthropic-like'
          ? 'anthropic'
          : provider?.kind === 'gemini-like'
            ? 'gemini'
            : undefined,
    providerKind: provider?.kind,
    variant: provider?.variant,
    providerId: provider?.id,
    authMode: provider?.authMode,
    baseURL: provider?.baseURL,
    apiKey:
      provider?.kind === 'gemini-like' &&
      provider?.authMode === 'gemini-cli-oauth'
        ? undefined
        : provider?.apiKey,
    model: activeModel,
    savedModels: provider?.models,
  }
}

function normalizeProviderConfig(value: Record<string, unknown>): ProviderConfig | null {
  const kind = normalizeProviderKind(value.kind) ?? normalizeProviderKind(value.id)
  if (!kind) return null
  const baseURL = normalizeCompatibleBaseURL(
    typeof value.baseURL === 'string' ? value.baseURL : undefined,
  )
  const authMode =
    typeof value.authMode === 'string'
      ? value.authMode
      : kind === 'openai-like'
        ? 'chat-completions'
        : kind === 'gemini-like'
          ? 'vertex-compatible'
          : 'api-key'
  const id = typeof value.id === 'string' && value.id !== kind ? value.id : deriveProviderId(baseURL, kind)
  const variant =
    normalizeProviderVariant(value.variant) ??
    inferProviderVariant({
      kind,
      authMode: authMode as ProviderAuthMode,
      baseURL,
      id,
      provider:
        value.provider === 'openai' || value.provider === 'gemini' || value.provider === 'anthropic'
          ? value.provider
          : undefined,
    })
  return {
    id,
    kind,
    variant,
    authMode: authMode as ProviderAuthMode,
    baseURL,
    apiKey: typeof value.apiKey === 'string' ? value.apiKey : undefined,
    models: dedupeModels(value.models),
    reasoning: normalizeProviderReasoning(value.reasoning),
    oauth:
      kind === 'openai-like'
        ? normalizeOpenAIOAuth(value.oauth)
        : kind === 'gemini-like'
          ? normalizeGeminiOAuth(value.oauth)
          : undefined,
  }
}

function migrateLegacyShape(value: Record<string, unknown>): CustomApiStorageData {
  const kind = normalizeLegacyProviderKind(value.provider)
  const baseURL = normalizeCompatibleBaseURL(
    typeof value.baseURL === 'string' ? value.baseURL : undefined,
  )
  const providerId = deriveProviderId(baseURL, kind)
  const legacyModel = typeof value.model === 'string' ? value.model : undefined
  const legacySaved = dedupeModels(value.savedModels)
  const models = [...new Set([...(legacyModel ? [legacyModel] : []), ...legacySaved])]
  const authMode = kind === 'openai-like' ? 'chat-completions' : kind === 'gemini-like' ? 'vertex-compatible' : 'api-key'
  const provider = {
    id: providerId,
    kind,
    variant: inferProviderVariant({
      kind,
      authMode,
      baseURL,
      id: providerId,
      provider: value.provider === 'openai' || value.provider === 'gemini' || value.provider === 'anthropic'
        ? value.provider
        : undefined,
    }),
    authMode,
    baseURL,
    apiKey: typeof value.apiKey === 'string' ? value.apiKey : undefined,
    models,
  } satisfies ProviderConfig
  return {
    activeProvider: providerId,
    activeModel: legacyModel,
    activeAuthMode: provider.authMode,
    providers: [provider],
    ...buildProviderSummary(provider, legacyModel),
  }
}

export function readCustomApiStorage(): CustomApiStorageData {
  const storage = getSecureStorage() as {
    read?: () => Record<string, unknown> | null
    update?: (data: Record<string, unknown>) => { success: boolean }
  }
  const data = storage.read?.() ?? {}
  const raw = data[CUSTOM_API_STORAGE_KEY]
  if (!raw || typeof raw !== 'object') return {}
  const value = raw as Record<string, unknown>
  if (!Array.isArray(value.providers)) {
    return migrateLegacyShape(value)
  }
  const providers = value.providers.map(item => item && typeof item === 'object' ? normalizeProviderConfig(item as Record<string, unknown>) : null).filter((item): item is ProviderConfig => item !== null)
  const activeProviderKey =
    typeof value.activeProviderKey === 'string' ? value.activeProviderKey : undefined
  const activeProvider = typeof value.activeProvider === 'string' ? value.activeProvider : typeof value.providerId === 'string' ? value.providerId : providers[0]?.id
  const activeModel = typeof value.activeModel === 'string' ? value.activeModel : typeof value.model === 'string' ? value.model : undefined
  const activeAuthMode = typeof value.activeAuthMode === 'string'
    ? value.activeAuthMode as ProviderAuthMode
    : typeof value.authMode === 'string'
      ? value.authMode as ProviderAuthMode
      : undefined
  const activeVariant = normalizeProviderVariant(value.variant)
  const matchesActiveProvider = (provider: ProviderConfig) =>
    provider.id === activeProvider
  const matchesActiveAuthMode = (provider: ProviderConfig) =>
    activeAuthMode === undefined || provider.authMode === activeAuthMode
  const matchesActiveModel = (provider: ProviderConfig) =>
    activeModel === undefined || provider.models.includes(activeModel)
  const matchesActiveVariant = (provider: ProviderConfig) =>
    activeVariant === undefined || provider.variant === activeVariant
  const currentProvider = providers.find(provider =>
    activeProviderKey !== undefined &&
    getProviderKeyFromConfig(provider) === activeProviderKey,
  ) ?? providers.find(provider =>
    matchesActiveProvider(provider) &&
    matchesActiveVariant(provider) &&
    matchesActiveAuthMode(provider) &&
    matchesActiveModel(provider),
  ) ?? providers.find(provider =>
    matchesActiveProvider(provider) &&
    matchesActiveVariant(provider) &&
    matchesActiveAuthMode(provider),
  ) ?? providers.find(provider =>
    matchesActiveProvider(provider) &&
    matchesActiveVariant(provider),
  ) ?? providers.find(provider =>
    matchesActiveProvider(provider) &&
    matchesActiveAuthMode(provider) &&
    matchesActiveModel(provider),
  ) ?? providers.find(provider =>
    matchesActiveProvider(provider) &&
    matchesActiveAuthMode(provider),
  ) ?? providers.find(provider =>
    matchesActiveProvider(provider) &&
    matchesActiveModel(provider),
  ) ?? providers.find(provider => matchesActiveProvider(provider))
    ?? providers.find(provider => matchesActiveModel(provider))
    ?? providers[0]
  return {
    activeProviderKey:
      currentProvider !== undefined
        ? getProviderKeyFromConfig(currentProvider)
        : activeProviderKey,
    activeProvider: currentProvider?.id ?? activeProvider,
    activeModel,
    activeAuthMode: currentProvider?.authMode ?? activeAuthMode,
    providers,
    ...buildProviderSummary(currentProvider, activeModel),
  }
}

export function getActiveProviderConfig(
  storage: CustomApiStorageData,
): ProviderConfig | undefined {
  const providers = storage.providers ?? []
  if (storage.activeProviderKey) {
    const exact = providers.find(
      provider => getProviderKeyFromConfig(provider) === storage.activeProviderKey,
    )
    if (exact) return exact
  }

  const activeProviderId = storage.activeProvider ?? storage.providerId
  const activeAuthMode = storage.activeAuthMode ?? storage.authMode
  const activeModel = storage.activeModel ?? storage.model
  const activeKind = storage.providerKind
  const activeVariant = storage.variant

  return providers.find(
    provider =>
      provider.id === activeProviderId &&
      (activeKind === undefined || provider.kind === activeKind) &&
      (activeVariant === undefined || provider.variant === activeVariant) &&
      (activeAuthMode === undefined || provider.authMode === activeAuthMode) &&
      (activeModel === undefined || provider.models.includes(activeModel)),
  ) ?? providers.find(
    provider =>
      provider.id === activeProviderId &&
      (activeKind === undefined || provider.kind === activeKind) &&
      (activeVariant === undefined || provider.variant === activeVariant) &&
      (activeAuthMode === undefined || provider.authMode === activeAuthMode),
  ) ?? providers.find(
    provider =>
      provider.id === activeProviderId &&
      (activeKind === undefined || provider.kind === activeKind) &&
      (activeVariant === undefined || provider.variant === activeVariant),
  ) ?? providers.find(
    provider =>
      provider.id === activeProviderId &&
      (activeKind === undefined || provider.kind === activeKind),
  ) ?? providers[0]
}

export function writeCustomApiStorage(next: CustomApiStorageData): void {
  const storage = getSecureStorage() as {
    read?: () => Record<string, unknown> | null
    update?: (data: Record<string, unknown>) => { success: boolean }
  }
  const current = storage.read?.() ?? {}
  storage.update?.({
    ...current,
    customApiEndpoint: next,
  })
}

export function clearCustomApiStorage(): void {
  const storage = getSecureStorage() as {
    read?: () => Record<string, unknown> | null
    update?: (data: Record<string, unknown>) => { success: boolean }
  }
  const current = storage.read?.() ?? {}
  const { customApiEndpoint: _, ...rest } = current
  storage.update?.(rest)
}
