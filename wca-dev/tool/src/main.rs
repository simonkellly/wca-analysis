// Single-pass, parallel mysqldump -> per-table Parquet converter.
//
//   bsdtar -xOf dump.zip | mysqldump-parquet OUT_DIR
//
// A reader thread splits the (decompressed) dump into per-table batches of raw
// tuple lines and hands them to a pool of worker threads that parse + encode
// Parquet. Relies on mysqldump's default escaping: a raw '\n' only terminates a
// statement, never appears inside data, so we can work line-by-line.
//
// Output: OUT_DIR/<table>/w<n>.parquet (Snappy), plus OUT_DIR/load.sql which
// materialises a fully-typed DuckDB database from the Parquet via TRY_CAST.

use std::collections::HashMap;
use std::env;
use std::fs::{self, File};
use std::io::{self, BufRead, BufReader, BufWriter, Write};
use std::sync::Arc;
use std::thread;

use arrow::array::{ArrayRef, Float64Builder, Int64Builder, StringBuilder};
use arrow::datatypes::{DataType, Field, Schema, SchemaRef};
use arrow::record_batch::RecordBatch;
use crossbeam_channel::{bounded, Receiver, Sender};
use parquet::arrow::ArrowWriter;
use parquet::basic::Compression;
use parquet::file::properties::WriterProperties;

const BATCH_ROWS: usize = 250_000;
const BATCH_BYTES: usize = 16 << 20; // flush a table batch to a worker every ~16 MB

#[derive(Clone, Copy, PartialEq)]
enum CType {
    Int,
    Float,
    Str,
}

/// Physical Arrow/Parquet storage type for a MySQL column.
fn physical_type(sql: &str) -> CType {
    let s = sql.to_ascii_lowercase();
    if s.starts_with("tinyint")
        || s.starts_with("smallint")
        || s.starts_with("mediumint")
        || s.starts_with("bigint")
        || s.starts_with("int")
        || s.starts_with("integer")
        || s.starts_with("bit")
        || s.starts_with("year")
    {
        CType::Int
    } else if s.starts_with("float") || s.starts_with("double") || s.starts_with("real") {
        CType::Float
    } else {
        // decimal/numeric kept as text to preserve exact precision; dates,
        // datetimes, strings, blobs all stored as text and cast in load.sql.
        CType::Str
    }
}

/// DuckDB type for the final typed table, derived from the MySQL column type.
fn duck_type(sql: &str) -> String {
    let s = sql.to_ascii_lowercase();
    let s = s.trim();
    if s.starts_with("tinyint(1)") || s == "boolean" || s == "bool" {
        "BOOLEAN".into()
    } else if s.starts_with("bigint") {
        "BIGINT".into()
    } else if s.starts_with("smallint") || s.starts_with("tinyint") {
        "SMALLINT".into()
    } else if s.starts_with("int") || s.starts_with("integer") || s.starts_with("mediumint")
        || s.starts_with("bit") || s.starts_with("year")
    {
        "INTEGER".into()
    } else if s.starts_with("decimal") || s.starts_with("numeric") {
        // keep the (precision, scale) suffix if present
        let suffix = match (s.find('('), s.find(')')) {
            (Some(a), Some(b)) if b > a => &s[a..=b],
            _ => "(18,3)",
        };
        format!("DECIMAL{suffix}")
    } else if s.starts_with("double") || s.starts_with("real") {
        "DOUBLE".into()
    } else if s.starts_with("float") {
        "FLOAT".into()
    } else if s.starts_with("datetime") || s.starts_with("timestamp") {
        "TIMESTAMP".into()
    } else if s.starts_with("date") {
        "DATE".into()
    } else if s.starts_with("time") {
        "TIME".into()
    } else {
        "VARCHAR".into()
    }
}

fn arrow_type(t: CType) -> DataType {
    match t {
        CType::Int => DataType::Int64,
        CType::Float => DataType::Float64,
        CType::Str => DataType::Utf8,
    }
}

