---
name: create-tool
description: "Create a new custom tool when you need executable capabilities beyond your built-in tools. Use when you need to call external APIs, run specialized computations, generate images, post to services, or perform any action that requires code execution."
---

# Creating Custom Tools

A tool is a TypeScript file that exports a function the agent can call during conversations. Tools are for **executable actions**, not knowledge (use skills for that).

## When to Create a Tool

- You need to call an external API (image generation, TTS, social media, etc.)
- You need a specialized computation or data transformation
- You need to interact with a service that has no built-in support
- The user asks you to gain a new capability that requires code

## File Format

Create a `.ts` file using the `@kilocode/plugin` tool helper:

```typescript
import { tool } from "@kilocode/plugin"

export default tool({
  description: "One sentence describing what this tool does",
  args: {
    param1: tool.schema.string().describe("What this parameter is for"),
    param2: tool.schema.number().optional().describe("Optional numeric param"),
  },
  async execute(args, ctx) {
    // Your tool logic here
    // args.param1, args.param2 are typed and validated
    // ctx.directory is the project directory
    // ctx.abort is an AbortSignal for cancellation
    return "Result string shown to the agent"
  },
})
```

## Where to Create

Write to `tools/<name>.ts`:

```
tools/
  generate-image.ts
  post-tweet.ts
  text-to-speech.ts
```

## Tool ID Convention

The file name becomes the tool ID. If the file exports `default`, the tool ID is the filename without extension. Named exports become `filename_exportname`.

Examples:
- `generate-image.ts` with `export default` → tool ID: `generate-image`
- `social.ts` with `export const post` → tool ID: `social_post`

## Key Rules

- **Return a string** — the execute function must return a string result
- **Use `tool.schema`** (which is Zod) for argument definitions
- **Add `.describe()`** to every argument so the agent knows what to pass
- **Handle errors** — throw errors with clear messages, don't return error strings
- **No side effects on import** — all logic goes inside `execute()`
- **Install dependencies first** — if your tool needs an npm package, install it with the bash tool before creating the tool file

## After Creating

1. The tool becomes available after the next session reload
2. Update `SKILLS.md` with the new tool entry so you remember it exists
