import { join } from "node:path"
import { platformTriple, type PlatformTriple } from "./platform.ts"

const dir = join(import.meta.dir, "..")
const binRoot = join(dir, "bin")

export const BSDTAR_VERSION = "v3.8.1-3"
export const BSDTAR_BASE =
  "https://github.com/hermeticbuild/bsdtar-prebuilt/releases/download/v3.8.1-3"

/** hermeticbuild asset name for each platform triple */
export const BSDTAR_ASSET: Record<PlatformTriple, string> = {
  "darwin-arm64": "tar_darwin_arm64",
  "darwin-amd64": "tar_darwin_amd64",
  "linux-arm64": "tar_linux_arm64",
  "linux-amd64": "tar_linux_amd64",
}

export function binDir(triple: PlatformTriple = platformTriple()) {
  return join(binRoot, triple)
}

export function mysqldumpParquetPath(triple: PlatformTriple = platformTriple()) {
  return join(binDir(triple), "mysqldump-parquet")
}

export function bsdtarPath(triple: PlatformTriple = platformTriple()) {
  return join(binDir(triple), "bsdtar")
}

export async function bundledBinaryExists(triple: PlatformTriple = platformTriple()) {
  const [converter, tar] = await Promise.all([
    Bun.file(mysqldumpParquetPath(triple)).exists(),
    Bun.file(bsdtarPath(triple)).exists(),
  ])
  return converter && tar
}
