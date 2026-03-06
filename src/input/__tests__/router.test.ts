import { describe, test, expect } from "bun:test"
import { InputRouter } from "../router"
import type { InputQueue } from "../queue"

function makeEvent(source: string, content: string, sender?: string): InputQueue.InputEvent {
  return {
    id: "test",
    source,
    sender,
    content,
    priority: "normal",
    timestamp: Date.now(),
  }
}

describe("InputRouter.formatInput", () => {
  test("telegram with sender", () => {
    const result = InputRouter.formatInput(makeEvent("telegram", "hello", "Alice"))
    expect(result).toBe("[telegram from Alice] hello")
  })

  test("cron job", () => {
    const result = InputRouter.formatInput(makeEvent("cron/daily-summary", "time to summarize"))
    expect(result).toBe("[cron/daily-summary] time to summarize")
  })

  test("autonomy", () => {
    const result = InputRouter.formatInput(makeEvent("autonomy", "idle check"))
    expect(result).toBe("[autonomy] idle check")
  })

  test("cli has no prefix", () => {
    const result = InputRouter.formatInput(makeEvent("cli", "user typed this"))
    expect(result).toBe("user typed this")
  })

  test("unknown source", () => {
    const result = InputRouter.formatInput(makeEvent("webhook", "incoming"))
    expect(result).toBe("[webhook] incoming")
  })
})