struct TableSchema {
    name: String,
    arrow: SchemaRef,
    types: Vec<CType>,
    cols: Vec<(String, String)>, // (name, mysql_type)
}

struct Batch {
    schema: Arc<TableSchema>,
    data: Vec<u8>, // newline-delimited tuple lines
}

/// Stream state machine: fed one line at a time, dispatches per-table batches.
struct Reader {
    out_dir: String,
    tx: Sender<Batch>,
    schemas: HashMap<String, Arc<TableSchema>>,
    create_cols: Vec<(String, String)>,
    in_create: Option<String>,
    cur: Option<Arc<TableSchema>>,
    buf: Vec<u8>,
    in_insert: bool,
}

impl Reader {
    fn new(out_dir: String, tx: Sender<Batch>) -> Self {
        Reader {
            out_dir,
            tx,
            schemas: HashMap::new(),
            create_cols: Vec::new(),
            in_create: None,
            cur: None,
            buf: Vec::with_capacity(BATCH_BYTES + (1 << 16)),
            in_insert: false,
        }
    }

    fn flush(&mut self) {
        if self.buf.is_empty() {
            return;
        }
        let schema = self.cur.clone().expect("schema for batch");
        self.tx
            .send(Batch {
                schema,
                data: std::mem::take(&mut self.buf),
            })
            .expect("send");
    }

    fn line(&mut self, raw: &[u8]) {
        let line = if raw.last() == Some(&b'\r') {
            &raw[..raw.len() - 1]
        } else {
            raw
        };

        if let Some(tbl) = self.in_create.clone() {
            let trimmed = trim_start(line);
            if trimmed.first() == Some(&b'`') {
                if let Some(name) = backtick_name(trimmed) {
                    let after = &trimmed[name_end(trimmed)..];
                    let ty = first_token(after);
                    self.create_cols.push((name, ty));
                }
            } else if trimmed.first() == Some(&b')') {
                if !self.create_cols.is_empty() {
                    let fields: Vec<Field> = self
                        .create_cols
                        .iter()
                        .map(|(n, t)| Field::new(n, arrow_type(physical_type(t)), true))
                        .collect();
                    let types = self.create_cols.iter().map(|(_, t)| physical_type(t)).collect();
                    let ts = Arc::new(TableSchema {
                        name: tbl.clone(),
                        arrow: Arc::new(Schema::new(fields)),
                        types,
                        cols: self.create_cols.clone(),
                    });
                    fs::create_dir_all(format!("{}/{tbl}", self.out_dir)).expect("mkdir table");
                    self.schemas.insert(tbl, ts);
                }
                self.in_create = None;
            }
            return;
        }

        if self.in_insert {
            let ends = line.last() == Some(&b';');
            self.buf.extend_from_slice(trim_start(line));
            self.buf.push(b'\n');
            if ends {
                self.in_insert = false;
            }
            if self.buf.len() >= BATCH_BYTES {
                self.flush();
            }
            return;
        }

        if line.starts_with(b"INSERT INTO ") {
            let name = backtick_name(line).expect("insert name");
            if self.cur.as_ref().map(|c| c.name != name).unwrap_or(true) {
                self.flush();
                self.cur = Some(self.schemas.get(&name).expect("INSERT before CREATE").clone());
            }
            let pos = find(line, b"VALUES").expect("VALUES") + 6;
            let payload = trim_start(&line[pos..]);
            if !payload.is_empty() {
                self.buf.extend_from_slice(payload);
                self.buf.push(b'\n');
            }
            self.in_insert = line.last() != Some(&b';');
            if self.buf.len() >= BATCH_BYTES {
                self.flush();
            }
        } else if line.starts_with(b"CREATE TABLE ") {
            self.in_create = Some(backtick_name(line).expect("create name"));
            self.create_cols.clear();
        }
    }

    fn finish(mut self) -> HashMap<String, Arc<TableSchema>> {
        self.flush();
        drop(self.tx);
        self.schemas
    }
}

