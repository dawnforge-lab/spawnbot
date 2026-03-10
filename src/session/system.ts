import { Instance } from "../project/instance"

import type { Provider } from "@/provider/provider"

import { loadSoul, buildDocsReference } from "../soul"
import { editorContextEnvLines, type EditorContext } from "../kilocode/editor-context"

const PROVIDER_PROMPT =
  "You are an autonomous AI agent. Your operating instructions and identity are defined in your SOUL below. Follow them."

export namespace SystemPrompt {
  export function instructions() {
    return PROVIDER_PROMPT
  }

  export function soul() {
    return loadSoul()
  }

  export function provider(_model: Provider.Model) {
    return [PROVIDER_PROMPT]
  }

  export async function environment(model: Provider.Model, editorContext?: EditorContext) {
    const project = Instance.project
    const docsRef = buildDocsReference()
    return [
      [
        `You are powered by the model named ${model.api.id}. The exact model ID is ${model.providerID}/${model.api.id}`,
        `Here is some useful information about the environment you are running in:`,
        `<env>`,
        `  Working directory: ${Instance.directory}`,
        `  Is directory a git repo: ${project.vcs === "git" ? "yes" : "no"}`,
        `  Platform: ${process.platform}`,
        ...editorContextEnvLines(editorContext),
        `</env>`,
        ...(docsRef ? [docsRef] : []),
      ].join("\n"),
    ]
  }
}
