import { cmd } from "./cmd"
import * as prompts from "@clack/prompts"
import { UI } from "../ui"
import path from "path"
import fs from "fs"
import os from "os"
import { Global } from "../../global"
import { EOL } from "os"
import { Auth } from "../../auth"
import { generateText, tool, stepCountIs, type LanguageModel, type CoreMessage } from "ai"
import { createAnthropic } from "@ai-sdk/anthropic"
import { createOpenAI } from "@ai-sdk/openai"
import { createGoogleGenerativeAI } from "@ai-sdk/google"
import { createXai } from "@ai-sdk/xai"
import { createMistral } from "@ai-sdk/mistral"
import { createGroq } from "@ai-sdk/groq"
import { createDeepInfra } from "@ai-sdk/deepinfra"
import { createCerebras } from "@ai-sdk/cerebras"
import { createCohere } from "@ai-sdk/cohere"
import { createTogetherAI } from "@ai-sdk/togetherai"
import { createPerplexity } from "@ai-sdk/perplexity"
import { createOpenRouter } from "@openrouter/ai-sdk-provider"
import { createOpenAICompatible } from "@ai-sdk/openai-compatible"
import { z } from "zod"

// Provider definitions for setup wizard
interface SetupProvider {
  id: string
  name: string
  envHint: string
  defaultModel: string
  baseURL?: string // for openai-compatible providers
  category: string
}

const PROVIDERS: SetupProvider[] = [
  // ── Major cloud providers ──
  { id: "anthropic", name: "Anthropic (Claude)", envHint: "ANTHROPIC_API_KEY", defaultModel: "claude-sonnet-4-20250514", category: "Major" },
  { id: "openai", name: "OpenAI (GPT)", envHint: "OPENAI_API_KEY", defaultModel: "gpt-4o", category: "Major" },
  { id: "google", name: "Google (Gemini)", envHint: "GOOGLE_GENERATIVE_AI_API_KEY", defaultModel: "gemini-2.0-flash", category: "Major" },
  { id: "xai", name: "xAI (Grok)", envHint: "XAI_API_KEY", defaultModel: "grok-3-mini-fast", category: "Major" },
  { id: "mistral", name: "Mistral", envHint: "MISTRAL_API_KEY", defaultModel: "mistral-large-latest", category: "Major" },
  { id: "deepseek", name: "DeepSeek", envHint: "DEEPSEEK_API_KEY", defaultModel: "deepseek-chat", baseURL: "https://api.deepseek.com/v1", category: "Major" },
  // ── Inference platforms ──
  { id: "groq", name: "Groq (fast inference)", envHint: "GROQ_API_KEY", defaultModel: "llama-3.3-70b-versatile", category: "Inference" },
  { id: "cerebras", name: "Cerebras (fast inference)", envHint: "CEREBRAS_API_KEY", defaultModel: "llama-3.3-70b", category: "Inference" },
  { id: "together", name: "Together AI", envHint: "TOGETHER_AI_API_KEY", defaultModel: "meta-llama/Meta-Llama-3.1-70B-Instruct-Turbo", category: "Inference" },
  { id: "deepinfra", name: "DeepInfra", envHint: "DEEPINFRA_API_KEY", defaultModel: "meta-llama/Meta-Llama-3.1-70B-Instruct", category: "Inference" },
  { id: "fireworks", name: "Fireworks AI", envHint: "FIREWORKS_API_KEY", defaultModel: "accounts/fireworks/models/llama-v3p1-70b-instruct", baseURL: "https://api.fireworks.ai/inference/v1", category: "Inference" },
  // ── Regional / specialized ──
  { id: "moonshot", name: "Moonshot (Kimi)", envHint: "MOONSHOT_API_KEY", defaultModel: "kimi-k2-0711-preview", baseURL: "https://api.moonshot.cn/v1", category: "Regional" },
  { id: "alibaba-cn", name: "Alibaba (Qwen / DashScope)", envHint: "DASHSCOPE_API_KEY", defaultModel: "qwen-plus", baseURL: "https://dashscope.aliyuncs.com/compatible-mode/v1", category: "Regional" },
  { id: "alibaba-coding", name: "Alibaba (Coding Plan)", envHint: "DASHSCOPE_API_KEY", defaultModel: "qwen3-coder-plus", baseURL: "https://coding-intl.dashscope.aliyuncs.com/apps/anthropic/v1", category: "Regional" },
  { id: "zai", name: "z.ai (ZhipuAI / GLM)", envHint: "ZHIPU_API_KEY", defaultModel: "glm-4-flash", baseURL: "https://open.bigmodel.cn/api/paas/v4", category: "Regional" },
  { id: "minimax", name: "MiniMax", envHint: "MINIMAX_API_KEY", defaultModel: "MiniMax-M1", baseURL: "https://api.minimaxi.chat/v1", category: "Regional" },
  // ── Other ──
  { id: "cohere", name: "Cohere", envHint: "COHERE_API_KEY", defaultModel: "command-r-plus", category: "Other" },
  { id: "perplexity", name: "Perplexity", envHint: "PERPLEXITY_API_KEY", defaultModel: "sonar-pro", category: "Other" },
  // ── Local ──
  { id: "ollama", name: "Ollama (local)", envHint: "OLLAMA_HOST", defaultModel: "llama3.1", baseURL: "http://localhost:11434/v1", category: "Local" },
  { id: "lmstudio", name: "LM Studio (local)", envHint: "LMSTUDIO_BASE_URL", defaultModel: "lmstudio-community/Meta-Llama-3.1-8B-Instruct-GGUF", baseURL: "http://localhost:1234/v1", category: "Local" },
  // ── Aggregators ──
  { id: "openrouter", name: "OpenRouter (75+ models)", envHint: "OPENROUTER_API_KEY", defaultModel: "anthropic/claude-sonnet-4", category: "Aggregator" },
]

