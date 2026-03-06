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
    expect(result).toContain("software engineer")
  })

  test("default soul contains personality section", () => {
    const result = loadSoul()
    expect(result).toContain("# Personality")
    expect(result).toContain("STRICTLY FORBIDDEN")
  })

  test("default soul contains code section", () => {
    const result = loadSoul()
    expect(result).toContain("# Code")
  })
})
