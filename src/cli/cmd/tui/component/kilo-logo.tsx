import { RGBA } from "@opentui/core"
import { For } from "solid-js"
import { useTheme } from "@tui/context/theme"

const ASCII_LOGO = [
  ` ███  ████   ████  █   █ █   █ ████   ████  █████`,
  `█     █   █  █  █  █   █ ██  █ █   █ █    █   █  `,
  ` ███  ████   ████  █ █ █ █ █ █ ████  █    █   █  `,
  `   █  █      █  █  █████ █  ██ █   █ █    █   █  `,
  `███   █      █  █   █ █  █   █ ████   ████    █  `,
]

export function SpawnbotLogo() {
  const { theme } = useTheme()
  const yellow = RGBA.fromHex("#F8F675")

  return (
    <box>
      <For each={ASCII_LOGO}>
        {(line) => (
          <box flexDirection="row">
            <text fg={yellow} selectable={false}>
              {line}
            </text>
          </box>
        )}
      </For>
    </box>
  )
}
