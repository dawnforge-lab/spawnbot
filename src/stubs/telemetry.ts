// Stub replacing @kilocode/kilo-telemetry — all no-ops

export namespace Telemetry {
  export async function init(_opts: any) {}
  export async function shutdown() {}
  export async function updateIdentity(_token: string, _accountId?: string) {}
  export function trackCliStart() {}
  export function trackCliExit(_exitCode?: number) {}
  export function trackEvent(_name: string, _props?: Record<string, any>) {}
  export function track(_event: string, _props?: Record<string, any>) {}
  export function trackAuthSuccess(_providerID: string) {}
  export function trackAuthLogout(_providerID: string) {}
  export function trackLlmCompletion(_data: Record<string, any>) {}
  export function trackPlanFollowup(_sessionID: string, _action: string) {}
  export function getTracer() {
    return undefined
  }
}

export namespace Identity {
  export function machineId() {
    return "local"
  }
}
