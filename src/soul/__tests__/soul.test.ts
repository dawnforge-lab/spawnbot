import { describe, test, expect, beforeEach, afterEach } from "bun:test"
import fs from "fs"
import path from "path"
import os from "os"

// Must import after test preload sets XDG vars
let loadSoul: typeof import("../index").loadSoul
let defaultSoul: typeof import("../index").defaultSoul
let buildDocsReference: typeof import("../index").buildDocsReference
let invalidateCache: typeof import("../index").invalidateCache

describe("soul", () => {
  let tmpDir: string

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "soul-test-"))
    // Re-import to get fresh module state
    const mod = await import("../index")
    loadSoul = mod.loadSoul
    defaultSoul = mod.defaultSoul
    buildDocsReference = mod.buildDocsReference
    invalidateCache = mod.invalidateCache
    invalidateCache()
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  test("loadSoul throws when no SOUL.md exists", () => {
    expect(() => loadSoul()).toThrow("SOUL.md not found")
  })

  test("defaultSoul returns template with identity placeholder", () => {
    const result = defaultSoul()
    expect(result).toContain("# Identity")
    expect(result).toContain("autonomous AI agent")
  })

  test("defaultSoul contains output format section", () => {
    const result = defaultSoul()
    expect(result).toContain("## Output format")
    expect(result).toContain("terminal or Telegram")
  })

  test("defaultSoul contains tools and code sections", () => {
    const result = defaultSoul()
    expect(result).toContain("## Tools")
    expect(result).toContain("## Working with code")
  })
})
