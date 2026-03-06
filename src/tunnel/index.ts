import ngrok from "@ngrok/ngrok"
import { Log } from "@/util/log"

const log = Log.create({ service: "tunnel" })

export namespace Tunnel {
  let listener: ngrok.Listener | undefined

  export interface Config {
    /** ngrok authtoken (or set NGROK_AUTHTOKEN env var) */
    authtoken?: string
    /** Local port to forward to */
    port: number
    /** Optional fixed domain (requires paid ngrok plan) */
    domain?: string
  }

  /** Start an ngrok tunnel and return the public URL */
  export async function start(config: Config): Promise<string> {
    if (listener) {
      log.warn("tunnel already running, stopping first")
      await stop()
    }

    listener = await ngrok.forward({
      addr: config.port,
      authtoken: config.authtoken,
      authtoken_from_env: !config.authtoken,
      domain: config.domain,
    })

    const url = listener.url()!
    log.info("tunnel started", { url, port: config.port })
    return url
  }

  /** Stop the ngrok tunnel */
  export async function stop() {
    if (listener) {
      await listener.close()
      listener = undefined
      log.info("tunnel stopped")
    }
  }

  /** Get the current tunnel URL, if running */
  export function url(): string | undefined {
    return listener?.url() ?? undefined
  }

  export function isRunning(): boolean {
    return listener !== undefined
  }
}
