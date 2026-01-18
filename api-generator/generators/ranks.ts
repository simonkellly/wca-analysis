import type { DataContext } from "../data";
import { loadData } from "../data";
import { createOverview, PAGE_SIZE, writeBatched, EVENT_IDS, groupBy } from "../utils";
import { getCountryContinent } from "./countries";
import type { RanksSingle, RanksAverage } from "../../lib/schema";

type RankEntry = RanksSingle | RanksAverage;

export async function generateRanks(ctx?: DataContext): Promise<void> {
  const { ranksSingle, ranksAverage, persons } = ctx || await loadData();
  
  const pc = new Map(persons.map(p => [p.wca_id, p.country_id]));
  const singlesByEvent = groupBy(ranksSingle, r => r.event_id);
  const averagesByEvent = groupBy(ranksAverage, r => r.event_id);
  
  const ranksByEventType: Map<string, Map<"single" | "average", RankEntry[]>> = new Map();
  for (const eventId of EVENT_IDS) {
    const byType = new Map<"single" | "average", RankEntry[]>();
    byType.set("single", (singlesByEvent.get(eventId) || []).sort((a, b) => a.world_rank - b.world_rank));
    byType.set("average", (averagesByEvent.get(eventId) || []).sort((a, b) => a.world_rank - b.world_rank));
    ranksByEventType.set(eventId, byType);
  }
  
  const ranksByRegion: Map<string, Map<"single" | "average", Map<string, RankEntry[]>>> = new Map();
  for (const [eventId, byType] of ranksByEventType) {
    const eventRegions = new Map<"single" | "average", Map<string, RankEntry[]>>();
    
    for (const [rankType, ranks] of byType) {
      const regionMap = new Map<string, RankEntry[]>();
      const worldRanks = ranks.filter(x => x.world_rank <= PAGE_SIZE).slice(0, PAGE_SIZE);
      if (worldRanks.length > 0) regionMap.set("world", worldRanks);
      
      const byCountry = new Map<string, RankEntry[]>();
      const byContinent = new Map<string, RankEntry[]>();
      
      for (const rank of ranks) {
        const countryId = pc.get(rank.person_id);
        if (!countryId) continue;
        
        const countryRanks = byCountry.get(countryId) ?? [];
        if (!byCountry.has(countryId)) byCountry.set(countryId, countryRanks);
        countryRanks.push(rank);
        
        const continentId = getCountryContinent(countryId);
        const continentRanks = byContinent.get(continentId) ?? [];
        if (!byContinent.has(continentId)) byContinent.set(continentId, continentRanks);
        continentRanks.push(rank);
      }
      
      for (const [continentId, continentRanks] of byContinent) {
        const sorted = continentRanks.sort((a, b) => a.continent_rank - b.continent_rank).slice(0, PAGE_SIZE);
        if (sorted.length > 0) regionMap.set(continentId, sorted);
      }
      
      for (const [countryId, countryRanks] of byCountry) {
        const sorted = countryRanks.sort((a, b) => a.country_rank - b.country_rank).slice(0, PAGE_SIZE);
        if (sorted.length > 0) regionMap.set(countryId, sorted);
      }
      
      eventRegions.set(rankType, regionMap);
    }
    
    ranksByRegion.set(eventId, eventRegions);
  }
  
  const types = ["single", "average"] as const;
  const writes: Array<{ path: string; data: unknown }> = [];
  
  // Generate files for all regions that have data
  for (const [eventId, byType] of ranksByRegion) {
    for (const [rankType, regionMap] of byType) {
      for (const [regionId, rankedEntries] of regionMap) {
        if (rankedEntries.length > 0) {
          writes.push({ path: `rank/${regionId}/${rankType}/${eventId}.json`, data: createOverview(rankedEntries.map(x => ({
            rankType, personId: x.person_id, eventId: x.event_id, best: x.best,
            rank: { world: x.world_rank, continent: x.continent_rank, country: x.country_rank },
          })))});
        }
      }
    }
  }
  
  await writeBatched(writes, 500, "ranks", 2000);
}
