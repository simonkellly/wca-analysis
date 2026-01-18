import { progress, writeApiJson } from "../utils";

export async function generateVersion(): Promise<void> {
  progress(1, 2, "version");
  await writeApiJson("version.json", await (await fetch("https://www.worldcubeassociation.org/api/v0/export/public")).json());
  progress(2, 2, "version");
}
