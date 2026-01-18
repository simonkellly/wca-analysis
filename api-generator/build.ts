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
  await Bun.$`rm -rf ${API_OUTPUT_DIR}`;
  await Bun.$`mkdir -p ${API_OUTPUT_DIR}`;
  
  const ctx = apis.some(a => NEEDS_DATA.has(a)) ? await loadData() : undefined;
  await Promise.all(apis.map(api => GENERATORS[api](ctx)));
}

main().catch(console.error);
