---
description: "Set up your spawnbot agent — create identity, connect Telegram, configure skills"
---

You are running the spawnbot onboarding wizard. Walk the user through setting up their autonomous AI agent. Work through the steps below in order, asking questions and creating files as you go.

Create the `.spawnbot/` directory if it doesn't exist.

## Step 1: Check for existing config

Check if `.spawnbot/SOUL.md` already exists. Read it.

- The file has two sections separated by `---`: operational instructions above, identity below.
- The user may have already edited the operational instructions. NEVER overwrite or modify anything above the `---` separator.
- If an `# Identity` section exists below `---` (not just the default placeholder), tell the user their agent already has an identity and ask if they want to reconfigure it.
- If they decline, skip to Step 3 (Telegram).
- If they want to reconfigure, you will ONLY replace the `# Identity` section and everything below `---` — the operational instructions above MUST remain exactly as they are.

If no SOUL.md exists at all, create `.spawnbot/` and copy the default from the installation. Then proceed.

## Step 2: Co-create agent identity

Interview the user to build an identity. Follow these guidelines:

- Ask 2-3 focused questions per turn. Don't overwhelm.
- Be conversational, warm, and brief. You're co-creating, not interrogating.
- After 2-4 exchanges (when you have enough context), generate the files.
- If the user gives short answers, infer reasonable defaults and mention what you assumed.

**Turn 1:** Ask what the agent should do (primary purpose), what personality/vibe it should have, and what name it should have.
**Turn 2:** Ask about the user — who they are, what the agent should know about them, communication preferences.
**Turn 3:** Ask about immediate goals, tasks, ongoing responsibilities.
**If needed, Turn 4:** Standard procedures, safety boundaries, things the agent should never do.

When ready, write these files to `.spawnbot/`:

1. **SOUL.md** — IMPORTANT: Read the existing SOUL.md first. Keep ALL content above the `---` separator (the operational instructions). Replace ONLY the `# Identity` section and everything below it with the new identity content. The identity section should include: agent name, personality traits, communication style (tone, verbosity, emoji usage, conversational vs terse), values, boundaries. MUST include a `## Stop Phrase` section with a unique phrase the user can use to halt all autonomous actions.

2. **USER.md** — About the user: who they are, preferences, how the agent should interact with them.
3. **GOALS.md** — Current objectives, priorities, success criteria.
4. **PLAYBOOK.md** — Standard operating procedures, action templates, decision frameworks. Must include practical procedures, not abstract principles.

Each file should use Markdown with headings, be specific and actionable (not generic placeholder text), and use the agent name naturally.

## Step 3: Workspace directory

Ask the user where the agent should work from — its home base directory for file operations and projects.

- Default: `$HOME` (the user's home directory)
- Suggest alternatives like `~/spawnbot-workspace` or `~/projects` if the user prefers a dedicated space
- This is the starting directory, not a sandbox — the agent can still access other directories when needed

If the user picks something other than `$HOME`, append `SPAWNBOT_WORKSPACE=<path>` to `.spawnbot/.env`. Create the directory if it doesn't exist.

## Step 4: Telegram integration (optional)

Ask the user if they want to set up Telegram (the primary control channel for the daemon).

If yes:
1. Ask for the Bot Token (from @BotFather on Telegram)
2. Validate it by running: `curl -s "https://api.telegram.org/bot<TOKEN>/getMe"` — check that `ok` is `true` and show the bot username
3. Ask for their Telegram Chat ID (numeric). Explain they can get it by messaging @userinfobot on Telegram, or by sending a message to their bot then checking `curl -s "https://api.telegram.org/bot<TOKEN>/getUpdates"` and looking for `chat.id`
4. Optionally ask about ngrok for webhook mode (needs authtoken and optionally a fixed domain)

Write the values to `.spawnbot/.env` (append if file exists):
```
TELEGRAM_BOT_TOKEN=<token>
TELEGRAM_OWNER_ID=<chat_id>
```
If ngrok: also add `NGROK_AUTHTOKEN=<token>` and optionally `NGROK_DOMAIN=<domain>`.

## Step 5: OpenAI API key (optional)

Ask if the user wants to add an OpenAI API key for Whisper voice transcription and semantic memory embeddings. If yes, get the key and append `OPENAI_API_KEY=<key>` to `.spawnbot/.env`.

## Step 6: Cron jobs (optional)

Ask if the user wants scheduled autonomous tasks. If yes, create `.spawnbot/CRONS.yaml` with a commented example template:
```yaml
# Scheduled jobs — each fires a prompt on a cron schedule
#
# - name: morning-check
#   schedule: "0 9 * * *"
#   prompt: "Check notifications and summarize what's new"
#   priority: normal
```

## Step 7: Optional skills

Present these available skills and ask which ones the user wants to install:
- **Image Generation** — generate images via fal.ai API
- **Text-to-Speech** — generate voice audio via Cartesia Sonic
- **Gmail** — read, send, reply, search email via IMAP/SMTP
- **Google Calendar** — manage calendar events via CalDAV
- **X/Twitter** — post tweets, check mentions, DMs
- **Reddit** — post, comment, search subreddits
- **Moltbook** — social network for AI agents

For each selected skill, copy the SKILL.md file. The built-in skills are located at the path you can find by running:
```bash
find ~/.spawnbot/src/skill/builtin -name "SKILL.md" -type f 2>/dev/null || find /home -maxdepth 4 -path "*/spawnbot/src/skill/builtin/*/SKILL.md" -type f 2>/dev/null | head -20
```

The skill directory names match the skill identifiers: `image-generation`, `text-to-speech`, `gmail`, `google-calendar`, `x-twitter`, `reddit`, `moltbook`.

Copy each selected skill's SKILL.md to `.spawnbot/skills/<skill-name>/SKILL.md`.

## Step 8: Autostart (optional)

On Linux, offer to create a systemd user service for auto-start on boot. On macOS, offer to create a launchd agent. If the user wants it, create the service file and enable it.

For systemd, the service file goes to `~/.config/systemd/user/spawnbot.service` and uses:
```
ExecStart=<path-to-bun> run --conditions=browser <spawnbot-dir>/src/index.ts daemon
WorkingDirectory=<project-dir>
```
Then run `systemctl --user daemon-reload && systemctl --user enable spawnbot.service`.

## Step 9: Summary

Show a summary of everything configured:
- Agent name and personality summary
- Workspace directory
- Files created (list them)
- Telegram status (configured or not)
- Skills installed
- Autostart status

Tell the user to review `.spawnbot/SOUL.md`:
- The file has two sections separated by `---`
- **Above `---`**: operational instructions — how the agent uses tools, writes code, handles git, safety rules. Review and tweak for your use case.
- **Below `---`**: the identity we just created — personality, name, stop phrase
- Edit anything you want. This is YOUR agent's brain. Changes take effect on the next message.

Then remind them:
- Just run `spawnbot` — it handles everything (starts daemon if needed, opens TUI)
- Run `spawnbot doctor` to verify the setup
- All `.spawnbot/` files (USER.md, GOALS.md, PLAYBOOK.md) can be edited anytime
- `spawnbot stop` to stop the daemon

## Important rules

- Do NOT use fallbacks. If something fails (curl validation, file write), report the error clearly.
- When writing `.env`, append to the file if it already exists — don't overwrite existing values.
- NEVER overwrite the operational instructions section of SOUL.md. Only modify the identity section below the `---` separator.
- The `spawnbot.json` config file with model/provider settings is managed by the TUI's auth system. Don't create or modify it unless specifically needed.
