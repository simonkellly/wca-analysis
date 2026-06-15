# wca-dev

Self-contained pipeline that turns the WCA **developer** database dump (a MySQL
dump, ~5 GB uncompressed, all 123 tables) into a typed DuckDB database — fast.

```sh
bun run wca-dev:build
# -> wca-dev/cache/wca-dev.duckdb

bun run wca-dev:ui
# -> builds if needed, then DuckDB UI at http://localhost:4213
```

Everything lives in this folder; nothing else in the repo depends on it. Build
outputs (`cache/`, `tool/target/`) are git-ignored. Pre-built `bsdtar` and
`mysqldump-parquet` binaries are vendored under `bin/<platform>/`.

## How it works

```
bsdtar -xOf dump.zip | bin/…/mysqldump-parquet  ->  cache/parquet/<table>/*.parquet
duckdb wca-dev.duckdb < cache/parquet/load.sql   ->  typed native tables
```

- **`bsdtar`** decompresses the zip ~7× faster than `unzip` and streams straight
  into the converter — no `.sql` ever written to disk. Pre-built binaries from
  [hermeticbuild/bsdtar-prebuilt](https://github.com/hermeticbuild/bsdtar-prebuilt)
  are bundled for macOS and Linux.
- **`mysqldump-parquet`** is a single-pass, multi-threaded Rust converter in
  `tool/`. Pre-built binaries are bundled; use `--rebuild-tool` to compile from
  source instead.
- **DuckDB** materialises a fully-typed native database from the Parquet
  (`tinyint(1)`→BOOLEAN, `decimal(p,s)`, `datetime`→TIMESTAMP, `date`→DATE, …).

Timings on an M-series laptop: ~15s to Parquet, ~40s end-to-end to the native db
(vs. ~2m53s for the old unzip → sql-to-csv → DuckDB pipeline).

## Flags

| Flag | Effect |
|---|---|
| `--fresh` | re-download the dump before building |
| `--parquet-only` | stop at Parquet; query lazily via `load.sql` |
| `--rebuild-tool` | force-recompile the Rust converter |

## GitHub Codespaces

The devcontainer installs Bun and DuckDB (≥ 1.2.1, with UI support). Port **4213**
is forwarded automatically for the DuckDB UI.

1. Create a codespace on `main`
2. `bun run wca-dev:ui` — downloads the dump on first run, builds the db, starts the UI
3. Open the forwarded **DuckDB UI** port in your browser

No Rust toolchain or system `bsdtar` is required — bundled binaries are used.

## Requirements (local)

- **DuckDB** CLI ≥ 1.2.1 (`duckdb -ui` / `CALL start_ui_server()`)
- **Bun** to run the build scripts
- Pre-built binaries in `bin/` (included in the repo), or:
  - `cargo` to compile the converter (`--rebuild-tool`)
  - `bun wca-dev/prepare-binaries.ts --bsdtar` if bsdtar is missing on Linux

### Refreshing vendored binaries

```sh
bun wca-dev/prepare-binaries.ts --all    # all platforms (Docker or cargo-zigbuild for Linux cross-build)
bun wca-dev/prepare-binaries.ts --manifest   # rewrite bin/manifest.json only
```

Linux cross-builds from macOS use [cargo-zigbuild](https://github.com/rust-cross/cargo-zigbuild)
(`brew install zig && cargo install cargo-zigbuild`) or Docker (`rust:bookworm`).
