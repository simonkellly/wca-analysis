import { dirname } from "node:path";
import { mkdir } from "node:fs/promises";
import type { Competition } from "../lib/schema";
import type { ApiCompetition, ApiOverview } from "./types";
import { getCountryIso2Code } from "./generators/countries";

export const API_OUTPUT_DIR = "api-output";
export const PAGE_SIZE = 1000;

export const ROUND_NAMES: Record<string, string> = {
  "0": "Qualification round", "1": "First round", "2": "Second round", "3": "Semi Final", "b": "B Final",
  "c": "Combined First round", "d": "Combined Second round", "e": "Combined Third round", "f": "Final",
  "g": "Combined Final", "h": "Combined qualification",
};

export const FORMAT_NAMES: Record<string, string> = {
  "1": "Best of 1", "2": "Best of 2", "3": "Best of 3", "a": "Average of 5", "m": "Mean of 3",
};

export const EVENT_IDS = ["222", "333bf", "333", "333fm", "333mbf", "333mbo", "333oh", "333ft", "444bf", "444", "555bf", "555", "666", "777", "clock", "magic", "mmagic", "minx", "pyram", "skewb", "sq1"];

const createdDirs = new Set<string>();

async function ensureDir(dir: string): Promise<void> {
  if (!createdDirs.has(dir)) {
    await mkdir(dir, { recursive: true });
    createdDirs.add(dir);
  }
}

export async function writeApiJson<T>(path: string, data: T): Promise<void> {
  const fullPath = `${API_OUTPUT_DIR}/${path}`;
  await ensureDir(dirname(fullPath));
  await Bun.write(fullPath, JSON.stringify(data));
}

export async function writeBatch<T>(writes: Array<{ path: string; data: T }>): Promise<void> {
  const pathMap = new Map<string, { path: string; data: T }>();
  for (const write of writes) pathMap.set(write.path, write);
  
  const stringified = [...pathMap.values()].map(({ path, data }) => ({
    path: `${API_OUTPUT_DIR}/${path}`,
    json: JSON.stringify(data),
    dir: dirname(`${API_OUTPUT_DIR}/${path}`),
  }));
  
  await Promise.all([...new Set(stringified.map(s => s.dir))].map(dir => ensureDir(dir)));
  await Promise.all(stringified.map(({ path, json }) => Bun.write(path, json)));
}

export function paginate<T>(items: T[], pageSize = PAGE_SIZE): T[][] {
  const pages: T[][] = [];
  for (let i = 0; i < items.length; i += pageSize) pages.push(items.slice(i, i + pageSize));
  return pages.length ? pages : [[]];
}

export function createOverview<T>(items: T[], page = 1, total?: number): ApiOverview<T> {
  return { pagination: { page, size: PAGE_SIZE }, total: total ?? items.length, items };
}

export function slugify(name: string): string {
  return name.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

export function progress(current: number, total: number, label: string): void {
  const pct = Math.floor((current / total) * 100);
  process.stdout.write(`\r  ${pct}% [${"=".repeat(Math.floor(pct / 4)).padEnd(25)}] ${current}/${total} ${label}`);
  if (current === total) console.log();
}

export function groupBy<T, K extends string | number>(items: T[], keyFn: (item: T) => K): Map<K, T[]> {
  const map = new Map<K, T[]>();
  for (const item of items) {
    const key = keyFn(item);
    const arr = map.get(key) ?? [];
    if (!map.has(key)) map.set(key, arr);
    arr.push(item);
  }
  return map;
}

export function parseDelegate(raw: string): { name: string; email: string }[] {
  if (!raw?.trim()) return [];
  const matches = [...raw.matchAll(/\[\{([^}]+)\}\{mailto:([^}]+)\}\]/g)];
  return matches.length ? matches.map(([, n, e]) => ({ name: n.trim(), email: e.trim() })) : raw.split(",").filter(Boolean).map(n => ({ name: n.trim(), email: "" }));
}

export function transformCompetition(c: Competition, region?: string): ApiCompetition & { region?: string } {
  const pad = (n: number) => String(n).padStart(2, "0");
  const from = new Date(c.year, c.month - 1, c.day);
  const till = new Date(c.end_year, c.end_month - 1, c.end_day);
  return {
    id: c.id, name: c.name, city: c.city_name, country: getCountryIso2Code(c.country_id),
    date: { from: `${c.year}-${pad(c.month)}-${pad(c.day)}`, till: `${c.end_year}-${pad(c.end_month)}-${pad(c.end_day)}`, numberOfDays: Math.ceil((till.getTime() - from.getTime()) / 86400000) + 1 },
    isCanceled: c.cancelled === 1,
    events: c.event_specs?.split(" ").filter(e => EVENT_IDS.includes(e)) || [],
    wcaDelegates: parseDelegate(c.delegates), organisers: parseDelegate(c.organizers),
    venue: { name: c.venue || "", address: c.venue_address || "", details: c.venue_details || null, coordinates: { latitude: c.latitude_microdegrees / 1e6, longitude: c.longitude_microdegrees / 1e6 } },
    information: c.information || null, externalWebsite: c.external_website || null,
    registrationOpen: c.registration_open || null,
    registrationClose: c.registration_close || null,
    ...(region && { region }),
  };
}

export async function writePaginated<T>(baseName: string, items: T[], total: number): Promise<void> {
  const pages = paginate(items);
  await Promise.all(pages.map((p, i) => writeApiJson(i === 0 ? `${baseName}.json` : `${baseName}-page-${i + 1}.json`, createOverview(p, i + 1, total))));
}

export async function writeGrouped<T>(dir: string, groups: Map<string, T[]>): Promise<void> {
  await Promise.all([...groups].map(([k, v]) => writeApiJson(`${dir}/${k}.json`, createOverview(v, 1, v.length))));
}

export async function writeBatched<T>(writes: Array<{ path: string; data: T }>, batchSize: number, label: string, progressInterval = batchSize * 5): Promise<void> {
  for (let i = 0; i < writes.length; i += batchSize) {
    await writeBatch(writes.slice(i, i + batchSize));
    if ((i + batchSize) % progressInterval === 0 || i + batchSize >= writes.length) {
      progress(Math.min(i + batchSize, writes.length), writes.length, label);
    }
  }
  if (writes.length > 0) progress(writes.length, writes.length, label);
}
