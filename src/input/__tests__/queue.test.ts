import { describe, test, expect, beforeEach } from "bun:test"
import { InputQueue } from "../queue"

function makeEvent(
  priority: InputQueue.Priority,
  content: string,
): InputQueue.InputEvent {
  return {
    id: `test-${Date.now()}-${Math.random()}`,
    source: "test",
    content,
    priority,
    timestamp: Date.now(),
  }
}

describe("InputQueue", () => {
  beforeEach(() => {
    InputQueue.clear()
  })

  test("enqueue and dequeue in priority order", async () => {
    InputQueue.enqueue(makeEvent("low", "low priority"))
    InputQueue.enqueue(makeEvent("high", "high priority"))
    InputQueue.enqueue(makeEvent("normal", "normal priority"))
    InputQueue.enqueue(makeEvent("critical", "critical priority"))

    expect(InputQueue.size()).toBe(4)

    const e1 = await InputQueue.dequeue()
    expect(e1.content).toBe("critical priority")

    const e2 = await InputQueue.dequeue()
    expect(e2.content).toBe("high priority")

    const e3 = await InputQueue.dequeue()
    expect(e3.content).toBe("normal priority")

    const e4 = await InputQueue.dequeue()
    expect(e4.content).toBe("low priority")

    expect(InputQueue.size()).toBe(0)
  })

  test("FIFO within same priority", async () => {
    InputQueue.enqueue(makeEvent("normal", "first"))
    InputQueue.enqueue(makeEvent("normal", "second"))
    InputQueue.enqueue(makeEvent("normal", "third"))

    const e1 = await InputQueue.dequeue()
    expect(e1.content).toBe("first")

    const e2 = await InputQueue.dequeue()
    expect(e2.content).toBe("second")
  })

  test("blocking dequeue resolves when event arrives", async () => {
    const promise = InputQueue.dequeue()

    // Enqueue after a small delay
    setTimeout(() => {
      InputQueue.enqueue(makeEvent("normal", "delayed event"))
    }, 10)

    const event = await promise
    expect(event.content).toBe("delayed event")
  })

  test("sizes returns per-priority counts", () => {
    InputQueue.enqueue(makeEvent("critical", "c1"))
    InputQueue.enqueue(makeEvent("critical", "c2"))
    InputQueue.enqueue(makeEvent("normal", "n1"))

    const sizes = InputQueue.sizes()
    expect(sizes.critical).toBe(2)
    expect(sizes.normal).toBe(1)
    expect(sizes.high).toBe(0)
    expect(sizes.low).toBe(0)
  })

  test("abort signal cancels blocking dequeue", async () => {
    const controller = new AbortController()

    const promise = InputQueue.dequeue(controller.signal).catch((err) => err)
    controller.abort()

    const result = await promise
    expect(result).toBeInstanceOf(Error)
  })
})
