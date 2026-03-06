import { cmd } from "./cmd"
import * as prompts from "@clack/prompts"
import { UI } from "../ui"
import path from "path"
import fs from "fs"
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

    // ── Step 5: Voice Transcription (Whisper) ────────────────────────
    let openaiKeyForWhisper = ""

    if (wantsTelegram) {
      const wantsWhisper = unwrap(
        await prompts.confirm({
          message: "Enable voice message transcription? (uses OpenAI Whisper API)",
          initialValue: true,
        }),
      )

      if (wantsWhisper) {
        // If they already chose OpenAI as their main provider, reuse the key
        if (providerId === "openai") {
          openaiKeyForWhisper = apiKey
          prompts.log.success("Using your existing OpenAI API key for Whisper.")
        } else {
          openaiKeyForWhisper = unwrap(
            await prompts.text({
              message: "OpenAI API key for Whisper (voice transcription):",
              placeholder: "sk-...",
              validate: (v) => {
                if (!v?.trim()) return "API key is required"
              },
            }),
          ).trim()
        }
      }
    }

    // ── Step 6: Cron jobs ─────────────────────────────────────────────
    const wantsCrons = unwrap(
      await prompts.confirm({
        message: "Create a CRONS.yaml template for scheduled tasks?",
        initialValue: false,
      }),
    )

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
    if (openaiKeyForWhisper && providerId !== "openai") {
      envLines.push(`OPENAI_API_KEY=${openaiKeyForWhisper}`)
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

    ws.stop("Config files written.")

    // ── Summary ───────────────────────────────────────────────────────
    const createdFiles = ["SOUL.md", "USER.md", "GOALS.md", "PLAYBOOK.md"]
    if (envLines.length > 0) createdFiles.push(".env")
    if (wantsCrons) createdFiles.push("CRONS.yaml")

    prompts.note(
      [
        `Agent: ${agentName}`,
        `Provider: ${provider.name}`,
        `Location: ${baseDir}`,
        telegramToken ? `Telegram: @${botUsername}` : "Telegram: not configured",
        openaiKeyForWhisper ? "Whisper: enabled" : "Whisper: not configured",
        "",
        "Files created:",
        ...createdFiles.map((f) => `  ${f}`),
      ].join(EOL),
      "Setup complete",
    )

    if (!telegramToken) {
      prompts.log.warn(
        "No Telegram configured. Run `spawnbot setup` again or add TELEGRAM_BOT_TOKEN to .env.",
      )
    } else if (!openaiKeyForWhisper) {
      prompts.log.info(
        "Voice transcription not enabled. Add OPENAI_API_KEY to .env to enable Whisper.",
      )
    }

    prompts.log.info("Edit the generated files anytime — they're just Markdown.")
    prompts.outro("Run `spawnbot daemon` to start your agent.")
  },
})
