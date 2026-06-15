# WCA developer database — data guide

The developer dump is the full MySQL schema behind [worldcubeassociation.org](https://www.worldcubeassociation.org) — 123 tables, not just the public TSV export. After `bun wca-dev/build.ts` it lives at `cache/wca-dev.duckdb`. Query with the DuckDB CLI or `bun wca-dev/ui.ts`.

For complete column lists and types, inspect the built database (`DESCRIBE "table_name"`) or `cache/parquet/schema.json` after a build. This document covers the tables you actually want, how they connect, and the non-obvious bits.

**Do not confuse this with the public export** documented in the repo root (`lib/schema.ts`, `wca_export/`). Shapes are similar for core tables but column names and richness differ — see [Differences from the public export](#differences-from-the-public-export).

---

## Entity relationships

```
countries ── continent_id ──► continents
persons ── country_id ──► countries

competitions ── id ──► competition_events ── id ──► rounds ── id ──► results ── id ──► result_attempts
     │                    │                              │
     │                    └── event_id ──► events         ├── person_id ──► persons.wca_id
     │                    └── competition_id               ├── event_id ──► events
     │                                                     ├── format_id ──► formats
     │                                                     └── round_type_id ──► round_types
     │
     ├── registrations ── id ──► registration_competition_events ──► competition_events
     │        ├── user_id ──► users
     │        └── registrant_id ──► persons.id
     │
     ├── competition_delegates / competition_organizers ──► users
     ├── competition_venues ──► venue_rooms
     ├── schedule_activities ── round_id ──► rounds
     └── scrambles ── round_id ──► rounds

users.wca_id ──► persons.wca_id   (when the account is linked to a WCA profile)
```

---

## Cross-cutting concepts

### Result values (`results.best`, `results.average`, `result_attempts.value`)

Same encoding as the [public results export](https://www.worldcubeassociation.org/export/results):

| Value | Meaning |
|-------|---------|
| `-1` | DNF |
| `-2` | DNS |
| `0` | No result (e.g. unused average slot in best-of-3) |
| Positive | Event-dependent — see `events.format` |

- **Time events** (`events.format = 'time'`): centiseconds. `1050` → 10.50s.
- **Fewest moves** (`333fm`): single = move count; average = 100 × mean moves (e.g. `2533` → 25.33).
- **Multi-blind** (`333mbf`, `333mbo`): encoded decimal — see the export README for `0DDTTTTTMM` decoding.

`result_attempts` holds individual solves; join on `result_attempts.result_id = results.id`. Zero-valued attempts are omitted from `result_attempts` (only non-zero values are stored).

### IDs and naming

- **`competitions.id`**: string like `IrishOpen2024` (not numeric).
- **`persons.id`**: internal integer primary key.
- **`persons.wca_id`**: public WCA ID string (e.g. `2019SMIT01`).
- **`results.person_id`**: always the **WCA ID string**, not `persons.id`.
- **`round_types.id`**: single-character code (`c` = Final, `h` = Qualification, …). Legacy duplicate IDs exist (e.g. `c` and `f` both mean Final).

### Sensitive data

Avoid selecting or logging from these columns in analysis output:

- **`users`**: `email`, `encrypted_password`, `reset_password_token`, `confirmation_token`, `otp_secret`, `otp_backup_codes`, `session_validity_token`, sign-in IPs
- **`registrations`**: `ip`
- **`oauth_*`**, **`payment_*`**, **`stripe_*`**, **`paypal_*`**: credentials and payment metadata

For competitor demographics, prefer **`persons`** (name, gender, country, dob) over **`users`**.

### Empty or sparse tables in the dump

- **`ranks_average`**, **`ranks_single`**: empty — use the public export or compute from `results`.
- Many Rails/internal tables (OAuth, payments, tickets, live scoring) are present but empty or irrelevant for most analysis.

---

## Core tables

### `results` (~6.6M rows)

One row per competitor per round. The largest analytical table after `result_attempts`.

| Column | Notes |
|--------|-------|
| `id` | PK; FK from `result_attempts` |
| `competition_id` | → `competitions.id` |
| `round_id` | → `rounds.id` (always set in current data) |
| `event_id` | → `events.id` (e.g. `333`, `444`) |
| `format_id` | → `formats.id` (round format, not event format) |
| `round_type_id` | → `round_types.id` |
| `person_id` | WCA ID string → `persons.wca_id` |
| `person_name` | Name as recorded at the competition |
| `country_id` | Competitor's country **at time of comp** (country name string, not ISO) |
| `pos` | Placement in the round |
| `best`, `average` | Encoded result values (see above) |
| `regional_single_record`, `regional_average_record` | Record tags: `WR`, `NR`, `ER`, `AfR`, `AsR`, `OcR`, `NAR`, `SAR`, … |

### `result_attempts` (~30.6M rows)

Individual solves. `attempt_number` is 1-based within the result.

### `persons` (~291K rows)

Canonical competitor profiles.

| Column | Notes |
|--------|-------|
| `id` | Internal PK — used by `registrations.registrant_id` |
| `wca_id` | Public ID — used by `results.person_id`, `users.wca_id` |
| `sub_id` | Sub-ID for multiple people sharing a WCA ID slot (usually 1) |
| `name`, `gender`, `country_id`, `dob` | Profile fields |
| `comments` | Internal WCA notes |

### `competitions` (~18K rows)

| Column | Notes |
|--------|-------|
| `id` | String competition ID |
| `name`, `city_name`, `country_id`, `venue`, `venue_address` | Location / naming |
| `start_date`, `end_date` | `DATE` — use these instead of year/month/day |
| `cancelled_at` | Non-null ⇒ cancelled (no `cancelled` boolean like the public export) |
| `registration_open`, `registration_close` | Registration window |
| `competitor_limit`, `competitor_limit_enabled` | Capacity |
| `results_posted_at`, `results_submitted_at` | Results workflow timestamps |
| `lead_delegate_id` | → `users.id` |

Many more columns cover fees, WCIF generation, Stripe, guest policy, etc. — see `DESCRIBE` when needed.

### `competition_events` (~144K rows)

Which events are held at a competition (junction: one comp × many events).

| Column | Notes |
|--------|-------|
| `competition_id` | → `competitions.id` |
| `event_id` | → `events.id` |
| `fee_lowest_denomination` | Event fee in smallest currency unit |
| `qualification`, `qualification_condition` | Qualification rules (text / JSON) |

### `rounds` (~252K rows)

Round definitions within a competition event (e.g. 3x3 Round 1, 3x3 Final).

| Column | Notes |
|--------|-------|
| `id` | PK — referenced by `results.round_id`, `scrambles.round_id`, `schedule_activities.round_id` |
| `competition_event_id` | → `competition_events.id` |
| `number` | Round number within the event (1, 2, 3, …) |
| `format_id` | Round format (best-of-5, average-of-5, …) |
| `time_limit`, `cutoff` | Text descriptions of limits |
| `advancement_condition` | Who advances to the next round |
| `total_number_of_rounds` | How many rounds planned for this event |

### `registrations` (~1.17M rows)

Online registrations (developer DB only — not in the public export).

| Column | Notes |
|--------|-------|
| `id` | PK |
| `competition_id` | → `competitions.id` |
| `user_id` | → `users.id` (who registered) |
| `registrant_id` | → `persons.id` (who is competing) |
| `competing_status` | `accepted`, `pending`, `cancelled`, `rejected`, `waiting_list` |
| `is_competing` | Boolean; usually true even for cancelled/rejected rows — filter on `competing_status` |
| `deleted_at` | Soft delete — exclude with `deleted_at IS NULL` for active regs |
| `registered_at`, `accepted_at` | Timestamps |
| `roles` | YAML-ish staff roles (`staff-judge`, `staff-scrambler`, …) |
| `guests` | Number of guest passes |

### `registration_competition_events` (~5.2M rows)

Which events each registration signed up for. Join `registration_id` → `registrations.id`, `competition_event_id` → `competition_events.id`.

### `events` (21 rows)

Lookup: `id` (`333`, `222`, `333bf`, …), `name`, `format` (`time`, `number`, `multi`), `rank` (display order).

### `formats` (7 rows)

Round scoring formats: `1` best-of-1, `3` best-of-3, `5` best-of-5, `a` average-of-5, `m` mean-of-3, `h` head-to-head. `expected_solve_count` tells you how many attempts to expect; `sort_by` is `single` or `average`.

### `round_types` (11 rows)

Round *stage* names: Qualification, First round, Semi Final, Final, etc. `final = true` for final rounds. `id` is a single letter used in `results.round_type_id`.

### `countries` (207 rows) / `continents` (7 rows)

`countries.id` is the country **name** string (e.g. `Ireland`), with `iso2` and `continent_id`. Same convention as the public export.

### `scrambles` (~3.1M rows)

Scramble strings per competition/round/group. `round_id` → `rounds.id`; `group_id` is a short group label; `scramble_num` is the scramble index within the set.

---

## Secondary tables (useful for specific questions)

### `users` (~538K rows)

Website accounts. Link to competitors via `users.wca_id = persons.wca_id` (~225K linked). See [Sensitive data](#sensitive-data) — avoid credential columns.

### `schedule_activities` (~565K rows)

Competition schedule: start/end times, linked to `rounds` and `venue_rooms`. `activity_code` encodes event/round/group (WCIF-style).

### `competition_venues` / `venue_rooms`

Physical venues and rooms within a competition. `venue_rooms.competition_venue_id` → `competition_venues.id`.

### `competition_delegates` / `competition_organizers`

Who ran the competition. `delegate_id` / `organizer_id` → `users.id`.

### `delegate_reports` (~18K rows)

Post-competition delegate write-ups: `summary`, `incidents`, `equipment`, `organization`, etc. One per competition (roughly).

### `championships` (~885 rows)

Maps `competition_id` → `championship_type` (e.g. national, continental, `greater_china`).

### `waiting_lists` (~1.7K rows)

JSON `entries` for competitions using a waiting list. Polymorphic via `holder_type` / `holder_id`.

### `user_roles` / `user_groups`

WCA staff roles (delegates, council, teams). Join `user_roles.user_id` → `users.id`, `user_roles.group_id` → `user_groups.id`.

---

## Example queries

```sql
-- Results with event name and round stage for a competition
SELECT r.person_name, e.name AS event, rt.name AS round, r.best, r.average, r.pos
FROM results r
JOIN events e ON e.id = r.event_id
JOIN round_types rt ON rt.id = r.round_type_id
WHERE r.competition_id = 'IrishOpen2024'
ORDER BY e.rank, rt.rank, r.pos;

-- Registrations with events for a competition
SELECT p.wca_id, p.name, reg.competing_status, e.name AS event
FROM registrations reg
JOIN persons p ON p.id = reg.registrant_id
JOIN registration_competition_events rce ON rce.registration_id = reg.id
JOIN competition_events ce ON ce.id = rce.competition_event_id
JOIN events e ON e.id = ce.event_id
WHERE reg.competition_id = 'IrishOpen2024'
  AND reg.deleted_at IS NULL
  AND reg.competing_status = 'accepted';

-- Attempts for a result
SELECT attempt_number, value
FROM result_attempts
WHERE result_id = 12345678
ORDER BY attempt_number;
```

---

## Differences from the public export

| Topic | Public export (`lib/schema.ts`) | Developer DB |
|-------|--------------------------------|--------------|
| Competition dates | `year`, `month`, `day`, `end_*` | `start_date`, `end_date` (`DATE`) |
| Cancelled comps | `cancelled` (0/1) | `cancelled_at` (`TIMESTAMP`, null = not cancelled) |
| Result country | `person_country_id` | `country_id` |
| Round linkage | `round_type_id` only | `round_id` → full `rounds` row + `round_type_id` |
| Persons | `wca_id` as implicit key | `id` (int) + `wca_id`; adds `dob`, `comments` |
| Registrations | Not available | `registrations`, `registration_competition_events` |
| Ranks | `ranks_single`, `ranks_average` TSVs | Tables exist but are **empty** in the dump |
| Users / schedule / delegates | Not available | `users`, `schedule_activities`, `delegate_reports`, … |

When writing TypeScript against the public export, keep using `lib/schema.ts`. For SQL against DuckDB, trust this document and `DESCRIBE`, not the TS types.

---

## Tables you can usually ignore

Rails infrastructure (`ar_internal_metadata`, `schema_migrations`, `active_storage_*`), OAuth (`oauth_*`), payment plumbing (`stripe_*`, `paypal_*`, `payment_intents` — mostly empty), forum archives (`archive_phpbb3_*`), tickets, live scoring (`live_*`), sanity checks, and empty stub tables. They bloat `schema.json` but rarely matter for competition/results analysis.
