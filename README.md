# WCA Analysis

![Bun](https://img.shields.io/badge/Bun-%23000000.svg?style=for-the-badge&logo=bun&logoColor=white)
![TypeScript](https://img.shields.io/badge/typescript-%23007ACC.svg?style=for-the-badge&logo=typescript&logoColor=white)


This project is a simple setup to be able to work with the World Cube Association's data exports using typescript rather than SQL.

## Usage
To use this project, you need the [Bun](https://bun.com/) javascript runtime.

To install dependencies:

```bash
bun install
```

To download the data:

```bash
bun run db
```

To run an example script

```bash
bun run scripts/example.ts
```

### GitHub Codespaces

To easily try out this project, you can use GitHub codespaces. Due to the devcontainer configuration, it will automatically include Bun and download the WCA data.
To do this click "Code" → "Codespaces" → "Create codespace on main".

## Working With Data

This project allows you to utilise the WCA's export data by calling lazy-loaded async functions. These provide typed versions of the TSV data in the `wca_export/` folder (which is created when downloading the data).

I tend to use the `linq-to-typescript` package when manipulating the data, to have a more sql-like experience. Check out `scripts/example.ts` to see how that works.

### Accessing Data

Import data functions from `@/data`:

```typescript
import { 
  results, 
  resultAttempts, 
  competitions, 
  championships, 
  roundTypes, 
  persons, 
  ranksAverage, 
  ranksSingle,
  resultsWithAttempts 
} from "@/data";
```

Each function returns a Promise that resolves to an array of typed objects:
- `results()` - All competition results
- `resultAttempts()` - Individual attempt values for results
- `competitions()` - Competition information
- `championships()` - Championship competitions
- `roundTypes()` - Round type definitions
- `persons()` - Competitor information
- `ranksAverage()` - Ranks by average
- `ranksSingle()` - Ranks by Single
- `resultsWithAttempts()` - Results with attempts pre-joined as an array

Note: Since the v2 results export, individual attempts are not included in the results data by default and you need to use the `resultsWithAttempts` function to utilise this data.

### Usage Pattern

The data is an array by default, so you can use standard javascript, or the linq-to-typescript library:

```typescript
import { competitions, results } from "@/data";
import { from } from "linq-to-typescript";

// Load data (async)
const competitionsData = await competitions();
const resultsData = await results();

// Standard JavaScript
const recentCompetitions = competitionsData.filter(c => c.year >= 2025);
const irishResults = resultsData.filter(r => r.person_country_id === "Ireland");

// linq-to-typescript
const recentCompetitionsLinq = from(competitionsData).where(c => c.year >= 2025);
const irishResultsLinq = from(resultsData).where(r => r.person_country_id === "Ireland");
```

### Types

All data types are defined in `lib/schema.ts`. The code for processing the TSV file entries is also here.
