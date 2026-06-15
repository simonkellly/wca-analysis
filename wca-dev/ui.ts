#!/usr/bin/env bun
// Build the WCA developer DuckDB database (if needed) and start the DuckDB UI.
//
//   bun wca-dev/ui.ts           # build db if missing, then UI on :4213
//   bun wca-dev/ui.ts --fresh   # rebuild db first
//
// In GitHub Codespaces, open the forwarded port 4213 in your browser.

import { $, spawn } from "bun"

const dir = import.meta.dir
const dbPath = join(dir, "cache", "wca-dev.duckdb")
const UI_PORT = 4213

const args = new Set(Bun.argv.slice(2))
const fresh = args.has("--fresh")

if (fresh || !(await Bun.file(dbPath).exists())) {
  const buildArgs = fresh ? ["--fresh"] : []
  await $`bun ${join(dir, "build.ts")} ${buildArgs}`
} else {
  console.log(`Using cached database (${dbPath})`)
}

const codespace = process.env.CODESPACE_NAME
const portUrl = codespace
  ? `https://${codespace}-${UI_PORT}.${process.env.GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN ?? "app.github.dev"}`
  : `http://localhost:${UI_PORT}`

console.log(`\nStarting DuckDB UI…`)
console.log(`  Database: ${dbPath}`)
console.log(`  Open:     ${portUrl}`)
console.log(`\nPress Ctrl+C to stop.\n`)

const proc = spawn(["duckdb", dbPath, "-cmd", "CALL start_ui_server();"], {
  stdout: "inherit",
  stderr: "inherit",
  stdin: "inherit",
})

proc.exited.then((code) => process.exit(code ?? 0))
process.on("SIGINT", () => proc.kill())
