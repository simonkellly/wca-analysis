import { generateChampionships } from "./generators/championships";
import { generateCompetitions } from "./generators/competitions";
import { generateContinents } from "./generators/continents";
import { generateCountries } from "./generators/countries";
import { generateEvents } from "./generators/events";
import { generatePersons } from "./generators/persons";
import { generateRanks } from "./generators/ranks";
import { generateResults } from "./generators/results";
import { generateVersion } from "./generators/version";
import { loadData, type DataContext } from "./data";
import { API_OUTPUT_DIR } from "./utils";
import { rm, mkdir } from "node:fs/promises";

type Generator = (ctx?: DataContext) => Promise<void>;

const GENERATORS: Record<string, Generator> = {
  continent: generateContinents, country: generateCountries, event: generateEvents,
  competition: generateCompetitions, championship: generateChampionships, person: generatePersons,
  rank: generateRanks, result: generateResults, version: generateVersion,
};

const NEEDS_DATA = new Set(["competition", "championship", "person", "rank", "result"]);
const DEFAULT_ORDER = ["continent", "country", "event", "competition", "championship", "person", "rank", "result", "version"];

async function main() {
  const args = process.argv.slice(2);
  const apis = args.length && !args[0].startsWith("--") ? args[0].split(",").filter(a => GENERATORS[a]) : DEFAULT_ORDER;
  
  console.log(`Building API → ${API_OUTPUT_DIR}/`);
  if (args.includes("--clean")) await rm(API_OUTPUT_DIR, { recursive: true, force: true });
  await mkdir(API_OUTPUT_DIR, { recursive: true });
  
  const ctx = apis.some(a => NEEDS_DATA.has(a)) ? await loadData() : undefined;
  
  const start = Date.now();
  for (const api of apis) {
    console.log(`  - ${api}...`);
    const t = Date.now();
    await GENERATORS[api](ctx);
    console.log(`    ✓ ${((Date.now() - t) / 1000).toFixed(1)}s`);
  }
  
  const sec = (Date.now() - start) / 1000;
  console.log(`\nDone in ${sec > 60 ? `${Math.floor(sec / 60)}m ${Math.round(sec % 60)}s` : `${Math.round(sec)}s`}`);
}

main().catch(console.error);