function createModel(providerId: string, apiKey: string): LanguageModel {
  const provider = PROVIDERS.find((p) => p.id === providerId)!

  // Alibaba Coding Plan uses Anthropic-compatible API
  if (providerId === "alibaba-coding") {
    return createAnthropic({ baseURL: provider.baseURL, apiKey })(provider.defaultModel)
  }

  // Providers with a baseURL use openai-compatible
  if (provider.baseURL) {
    return createOpenAICompatible({ name: providerId, baseURL: provider.baseURL, apiKey })(provider.defaultModel)
  }

  const sdkFactories: Record<string, (opts: { apiKey: string }) => (model: string) => LanguageModel> = {
    anthropic: (o) => createAnthropic(o),
    openai: (o) => createOpenAI(o),
    google: (o) => createGoogleGenerativeAI(o),
    xai: (o) => createXai(o),
    mistral: (o) => createMistral(o),
    groq: (o) => createGroq(o),
    cerebras: (o) => createCerebras(o),
    together: (o) => createTogetherAI(o),
    deepinfra: (o) => createDeepInfra(o),
    cohere: (o) => createCohere(o),
    perplexity: (o) => createPerplexity(o),
    openrouter: (o) => createOpenRouter(o),
  }

  const factory = sdkFactories[providerId]
  if (factory) return factory({ apiKey })(provider.defaultModel)

  throw new Error(`Unknown provider: ${providerId}`)
}

async function validateApiKey(providerId: string, apiKey: string): Promise<boolean> {
  try {
    const model = createModel(providerId, apiKey)
    await generateText({
      model,
      prompt: "Reply with OK",
      maxOutputTokens: 5,
    })
    return true
  } catch {
    return false
  }
}

