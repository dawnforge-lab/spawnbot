import { describe, test, expect, beforeEach, afterEach } from "bun:test"
import fs from "fs"
import path from "path"
import os from "os"

// Must import after test preload sets XDG vars
let loadSoul: typeof import("../index").loadSoul
let buildDocsReference: typeof import("../index").buildDocsReference
let invalidateCache: typeof import("../index").invalidateCache

describe("soul", () => {
  let tmpDir: string

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "soul-test-"))
    // Re-import to get fresh module state
    const mod = await import("../index")
    loadSoul = mod.loadSoul
    buildDocsReference = mod.buildDocsReference
    invalidateCache = mod.invalidateCache
    invalidateCache()
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  test("loadSoul returns default when no SOUL.md exists", () => {
    const result = loadSoul()
    expect(result).toContain("Spawnbot")
    expect(result).toContain("autonomous AI agent")
  })

  test("default soul contains output format section", () => {
    const result = loadSoul()
    expect(result).toContain("## Output format")
    expect(result).toContain("terminal or Telegram")
  })

  test("default soul contains tools and code sections", () => {
    const result = loadSoul()
    expect(result).toContain("## Tools")
    expect(result).toContain("## Working with code")
  })

  test("default soul contains identity placeholder", () => {
    const result = loadSoul()
    expect(result).toContain("# Identity")
  })
})
