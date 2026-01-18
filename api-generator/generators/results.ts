import type { DataContext } from "../data";
import { loadData } from "../data";
import { createOverview, groupBy, writeBatched, ROUND_NAMES, FORMAT_NAMES } from "../utils";

export async function generateResults(ctx?: DataContext): Promise<void> {
  const { results } = ctx || await loadData();
  const byComp = groupBy(results, r => r.competition_id);
  const transform = (x: typeof results[0]) => ({
    competitionId: x.competition_id, personId: x.person_id,
    round: ROUND_NAMES[x.round_type_id] || x.round_type_id, position: x.pos,
    best: x.best, average: x.average, format: FORMAT_NAMES[x.format_id] || x.format_id, solves: x.attempts,
  });
  
  const writes: Array<{ path: string; data: unknown }> = [];
  for (const [id, r] of byComp) {
    const apiRes = r.map(transform);
    writes.push({ path: `results/${id}.json`, data: createOverview(apiRes) });
    for (const [eid, evr] of groupBy(r, x => x.event_id)) {
      writes.push({ path: `results/${id}/${eid}.json`, data: createOverview(evr.map(transform)) });
    }
  }
  
  await writeBatched(writes, 1000, "results");
}
