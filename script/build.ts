#!/usr/bin/env bun

import solidPlugin from "../node_modules/@opentui/solid/scripts/solid-plugin"
import path from "path"
import fs from "fs"
import { $ } from "bun"

const dir = path.resolve(import.meta.dirname, "..")
process.chdir(dir)

const pkg = await Bun.file(path.join(dir, "package.json")).json()

// --- Migrations ---
const migrationDir = path.join(dir, "migration")
const migrationEntries = fs.existsSync(migrationDir)
  ? await Promise.all(
      fs
        .readdirSync(migrationDir, { withFileTypes: true })
        .filter((e) => e.isDirectory() && /^\d{14}/.test(e.name))
        .map((e) => e.name)
        .sort()
        .map(async (name) => {
          const sql = await Bun.file(path.join(migrationDir, name, "migration.sql")).text()
          const m = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})/.exec(name)
          const timestamp = m
            ? Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6])
            : 0
          return { sql, timestamp }
        }),
    )
  : []
console.log(`Loaded ${migrationEntries.length} migrations`)

// --- Build ---
await $`rm -rf dist`

const name = `spawnbot-${process.platform}-${process.arch}`
console.log(`Building ${name}...`)
await $`mkdir -p dist/${name}/bin`

const parserWorker = fs.realpathSync(
  path.resolve(dir, "./node_modules/@opentui/core/parser.worker.js"),
)
const workerPath = "./src/cli/cmd/tui/worker.ts"
const workerRelativePath = path.relative(dir, parserWorker).replaceAll("\\", "/")
const bunfsRoot = "/$bunfs/root/"

await Bun.build({
  conditions: ["browser"],
  tsconfig: "./tsconfig.json",
  plugins: [solidPlugin],
  sourcemap: "external",
  compile: {
    autoloadBunfig: false,
    autoloadDotenv: false,
    // @ts-ignore
    autoloadTsconfig: true,
    autoloadPackageJson: true,
    target: name.replace("spawnbot", "bun") as any,
    outfile: `dist/${name}/bin/spawnbot`,
    execArgv: ["--use-system-ca", "--"],
    windows: {},
  },
  entrypoints: ["./src/index.ts", parserWorker, workerPath],
  define: {
    KILO_VERSION: `'${pkg.version}'`,
    OTUI_TREE_SITTER_WORKER_PATH: bunfsRoot + workerRelativePath,
    KILO_WORKER_PATH: workerPath,
    KILO_CHANNEL: `'stable'`,
    KILO_LIBC: process.platform === "linux" ? `'glibc'` : "",
    KILO_MIGRATIONS: JSON.stringify(migrationEntries),
  },
})

console.log(`Build complete: dist/${name}/bin/spawnbot`)
