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

  /** Start an ngrok tunnel and return the public URL.
   *  Retries on session limit errors (ERR_NGROK_108) since stale sessions
   *  from a crashed daemon expire after ~60s on ngrok's servers. */
  export async function start(config: Config): Promise<string> {
    if (listener) {
      log.warn("tunnel already running, stopping first")
      await stop()
    }

    // Clean up any local stale sessions from a previous process
    await ngrok.disconnect().catch(() => {})
    await ngrok.kill().catch(() => {})

    const maxAttempts = 4
    const retryDelay = 15_000 // 15s between retries (stale sessions expire in ~60s)

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        listener = await ngrok.forward({
          addr: config.port,
          authtoken: config.authtoken,
          authtoken_from_env: !config.authtoken,
          domain: config.domain,
        })

        const url = listener.url()!
        log.info("tunnel started", { url, port: config.port })
        return url
      } catch (err: any) {
        const isSessionLimit = err?.message?.includes("ERR_NGROK_108") ||
          err?.error_code === "ERR_NGROK_108"

        if (isSessionLimit && attempt < maxAttempts) {
          log.warn("ngrok session limit — stale session from previous daemon, retrying", {
            attempt,
            retryIn: `${retryDelay / 1000}s`,
          })
          await new Promise((r) => setTimeout(r, retryDelay))
          continue
        }
        throw err
      }
    }

    throw new Error("ngrok: failed to start tunnel after retries")
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