async function validateTelegramToken(token: string): Promise<{ ok: true; username: string } | { ok: false; error: string }> {
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/getMe`)
    const data = await res.json() as any
    if (data.ok && data.result?.username) {
      return { ok: true, username: data.result.username }
    }
    return { ok: false, error: data.description ?? "Invalid token" }
  } catch (err) {
    return { ok: false, error: String(err) }
  }
}

function cancel(): never {
  prompts.cancel("Setup cancelled.")
  process.exit(0)
}

function unwrap<T>(value: T | symbol): T {
  if (prompts.isCancel(value)) cancel()
  return value as T
}

// The co-creation system prompt
const CO_CREATION_SYSTEM = `You are helping a user set up their autonomous AI agent named "{name}".

Your job is to have a brief, engaging conversation to understand who this agent should be. You need to gather enough information to generate four identity documents:

1. **SOUL.md** — The agent's core identity: personality traits, communication style, values, boundaries, and a stop phrase.
2. **USER.md** — About the owner: who they are, what they care about, how the agent should treat them.
3. **GOALS.md** — The agent's current objectives, priorities, and success criteria.
4. **PLAYBOOK.md** — Standard operating procedures, action templates, and decision frameworks.

## Conversation guidelines

- Ask 2-3 focused questions per turn. Don't overwhelm with too many questions.
- Be conversational, warm, and brief. You're co-creating, not interrogating.
- After 2-4 exchanges (when you have enough context), call the generate_files tool.
- If the user gives short answers, infer reasonable defaults and mention what you assumed.
- The agent name is "{name}" — use it naturally.

## What to ask about (spread across turns)

**Turn 1:** What does the agent do? What's its primary purpose? What personality/vibe should it have?
**Turn 2:** Who are you (the owner)? What should the agent know about you? Any communication preferences?
**Turn 3:** What are the agent's immediate goals? Any specific tasks or ongoing responsibilities?
**If needed, Turn 4:** Any standard procedures, safety boundaries, or things the agent should never do?

## File generation guidelines

When you call generate_files, write complete, production-ready Markdown. Each file should:
- Start with a top-level heading (# Title)
- Use the agent's name naturally
- Be specific and actionable, not generic placeholder text
- SOUL.md should include a "## Stop Phrase" section with a unique phrase the owner can use to halt all autonomous actions
- PLAYBOOK.md should include practical procedures, not abstract principles`

const generateFilesTool = tool({
  description: "Generate the identity files when you have gathered enough information from the user.",
  inputSchema: z.object({
    soul: z.string().describe("Complete SOUL.md content (Markdown)"),
    user: z.string().describe("Complete USER.md content (Markdown)"),
    goals: z.string().describe("Complete GOALS.md content (Markdown)"),
    playbook: z.string().describe("Complete PLAYBOOK.md content (Markdown)"),
  }),
})

interface GeneratedFiles {
  soul: string
  user: string
  goals: string
  playbook: string
}

async function runCoCreation(model: LanguageModel, agentName: string): Promise<GeneratedFiles> {
  const systemPrompt = CO_CREATION_SYSTEM.replaceAll("{name}", agentName)
  const messages: CoreMessage[] = []

  // Initial LLM turn — it asks the first questions
  prompts.log.info(`Starting co-creation with your LLM...${EOL}`)

  let generated: GeneratedFiles | undefined

  for (let turn = 0; turn < 8; turn++) {
    const result = await generateText({
      model,
      system: systemPrompt,
      messages,
      tools: { generate_files: generateFilesTool },
      maxOutputTokens: 4096,
      stopWhen: stepCountIs(2),
    })

    // Check if generate_files was called
    for (const step of result.steps) {
      for (const tc of step.toolCalls) {
        if (tc.toolName === "generate_files") {
          generated = tc.input as GeneratedFiles
        }
      }
    }

    if (generated) {
      // Show final message if there is one
      if (result.text?.trim()) {
        prompts.log.message(result.text.trim())
      }
      break
    }

    // Show LLM's questions
    if (!result.text?.trim()) {
      // LLM produced no text and no tool call — shouldn't happen, but handle gracefully
      prompts.log.warn("LLM produced no response, generating files with defaults...")
      break
    }

    prompts.log.message(result.text.trim())
    messages.push({ role: "assistant", content: result.text })

    // Get user's answer
    const answer = unwrap(
      await prompts.text({
        message: "Your answer:",
        placeholder: "Type your response...",
      }),
    )
    messages.push({ role: "user", content: answer.trim() })
  }

  if (!generated) {
    // Force generation if conversation went too long without tool call
    const forceResult = await generateText({
      model,
      system: systemPrompt,
      messages: [
        ...messages,
        {
          role: "user" as const,
          content: "That's all the info I have. Please generate the files now based on what we discussed.",
        },
      ],
      tools: { generate_files: generateFilesTool },
      maxOutputTokens: 4096,
      stopWhen: stepCountIs(2),
    })

    for (const step of forceResult.steps) {
      for (const tc of step.toolCalls) {
        if (tc.toolName === "generate_files") {
          generated = tc.input as GeneratedFiles
        }
      }
    }
  }

  if (!generated) {
    // Absolute fallback — use minimal defaults
    prompts.log.warn("Could not generate files via LLM. Using defaults.")
    return {
      soul: `# ${agentName}\n\nYou are ${agentName}, an autonomous AI assistant.\n\n## Personality\n\n- Direct, concise, and action-oriented\n- You accomplish tasks iteratively, breaking them down into clear steps\n- You never start messages with "Great", "Certainly", "Okay", "Sure"\n\n## Stop Phrase\n\n"${agentName} stop" — immediately halt all autonomous actions.\n`,
      user: `# About the Owner\n\n<!-- Update this with information about yourself -->\n`,
      goals: `# Goals\n\n<!-- Define your agent's current objectives here -->\n`,
      playbook: `# Playbook\n\n<!-- Define action templates and standard procedures here -->\n`,
    }
  }

  return generated
}

