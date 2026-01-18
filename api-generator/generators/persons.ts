import type { DataContext } from "../data";
import { loadData } from "../data";
import type { ApiPerson, ApiPersonRank, ApiPersonResult } from "../types";
import { createOverview, groupBy, progress, slugify, writeBatch, ROUND_NAMES, FORMAT_NAMES, PAGE_SIZE } from "../utils";

export async function generatePersons(ctx?: DataContext): Promise<void> {
  const { persons: personData, ranksSingle, ranksAverage, results, championships } = ctx || await loadData();
  
  const champCompIds = new Set(championships.map(c => c.competition_id));
  const singlesByPerson = groupBy(ranksSingle, s => s.person_id);
  const averagesByPerson = groupBy(ranksAverage, a => a.person_id);
  const resultsByPerson = groupBy(results, r => r.person_id);
  
  const uniquePersons = new Map<string, typeof personData[0]>();
  for (const p of personData) if (!uniquePersons.has(p.wca_id) || p.sub_id === 1) uniquePersons.set(p.wca_id, p);
  
  const personList = [...uniquePersons.values()].sort((a, b) => a.name.localeCompare(b.name));
  const total = personList.length;
  
  let currentPage: ApiPerson[] = [];
  let pageIndex = 1;
  const writes: Array<{ path: string; data: unknown }> = [];
  const toRank = (r: { event_id: string; best: number; world_rank: number; continent_rank: number; country_rank: number }): ApiPersonRank => ({
    eventId: r.event_id, best: r.best, rank: { world: r.world_rank, continent: r.continent_rank, country: r.country_rank }
  });
  
  for (let i = 0; i < personList.length; i++) {
    const person = personList[i];
    const id = person.wca_id;
    const personResults = resultsByPerson.get(id) || [];
    
    const competitionIdsSet = new Set<string>();
    const championshipIdsSet = new Set<string>();
    const medals = { gold: 0, silver: 0, bronze: 0 };
    const records = { single: { WR: 0, CR: 0, NR: 0 }, average: { WR: 0, CR: 0, NR: 0 } };
    const results2: Record<string, Record<string, ApiPersonResult[]>> = {};
    
    for (const r of personResults) {
      const ev = r.event_id, cid = r.competition_id;
      competitionIdsSet.add(cid);
      if (champCompIds.has(cid)) championshipIdsSet.add(cid);
      
      (results2[cid] ??= {})[ev] ??= [];
      results2[cid][ev].push({
        round: ROUND_NAMES[r.round_type_id] || r.round_type_id, position: r.pos,
        best: r.best, average: r.average, format: FORMAT_NAMES[r.format_id] || r.format_id, solves: r.attempts,
      });
      
      if ((r.round_type_id === "f" || r.round_type_id === "g") && r.pos <= 3) {
        if (r.pos === 1) medals.gold++; else if (r.pos === 2) medals.silver++; else medals.bronze++;
      }
      
      const sr = r.regional_single_record, ar = r.regional_average_record;
      if (sr === "WR") records.single.WR++; else if (sr === "CR") records.single.CR++; else if (sr === "NR") records.single.NR++;
      if (ar === "WR") records.average.WR++; else if (ar === "CR") records.average.CR++; else if (ar === "NR") records.average.NR++;
    }
    
    const apiPerson: ApiPerson = {
      id, name: person.name, slug: slugify(person.name), country: person.country_id,
      numberOfCompetitions: competitionIdsSet.size, competitionIds: [...competitionIdsSet],
      numberOfChampionships: championshipIdsSet.size, championshipIds: [...championshipIdsSet],
      rank: { singles: (singlesByPerson.get(id) || []).map(toRank), averages: (averagesByPerson.get(id) || []).map(toRank) },
      medals, records, results: results2,
    };
    
    writes.push({ path: `persons/${id}.json`, data: apiPerson });
    currentPage.push(apiPerson);
    
    if (currentPage.length >= PAGE_SIZE) {
      writes.push({ path: pageIndex === 1 ? "persons.json" : `persons-page-${pageIndex}.json`, data: createOverview(currentPage, pageIndex, total) });
      currentPage = [];
      pageIndex++;
    }
    
    if (writes.length >= 2000) {
      await writeBatch(writes.splice(0, 2000));
    }
    if ((i + 1) % 5000 === 0) progress(i + 1, total, "persons");
  }
  
  if (currentPage.length > 0) {
    writes.push({ path: pageIndex === 1 ? "persons.json" : `persons-page-${pageIndex}.json`, data: createOverview(currentPage, pageIndex, total) });
  }
  
  for (let i = 0; i < writes.length; i += 2000) {
    await writeBatch(writes.slice(i, i + 2000));
  }
  progress(total, total, "persons");
}
