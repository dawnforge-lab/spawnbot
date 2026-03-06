// Type stubs for @kilocode/kilo-gateway — stripped in spawnbot fork
declare module "@kilocode/kilo-gateway" {
  export interface Organization {
    id: string
    name: string
    [key: string]: any
  }

  export interface KilocodeProfile {
    id: string
    email: string
    organizations?: Organization[]
    [key: string]: any
  }

  export interface KilocodeBalance {
    credits: number
    [key: string]: any
  }

  export interface KilocodeNotification {
    id: string
    message: string
    [key: string]: any
  }
}
