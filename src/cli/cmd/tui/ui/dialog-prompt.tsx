import { TextareaRenderable, TextAttributes, type KeyEvent, type PasteEvent } from "@opentui/core"
import { useTheme } from "../context/theme"
import { useDialog, type DialogContext } from "./dialog"
import { onMount, type JSX } from "solid-js"
import { useKeyboard } from "@opentui/solid"
import { Clipboard } from "@tui/util/clipboard"

export type DialogPromptProps = {
  title: string
  description?: () => JSX.Element
  placeholder?: string
  value?: string
  onConfirm?: (value: string) => void
  onCancel?: () => void
}

export function DialogPrompt(props: DialogPromptProps) {
  const dialog = useDialog()
  const { theme } = useTheme()
  let textarea: TextareaRenderable

  useKeyboard((evt) => {
    if (evt.name === "return") {
      props.onConfirm?.(textarea.plainText)
    }
  })

  onMount(() => {
    dialog.setSize("medium")
    setTimeout(() => {
      if (!textarea || textarea.isDestroyed) return
      textarea.focus()
    }, 1)
    textarea.gotoLineEnd()
  })

  return (
    <box paddingLeft={2} paddingRight={2} gap={1}>
      <box flexDirection="row" justifyContent="space-between">
        <text attributes={TextAttributes.BOLD} fg={theme.text}>
          {props.title}
        </text>
        <text fg={theme.textMuted} onMouseUp={() => dialog.clear()}>
          esc
        </text>
      </box>
      <box gap={1}>
        {props.description}
        <textarea
          onSubmit={() => {
            props.onConfirm?.(textarea.plainText)
          }}
          onKeyDown={async (e: KeyEvent) => {
            // Handle Ctrl+V paste — read from clipboard directly
            // Some terminals don't send bracketed paste for dialog inputs
            if (e.name === "v" && e.ctrl && !e.meta && !e.shift) {
              const content = await Clipboard.read()
              if (content?.mime === "text/plain" && content.data) {
                e.preventDefault()
                textarea.insertText(content.data)
              }
            }
          }}
          onPaste={(event: PasteEvent) => {
            // Handle bracketed paste from terminal
            const text = event.text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim()
            if (!text) return
            event.preventDefault()
            textarea.insertText(text)
          }}
          height={3}
          keyBindings={[{ name: "return", action: "submit" }]}
          ref={(val: TextareaRenderable) => (textarea = val)}
          initialValue={props.value}
          placeholder={props.placeholder ?? "Enter text"}
          textColor={theme.text}
          focusedTextColor={theme.text}
          cursorColor={theme.text}
        />
      </box>
      <box paddingBottom={1} gap={1} flexDirection="row">
        <text fg={theme.text}>
          enter <span style={{ fg: theme.textMuted }}>submit</span>
        </text>
      </box>
    </box>
  )
}

DialogPrompt.show = (dialog: DialogContext, title: string, options?: Omit<DialogPromptProps, "title">) => {
  return new Promise<string | null>((resolve) => {
    dialog.replace(
      () => (
        <DialogPrompt title={title} {...options} onConfirm={(value) => resolve(value)} onCancel={() => resolve(null)} />
      ),
      () => resolve(null),
    )
  })
}
