import { Cron } from "croner"
import { InputQueue } from "@/input/queue"
import { Log } from "@/util/log"
import { ulid } from "ulid"
import * as prompts from "./prompts"

const log = Log.create({ service: "autonomy.cron" })

export namespace CronScheduler {
  export interface Job {
    name: string
    schedule: string // cron expression
    prompt: string
    priority?: InputQueue.Priority
    enabled?: boolean
  }

  const jobs: Map<string, Cron> = new Map()

  export function start(jobConfigs: Job[]) {
    for (const config of jobConfigs) {
      if (config.enabled === false) continue
      scheduleJob(config)
    }
    log.info("cron scheduler started", { jobs: jobs.size })
  }

  export function scheduleJob(config: Job) {
    if (jobs.has(config.name)) {
      jobs.get(config.name)!.stop()
    }

    const cron = new Cron(config.schedule, () => {
      log.info("cron job firing", { name: config.name })
      const content = config.prompt.trim()
        ? prompts.cronWithContent(config.name, config.prompt)
        : prompts.cronEmpty(config.name)
      InputQueue.enqueue({
        id: ulid(),
        source: `cron/${config.name}`,
        content,
        priority: config.priority ?? "normal",
        timestamp: Date.now(),
      })
    })

    jobs.set(config.name, cron)
    log.info("cron job scheduled", {
      name: config.name,
      schedule: config.schedule,
      next: cron.nextRun()?.toISOString(),
    })
  }

  export function removeJob(name: string) {
    const cron = jobs.get(name)
    if (cron) {
      cron.stop()
      jobs.delete(name)
      log.info("cron job removed", { name })
    }
  }

  export function stop() {
    for (const [name, cron] of jobs) {
      cron.stop()
    }
    jobs.clear()
    log.info("cron scheduler stopped")
  }

  export function list(): { name: string; schedule: string; nextRun: string | null }[] {
    return [...jobs.entries()].map(([name, cron]) => ({
      name,
      schedule: cron.getPattern(),
      nextRun: cron.nextRun()?.toISOString() ?? null,
    }))
  }

  export function isRunning(): boolean {
    return jobs.size > 0
  }
}
