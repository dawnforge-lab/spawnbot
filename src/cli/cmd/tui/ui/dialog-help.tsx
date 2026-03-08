import { TextAttributes } from "@opentui/core"
import { useTheme } from "@tui/context/theme"
import { useDialog } from "./dialog"
import { useKeyboard } from "@opentui/solid"
import { useKeybind } from "@tui/context/keybind"

export function DialogHelp() {
  const dialog = useDialog()
  const { theme } = useTheme()
  const keybind = useKeybind()

  useKeyboard((evt) => {
    if (evt.name === "return" || evt.name === "escape") {
      dialog.clear()
    }
  })

  const muted = theme.textMuted
  const text = theme.text
  const accent = theme.primary

  return (
    <box paddingLeft={2} paddingRight={2} gap={1}>
      <box flexDirection="row" justifyContent="space-between">
        <text attributes={TextAttributes.BOLD} fg={text}>
          Spawnbot Help
        </text>
        <text fg={muted} onMouseUp={() => dialog.clear()}>
          esc/enter
        </text>
      </box>

      <box gap={0}>
        <text attributes={TextAttributes.BOLD} fg={accent}>
          Getting Started
        </text>
        <text fg={muted}>
          /setup          Run the onboarding wizard (identity, Telegram, skills)
        </text>
        <text fg={muted}>
          /connect        Add or manage LLM provider API keys
        </text>
        <text fg={muted}>
          /models         Switch between available models
        </text>
      </box>

      <box gap={0}>
        <text attributes={TextAttributes.BOLD} fg={accent}>
          Commands
        </text>
        <text fg={muted}>
          {keybind.print("command_list")}             Open command palette (all commands)
        </text>
        <text fg={muted}>
          /compact        Summarize a long session near context limits
        </text>
        <text fg={muted}>
          /undo /redo     Undo or redo last message and file changes
        </text>
        <text fg={muted}>
          /new            Start a fresh conversation session
        </text>
        <text fg={muted}>
          /sessions       List and continue previous conversations
        </text>
      </box>

      <box gap={0}>
        <text attributes={TextAttributes.BOLD} fg={accent}>
          Keyboard Shortcuts
        </text>
        <text fg={muted}>
          Ctrl+V          Paste image from clipboard
        </text>
        <text fg={muted}>
          Ctrl+Shift+V    Paste text from clipboard
        </text>
        <text fg={muted}>
          Tab             Cycle agents (Build, Plan, etc.)
        </text>
        <text fg={muted}>
          Shift+Enter     New line in prompt
        </text>
        <text fg={muted}>
          Escape          Stop the AI mid-response
        </text>
        <text fg={muted}>
          PageUp/Down     Scroll conversation
        </text>
      </box>

      <box gap={0}>
        <text attributes={TextAttributes.BOLD} fg={accent}>
          Prompt Tricks
        </text>
        <text fg={muted}>
          @filename       Fuzzy search and attach a file
        </text>
        <text fg={muted}>
          !command        Run a shell command directly (e.g. !ls -la)
        </text>
        <text fg={muted}>
          /command args   Run a slash command
        </text>
      </box>

      <box gap={0}>
        <text attributes={TextAttributes.BOLD} fg={accent}>
          Config Files
        </text>
        <text fg={muted}>
          .spawnbot/SOUL.md        Operating instructions + identity
        </text>
        <text fg={muted}>
          .spawnbot/USER.md        Information about you
        </text>
        <text fg={muted}>
          .spawnbot/GOALS.md       Current objectives
        </text>
        <text fg={muted}>
          .spawnbot/PLAYBOOK.md    Action templates
        </text>
        <text fg={muted}>
          .spawnbot/.env           API keys and secrets
        </text>
      </box>

      <box flexDirection="row" justifyContent="flex-end" paddingBottom={1}>
        <box paddingLeft={3} paddingRight={3} backgroundColor={accent} onMouseUp={() => dialog.clear()}>
          <text fg={theme.selectedListItemText}>ok</text>
        </box>
      </box>
    </box>
  )
}