fn main() {
    let out_dir = env::args().nth(1).expect("usage: mysqldump-parquet OUT_DIR");
    fs::create_dir_all(&out_dir).expect("create out dir");

    let nworkers = thread::available_parallelism()
        .map(|n| n.get().saturating_sub(1).max(1))
        .unwrap_or(4);

    let (tx, rx) = bounded::<Batch>(nworkers * 4);
    let mut handles = Vec::new();
    for id in 0..nworkers {
        let rx = rx.clone();
        let out = out_dir.clone();
        handles.push(thread::spawn(move || worker(id, rx, out)));
    }
    drop(rx);

    // ---- reader (this thread): BufReader line scan ----
    let mut rd = Reader::new(out_dir.clone(), tx);
    {
        let stdin = io::stdin();
        let mut reader = BufReader::with_capacity(1 << 20, stdin.lock());
        let mut line: Vec<u8> = Vec::with_capacity(1 << 16);
        loop {
            line.clear();
            let n = reader.read_until(b'\n', &mut line).expect("read");
            if n == 0 {
                break;
            }
            let mut end = line.len();
            while end > 0 && (line[end - 1] == b'\n' || line[end - 1] == b'\r') {
                end -= 1;
            }
            rd.line(&line[..end]);
        }
    }
    let schemas = rd.finish();

    // ---- collect per-table counts from workers ----
    let mut counts: HashMap<String, u64> = HashMap::new();
    for h in handles {
        for (name, c) in h.join().expect("worker join") {
            *counts.entry(name).or_insert(0) += c;
        }
    }

    write_outputs(&out_dir, &schemas, &counts);

    let total: u64 = counts.values().sum();
    eprintln!(
        "tables: {} ({} with rows), rows: {}, workers: {}",
        schemas.len(),
        counts.values().filter(|&&c| c > 0).count(),
        total,
        nworkers
    );
}

struct WTable {
    schema: SchemaRef,
    types: Vec<CType>,
    builders: Vec<ColBuilder>,
    writer: ArrowWriter<BufWriter<File>>,
    rows: usize,
    total: u64,
}

fn worker(id: usize, rx: Receiver<Batch>, out_dir: String) -> HashMap<String, u64> {
    let props = Arc::new(
        WriterProperties::builder()
            .set_compression(Compression::SNAPPY)
            .set_max_row_group_size(BATCH_ROWS)
            .build(),
    );
    let mut tables: HashMap<String, WTable> = HashMap::new();

    for batch in rx.iter() {
        let name = batch.schema.name.clone();
        let wt = tables.entry(name).or_insert_with(|| {
            let path = format!("{}/{}/w{}.parquet", out_dir, batch.schema.name, id);
            let file =
                BufWriter::with_capacity(1 << 20, File::create(&path).expect("create parquet"));
            let writer = ArrowWriter::try_new(file, batch.schema.arrow.clone(), Some((*props).clone()))
                .expect("writer");
            WTable {
                schema: batch.schema.arrow.clone(),
                types: batch.schema.types.clone(),
                builders: batch.schema.types.iter().map(|t| ColBuilder::new(*t)).collect(),
                writer,
                rows: 0,
                total: 0,
            }
        });
        for raw in batch.data.split(|&b| b == b'\n') {
            if raw.is_empty() {
                continue;
            }
            parse_into(raw, wt);
        }
        if wt.rows >= BATCH_ROWS {
            flush_rowgroup(wt);
        }
    }

    let mut counts = HashMap::new();
    for (name, mut wt) in tables.drain() {
        flush_rowgroup(&mut wt);
        wt.writer.close().expect("close parquet");
        counts.insert(name, wt.total);
    }
    counts
}

fn flush_rowgroup(wt: &mut WTable) {
    if wt.rows == 0 {
        return;
    }
    let arrays: Vec<ArrayRef> = wt.builders.iter_mut().map(|b| b.finish()).collect();
    let batch = RecordBatch::try_new(wt.schema.clone(), arrays).expect("batch");
    wt.writer.write(&batch).expect("write batch");
    wt.rows = 0;
}

enum ColBuilder {
    Int(Int64Builder),
    Float(Float64Builder),
    Str(StringBuilder),
}

