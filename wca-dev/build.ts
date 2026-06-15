#!/usr/bin/env bun
// Build a typed DuckDB database from the WCA *developer* database dump.
//
//   bun wca-dev/build.ts            # download (if needed) -> parquet -> native duckdb
//   bun wca-dev/build.ts --fresh    # re-download the dump first
//   bun wca-dev/build.ts --parquet-only   # stop at parquet (query via load.sql views)
//   bun wca-dev/build.ts --rebuild-tool   # force-recompile the Rust converter
//
// Default build removes cache/parquet after materialising the native db.
// Pipeline: bsdtar streams the decompressed dump straight into a single-pass,
// parallel Rust converter that writes per-table Parquet; DuckDB then materialises
// a fully-typed native database. No intermediate .sql or .tsv ever hits disk.
//
// Pre-built bsdtar + mysqldump-parquet binaries live in wca-dev/bin/<platform>/.
// Run `bun wca-dev/prepare-binaries.ts` to refresh them.

import { $ } from "bun"
import { chmodSync } from "node:fs"
import { join } from "node:path"
import { bsdtarPath, bundledBinaryExists, mysqldumpParquetPath } from "./lib/binaries.ts"
import { platformTriple } from "./lib/platform.ts"

const dir = import.meta.dir
const cache = join(dir, "cache")
const zip = join(cache, "dump.zip")
const parquetDir = join(cache, "parquet")
const loadSql = join(parquetDir, "load.sql")
const dbPath = join(cache, "wca-dev.duckdb")
const toolDir = join(dir, "tool")
const cargoBin = join(toolDir, "target/release/mysqldump-parquet")

const DUMP_URL =
  "https://exports.worldcubeassociation.org/developer/wca-developer-database-dump.zip"

const args = new Set(Bun.argv.slice(2))
const fresh = args.has("--fresh")
const parquetOnly = args.has("--parquet-only")
const rebuildTool = args.has("--rebuild-tool")

process.env.PATH = `${process.env.HOME}/.cargo/bin:${process.env.PATH}`

const fmt = (ms: number) => (ms < 1000 ? `${ms.toFixed(0)}ms` : `${(ms / 1000).toFixed(1)}s`)
const timed = async <T>(label: string, fn: () => Promise<T>): Promise<T> => {
  const t = performance.now()
  const out = await fn()
  console.log(`  ${label.padEnd(22)} ${fmt(performance.now() - t)}`)
  return out
}

const resolveConverter = async (): Promise<string> => {
  const bundled = mysqldumpParquetPath()
  if (!rebuildTool && (await bundledBinaryExists())) return bundled

  if (rebuildTool || !(await Bun.file(cargoBin).exists())) {
    await timed("build converter", async () => {
      await $`cargo build --release --manifest-path ${join(toolDir, "Cargo.toml")}`.quiet()
    })
    return cargoBin
  }

  if (await Bun.file(bundled).exists()) return bundled
  return cargoBin
}

const resolveBsdtar = async (): Promise<string> => {
  const bundled = bsdtarPath()
  if (await Bun.file(bundled).exists()) {
    chmodSync(bundled, 0o755)
    return bundled
  }
  // macOS ships bsdtar as `tar`; Linux may have libarchive-tools
  for (const name of ["bsdtar", "tar"]) {
    const which = await $`which ${name}`.quiet().nothrow()
    if (which.exitCode === 0) return name
  }
  throw new Error(
    `No bsdtar found for ${platformTriple()}. Run: bun wca-dev/prepare-binaries.ts --bsdtar`,
  )
}

await $`mkdir -p ${cache}`

// 1. dump
if (fresh || !(await Bun.file(zip).exists())) {
  await timed("download", async () => {
    await $`curl -fSL --progress-bar ${DUMP_URL} -o ${zip}`
  })
} else {
  console.log(`  download               cached (${zip})`)
}

const converter = await resolveConverter()
const tar = await resolveBsdtar()

// 3. decompress -> parse -> parquet (single streamed, parallel pass)
await timed("decompress + parquet", async () => {
  await $`rm -rf ${parquetDir}`
  await $`${tar} -xOf ${zip} | ${converter} ${parquetDir}`
})

// 4. materialise typed native duckdb
if (parquetOnly) {
  console.log(`\n  Parquet ready: ${parquetDir}`)
  console.log(`  Query it with: duckdb -c ".read '${loadSql}'"  (creates typed tables/views)`)
} else {
  await timed("materialise duckdb", async () => {
    await $`rm -f ${dbPath}`
    await $`duckdb ${dbPath} -c ${`.read ${loadSql}`}`.quiet()
  })
  await timed("cleanup parquet", async () => {
    await $`rm -rf ${parquetDir}`
  })
  const size = (await Bun.file(dbPath).stat()).size
  console.log(`\n  Built ${dbPath} (${(size / 1024 ** 3).toFixed(2)} GB)`)
}
