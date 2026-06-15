import { arch, platform } from "node:os"

/** Normalised triple used under wca-dev/bin/<triple>/ */
export type PlatformTriple =
  | "darwin-arm64"
  | "darwin-amd64"
  | "linux-arm64"
  | "linux-amd64"

export function platformTriple(): PlatformTriple {
  const p = platform()
  const a = arch()
  if (p === "darwin") return a === "arm64" ? "darwin-arm64" : "darwin-amd64"
  if (p === "linux") return a === "arm64" ? "linux-arm64" : "linux-amd64"
  throw new Error(`Unsupported platform: ${p}/${a} (need macOS or Linux)`)
}