impl ColBuilder {
    fn new(t: CType) -> Self {
        match t {
            CType::Int => ColBuilder::Int(Int64Builder::with_capacity(BATCH_ROWS)),
            CType::Float => ColBuilder::Float(Float64Builder::with_capacity(BATCH_ROWS)),
            CType::Str => ColBuilder::Str(StringBuilder::with_capacity(BATCH_ROWS, BATCH_ROWS * 8)),
        }
    }
    fn finish(&mut self) -> ArrayRef {
        match self {
            ColBuilder::Int(b) => Arc::new(b.finish()),
            ColBuilder::Float(b) => Arc::new(b.finish()),
            ColBuilder::Str(b) => Arc::new(b.finish()),
        }
    }
    fn append_null(&mut self) {
        match self {
            ColBuilder::Int(b) => b.append_null(),
            ColBuilder::Float(b) => b.append_null(),
            ColBuilder::Str(b) => b.append_null(),
        }
    }
}

/// Parse all tuples on one payload line into the table builders.
fn parse_into(payload: &[u8], wt: &mut WTable) {
    let n = payload.len();
    let ncol = wt.types.len();
    let mut i = 0;
    let mut strbuf: Vec<u8> = Vec::with_capacity(64);
    loop {
        while i < n && (payload[i] == b' ' || payload[i] == b'\t') {
            i += 1;
        }
        if i >= n || payload[i] == b';' {
            return;
        }
        if payload[i] != b'(' {
            return;
        }
        i += 1;
        for c in 0..ncol {
            let b = payload[i];
            if b == b'N' && payload[i..].starts_with(b"NULL") {
                wt.builders[c].append_null();
                i += 4;
            } else if b == b'\'' {
                i += 1;
                strbuf.clear();
                loop {
                    let ch = payload[i];
                    if ch == b'\\' {
                        let e = payload[i + 1];
                        strbuf.push(match e {
                            b'0' => 0,
                            b'n' => b'\n',
                            b'r' => b'\r',
                            b't' => b'\t',
                            b'b' => 8,
                            b'Z' => 26,
                            other => other,
                        });
                        i += 2;
                    } else if ch == b'\'' {
                        i += 1;
                        break;
                    } else {
                        strbuf.push(ch);
                        i += 1;
                    }
                }
                append_scalar(&mut wt.builders[c], &strbuf);
            } else {
                let start = i;
                while payload[i] != b',' && payload[i] != b')' {
                    i += 1;
                }
                append_scalar(&mut wt.builders[c], &payload[start..i]);
            }
            if c + 1 < ncol {
                i += 1; // ','
            }
        }
        i += 1; // ')'
        wt.rows += 1;
        wt.total += 1;
        while i < n && (payload[i] == b' ' || payload[i] == b'\t') {
            i += 1;
        }
        if i < n && payload[i] == b',' {
            i += 1;
        } else {
            return;
        }
    }
}

fn append_scalar(b: &mut ColBuilder, bytes: &[u8]) {
    match b {
        ColBuilder::Int(bu) => bu.append_value(parse_i64(bytes)),
        ColBuilder::Float(bu) => {
            let s = std::str::from_utf8(bytes).unwrap_or("0");
            bu.append_value(s.parse::<f64>().unwrap_or(0.0));
        }
        ColBuilder::Str(bu) => bu.append_value(String::from_utf8_lossy(bytes)),
    }
}

fn parse_i64(bytes: &[u8]) -> i64 {
    let mut i = 0;
    let mut neg = false;
    if bytes.first() == Some(&b'-') {
        neg = true;
        i = 1;
    }
    let mut v: i64 = 0;
    while i < bytes.len() {
        let d = bytes[i];
        if !d.is_ascii_digit() {
            break;
        }
        v = v * 10 + (d - b'0') as i64;
        i += 1;
    }
    if neg {
        -v
    } else {
        v
    }
}

