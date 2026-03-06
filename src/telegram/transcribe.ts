import { Log } from "@/util/log"

const log = Log.create({ service: "telegram.transcribe" })

export namespace Transcribe {
  /** Transcribe an audio file using OpenAI's Whisper API. */
  export async function audio(filePath: string): Promise<string | undefined> {
    const apiKey = process.env.OPENAI_API_KEY
    if (!apiKey) {
      log.warn("OPENAI_API_KEY not set, skipping transcription")
      return undefined
    }

    try {
      const file = Bun.file(filePath)
      const formData = new FormData()
      formData.append("file", file)
      formData.append("model", "whisper-1")

      const res = await fetch("https://api.openai.com/v1/audio/transcriptions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
        },
        body: formData,
      })

      if (!res.ok) {
        const body = await res.text()
        log.error("whisper API error", { status: res.status, body })
        return undefined
      }

      const data = (await res.json()) as { text: string }
      log.info("transcribed audio", { filePath, length: data.text.length })
      return data.text
    } catch (err) {
      log.error("transcription failed", { filePath, error: err })
      return undefined
    }
  }
}
