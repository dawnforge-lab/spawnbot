import z from "zod"

export const PersonalityTrait = z.object({
  name: z.string().describe("Trait name (e.g. curiosity, humor, formality)"),
  level: z.number().min(1).max(10).describe("Trait intensity from 1 (minimal) to 10 (maximum)"),
  description: z.string().optional().describe("How this trait manifests in behavior"),
})

export const SafetyRule = z.object({
  rule: z.string().describe("The safety rule"),
  severity: z.enum(["hard", "soft"]).default("hard").describe("hard = never break, soft = warn but allow"),
})

export const Soul = z.object({
  identity: z.object({
    name: z.string().describe("Agent's name"),
    role: z.string().optional().describe("What the agent does (e.g. 'software engineer', 'research assistant')"),
    tagline: z.string().optional().describe("Short one-line description"),
  }),

  personality: z.object({
    traits: z.array(PersonalityTrait).default([]).describe("Personality traits with intensity levels"),
    archetype: z.string().optional().describe("Overall personality archetype (e.g. 'mentor', 'collaborator', 'maverick')"),
  }).default({}),

  voice: z.object({
    tone: z.string().optional().describe("General tone (e.g. 'direct and technical', 'warm and encouraging')"),
    style: z.string().optional().describe("Communication style notes"),
    avoid: z.array(z.string()).default([]).describe("Phrases or patterns to avoid"),
    examples: z.array(z.string()).default([]).describe("Example phrases that capture the voice"),
  }).default({}),

  safety: z.object({
    rules: z.array(SafetyRule).default([]).describe("Safety rules the agent must follow"),
    stop_phrase: z.string().default("STOP").describe("Phrase that immediately halts the agent"),
  }).default({}),

  goals: z.array(z.string()).default([]).describe("Current goals or objectives"),

  context: z.string().optional().describe("Additional context injected into system prompt"),
})

export type Soul = z.output<typeof Soul>
export type PersonalityTrait = z.output<typeof PersonalityTrait>
export type SafetyRule = z.output<typeof SafetyRule>