export const SetupCommand = cmd({
  command: "setup",
  describe: "create a new agent instance (interactive wizard)",
  builder: (yargs) =>
    yargs
      .option("dir", {
        type: "string",
        describe: "directory to create .spawnbot/ in (default: current directory)",
      })
      .option("global", {
        type: "boolean",
        describe: "create config in global ~/.config/spawnbot/ instead of .spawnbot/",
      }),
  handler: async (opts) => {
    prompts.intro(UI.logo())

    const isGlobal = opts.global ?? false
    const baseDir = isGlobal
      ? Global.Path.config
      : path.join(opts.dir ?? process.cwd(), ".spawnbot")

    if (fs.existsSync(path.join(baseDir, "SOUL.md"))) {
      const overwrite = unwrap(
        await prompts.confirm({
          message: `SOUL.md already exists in ${baseDir}. Overwrite?`,
        }),
      )
      if (!overwrite) cancel()
    }

    // ── Step 1: LLM Provider ──────────────────────────────────────────
    prompts.log.step("Step 1: Connect an LLM provider")

    const providerId = unwrap(
      await prompts.select({
        message: "Which LLM provider do you want to use?",
        options: PROVIDERS.map((p) => ({
          value: p.id,
          label: p.name,
          hint: p.category === "Local" ? "no API key needed" : p.envHint,
        })),
      }),
    )

    const provider = PROVIDERS.find((p) => p.id === providerId)!
    const isLocal = provider.category === "Local"

    let apiKey: string
    if (isLocal) {
      // Local providers (Ollama, LM Studio) don't need API keys
      apiKey = "local"
      const s = prompts.spinner()
      s.start(`Checking ${provider.name} at ${provider.baseURL}...`)
      const valid = await validateApiKey(providerId, apiKey)
      if (valid) {
        s.stop(`${provider.name} is running!`)
      } else {
        s.stop(`Could not reach ${provider.name} at ${provider.baseURL}`)
        prompts.log.warn("Make sure it's running before starting the daemon. Continuing anyway.")
      }
    } else {
      while (true) {
        apiKey = unwrap(
          await prompts.text({
            message: `Enter your ${provider.name} API key:`,
            placeholder: provider.envHint,
            validate: (v) => {
              if (!v?.trim()) return "API key is required"
            },
          }),
        ).trim()

        const s = prompts.spinner()
        s.start("Validating API key...")
        const valid = await validateApiKey(providerId, apiKey)
        if (valid) {
          s.stop("API key valid!")
          break
        }
        s.stop("API key invalid — could not reach the provider.")
        prompts.log.error("Please check your key and try again.")
      }

      // Save the API key
      await Auth.set(providerId, { type: "api", key: apiKey })
    }
    prompts.log.success(`${provider.name} configured.`)

    // ── Step 2: Agent Name ────────────────────────────────────────────
    prompts.log.step("Step 2: Name your agent")

    const agentName = unwrap(
      await prompts.text({
        message: "What is your agent's name?",
        placeholder: "Spawnbot",
        defaultValue: "Spawnbot",
        validate: (v) => {
          if (!v?.trim()) return "Name is required"
        },
      }),
    ).trim()

    // ── Step 3: LLM Co-Creation ───────────────────────────────────────
    prompts.log.step("Step 3: Co-create your agent's identity")
    prompts.log.info(
      "Your LLM will interview you to craft the agent's personality, goals, and procedures.",
    )

    const model = createModel(providerId, apiKey)
    const s = prompts.spinner()
    s.start("Connecting to LLM...")
    // Quick warmup to fail fast if something's wrong
    try {
      await generateText({ model, prompt: "Hi", maxOutputTokens: 5 })
      s.stop("Connected.")
    } catch (err) {
      s.stop("Connection failed.")
      prompts.log.error(`LLM error: ${err}`)
      prompts.log.warn("Falling back to default templates.")
    }

    const files = await runCoCreation(model, agentName)

    // Show preview
    prompts.log.success("Identity files generated!")
    prompts.log.message(`${UI.Style.TEXT_DIM}── SOUL.md preview ──${UI.Style.TEXT_NORMAL}`)
    // Show first 10 lines
    const soulPreview = files.soul.split("\n").slice(0, 12).join("\n")
    prompts.log.message(soulPreview + (files.soul.split("\n").length > 12 ? "\n..." : ""))

    const acceptFiles = unwrap(
      await prompts.confirm({
        message: "Accept these identity files? (you can edit them later)",
      }),
    )
    if (!acceptFiles) {
      prompts.log.info("You can re-run `spawnbot setup` or edit the files manually.")
      cancel()
    }

    // ── Step 4: Telegram ──────────────────────────────────────────────
    prompts.log.step("Step 4: Telegram integration")

    const wantsTelegram = unwrap(
      await prompts.confirm({
        message: "Set up Telegram? (primary control channel for the agent)",
        initialValue: true,
      }),
    )

    let telegramToken = ""
    let telegramOwner = ""
    let botUsername = ""
    let ngrokToken = ""
    let ngrokDomain = ""

    if (wantsTelegram) {
      // Token
      while (true) {
        telegramToken = unwrap(
          await prompts.text({
            message: "Telegram Bot Token (from @BotFather):",
            validate: (v) => {
              if (!v?.trim()) return "Token is required"
            },
          }),
        ).trim()

        const ts = prompts.spinner()
        ts.start("Validating token...")
        const result = await validateTelegramToken(telegramToken)
        if (result.ok) {
          botUsername = result.username
          ts.stop(`Valid! Bot: @${botUsername}`)
          break
        }
        ts.stop(`Invalid: ${result.error}`)
        prompts.log.error("Please check your token and try again.")
      }

      // Owner chat ID
      prompts.log.info(
        `To find your Chat ID: message @${botUsername}, then open https://api.telegram.org/bot${telegramToken}/getUpdates`,
      )
      prompts.log.info(
        "Look for \"chat\":{\"id\":YOUR_ID} in the response. Or message @userinfobot on Telegram.",
      )

      telegramOwner = unwrap(
        await prompts.text({
          message: "Your Telegram Chat ID (numeric):",
          validate: (v) => {
            if (!v?.trim()) return "Chat ID is required"
            if (!/^\d+$/.test(v!.trim())) return "Chat ID must be a number"
          },
        }),
      ).trim()

      // ngrok
      const wantsNgrok = unwrap(
        await prompts.confirm({
          message: "Use ngrok for webhook mode? (faster than long polling, requires free ngrok account)",
          initialValue: false,
        }),
      )

      if (wantsNgrok) {
        ngrokToken = unwrap(
          await prompts.text({
            message: "ngrok authtoken:",
            validate: (v) => {
              if (!v?.trim()) return "ngrok token is required"
            },
          }),
        ).trim()

        ngrokDomain = unwrap(
          await prompts.text({
            message: "ngrok fixed domain (optional, skip for random URL):",
            placeholder: "skip",
          }),
        ).trim()
      }
    }

    // ── Step 5: OpenAI API (Whisper + Embeddings) ────────────────────
    let openaiKeyForServices = ""

    const needsOpenAIKey = providerId !== "openai" // already have it if OpenAI is the main provider
    if (needsOpenAIKey) {
      const wantsOpenAI = unwrap(
        await prompts.confirm({
          message: "Add OpenAI API key? (enables voice transcription via Whisper + semantic memory via embeddings)",
          initialValue: true,
        }),
      )

      if (wantsOpenAI) {
        openaiKeyForServices = unwrap(
          await prompts.text({
            message: "OpenAI API key:",
            placeholder: "sk-...",
            validate: (v) => {
              if (!v?.trim()) return "API key is required"
            },
          }),
        ).trim()
      }
    } else {
      openaiKeyForServices = apiKey
      prompts.log.success("OpenAI key will be used for Whisper transcription and memory embeddings.")
    }

    // ── Step 6: Gemini Safety Filters (Google only) ─────────────────────
    type SafetyLevel = "default" | "none" | "low"
    let geminiSafety: SafetyLevel = "default"

    if (providerId === "google") {
      prompts.log.step("Step 6: Gemini safety filters")
      prompts.log.info(
        "Google's Gemini models have built-in safety filters that can block responses on certain topics.",
      )

      geminiSafety = unwrap(
        await prompts.select({
          message: "How should safety filters be configured?",
          options: [
            { value: "default" as SafetyLevel, label: "Default", hint: "Google's standard filtering (recommended for most users)" },
            { value: "low" as SafetyLevel, label: "Low blocking", hint: "only block high-probability harmful content" },
            { value: "none" as SafetyLevel, label: "No filtering", hint: "disable all safety filters (autonomous agents may need this)" },
          ],
        }),
      )

      if (geminiSafety !== "default") {
        prompts.log.success(`Safety filters: ${geminiSafety === "none" ? "disabled" : "low blocking"}`)
      }
    }

    // ── Step 7: Cron jobs ─────────────────────────────────────────────
    const wantsCrons = unwrap(
      await prompts.confirm({
        message: "Create a CRONS.yaml template for scheduled tasks?",
        initialValue: false,
      }),
    )

    // ── Step 8: Autostart ───────────────────────────────────────────────
    prompts.log.step("Step 8: How should the agent run?")

    type RunMode = "manual" | "systemd" | "launchd"
    const platform = os.platform()
    const runOptions: Array<{ value: RunMode; label: string; hint?: string }> = [
      { value: "manual", label: "Manual", hint: "run `spawnbot daemon` yourself" },
    ]

    if (platform === "linux") {
      runOptions.push({
        value: "systemd",
        label: "Systemd service",
        hint: "auto-starts on boot, restarts on crash",
      })
    } else if (platform === "darwin") {
      runOptions.push({
        value: "launchd",
        label: "Launchd agent",
        hint: "auto-starts on login, restarts on crash",
      })
    }

    let runMode: RunMode = "manual"
    if (runOptions.length > 1) {
      runMode = unwrap(
        await prompts.select({
          message: "How should the daemon run?",
          options: runOptions,
        }),
      )
    } else {
      prompts.log.info("Only manual mode available on this platform.")
    }

    // ── Step 9: Optional skills ─────────────────────────────────────────
    prompts.log.step("Step 9: Install optional skills")
    prompts.log.info(
      "Skills teach your agent how to use external services. It will create its own tools when needed.",
    )

    const OPTIONAL_SKILLS = [
      { value: "image-generation", label: "Image Generation (fal.ai)", hint: "generate images via fal.ai API" },
      { value: "text-to-speech", label: "Text-to-Speech (Cartesia)", hint: "generate voice audio via Cartesia Sonic 3" },
      { value: "gmail", label: "Gmail (IMAP/SMTP)", hint: "read, send, reply, search email" },
      { value: "google-calendar", label: "Google Calendar (CalDAV)", hint: "manage calendar events" },
      { value: "x-twitter", label: "X/Twitter (tweepy)", hint: "post tweets, check mentions, DMs" },
      { value: "reddit", label: "Reddit (PRAW)", hint: "post, comment, search subreddits" },
      { value: "moltbook", label: "Moltbook", hint: "social network for AI agents" },
    ] as const

    const selectedSkills = unwrap(
      await prompts.multiselect({
        message: "Which skills should your agent have? (space to toggle, enter to confirm)",
        options: OPTIONAL_SKILLS.map((s) => ({
          value: s.value,
          label: s.label,
          hint: s.hint,
        })),
        required: false,
      }),
    ) as string[]

    // ── Step 10: Agent model configuration ─────────────────────────────
    interface AgentModelConfig {
      [agentName: string]: { providerID: string; modelID: string }
    }
    let agentModels: AgentModelConfig = {}

    const wantsAgentModels = unwrap(
      await prompts.confirm({
        message: "Configure different models for subagents? (e.g., cheap model for exploration, strong model for coding)",
        initialValue: false,
      }),
    )

    if (wantsAgentModels) {
      prompts.log.info(
        "The main agent uses your selected provider. You can assign different models to specific roles.",
      )
      prompts.log.info(
        `Current default: ${provider.name} / ${provider.defaultModel}`,
      )

      const agentRoles = [
        { name: "coder", label: "Coder", hint: "code implementation and file editing — your strongest coding model" },
        { name: "explore", label: "Explorer", hint: "codebase search and file reading — can use a fast/cheap model" },
        { name: "general", label: "General subagent", hint: "delegated subtasks — can use a different model" },
        { name: "compaction", label: "Compaction", hint: "context summarization — can use a cheap model" },
        { name: "title", label: "Title generation", hint: "session naming — can use a tiny model" },
      ]

      for (const role of agentRoles) {
        const configure = unwrap(
          await prompts.confirm({
            message: `Configure model for ${role.label}? (${role.hint})`,
            initialValue: false,
          }),
        )
        if (!configure) continue

        const roleProvider = unwrap(
          await prompts.select({
            message: `Provider for ${role.label}:`,
            options: PROVIDERS.map((p) => ({
              value: p.id,
              label: p.name,
              hint: p.id === providerId ? "current default" : undefined,
            })),
            initialValue: providerId,
          }),
        )

        const rp = PROVIDERS.find((p) => p.id === roleProvider)!
        const roleModel = unwrap(
          await prompts.text({
            message: `Model ID for ${role.label}:`,
            defaultValue: rp.defaultModel,
            placeholder: rp.defaultModel,
          }),
        ).trim()

        agentModels[role.name] = { providerID: roleProvider, modelID: roleModel }
        prompts.log.success(`${role.label}: ${rp.name} / ${roleModel}`)
      }
    }

    // ── Write files ───────────────────────────────────────────────────
    fs.mkdirSync(baseDir, { recursive: true })

    const ws = prompts.spinner()
    ws.start("Writing config files...")

    // Identity files
    fs.writeFileSync(path.join(baseDir, "SOUL.md"), files.soul)
    fs.writeFileSync(path.join(baseDir, "USER.md"), files.user)
    fs.writeFileSync(path.join(baseDir, "GOALS.md"), files.goals)
    fs.writeFileSync(path.join(baseDir, "PLAYBOOK.md"), files.playbook)

    // .env
    const envLines: string[] = []
    if (telegramToken) {
      envLines.push(
        `TELEGRAM_BOT_TOKEN=${telegramToken}`,
        `TELEGRAM_OWNER_ID=${telegramOwner}`,
      )
      if (ngrokToken) {
        envLines.push(`NGROK_AUTHTOKEN=${ngrokToken}`)
        if (ngrokDomain) {
          envLines.push(`NGROK_DOMAIN=${ngrokDomain}`)
        }
      }
    }
    if (openaiKeyForServices) {
      envLines.push(`OPENAI_API_KEY=${openaiKeyForServices}`)
    }
    if (envLines.length > 0) {
      envLines.push("")
      fs.writeFileSync(path.join(baseDir, ".env"), envLines.join(EOL))
    }

    // CRONS.yaml
    if (wantsCrons) {
      fs.writeFileSync(
        path.join(baseDir, "CRONS.yaml"),
        [
          "# Scheduled jobs — each fires a prompt on a cron schedule",
          "#",
          "# - name: morning-check",
          "#   schedule: \"0 9 * * *\"",
          "#   prompt: \"Check notifications and summarize what's new\"",
          "#   priority: normal",
          "",
        ].join(EOL),
      )
    }

    // Copy selected skills from builtin to .spawnbot/skills/
    if (selectedSkills.length > 0) {
      const builtinDir = path.join(path.dirname(new URL(import.meta.url).pathname), "..", "..", "skill", "builtin")
      const skillsDir = path.join(baseDir, "skills")
      for (const skillName of selectedSkills) {
        const srcDir = path.join(builtinDir, skillName)
        const destDir = path.join(skillsDir, skillName)
        fs.mkdirSync(destDir, { recursive: true })
        const skillFile = path.join(srcDir, "SKILL.md")
        if (fs.existsSync(skillFile)) {
          fs.copyFileSync(skillFile, path.join(destDir, "SKILL.md"))
        }
      }
    }

    // spawnbot.json — config with model, agent overrides, and schema
    const modelConfig: Record<string, any> = { providerID: providerId, modelID: provider.defaultModel }

    // Gemini safety filter options
    if (geminiSafety !== "default") {
      const threshold = geminiSafety === "none" ? "BLOCK_NONE" : "BLOCK_ONLY_HIGH"
      modelConfig.options = {
        safetySettings: [
          { category: "HARM_CATEGORY_HARASSMENT", threshold },
          { category: "HARM_CATEGORY_HATE_SPEECH", threshold },
          { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold },
          { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold },
          { category: "HARM_CATEGORY_CIVIC_INTEGRITY", threshold },
        ],
      }
    }

    const config: Record<string, any> = {
      $schema: "https://opencode.ai/config.json",
      model: modelConfig,
    }

    // Alibaba Coding Plan needs a custom provider block with Anthropic SDK + model definitions
    if (providerId === "alibaba-coding") {
      config.provider = {
        "alibaba-coding": {
          npm: "@ai-sdk/anthropic",
          name: "Alibaba Coding Plan",
          options: {
            baseURL: "https://coding-intl.dashscope.aliyuncs.com/apps/anthropic/v1",
          },
          models: {
            "qwen3-coder-plus": {
              name: "Qwen3 Coder Plus",
              modalities: { input: ["text"], output: ["text"] },
              limit: { context: 1000000, output: 65536 },
            },
            "qwen3-coder-next": {
              name: "Qwen3 Coder Next",
              modalities: { input: ["text"], output: ["text"] },
              limit: { context: 262144, output: 65536 },
            },
            "qwen3.5-plus": {
              name: "Qwen3.5 Plus",
              modalities: { input: ["text", "image"], output: ["text"] },
              options: { thinking: { type: "enabled", budgetTokens: 8192 } },
              limit: { context: 1000000, output: 65536 },
            },
            "qwen3-max-2026-01-23": {
              name: "Qwen3 Max",
              modalities: { input: ["text"], output: ["text"] },
              limit: { context: 262144, output: 32768 },
            },
            "kimi-k2.5": {
              name: "Kimi K2.5",
              modalities: { input: ["text", "image"], output: ["text"] },
              options: { thinking: { type: "enabled", budgetTokens: 8192 } },
              limit: { context: 262144, output: 32768 },
            },
            "MiniMax-M2.5": {
              name: "MiniMax M2.5",
              modalities: { input: ["text"], output: ["text"] },
              options: { thinking: { type: "enabled", budgetTokens: 8192 } },
              limit: { context: 204800, output: 131072 },
            },
            "glm-5": {
              name: "GLM-5",
              modalities: { input: ["text"], output: ["text"] },
              options: { thinking: { type: "enabled", budgetTokens: 8192 } },
              limit: { context: 202752, output: 16384 },
            },
          },
        },
      }
    }
    if (Object.keys(agentModels).length > 0) {
      config.agent = {}
      for (const [name, model] of Object.entries(agentModels)) {
        config.agent[name] = { model }
      }
    }
    fs.writeFileSync(
      path.join(baseDir, "spawnbot.json"),
      JSON.stringify(config, null, 2) + "\n",
    )

    ws.stop("Config files written.")

    // ── Install service if requested ──────────────────────────────────
    let serviceInstalled = false

    if (runMode === "systemd") {
      serviceInstalled = await installSystemdService(baseDir, agentName)
    } else if (runMode === "launchd") {
      serviceInstalled = await installLaunchdAgent(baseDir, agentName)
    }

    // ── Summary ───────────────────────────────────────────────────────
    const createdFiles = ["SOUL.md", "USER.md", "GOALS.md", "PLAYBOOK.md", "spawnbot.json"]
    if (envLines.length > 0) createdFiles.push(".env")
    if (wantsCrons) createdFiles.push("CRONS.yaml")

    prompts.note(
      [
        `Agent: ${agentName}`,
        `Provider: ${provider.name}`,
        `Location: ${baseDir}`,
        telegramToken ? `Telegram: @${botUsername}` : "Telegram: not configured",
        openaiKeyForServices ? "Whisper + Embeddings: enabled" : "Whisper + Embeddings: not configured",
        geminiSafety !== "default"
          ? `Gemini safety: ${geminiSafety === "none" ? "disabled" : "low blocking"}`
          : providerId === "google"
            ? "Gemini safety: default"
            : undefined,
        selectedSkills.length > 0
          ? `Skills: ${selectedSkills.join(", ")}`
          : "Skills: none (built-in defaults only)",
        Object.keys(agentModels).length > 0
          ? `Agent models: ${Object.entries(agentModels).map(([k, v]) => `${k}=${v.modelID}`).join(", ")}`
          : "Agent models: all using default",
        `Run mode: ${runMode}${serviceInstalled ? " (installed)" : ""}`,
        "",
        "Files created:",
        ...createdFiles.map((f) => `  ${f}`),
      ].filter(Boolean).join(EOL),
      "Setup complete",
    )

    if (!telegramToken) {
      prompts.log.warn(
        "No Telegram configured. Run `spawnbot setup` again or add TELEGRAM_BOT_TOKEN to .env.",
      )
    }
    if (!openaiKeyForServices) {
      prompts.log.info(
        "OpenAI API not configured. Add OPENAI_API_KEY to .env to enable Whisper transcription and semantic memory.",
      )
    }

    prompts.log.info("Edit the generated files anytime — they're just Markdown.")
    if (serviceInstalled) {
      prompts.outro("Your agent is installed as a service and will start automatically.")
    } else {
      prompts.outro("Run `spawnbot daemon` to start your agent.")
    }
  },
})

