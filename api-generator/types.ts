export type ApiPagination = { page: number; size: number };
export type ApiOverview<T> = { pagination: ApiPagination; total: number; items: T[] };

export type ApiCompetition = {
  id: string; name: string; city: string; country: string;
  date: { from: string; till: string; numberOfDays: number };
  isCanceled: boolean; events: string[];
  wcaDelegates: { name: string; email: string }[];
  organisers: { name: string; email: string }[];
  venue: { name: string; address: string; details: string | null; coordinates: { latitude: number; longitude: number } };
  information: string | null; externalWebsite: string | null;
};

export type ApiChampionship = ApiCompetition & { region?: string };

export type ApiPersonRank = { eventId: string; best: number; rank: { world: number; continent: number; country: number } };
export type ApiPersonResult = { round: string; position: number; best: number; average: number; format: string; solves: number[] };

export type ApiPerson = {
  id: string; name: string; slug: string; country: string;
  numberOfCompetitions: number; competitionIds: string[];
  numberOfChampionships: number; championshipIds: string[];
  rank: { singles: ApiPersonRank[]; averages: ApiPersonRank[] };
  medals: { gold: number; silver: number; bronze: number };
  records: { single: { WR: number; CR: number; NR: number }; average: { WR: number; CR: number; NR: number } };
  results: Record<string, Record<string, ApiPersonResult[]>>;
};

export type ApiRank = {
  rankType: "single" | "average"; personId: string; eventId: string; best: number;
  rank: { world: number; continent: number; country: number };
};

export type ApiResult = {
  competitionId: string; personId: string; round: string; position: number;
  best: number; average: number; format: string; solves: number[];
};
