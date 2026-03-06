import { cmd } from "./cmd"
import * as prompts from "@clack/prompts"
import { UI } from "../ui"
import path from "path"
import fs from "fs"
import { Global } from "../../global"
import { EOL } from "os"

const DEFAULT_SOUL = `# {name}

You are {name}, an autonomous AI assistant.

## Personality

- Direct, concise, and action-oriented
- You accomplish tasks iteratively, breaking them down into clear steps
- You never start messages with "Great", "Certainly", "Okay", "Sure"
- You never end with questions or requests for further conversation

## Voice

- Casual but competent
- Short sentences, no filler words
- Match the user's language and energy
`

export const SetupCommand = cmd({
  command: "setup",
  describe: "create a new agent instance",
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
      const overwrite = await prompts.confirm({
        message: `SOUL.md already exists in ${baseDir}. Overwrite?`,
      })
      if (prompts.isCancel(overwrite) || !overwrite) {
        prompts.cancel("Setup cancelled.")
        process.exit(0)
      }
    }

    // Agent name
    const name = await prompts.text({
      message: "What is your agent's name?",
      placeholder: "Spawnbot",
      defaultValue: "Spawnbot",
      validate: (v) => {
        if (!v?.trim()) return "Name is required"
      },
    })
    if (prompts.isCancel(name)) {
      prompts.cancel("Setup cancelled.")
      process.exit(0)
    }

    // Telegram bot token
    const telegramToken = await prompts.text({
      message: "Telegram Bot Token (from @BotFather)",
      placeholder: "skip to set up later",
    })
    if (prompts.isCancel(telegramToken)) {
      prompts.cancel("Setup cancelled.")
      process.exit(0)
    }

    let telegramOwner: string | symbol = ""
    let ngrokToken: string | symbol = ""
    let ngrokDomain: string | symbol = ""
    if (telegramToken?.trim()) {
      telegramOwner = await prompts.text({
        message: "Your Telegram Chat ID (for owner verification)",
        placeholder: "e.g. 123456789",
        validate: (v) => {
          if (!v?.trim()) return "Chat ID is required when using Telegram"
          if (!/^\d+$/.test(v!.trim())) return "Chat ID must be a number"
        },
      })
      if (prompts.isCancel(telegramOwner)) {
        prompts.cancel("Setup cancelled.")
        process.exit(0)
      }

      // ngrok for webhook mode
      ngrokToken = await prompts.text({
        message: "ngrok authtoken (for webhook mode, skip for long polling)",
        placeholder: "skip to use long polling",
      })
      if (prompts.isCancel(ngrokToken)) {
        prompts.cancel("Setup cancelled.")
        process.exit(0)
      }

      if ((ngrokToken as string)?.trim()) {
        ngrokDomain = await prompts.text({
          message: "ngrok fixed domain (optional, requires paid plan)",
          placeholder: "skip for random URL",
        })
        if (prompts.isCancel(ngrokDomain)) {
          prompts.cancel("Setup cancelled.")
          process.exit(0)
        }
      }
    }

    // Optional docs
    const extras = await prompts.multiselect({
      message: "Create optional knowledge files?",
      options: [
        { value: "goals", label: "GOALS.md", hint: "objectives and targets" },
        { value: "playbook", label: "PLAYBOOK.md", hint: "action templates" },
        { value: "user", label: "USER.md", hint: "about the owner" },
        { value: "crons", label: "CRONS.yaml", hint: "scheduled jobs" },
      ],
      required: false,
    })
    if (prompts.isCancel(extras)) {
      prompts.cancel("Setup cancelled.")
      process.exit(0)
    }

    // Create directory
    fs.mkdirSync(baseDir, { recursive: true })

    const s = prompts.spinner()
    s.start("Writing config files...")

    // Write SOUL.md
    const soulContent = DEFAULT_SOUL.replaceAll("{name}", name.trim())
    fs.writeFileSync(path.join(baseDir, "SOUL.md"), soulContent)

    // Write .env if Telegram configured
    if (telegramToken?.trim()) {
      const envPath = path.join(baseDir, ".env")
      const envLines = [
        `TELEGRAM_BOT_TOKEN=${telegramToken.trim()}`,
        `TELEGRAM_OWNER_ID=${(telegramOwner as string).trim()}`,
      ]
      if ((ngrokToken as string)?.trim()) {
        envLines.push(`NGROK_AUTHTOKEN=${(ngrokToken as string).trim()}`)
        if ((ngrokDomain as string)?.trim()) {
          envLines.push(`NGROK_DOMAIN=${(ngrokDomain as string).trim()}`)
        }
      }
      envLines.push("")
      fs.writeFileSync(envPath, envLines.join(EOL))
    }

    // Write optional files
    const selected = extras as string[]

    if (selected.includes("goals")) {
      fs.writeFileSync(
        path.join(baseDir, "GOALS.md"),
        `# Goals${EOL}${EOL}<!-- Define your agent's current objectives here -->${EOL}`,
      )
    }

    if (selected.includes("playbook")) {
      fs.writeFileSync(
        path.join(baseDir, "PLAYBOOK.md"),
        `# Playbook${EOL}${EOL}<!-- Define action templates and standard procedures here -->${EOL}`,
      )
    }

    if (selected.includes("user")) {
      fs.writeFileSync(
        path.join(baseDir, "USER.md"),
        `# About the Owner${EOL}${EOL}<!-- Information about you that helps the agent understand context -->${EOL}`,
      )
    }

    if (selected.includes("crons")) {
      fs.writeFileSync(
        path.join(baseDir, "CRONS.yaml"),
        [
          "# Scheduled jobs",
          "# Each job fires a prompt on a cron schedule",
          "#",
          "# - name: morning-check",
          "#   schedule: \"0 9 * * *\"",
          "#   prompt: \"Check notifications and summarize what's new\"",
          "#   priority: normal",
          "",
        ].join(EOL),
      )
    }

    s.stop("Config files written.")

    // Summary
    prompts.note(
      [
        `Agent: ${name}`,
        `Location: ${baseDir}`,
        "",
        "Files created:",
        `  SOUL.md${telegramToken?.trim() ? EOL + "  .env" : ""}`,
        ...selected.map((s) => {
          switch (s) {
            case "goals": return "  GOALS.md"
            case "playbook": return "  PLAYBOOK.md"
            case "user": return "  USER.md"
            case "crons": return "  CRONS.yaml"
            default: return ""
          }
        }),
      ].join(EOL),
      "Setup complete",
    )

    if (!telegramToken?.trim()) {
      prompts.log.warn(
        "No Telegram token configured. Add TELEGRAM_BOT_TOKEN to .env when ready.",
      )
    }

    prompts.outro("Run `spawnbot` to start your agent.")
  },
})
