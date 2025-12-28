export type Championship = {
  id: number;
  competition_id: string;
  championship_type: string;
};

export type ChampionshipEligibility = {
  championship_type: string;
  eligible_country_iso2: string;
};

export type Competition = {
  id: string;
  name: string;
  information: string;
  external_website: string;
  venue: string;
  city_name: string;
  country_id: string;
  venue_address: string;
  venue_details: string;
  cell_name: string;
  cancelled: number;
  event_specs: string;
  delegates: string;
  organizers: string;
  year: number;
  month: number;
  day: number;
  end_year: number;
  end_month: number;
  end_day: number;
  latitude_microdegrees: number;
  longitude_microdegrees: number;
};

export type Continent = {
  id: string;
  name: string;
  record_name: string;
};

export type Country = {
  id: string;
  name: string;
  continent_id: string;
  iso2: string;
};

export type Event = {
  id: string;
  format: string;
  name: string;
  rank: number;
};

export type Format = {
  id: string;
  expected_solve_count: number;
  name: string;
  sort_by: string;
  sort_by_second: string;
  trim_fastest_n: number;
  trim_slowest_n: number;
};

export type Person = {
  name: string;
  gender: string;
  wca_id: string;
  sub_id: number;
  country_id: string;
};

export type RanksAverage = {
  best: number;
  person_id: string;
  event_id: string;
  world_rank: number;
  continent_rank: number;
  country_rank: number;
};

export type RanksSingle = {
  best: number;
  person_id: string;
  event_id: string;
  world_rank: number;
  continent_rank: number;
  country_rank: number;
};

export type Result = {
  id: number;
  pos: number;
  best: number;
  average: number;
  competition_id: string;
  round_type_id: string;
  event_id: string;
  person_name: string;
  person_id: string;
  format_id: string;
  regional_single_record: string;
  regional_average_record: string;
  person_country_id: string;
};

export type ResultAttempt = {
  id: number;
  value: number;
  attempt_number: number;
  result_id: number;
  created_at: string;
  updated_at: string;
};

export type RoundType = {
  id: number;
  cell_name: string;
  final: number;
  name: string;
  rank: number;
};

export type Scramble = {
  scramble: string;
  id: number;
  competition_id: string;
  event_id: string;
  group_id: string;
  is_extra: number;
  round_type_id: number;
  scramble_num: number;
};

export function processChampionshipTSVString(line: string): Championship {
  const [id, competition_id, championship_type] = line.split('\t');
  return {
    id: parseInt(id),
    competition_id,
    championship_type,
  };
}

export function processCompetitionTSVString(line: string): Competition {
  const [
    id,
    name,
    information,
    external_website,
    venue,
    city_name,
    country_id,
    venue_address,
    venue_details,
    cell_name,
    cancelled,
    event_specs,
    delegates,
    organizers,
    year,
    month,
    day,
    end_year,
    end_month,
    end_day,
    latitude_microdegrees,
    longitude_microdegrees,
  ] = line.split('\t');
  return {
    id,
    name,
    information,
    external_website,
    venue,
    city_name,
    country_id,
    venue_address,
    venue_details,
    cell_name,
    cancelled: parseInt(cancelled),
    event_specs,
    delegates,
    organizers,
    year: parseInt(year),
    month: parseInt(month),
    day: parseInt(day),
    end_year: parseInt(end_year),
    end_month: parseInt(end_month),
    end_day: parseInt(end_day),
    latitude_microdegrees: parseInt(latitude_microdegrees),
    longitude_microdegrees: parseInt(longitude_microdegrees),
  };
}

export function processPersonTSVString(line: string): Person {
  const [name, gender, wca_id, sub_id, country_id] = line.split('\t');
  return {
    name,
    gender,
    wca_id,
    sub_id: parseInt(sub_id),
    country_id,
  };
}

export function processRanksAverageTSVString(line: string): RanksAverage {
  const [best, person_id, event_id, world_rank, continent_rank, country_rank] = line.split('\t');
  return {
    best: parseInt(best),
    person_id,
    event_id,
    world_rank: parseInt(world_rank),
    continent_rank: parseInt(continent_rank),
    country_rank: parseInt(country_rank),
  };
}

export function processRanksSingleTSVString(line: string): RanksSingle {
  const [best, person_id, event_id, world_rank, continent_rank, country_rank] = line.split('\t');
  return {
    best: parseInt(best),
    person_id,
    event_id,
    world_rank: parseInt(world_rank),
    continent_rank: parseInt(continent_rank),
    country_rank: parseInt(country_rank),
  };
}

export function processResultAttemptTSVString(line: string): ResultAttempt {
  const [id, value, attempt_number, result_id, created_at, updated_at] = line.split('\t');
  return {
    id: parseInt(id),
    value: parseInt(value),
    attempt_number: parseInt(attempt_number),
    result_id: parseInt(result_id),
    created_at,
    updated_at,
  };
}

export function processResultTSVString(line: string): Result {
  const [
    id,
    pos,
    best,
    average,
    competition_id,
    round_type_id,
    event_id,
    person_name,
    person_id,
    format_id,
    regional_single_record,
    regional_average_record,
    person_country_id,
  ] = line.split('\t');
  return {
    id: parseInt(id),
    pos: parseInt(pos),
    best: parseInt(best),
    average: parseInt(average),
    competition_id,
    round_type_id,
    event_id,
    person_name,
    person_id,
    format_id,
    regional_single_record,
    regional_average_record,
    person_country_id,
  };
}

export function processRoundTypeTSVString(line: string): RoundType {
  const [id, cell_name, final, name, rank] = line.split('\t');
  return {
    id: parseInt(id),
    cell_name,
    final: parseInt(final),
    name,
    rank: parseInt(rank),
  };
}
