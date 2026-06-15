#!/usr/bin/env bun
// Download bsdtar prebuilts and compile mysqldump-parquet for macOS + Linux.
//
//   bun wca-dev/prepare-binaries.ts              # current platform only
//   bun wca-dev/prepare-binaries.ts --all        # all four triples (needs Docker for cross-build)
//   bun wca-dev/prepare-binaries.ts --bsdtar     # bsdtar only
//   bun wca-dev/prepare-binaries.ts --rust       # rust only
//
// Linux cross-builds from macOS use Docker (rust:bookworm). On Linux, native cargo is used.

import { $ } from "bun"
import { chmodSync } from "node:fs"
import { join } from "node:path"
import {
  BSDTAR_ASSET,
  BSDTAR_BASE,
  binDir,
  bsdtarPath,
  mysqldumpParquetPath,
} from "./lib/binaries.ts"
import { platformTriple, type PlatformTriple } from "./lib/platform.ts"

const dir = import.meta.dir
const toolDir = join(dir, "tool")
const manifestPath = join(dir, "bin", "manifest.json")

const ALL: PlatformTriple[] = ["darwin-arm64", "darwin-amd64", "linux-arm64", "linux-amd64"]

const args = new Set(Bun.argv.slice(2))
const all = args.has("--all")
const bsdtarOnly = args.has("--bsdtar")
const rustOnly = args.has("--rust")
const manifestOnly = args.has("--manifest")
const doBsdtar = !rustOnly && !manifestOnly
const doRust = !bsdtarOnly && !manifestOnly

const triples = all ? ALL : [platformTriple()]

process.env.PATH = `${process.env.HOME}/.cargo/bin:${process.env.PATH}`

const sha256 = async (path: string) => {
  const buf = await Bun.file(path).arrayBuffer()
  const hash = await crypto.subtle.digest("SHA-256", buf)
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, "0")).join("")
}

const fetchBsdtar = async (triple: PlatformTriple) => {
  const out = bsdtarPath(triple)
  await $`mkdir -p ${binDir(triple)}`
  const url = `${BSDTAR_BASE}/${BSDTAR_ASSET[triple]}`
  await $`curl -fSL ${url} -o ${out}`
  chmodSync(out, 0o755)
  console.log(`  bsdtar ${triple}`)
}

const rustTarget = (triple: PlatformTriple) => {
  switch (triple) {
    case "darwin-arm64":
      return "aarch64-apple-darwin"
    case "darwin-amd64":
      return "x86_64-apple-darwin"
    case "linux-arm64":
      return "aarch64-unknown-linux-gnu"
    case "linux-amd64":
      return "x86_64-unknown-linux-gnu"
  }
}

const buildRustNative = async (triple: PlatformTriple) => {
  const target = rustTarget(triple)
  const out = mysqldumpParquetPath(triple)
  await $`mkdir -p ${binDir(triple)}`
  await $`rustup target add ${target}`.quiet().nothrow()
  await $`cargo build --release --manifest-path ${join(toolDir, "Cargo.toml")} --target ${target}`.quiet()
  const built = join(toolDir, "target", target, "release", "mysqldump-parquet")
  await $`cp ${built} ${out}`
  chmodSync(out, 0o755)
  console.log(`  mysqldump-parquet ${triple}`)
}

const buildRustDocker = async (triple: PlatformTriple) => {
  const target = rustTarget(triple)
  const out = mysqldumpParquetPath(triple)
  await $`mkdir -p ${binDir(triple)}`
  await $`docker run --rm -v ${toolDir}:/app -w /app rust:bookworm bash -lc ${`cargo build --release --target ${target} && cp target/${target}/release/mysqldump-parquet /app/mysqldump-parquet-${triple}`}`.quiet()
  await $`cp ${join(toolDir, `mysqldump-parquet-${triple}`)} ${out}`
  await $`rm -f ${join(toolDir, `mysqldump-parquet-${triple}`)}`
  chmodSync(out, 0o755)
  console.log(`  mysqldump-parquet ${triple} (docker)`)
}

const buildRust = async (triple: PlatformTriple) => {
  const host = platformTriple()
  const isLinuxTarget = triple.startsWith("linux")
  const isDarwinHost = host.startsWith("darwin")
  if (triple === host || (isLinuxTarget && host.startsWith("linux"))) {
    await buildRustNative(triple)
  } else if (isDarwinHost && isLinuxTarget) {
    await buildRustDocker(triple)
  } else if (isDarwinHost && triple.startsWith("darwin") && triple !== host) {
    // cross-compile other mac arch via cargo if targets installed
    await buildRustNative(triple)
  } else {
    console.warn(`  skip mysqldump-parquet ${triple} (build on ${triple} or use --all from mac/linux with Docker)`)
  }
}

type ManifestEntry = { sha256: string; bytes: number }
type Manifest = {
  bsdtar: string
  platforms: Record<string, { bsdtar?: ManifestEntry; mysqldumpParquet?: ManifestEntry }>
}

const writeManifest = async () => {
  const manifest: Manifest = { bsdtar: "v3.8.1-3", platforms: {} }
  for (const triple of ALL) {
    manifest.platforms[triple] = {}
    for (const [key, pathFn] of [
      ["bsdtar", bsdtarPath],
      ["mysqldumpParquet", mysqldumpParquetPath],
    ] as const) {
      const path = pathFn(triple)
      if (await Bun.file(path).exists()) {
        const stat = await Bun.file(path).stat()
        manifest.platforms[triple][key] = { sha256: await sha256(path), bytes: stat.size }
      }
    }
  }
  await Bun.write(manifestPath, JSON.stringify(manifest, null, 2) + "\n")
  console.log(`\n  wrote ${manifestPath}`)
}

if (manifestOnly) {
  await writeManifest()
} else {
  console.log("Preparing wca-dev binaries…\n")
  for (const triple of triples) {
    console.log(triple)
    if (doBsdtar) await fetchBsdtar(triple)
    if (doRust) await buildRust(triple)
    console.log()
  }
  if (all || triples.length === ALL.length) await writeManifest()
}
