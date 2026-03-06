// Stub replacing @kilocode/kilo-gateway — strips Kilo cloud features

import { Hono } from "hono"

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

export function fetchDefaultModel(_token?: string, _organizationId?: string) {
  return undefined
}

export function fetchKiloModels(_options?: any) {
  return []
}

export function createKilo(_opts: any): any {
  return null
}

export function createKiloRoutes(_opts?: any) {
  return new Hono()
}

export async function KiloAuthPlugin(): Promise<any> {
  return undefined
}
