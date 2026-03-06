// Stub replacing @kilocode/kilo-gateway — strips Kilo cloud features

export const KILO_API_BASE = ""
export const KILO_OPENROUTER_BASE = ""
export const ENV_FEATURE = "SPAWNBOT_FEATURE"
export const ENV_VERSION = "SPAWNBOT_VERSION"
export const HEADER_PROJECTID = "x-project-id"
export const HEADER_MACHINEID = "x-machine-id"
export const HEADER_TASKID = "x-task-id"

export async function migrateLegacyKiloAuth(
  _check: () => Promise<boolean>,
  _set: (auth: any) => Promise<void>,
) {}

export function fetchDefaultModel() {
  return undefined
}

export function fetchKiloModels() {
  return []
}

export function createKilo(_opts: any) {
  throw new Error("Kilo gateway provider not available in spawnbot")
}

export function createKiloRoutes() {
  return null
}

export async function KiloAuthPlugin() {
  return undefined
}