async function installSystemdService(workDir: string, agentName: string): Promise<boolean> {
  const serviceName = `spawnbot-${agentName.toLowerCase().replace(/[^a-z0-9]/g, "-")}`
  const serviceDir = path.join(os.homedir(), ".config", "systemd", "user")
  const servicePath = path.join(serviceDir, `${serviceName}.service`)
  const execPath = process.execPath

  const unit = [
    "[Unit]",
    `Description=Spawnbot daemon: ${agentName}`,
    "After=network-online.target",
    "Wants=network-online.target",
    "",
    "[Service]",
    "Type=simple",
    `ExecStart=${execPath} daemon --directory ${workDir}`,
    `WorkingDirectory=${workDir}`,
    "Restart=on-failure",
    "RestartSec=10",
    `Environment=HOME=${os.homedir()}`,
    "",
    "[Install]",
    "WantedBy=default.target",
    "",
  ].join("\n")

  try {
    fs.mkdirSync(serviceDir, { recursive: true })
    fs.writeFileSync(servicePath, unit)
    prompts.log.success(`Systemd service written to ${servicePath}`)

    const { $ } = await import("bun")

    // Reload systemd and enable the service
    await $`systemctl --user daemon-reload`.quiet().nothrow()
    const enable = await $`systemctl --user enable ${serviceName}`.quiet().nothrow()
    if (enable.exitCode !== 0) {
      prompts.log.warn("Could not enable service automatically.")
      prompts.log.info(`  Run: systemctl --user enable ${serviceName}`)
      prompts.log.info(`  Run: systemctl --user start ${serviceName}`)
      return false
    }

    const start = await $`systemctl --user start ${serviceName}`.quiet().nothrow()
    if (start.exitCode !== 0) {
      prompts.log.warn("Service enabled but could not start. Check with:")
      prompts.log.info(`  systemctl --user status ${serviceName}`)
      return true
    }

    // Enable lingering so service runs even when user is not logged in
    await $`loginctl enable-linger ${os.userInfo().username}`.quiet().nothrow()

    prompts.log.success(`Service ${serviceName} started and enabled on boot.`)
    prompts.log.info(`  Status: systemctl --user status ${serviceName}`)
    prompts.log.info(`  Logs:   journalctl --user -u ${serviceName} -f`)
    prompts.log.info(`  Stop:   systemctl --user stop ${serviceName}`)
    return true
  } catch (err) {
    prompts.log.error(`Failed to install systemd service: ${err}`)
    return false
  }
}

