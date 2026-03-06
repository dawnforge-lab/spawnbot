import { describe, test, expect } from "bun:test"
import { Soul } from "../schema"
import { renderSoul } from "../render"

describe("renderSoul", () => {
  test("renders minimal soul", () => {
    const soul = Soul.parse({
      identity: { name: "TestBot" },
    })
    const result = renderSoul(soul)
    expect(result).toContain("You are TestBot.")
  })

  test("renders identity with role and tagline", () => {
    const soul = Soul.parse({
      identity: {
        name: "Agent",
        role: "research assistant",
        tagline: "Finding answers fast",
      },
    })
    const result = renderSoul(soul)
    expect(result).toContain("You are Agent, research assistant.")
    expect(result).toContain("Finding answers fast")
  })

  test("renders personality traits with visual bars", () => {
    const soul = Soul.parse({
      identity: { name: "Bot" },
      personality: {
        archetype: "mentor",
        traits: [
          { name: "curiosity", level: 7, description: "Always exploring" },
          { name: "humor", level: 3 },
        ],
      },
    })
    const result = renderSoul(soul)
    expect(result).toContain("# Personality")
    expect(result).toContain("Archetype: mentor")
    expect(result).toContain("curiosity: [███████░░░] 7/10 — Always exploring")
    expect(result).toContain("humor: [███░░░░░░░] 3/10")
  })

  test("renders voice section", () => {
    const soul = Soul.parse({
      identity: { name: "Bot" },
      voice: {
        tone: "warm",
        avoid: ["filler words"],
        examples: ["Let's dig in."],
      },
    })
    const result = renderSoul(soul)
    expect(result).toContain("# Voice")
    expect(result).toContain("Tone: warm")
    expect(result).toContain('- "filler words"')
    expect(result).toContain('- "Let\'s dig in."')
  })

  test("renders safety rules with severity", () => {
    const soul = Soul.parse({
      identity: { name: "Bot" },
      safety: {
        stop_phrase: "HALT",
        rules: [
          { rule: "Never delete production data", severity: "hard" },
          { rule: "Prefer safe operations", severity: "soft" },
        ],
      },
    })
    const result = renderSoul(soul)
    expect(result).toContain("# Safety Rules")
    expect(result).toContain("[MUST] Never delete production data")
    expect(result).toContain("[SHOULD] Prefer safe operations")
    expect(result).toContain('Stop phrase: "HALT"')
  })

  test("renders goals", () => {
    const soul = Soul.parse({
      identity: { name: "Bot" },
      goals: ["Ship v1", "Write tests"],
    })
    const result = renderSoul(soul)
    expect(result).toContain("# Current Goals")
    expect(result).toContain("- Ship v1")
    expect(result).toContain("- Write tests")
  })

  test("renders additional context", () => {
    const soul = Soul.parse({
      identity: { name: "Bot" },
      context: "You specialize in TypeScript and Rust.",
    })
    const result = renderSoul(soul)
    expect(result).toContain("You specialize in TypeScript and Rust.")
  })

  test("omits empty sections", () => {
    const soul = Soul.parse({
      identity: { name: "Bot" },
    })
    const result = renderSoul(soul)
    expect(result).not.toContain("# Personality")
    expect(result).not.toContain("# Voice")
    expect(result).not.toContain("# Safety")
    expect(result).not.toContain("# Current Goals")
  })
})