/// Write load.sql (typed materialisation) and schema.json.
fn write_outputs(
    out_dir: &str,
    schemas: &HashMap<String, Arc<TableSchema>>,
    counts: &HashMap<String, u64>,
) {
    let mut names: Vec<&String> = schemas.keys().collect();
    names.sort();

    let mut sql = String::new();
    sql.push_str("PRAGMA disable_progress_bar;\nSET preserve_insertion_order = false;\n\n");
    let mut json = String::from("{\n  \"tables\": {\n");

    for (ti, name) in names.iter().enumerate() {
        let ts = &schemas[*name];
        let has_rows = counts.get(*name).copied().unwrap_or(0) > 0;

        if has_rows {
            sql.push_str(&format!("CREATE OR REPLACE TABLE \"{name}\" AS SELECT\n"));
            let cols: Vec<String> = ts
                .cols
                .iter()
                .map(|(c, mt)| {
                    let dt = duck_type(mt);
                    if dt == "VARCHAR" {
                        format!("  \"{c}\"")
                    } else {
                        format!("  TRY_CAST(\"{c}\" AS {dt}) AS \"{c}\"")
                    }
                })
                .collect();
            sql.push_str(&cols.join(",\n"));
            sql.push_str(&format!(
                "\nFROM read_parquet('{out_dir}/{name}/*.parquet');\n\n"
            ));
        } else {
            // empty table: create the typed shell with no rows
            let cols: Vec<String> = ts
                .cols
                .iter()
                .map(|(c, mt)| format!("  \"{c}\" {}", duck_type(mt)))
                .collect();
            sql.push_str(&format!(
                "CREATE OR REPLACE TABLE \"{name}\" (\n{}\n);\n\n",
                cols.join(",\n")
            ));
        }

        // schema.json entry
        json.push_str(&format!("    \"{name}\": {{ \"rows\": {}, \"columns\": [", counts.get(*name).copied().unwrap_or(0)));
        let jc: Vec<String> = ts
            .cols
            .iter()
            .map(|(c, mt)| format!("{{\"name\":\"{c}\",\"mysql\":\"{}\",\"duck\":\"{}\"}}", mt, duck_type(mt)))
            .collect();
        json.push_str(&jc.join(","));
        json.push_str("] }");
        if ti + 1 < names.len() {
            json.push(',');
        }
        json.push('\n');
    }
    json.push_str("  }\n}\n");

    File::create(format!("{out_dir}/load.sql"))
        .and_then(|mut f| f.write_all(sql.as_bytes()))
        .expect("write load.sql");
    File::create(format!("{out_dir}/schema.json"))
        .and_then(|mut f| f.write_all(json.as_bytes()))
        .expect("write schema.json");
}

fn backtick_name(line: &[u8]) -> Option<String> {
    let start = line.iter().position(|&b| b == b'`')? + 1;
    let end = start + line[start..].iter().position(|&b| b == b'`')?;
    Some(String::from_utf8_lossy(&line[start..end]).into_owned())
}

fn trim_start(line: &[u8]) -> &[u8] {
    let mut i = 0;
    while i < line.len() && (line[i] == b' ' || line[i] == b'\t') {
        i += 1;
    }
    &line[i..]
}

fn name_end(trimmed: &[u8]) -> usize {
    let start = trimmed.iter().position(|&b| b == b'`').unwrap() + 1;
    start + trimmed[start..].iter().position(|&b| b == b'`').unwrap() + 1
}

/// Extract the column type token, keeping any parenthesised suffix like
/// "decimal(10,2)" or "varchar(255)" intact (commas inside parens don't end it).
fn first_token(s: &[u8]) -> String {
    let s = trim_start(s);
    let mut depth = 0i32;
    let mut end = s.len();
    for (i, &b) in s.iter().enumerate() {
        match b {
            b'(' => depth += 1,
            b')' => depth -= 1,
            b' ' | b',' if depth == 0 => {
                end = i;
                break;
            }
            _ => {}
        }
    }
    String::from_utf8_lossy(&s[..end]).into_owned()
}

fn find(haystack: &[u8], needle: &[u8]) -> Option<usize> {
    memchr::memmem::find(haystack, needle)
}
