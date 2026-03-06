import type { Soul } from "./schema"

/**
 * Renders a Soul config into a system prompt string.
 * Each section is only included if it has meaningful content.
 */
export function renderSoul(soul: Soul): string {
  const sections: string[] = []

  // Identity
  const identity = [`You are ${soul.identity.name}`]
  if (soul.identity.role) identity[0] += `, ${soul.identity.role}`
  identity[0] += "."
  if (soul.identity.tagline) identity.push(soul.identity.tagline)
  sections.push(identity.join("\n"))

  // Personality traits
  if (soul.personality?.traits && soul.personality.traits.length > 0) {
    const lines = ["# Personality"]
    if (soul.personality.archetype) {
      lines.push(`Archetype: ${soul.personality.archetype}`)
      lines.push("")
    }
    for (const trait of soul.personality.traits) {
      const bar = "█".repeat(trait.level) + "░".repeat(10 - trait.level)
      const line = `- ${trait.name}: [${bar}] ${trait.level}/10`
      lines.push(trait.description ? `${line} — ${trait.description}` : line)
    }
    sections.push(lines.join("\n"))
  }

  // Voice
  const voice = soul.voice ?? {}
  const avoid = voice.avoid ?? []
  const examples = voice.examples ?? []
  const hasVoice = voice.tone || voice.style || avoid.length > 0 || examples.length > 0
  if (hasVoice) {
    const lines = ["# Voice"]
    if (voice.tone) lines.push(`Tone: ${voice.tone}`)
    if (voice.style) lines.push(`Style: ${voice.style}`)
    if (avoid.length > 0) {
      lines.push("")
      lines.push("Avoid:")
      for (const phrase of avoid) {
        lines.push(`- "${phrase}"`)
      }
    }
    if (examples.length > 0) {
      lines.push("")
      lines.push("Example phrases:")
      for (const example of examples) {
        lines.push(`- "${example}"`)
      }
    }
    sections.push(lines.join("\n"))
  }

  // Safety
  const safetyRules = soul.safety?.rules ?? []
  if (safetyRules.length > 0) {
    const lines = ["# Safety Rules"]
    for (const rule of safetyRules) {
      const prefix = rule.severity === "hard" ? "MUST" : "SHOULD"
      lines.push(`- [${prefix}] ${rule.rule}`)
    }
    lines.push("")
    const stopPhrase = soul.safety?.stop_phrase ?? "STOP"
    lines.push(`Stop phrase: "${stopPhrase}" — if you see this, stop immediately.`)
    sections.push(lines.join("\n"))
  }

  // Goals
  const goals = soul.goals ?? []
  if (goals.length > 0) {
    const lines = ["# Current Goals"]
    for (const goal of goals) {
      lines.push(`- ${goal}`)
    }
    sections.push(lines.join("\n"))
  }

  // Additional context
  if (soul.context) {
    sections.push(soul.context.trim())
  }

  return sections.join("\n\n")
}
