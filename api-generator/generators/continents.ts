import { createOverview, progress, writeApiJson } from "../utils";

const CONTINENTS = [
  { id: "africa", name: "Africa" }, { id: "asia", name: "Asia" }, { id: "europe", name: "Europe" },
  { id: "multiple-continents", name: "Multiple Continents" }, { id: "north-america", name: "North America" },
  { id: "oceania", name: "Oceania" }, { id: "south-america", name: "South America" },
];

export async function generateContinents(): Promise<void> {
  progress(1, 2, "continents");
  await writeApiJson("continents.json", createOverview(CONTINENTS));
  progress(2, 2, "continents");
}

export { CONTINENTS };
