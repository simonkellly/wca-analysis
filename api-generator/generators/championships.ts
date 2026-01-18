import type { DataContext } from "../data";
import { loadData } from "../data";
import { transformCompetition, groupBy, progress, writeApiJson, paginate, createOverview, writeBatch } from "../utils";
import type { ApiChampionship } from "../types";

export async function generateChampionships(ctx?: DataContext): Promise<void> {
  const { championships: champData, competitions } = ctx || await loadData();
  const compMap = new Map(competitions.map(c => [c.id, c]));
  
  const apiChamps = champData
    .filter(ch => compMap.has(ch.competition_id))
    .map(ch => transformCompetition(compMap.get(ch.competition_id)!, ch.championship_type) as ApiChampionship)
    .sort((a, b) => new Date(b.date.from).getTime() - new Date(a.date.from).getTime());
  
  const total = apiChamps.length;
  const pages = paginate(apiChamps);
  await Promise.all(pages.map((p, i) => writeApiJson(i === 0 ? "championships.json" : `championships-page-${i + 1}.json`, createOverview(p, i + 1, total))));
  
  const writes: Array<{ path: string; data: unknown }> = [];
  const byRegion = groupBy(apiChamps, c => c.region!);
  for (const [k, v] of byRegion) writes.push({ path: `championships/${k}.json`, data: createOverview(v) });
  for (const c of apiChamps) writes.push({ path: `championships/${c.id}.json`, data: c });
  
  for (let i = 0; i < writes.length; i += 100) {
    await writeBatch(writes.slice(i, i + 100));
    if ((i + 100) % 1000 === 0 || i + 100 >= writes.length) progress(Math.min(i + 100, writes.length), writes.length, "championships");
  }
  progress(writes.length, writes.length, "championships");
}
