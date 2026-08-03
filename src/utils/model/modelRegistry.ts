import { readFileSync } from 'fs'
import { mkdirSync, writeFileSync } from 'fs'
import { join } from 'path'
import { z } from 'zod/v4'
import { getClaudeConfigHomeDir } from '../envUtils.js'
import { safeParseJSON } from '../json.js'
import { jsonStringify } from '../slowOperations.js'
import { getCanonicalName } from './model.js'
import defaultRegistry from '../../constants/model-registry.json'

const MatchSchema = z
  .object({
    type: z.enum(['exact', 'prefix', 'version_gte']),
    value: z.string(),
    family: z.string().optional(),
  })
  .passthrough()

const MetadataSchema = z
  .object({
    contextWindow: z.number().int().positive().optional(),
    provider: z.string().optional(),
    baseUrl: z.string().optional(),
    authMode: z.string().optional(),
  })
  .passthrough()

const ModelRegistryEntrySchema = z.object({
  match: MatchSchema,
  metadata: MetadataSchema.default({}),
})

const ModelRegistrySchema = z.object({
  version: z.number().int().positive(),
  models: z.array(ModelRegistryEntrySchema),
})

type ModelRegistry = z.infer<typeof ModelRegistrySchema>
type ModelRegistryEntry = z.infer<typeof ModelRegistryEntrySchema>

const DEFAULT_REGISTRY = ModelRegistrySchema.parse(defaultRegistry)

function getRegistryPath(): string {
  return join(getClaudeConfigHomeDir(), 'model-registry.json')
}

function ensureRegistryFile(): void {
  const path = getRegistryPath()
  try {
    readFileSync(path, 'utf-8')
  } catch {
    mkdirSync(getClaudeConfigHomeDir(), { recursive: true })
    writeFileSync(path, jsonStringify(DEFAULT_REGISTRY, null, 2), 'utf-8')
  }
}

function loadRegistry(): ModelRegistry {
  const path = getRegistryPath()
  ensureRegistryFile()
  try {
    const raw = readFileSync(path, 'utf-8')
    const parsed = ModelRegistrySchema.safeParse(safeParseJSON(raw, false))
    if (parsed.success) {
      return parsed.data
    }
  } catch {
    // fall through to default registry
  }
  return DEFAULT_REGISTRY
}

function parseVersionParts(value: string): number[] {
  const match = value.match(/\d+(?:\.\d+)*/)
  if (!match) return []
  return match[0].split('.').map(part => Number.parseInt(part, 10) || 0)
}

function isVersionGte(model: string, family: string, minVersion: string): boolean {
  const lower = model.toLowerCase()
  const familyPrefix = `${family.toLowerCase()}-`
  if (!lower.startsWith(familyPrefix)) return false
  const modelParts = parseVersionParts(lower.slice(familyPrefix.length))
  const minParts = parseVersionParts(minVersion)
  const length = Math.max(modelParts.length, minParts.length)
  for (let i = 0; i < length; i++) {
    const a = modelParts[i] ?? 0
    const b = minParts[i] ?? 0
    if (a > b) return true
    if (a < b) return false
  }
  return modelParts.length > 0
}

function matchesEntry(model: string, entry: ModelRegistryEntry): boolean {
  const lower = model.toLowerCase()
  switch (entry.match.type) {
    case 'exact':
      return lower === entry.match.value.toLowerCase()
    case 'prefix':
      return lower.startsWith(entry.match.value.toLowerCase())
    case 'version_gte':
      return entry.match.family
        ? isVersionGte(lower, entry.match.family, entry.match.value)
        : false
  }
}

export function getModelRegistry(): ModelRegistry {
  return loadRegistry()
}

export function getModelRegistryEntry(model: string): ModelRegistryEntry | undefined {
  const normalized = getCanonicalName(model)
  return loadRegistry().models.find(entry => matchesEntry(normalized, entry))
}

export function getModelContextWindowFromRegistry(model: string): number | undefined {
  return getModelRegistryEntry(model)?.metadata.contextWindow
}
