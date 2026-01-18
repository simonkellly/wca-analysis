import type { DataContext } from "../data";
import { loadData } from "../data";
import { transformCompetition, groupBy, paginate, createOverview, writeBatched } from "../utils";

export async function generateCompetitions(ctx?: DataContext): Promise<void> {
  const { competitions: comps } = ctx || await loadData();
  const apiComps = comps.sort((a, b) => new Date(b.year, b.month, b.day).getTime() - new Date(a.year, a.month, a.day).getTime()).map(c => transformCompetition(c));
  const total = apiComps.length;
  
  const writes: Array<{ path: string; data: unknown }> = [];
  const pages = paginate(apiComps);
  for (let i = 0; i < pages.length; i++) {
    writes.push({ path: i === 0 ? "competitions.json" : `competitions-page-${i + 1}.json`, data: createOverview(pages[i], i + 1, total) });
  }
  
  for (const [k, v] of groupBy(apiComps, c => c.country)) writes.push({ path: `competitions/${k}.json`, data: createOverview(v) });
  for (const [k, v] of groupBy(apiComps, c => c.date.from.slice(0, 4))) writes.push({ path: `competitions/${k}.json`, data: createOverview(v) });
  for (const [k, v] of groupBy(apiComps, c => c.date.from.slice(0, 7).replace("-", "/"))) writes.push({ path: `competitions/${k}.json`, data: createOverview(v) });
  for (const [k, v] of groupBy(apiComps, c => c.date.from.replace(/-/g, "/"))) writes.push({ path: `competitions/${k}.json`, data: createOverview(v) });
  
  const byEvent = new Map<string, typeof apiComps>();
  for (const c of apiComps) {
    for (const e of c.events) {
      const arr = byEvent.get(e) ?? [];
      if (!byEvent.has(e)) byEvent.set(e, arr);
      arr.push(c);
    }
  }
  
  for (const [e, list] of byEvent) {
    const p = paginate(list);
    for (let i = 0; i < p.length; i++) {
      writes.push({ path: `competitions/${i === 0 ? e : `${e}-page-${i+1}`}.json`, data: createOverview(p[i]) });
    }
  }
  
  for (const c of apiComps) writes.push({ path: `competitions/${c.id}.json`, data: c });
  
  await writeBatched(writes, 1000, "competitions", 10000);
}
