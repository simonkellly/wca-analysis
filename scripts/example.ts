import { competitions, results } from "@/data";
import { from } from "linq-to-typescript";

// Load competitions data and filter for 2025
const comps2025 = from(await competitions())
  .where(c => c.year === 2025)
  .select(c => c.id)
  .toSet();

// Load results data and filter for different Irish competitors competing in 2025
const irish = from(await results())
  .where(r => comps2025.has(r.competition_id) && r.person_country_id === "Ireland")
  .select(r => r.person_id)
  .toSet();

console.log(`Competitions 2025: ${comps2025.size}`);
console.log(`Distinct Irish competitors: ${irish.size}`);
