import { championships, competitions, persons, ranksAverage, ranksSingle } from "../lib/data";
import type { Championship, Competition, Person, RanksAverage, RanksSingle } from "../lib/schema";

export type ResultShort = {
  competition_id: string; person_id: string; event_id: string; round_type_id: string; pos: number;
  best: number; average: number; format_id: string; attempts: number[];
  regional_single_record: string; regional_average_record: string;
};

export type DataContext = {
  competitions: Competition[]; championships: Championship[]; persons: Person[];
  ranksSingle: RanksSingle[]; ranksAverage: RanksAverage[]; results: ResultShort[];
};

let cached: DataContext | null = null;
const stringPool = new Map<string, string>();
const intern = (s: string) => { if (!s) return ""; const v = stringPool.get(s); return v ?? (stringPool.set(s, s), s); };

const ATTEMPTS_BUFFER_SIZE = 10_000_000 * 5;
const attemptsBuffer = new Int32Array(ATTEMPTS_BUFFER_SIZE);

async function loadAttempts() {
  const text = await Bun.file("wca_export/WCA_export_result_attempts.tsv").text();
  let lineStart = text.indexOf('\n') + 1;
  while (true) {
    const lineEnd = text.indexOf('\n', lineStart);
    if (lineEnd === -1) break;
    const t1 = text.indexOf('\t', lineStart);
    const t2 = text.indexOf('\t', t1 + 1);
    if (t1 !== -1 && t2 !== -1 && t2 < lineEnd) {
      const id = parseInt(text.slice(t2 + 1, lineEnd), 10);
      const attempt = parseInt(text.slice(t1 + 1, t2), 10);
      if (id < 10_000_000 && attempt >= 1 && attempt <= 5) {
        attemptsBuffer[id * 5 + (attempt - 1)] = parseInt(text.slice(lineStart, t1), 10);
      }
    }
    lineStart = lineEnd + 1;
  }
}

async function readResults(): Promise<ResultShort[]> {
  await loadAttempts();
  const text = await Bun.file("wca_export/WCA_export_results.tsv").text();
  const rows: ResultShort[] = [];
  let lineStart = text.indexOf('\n') + 1;
  while (true) {
    const lineEnd = text.indexOf('\n', lineStart);
    if (lineEnd === -1) break;
    const p = text.slice(lineStart, lineEnd).split('\t');
    if (p.length >= 13) {
      const id = parseInt(p[0], 10);
      const o = id * 5;
      rows.push({
        competition_id: intern(p[4]), event_id: intern(p[6]), round_type_id: intern(p[5]),
        pos: parseInt(p[1], 10), best: parseInt(p[2], 10), average: parseInt(p[3], 10),
        person_id: intern(p[8]), format_id: intern(p[9]),
        attempts: [attemptsBuffer[o], attemptsBuffer[o+1], attemptsBuffer[o+2], attemptsBuffer[o+3], attemptsBuffer[o+4]],
        regional_single_record: intern(p[10]), regional_average_record: intern(p[11])
      });
    }
    lineStart = lineEnd + 1;
  }
  return rows;
}

export async function loadData(): Promise<DataContext> {
  if (cached) return cached;
  const [comps, champs, pers, single, avg] = await Promise.all([competitions(), championships(), persons(), ranksSingle(), ranksAverage()]);
  cached = {
    competitions: comps.slice(1).filter(c => c.id), championships: champs.slice(1).filter(c => c.competition_id),
    persons: pers.slice(1).filter(p => p.wca_id), ranksSingle: single.slice(1).filter(r => r.person_id),
    ranksAverage: avg.slice(1).filter(r => r.person_id), results: await readResults(),
  };
  return cached;
}
