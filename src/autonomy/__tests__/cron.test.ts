import { describe, test, expect, beforeEach, afterEach } from "bun:test"
import { CronScheduler } from "../cron"
import { InputQueue } from "@/input/queue"

describe("CronScheduler", () => {
  beforeEach(() => {
    InputQueue.clear()
    CronScheduler.stop()
  })

  afterEach(() => {
    CronScheduler.stop()
  })

  test("schedules and lists jobs", () => {
    CronScheduler.start([
      { name: "test-job", schedule: "0 * * * *", prompt: "hourly check" },
      { name: "daily", schedule: "0 9 * * *", prompt: "morning routine" },
    ])

    const list = CronScheduler.list()
    expect(list).toHaveLength(2)
    expect(list[0].name).toBe("test-job")
    expect(list[1].name).toBe("daily")
    expect(list[0].nextRun).toBeTruthy()
  })

  test("skips disabled jobs", () => {
    CronScheduler.start([
      { name: "active", schedule: "0 * * * *", prompt: "active", enabled: true },
      { name: "disabled", schedule: "0 * * * *", prompt: "disabled", enabled: false },
    ])

    const list = CronScheduler.list()
    expect(list).toHaveLength(1)
    expect(list[0].name).toBe("active")
  })

  test("removes a job", () => {
    CronScheduler.start([
      { name: "to-remove", schedule: "0 * * * *", prompt: "remove me" },
    ])
    expect(CronScheduler.list()).toHaveLength(1)

    CronScheduler.removeJob("to-remove")
    expect(CronScheduler.list()).toHaveLength(0)
  })

  test("stop clears all jobs", () => {
    CronScheduler.start([
      { name: "a", schedule: "0 * * * *", prompt: "a" },
      { name: "b", schedule: "0 * * * *", prompt: "b" },
    ])
    expect(CronScheduler.isRunning()).toBe(true)

    CronScheduler.stop()
    expect(CronScheduler.isRunning()).toBe(false)
    expect(CronScheduler.list()).toHaveLength(0)
  })
})
