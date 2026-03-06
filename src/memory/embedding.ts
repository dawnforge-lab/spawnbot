import { Log } from "@/util/log"

const log = Log.create({ service: "memory.embedding" })

const EMBEDDING_MODEL = "text-embedding-3-small"
const EMBEDDING_DIMS = 1536

export namespace Embedding {
  /** Generate an embedding vector for the given text. Returns undefined if no API key. */
  export async function embed(text: string): Promise<Float32Array | undefined> {
    const apiKey = process.env.OPENAI_API_KEY
    if (!apiKey) return undefined

    try {
      const res = await fetch("https://api.openai.com/v1/embeddings", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: EMBEDDING_MODEL,
          input: text.slice(0, 8000), // trim to avoid token limit
        }),
      })

      if (!res.ok) {
        const body = await res.text()
        log.error("embedding API error", { status: res.status, body })
        return undefined
      }

      const data = (await res.json()) as { data: Array<{ embedding: number[] }> }
      return new Float32Array(data.data[0].embedding)
    } catch (err) {
      log.error("embedding failed", { error: err })
      return undefined
    }
  }

  /** Batch-embed multiple texts. Returns array aligned with input (undefined entries on failure). */
  export async function embedBatch(texts: string[]): Promise<Array<Float32Array | undefined>> {
    const apiKey = process.env.OPENAI_API_KEY
    if (!apiKey) return texts.map(() => undefined)
    if (texts.length === 0) return []

    try {
      const res = await fetch("https://api.openai.com/v1/embeddings", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: EMBEDDING_MODEL,
          input: texts.map((t) => t.slice(0, 8000)),
        }),
      })

      if (!res.ok) {
        const body = await res.text()
        log.error("batch embedding API error", { status: res.status, body })
        return texts.map(() => undefined)
      }

      const data = (await res.json()) as { data: Array<{ embedding: number[]; index: number }> }
      const result: Array<Float32Array | undefined> = texts.map(() => undefined)
      for (const item of data.data) {
        result[item.index] = new Float32Array(item.embedding)
      }
      return result
    } catch (err) {
      log.error("batch embedding failed", { error: err })
      return texts.map(() => undefined)
    }
  }

  /** Cosine similarity between two vectors. Returns -1 to 1. */
  export function cosineSimilarity(a: Float32Array, b: Float32Array): number {
    let dot = 0
    let normA = 0
    let normB = 0
    for (let i = 0; i < a.length; i++) {
      dot += a[i] * b[i]
      normA += a[i] * a[i]
      normB += b[i] * b[i]
    }
    const denom = Math.sqrt(normA) * Math.sqrt(normB)
    return denom === 0 ? 0 : dot / denom
  }

  /** Serialize Float32Array to Buffer for SQLite BLOB storage. */
  export function toBlob(vec: Float32Array): Buffer {
    return Buffer.from(vec.buffer, vec.byteOffset, vec.byteLength)
  }

  /** Deserialize Buffer from SQLite BLOB to Float32Array. */
  export function fromBlob(blob: Buffer): Float32Array {
    const ab = new ArrayBuffer(blob.length)
    const view = new Uint8Array(ab)
    for (let i = 0; i < blob.length; i++) view[i] = blob[i]
    return new Float32Array(ab)
  }

  export const DIMS = EMBEDDING_DIMS
}