async function installLaunchdAgent(workDir: string, agentName: string): Promise<boolean> {
  const label = `com.spawnbot.${agentName.toLowerCase().replace(/[^a-z0-9]/g, "-")}`
  const agentDir = path.join(os.homedir(), "Library", "LaunchAgents")
  const plistPath = path.join(agentDir, `${label}.plist`)
  const execPath = process.execPath
  const logDir = path.join(os.homedir(), "Library", "Logs", "spawnbot")

  const plist = [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">`,
    `<plist version="1.0">`,
    `<dict>`,
    `  <key>Label</key>`,
    `  <string>${label}</string>`,
    `  <key>ProgramArguments</key>`,
    `  <array>`,
    `    <string>${execPath}</string>`,
    `    <string>daemon</string>`,
    `    <string>--directory</string>`,
    `    <string>${workDir}</string>`,
    `  </array>`,
    `  <key>WorkingDirectory</key>`,
    `  <string>${workDir}</string>`,
    `  <key>RunAtLoad</key>`,
    `  <true/>`,
    `  <key>KeepAlive</key>`,
    `  <dict>`,
    `    <key>SuccessfulExit</key>`,
    `    <false/>`,
    `  </dict>`,
    `  <key>StandardOutPath</key>`,
    `  <string>${logDir}/stdout.log</string>`,
    `  <key>StandardErrorPath</key>`,
    `  <string>${logDir}/stderr.log</string>`,
    `  <key>EnvironmentVariables</key>`,
    `  <dict>`,
    `    <key>HOME</key>`,
    `    <string>${os.homedir()}</string>`,
    `  </dict>`,
    `</dict>`,
    `</plist>`,
    ``,
  ].join("\n")

  try {
    fs.mkdirSync(agentDir, { recursive: true })
    fs.mkdirSync(logDir, { recursive: true })
    fs.writeFileSync(plistPath, plist)
    prompts.log.success(`Launchd agent written to ${plistPath}`)

    const { $ } = await import("bun")
    const load = await $`launchctl load ${plistPath}`.quiet().nothrow()
    if (load.exitCode !== 0) {
      prompts.log.warn("Could not load agent automatically.")
      prompts.log.info(`  Run: launchctl load ${plistPath}`)
      return false
    }

    prompts.log.success(`Agent ${label} loaded and will start on login.`)
    prompts.log.info(`  Status: launchctl list | grep ${label}`)
    prompts.log.info(`  Logs:   tail -f ${logDir}/stdout.log`)
    prompts.log.info(`  Stop:   launchctl unload ${plistPath}`)
    return true
  } catch (err) {
    prompts.log.error(`Failed to install launchd agent: ${err}`)
    return false
  }
}
