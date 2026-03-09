import { cmd } from "./cmd"
import * as prompts from "@clack/prompts"
import { UI } from "../ui"
import { Auth } from "../../auth"
import { ModelsDev } from "../../provider/models"
import { map, pipe, sortBy, values } from "remeda"
import fs from "fs"
import path from "path"

export const ConfigCommand = cmd({
  command: "config",
  describe: "configure API keys, Telegram, ngrok, and other settings",
  builder: (yargs) =>
    yargs.option("directory", {
      type: "string",
      describe: "workspace directory",
      default: process.env.SPAWNBOT_ORIGINAL_CWD ?? process.cwd(),
    }),
  handler: async (args) => {
    const workspace = args.directory as string

    UI.empty()
    prompts.intro(UI.logo() + "  configuration")

    // --- Section 1: LLM Provider ---
    await configureProvider()

    // --- Section 2: Telegram ---
    await configureTelegram(workspace)

    // --- Section 3: ngrok ---
    await configureNgrok(workspace)

    // --- Section 4: OpenAI (Whisper) ---
    await configureOpenAI(workspace)

    prompts.outro("Configuration complete. Run `spawnbot` to start.")
  },
})

/** Add or update a key=value line in a .env file */
function setEnvValue(envPath: string, key: string, value: string) {
  fs.mkdirSync(path.dirname(envPath), { recursive: true })

  if (fs.existsSync(envPath)) {
    const content = fs.readFileSync(envPath, "utf-8")
    const lines = content.split("\n")
    const idx = lines.findIndex((l) => l.startsWith(`${key}=`))
    if (idx >= 0) {
      lines[idx] = `${key}=${value}`
      fs.writeFileSync(envPath, lines.join("\n"))
      return
    }
    // Append
    const needsNewline = content.length > 0 && !content.endsWith("\n")
    fs.appendFileSync(envPath, `${needsNewline ? "\n" : ""}${key}=${value}\n`)
  } else {
    fs.writeFileSync(envPath, `${key}=${value}\n`)
  }
}

/** Read existing value from .env file */
function getEnvValue(envPath: string, key: string): string | undefined {
  if (!fs.existsSync(envPath)) return undefined
  const content = fs.readFileSync(envPath, "utf-8")
  for (const line of content.split("\n")) {
    const trimmed = line.trim()
    if (trimmed.startsWith(`${key}=`)) {
      return trimmed.slice(key.length + 1).trim()
    }
  }
  return undefined
}

async function configureProvider() {
  const existing = await Auth.all()
  if (Object.keys(existing).length > 0) {
    const database = await ModelsDev.get().catch(() => ({} as Record<string, any>))
    const names = Object.keys(existing).map((id) => database[id]?.name ?? id).join(", ")
    prompts.log.info(`LLM provider already configured: ${names}`)

    const reconfigure = await prompts.confirm({
      message: "Add another provider?",
      initialValue: false,
    })
    if (prompts.isCancel(reconfigure) || !reconfigure) return
  }

  await ModelsDev.refresh().catch(() => {})
  const providers = await ModelsDev.get()

  const priority: Record<string, number> = {
    anthropic: 0,
    google: 1,
    openai: 2,
    openrouter: 3,
  }

  let provider = await prompts.autocomplete({
    message: "Select LLM provider",
    maxItems: 8,
    options: [
      ...pipe(
        providers,
        values(),
        sortBy(
          (x) => priority[x.id] ?? 99,
          (x) => x.name ?? x.id,
        ),
        map((x) => ({
          label: x.name,
          value: x.id,
          hint: {
            anthropic: "Claude — recommended",
            google: "Gemini",
            openai: "GPT / o-series",
            openrouter: "multi-provider gateway",
          }[x.id],
        })),
      ),
      {
        value: "other",
        label: "Other",
      },
    ],
  })
  if (prompts.isCancel(provider)) return

  if (provider === "other") {
    provider = await prompts.text({
      message: "Enter provider id",
      validate: (x) => (x && x.match(/^[0-9a-z-]+$/) ? undefined : "a-z, 0-9 and hyphens only"),
    })
    if (prompts.isCancel(provider)) return
  }

  const key = await prompts.password({
    message: "Enter your API key",
    validate: (x) => (x && x.length > 0 ? undefined : "Required"),
  })
  if (prompts.isCancel(key)) return

  await Auth.set(provider, { type: "api", key })
  prompts.log.success(`${providers[provider]?.name ?? provider} configured`)
}

