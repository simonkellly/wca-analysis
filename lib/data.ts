import { processChampionshipTSVString, processCompetitionTSVString, processResultTSVString, processResultAttemptTSVString, processRoundTypeTSVString, processPersonTSVString, processRanksAverageTSVString, processRanksSingleTSVString, type ResultAttempt } from "./schema"

export async function* readLines<T>(filePath: string, parser: (line: string) => T) {
  const reader = Bun.file('wca_export/WCA_export_' + filePath).stream().pipeThrough(new TextDecoderStream('utf-8')).getReader()

  let remainder = ''
  while(true) {
      const {value, done} = await reader.read()
      if(done) break
      let lines = (remainder + value).split(/\r?\n/)
      remainder = lines.pop()!

      for(const line of lines) {
          yield parser(line)
      }
  }

  if(remainder) {
      yield parser(remainder)
  }
}

function asyncLazy<T>(func: () => Promise<T>) {
  let value: T | undefined;
  let processingPromise:  Promise<T> | undefined;
  return async () => {
    if(processingPromise) {
      return processingPromise;
    }
    if(!value) {
      processingPromise = func();
      value = await processingPromise;
      processingPromise = undefined;
    }
    return value;
  }
}

export const results = asyncLazy(() => Array.fromAsync(readLines(`results.tsv`, processResultTSVString)));
export const resultAttempts = asyncLazy(() => Array.fromAsync(readLines(`result_attempts.tsv`, processResultAttemptTSVString)));
export const competitions = asyncLazy(() => Array.fromAsync(readLines(`competitions.tsv`, processCompetitionTSVString)));
export const championships = asyncLazy(() => Array.fromAsync(readLines(`championships.tsv`, processChampionshipTSVString)));
export const roundTypes = asyncLazy(() => Array.fromAsync(readLines(`round_types.tsv`, processRoundTypeTSVString)));
export const persons = asyncLazy(() => Array.fromAsync(readLines(`persons.tsv`, processPersonTSVString)));
export const ranksAverage = asyncLazy(() => Array.fromAsync(readLines(`ranks_average.tsv`, processRanksAverageTSVString)));
export const ranksSingle = asyncLazy(() => Array.fromAsync(readLines(`ranks_single.tsv`, processRanksSingleTSVString)));

export const resultsWithAttempts = asyncLazy(async () => {
  const resultAttemptsMap = new Map<number, ResultAttempt[]>();
  const resultsData = await results();
  const resultAttemptsData = await resultAttempts();
  for(const attempt of resultAttemptsData) {
    resultAttemptsMap.set(attempt.result_id, [...(resultAttemptsMap.get(attempt.result_id) || []), attempt]);
  }
  return resultsData.map(result => {
    return {
      ...result,
      attempts: resultAttemptsMap.get(result.id)?.sort((a, b) => a.attempt_number - b.attempt_number).map(attempt => attempt.value) || []
    }
  });
});