import { createOverview, progress, writeApiJson, EVENT_IDS } from "../utils";

const EVENTS = [
  { id: "222", name: "2x2x2 Cube", format: "time" }, { id: "333bf", name: "3x3x3 Blindfolded", format: "time" },
  { id: "333", name: "3x3x3 Cube", format: "time" }, { id: "333fm", name: "3x3x3 Fewest Moves", format: "number" },
  { id: "333mbf", name: "3x3x3 Multi-Blind", format: "multi" }, { id: "333mbo", name: "3x3x3 Multi-Blind Old Style", format: "multi" },
  { id: "333oh", name: "3x3x3 One-Handed", format: "time" }, { id: "333ft", name: "3x3x3 With Feet", format: "time" },
  { id: "444bf", name: "4x4x4 Blindfolded", format: "time" }, { id: "444", name: "4x4x4 Cube", format: "time" },
  { id: "555bf", name: "5x5x5 Blindfolded", format: "time" }, { id: "555", name: "5x5x5 Cube", format: "time" },
  { id: "666", name: "6x6x6 Cube", format: "time" }, { id: "777", name: "7x7x7 Cube", format: "time" },
  { id: "clock", name: "Clock", format: "time" }, { id: "magic", name: "Magic", format: "time" },
  { id: "mmagic", name: "Master Magic", format: "time" }, { id: "minx", name: "Megaminx", format: "time" },
  { id: "pyram", name: "Pyraminx", format: "time" }, { id: "skewb", name: "Skewb", format: "time" },
  { id: "sq1", name: "Square-1", format: "time" },
] as const;

export async function generateEvents(): Promise<void> {
  progress(1, 2, "events");
  await writeApiJson("events.json", createOverview([...EVENTS]));
  progress(2, 2, "events");
}

export { EVENTS, EVENT_IDS };