async function configureTelegram(workspace: string) {
  const envPath = path.join(workspace, ".env")
  const existingToken = getEnvValue(envPath, "TELEGRAM_BOT_TOKEN")

  if (existingToken) {
    prompts.log.info("Telegram already configured")
    const reconfigure = await prompts.confirm({
      message: "Reconfigure Telegram?",
      initialValue: false,
    })
    if (prompts.isCancel(reconfigure) || !reconfigure) return
  } else {
    const setup = await prompts.confirm({
      message: "Set up Telegram integration?",
      initialValue: true,
    })
    if (prompts.isCancel(setup) || !setup) return
  }

  const token = await prompts.text({
    message: "Telegram Bot Token (from @BotFather)",
    validate: (x) => {
      if (!x || x.length === 0) return "Required"
      if (!x.includes(":")) return "Invalid format — should be like 123456:ABC-DEF"
      return undefined
    },
  })
  if (prompts.isCancel(token)) return

  // Validate the token
  const spinner = prompts.spinner()
  spinner.start("Validating token...")
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/getMe`)
    const data = (await res.json()) as any
    if (!data.ok) {
      spinner.stop("Invalid token — Telegram API rejected it", 1)
      return
    }
    spinner.stop(`Bot verified: @${data.result.username}`)
  } catch (err) {
    spinner.stop(`Could not reach Telegram API: ${err instanceof Error ? err.message : String(err)}`, 1)
    return
  }

  const chatId = await prompts.text({
    message: "Your Telegram Chat ID (numeric — message @userinfobot to get it)",
    validate: (x) => {
      if (!x || x.length === 0) return "Required"
      if (!/^-?\d+$/.test(x.trim())) return "Must be a number"
      return undefined
    },
  })
  if (prompts.isCancel(chatId)) return

  setEnvValue(envPath, "TELEGRAM_BOT_TOKEN", token)
  setEnvValue(envPath, "TELEGRAM_OWNER_ID", chatId.trim())
  prompts.log.success("Telegram configured")
}

async function configureNgrok(workspace: string) {
  const envPath = path.join(workspace, ".env")
  const existingToken = getEnvValue(envPath, "NGROK_AUTHTOKEN")

  if (existingToken) {
    prompts.log.info("ngrok already configured")
    return
  }

  const setup = await prompts.confirm({
    message: "Set up ngrok tunnel? (needed for Telegram webhook mode)",
    initialValue: false,
  })
  if (prompts.isCancel(setup) || !setup) return

  const authtoken = await prompts.text({
    message: "ngrok authtoken (from dashboard.ngrok.com)",
    validate: (x) => (x && x.length > 0 ? undefined : "Required"),
  })
  if (prompts.isCancel(authtoken)) return

  setEnvValue(envPath, "NGROK_AUTHTOKEN", authtoken)

  const domain = await prompts.text({
    message: "ngrok custom domain (optional — press Enter to skip)",
  })
  if (!prompts.isCancel(domain) && domain && domain.trim()) {
    setEnvValue(envPath, "NGROK_DOMAIN", domain.trim())
  }

  prompts.log.success("ngrok configured")
}

async function configureOpenAI(workspace: string) {
  const envPath = path.join(workspace, ".env")
  const existingKey = getEnvValue(envPath, "OPENAI_API_KEY")

  if (existingKey) {
    prompts.log.info("OpenAI API key already configured")
    return
  }

  const setup = await prompts.confirm({
    message: "Add OpenAI API key? (used for Whisper voice transcription)",
    initialValue: false,
  })
  if (prompts.isCancel(setup) || !setup) return

  const key = await prompts.password({
    message: "OpenAI API key",
    validate: (x) => (x && x.length > 0 ? undefined : "Required"),
  })
  if (prompts.isCancel(key)) return

  setEnvValue(envPath, "OPENAI_API_KEY", key)
  prompts.log.success("OpenAI API key configured")
}
