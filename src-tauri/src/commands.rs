use calamine::{open_workbook_auto, Reader};
use chardetng::EncodingDetector;
use csv::{ByteRecord, ReaderBuilder};
use duckdb::Connection;
use parquet::file::reader::{FileReader, SerializedFileReader};
use quick_xml::events::Event;
use quick_xml::Reader as XmlReader;
use rusqlite::Connection as SqliteConnection;
use serde::Serialize;
use serde_json::Value;
use std::collections::HashMap;
use std::fs;
use std::io::{BufRead, Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager};
use walkdir::WalkDir;
use zip::ZipArchive;

#[derive(Debug, Clone, Serialize)]
pub struct FileEntry {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    pub children: Option<Vec<FileEntry>>,
}

#[derive(Debug, Clone, Serialize)]
pub struct SupportedFileType {
    pub id: String,
    pub label: String,
    pub extensions: Vec<String>,
    pub searchable: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct XlsxSheetData {
    pub name: String,
    pub rows: Vec<Vec<String>>,
}

#[derive(Debug, Clone, Serialize)]
pub struct XlsxData {
    pub sheets: Vec<XlsxSheetData>,
}

#[derive(Debug, Clone, Serialize)]
pub struct DocxTextData {
    pub text: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileContentData {
    pub content: String,
    pub encoding: String,
    pub is_utf8: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct CsvChunkData {
    pub delimiter: String,
    pub header: Vec<String>,
    pub rows: Vec<Vec<String>>,
    pub next_cursor: Option<u64>,
    pub eof: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ParquetPreviewData {
    pub columns: Vec<String>,
    pub rows: Vec<Vec<String>>,
    pub total_rows: usize,
    pub truncated: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LaunchTarget {
    pub workspace_path: String,
    pub selected_file_path: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DuckDbTablePreviewData {
    pub table_name: String,
    pub columns: Vec<String>,
    pub rows: Vec<Vec<String>>,
    pub total_rows: usize,
    pub truncated: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DuckDbTableInfo {
    pub schema_name: String,
    pub table_name: String,
    pub display_name: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SqliteTableInfo {
    pub table_name: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SqliteTablePreviewData {
    pub table_name: String,
    pub columns: Vec<String>,
    pub rows: Vec<Vec<String>>,
    pub total_rows: usize,
    pub truncated: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct GeoJsonData {
    pub geojson: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileMetaData {
    pub size_bytes: u64,
    pub extension: String,
    pub mime_guess: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GeoJsonTileSessionData {
    pub dataset_id: String,
    pub bounds: Option<[f64; 4]>,
    pub min_zoom: u8,
    pub max_zoom: u8,
    pub total_features: usize,
    pub max_features_per_tile: usize,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GeoJsonTileData {
    pub features: Vec<Value>,
    pub total_features: usize,
    pub truncated: bool,
    pub simplified_features: usize,
    pub fallback_features: usize,
    pub lod_tolerance: f64,
    pub lod_mode: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct GeoJsonPrepareProgressPayload {
    request_id: String,
    stage: String,
    percent: u8,
    message: String,
    total_features: Option<usize>,
    processed_features: Option<usize>,
}

#[derive(Default)]
pub struct GeoJsonTileStore {
    sessions: Mutex<HashMap<String, GeoJsonTileSession>>,
}

#[derive(Debug, Clone)]
struct GeoJsonTileSession {
    indexed_features: Vec<IndexedFeature>,
    file_size_bytes: u64,
    total_features: usize,
    min_zoom: u8,
    max_zoom: u8,
    max_features_per_tile: usize,
    tile_cache: HashMap<String, GeoJsonTileData>,
    resolved_auto_mode: Option<String>,
}

#[derive(Debug, Clone)]
struct IndexedFeature {
    feature: Value,
    bbox: Option<BBox>,
}

#[derive(Debug, Copy, Clone)]
struct BBox {
    min_lng: f64,
    min_lat: f64,
    max_lng: f64,
    max_lat: f64,
}

static GEOJSON_TILE_SESSION_COUNTER: AtomicU64 = AtomicU64::new(1);

fn text_extensions() -> Vec<String> {
    vec![
        "txt".to_string(),
        "text".to_string(),
        "log".to_string(),
        "ini".to_string(),
        "cfg".to_string(),
        "conf".to_string(),
        "yaml".to_string(),
        "yml".to_string(),
        "toml".to_string(),
        "xml".to_string(),
        "sql".to_string(),
        "sh".to_string(),
        "bash".to_string(),
        "zsh".to_string(),
        "fish".to_string(),
        "ps1".to_string(),
        "bat".to_string(),
        "cmd".to_string(),
        "c".to_string(),
        "h".to_string(),
        "cpp".to_string(),
        "hpp".to_string(),
        "py".to_string(),
        "rb".to_string(),
        "go".to_string(),
        "rs".to_string(),
        "java".to_string(),
        "js".to_string(),
        "jsx".to_string(),
        "mjs".to_string(),
        "cjs".to_string(),
        "ts".to_string(),
        "tsx".to_string(),
        "css".to_string(),
        "scss".to_string(),
        "less".to_string(),
        "swift".to_string(),
        "kt".to_string(),
        "dart".to_string(),
        "lua".to_string(),
        "php".to_string(),
        "r".to_string(),
        "properties".to_string(),
        "editorconfig".to_string(),
        "gitignore".to_string(),
        "jsonl".to_string(),
        "ndjson".to_string(),
    ]
}

fn text_special_file_names() -> Vec<String> {
    vec![
        "dockerfile".to_string(),
        "makefile".to_string(),
        "gnumakefile".to_string(),
        ".env".to_string(),
        ".env.local".to_string(),
        ".env.development".to_string(),
        ".env.production".to_string(),
        ".env.test".to_string(),
        ".gitignore".to_string(),
        ".editorconfig".to_string(),
    ]
}

fn spreadsheet_extensions() -> Vec<String> {
    vec![
        "xlsx".to_string(),
        "xlsm".to_string(),
        "xls".to_string(),
        "ods".to_string(),
    ]
}

fn document_extensions() -> Vec<String> {
    vec!["docx".to_string(), "odt".to_string(), "rtf".to_string()]
}

fn parquet_extensions() -> Vec<String> {
    vec!["parquet".to_string()]
}

fn duckdb_extensions() -> Vec<String> {
    vec!["duckdb".to_string(), "ddb".to_string()]
}

fn sqlite_extensions() -> Vec<String> {
    vec![
        "sqlite".to_string(),
        "sqlite3".to_string(),
        "db".to_string(),
    ]
}

fn gpx_extensions() -> Vec<String> {
    vec!["gpx".to_string()]
}

fn kml_extensions() -> Vec<String> {
    vec!["kml".to_string(), "kmz".to_string()]
}

fn supported_file_types() -> Vec<SupportedFileType> {
    vec![
        SupportedFileType {
            id: "md".to_string(),
            label: "Markdown".to_string(),
            extensions: vec!["md".to_string(), "markdown".to_string()],
            searchable: true,
        },
        SupportedFileType {
            id: "html".to_string(),
            label: "HTML".to_string(),
            extensions: vec!["html".to_string(), "htm".to_string()],
            searchable: true,
        },
        SupportedFileType {
            id: "json".to_string(),
            label: "JSON".to_string(),
            extensions: vec!["json".to_string(), "geojson".to_string()],
            searchable: true,
        },
        SupportedFileType {
            id: "csv".to_string(),
            label: "CSV".to_string(),
            extensions: vec!["csv".to_string(), "tsv".to_string()],
            searchable: true,
        },
        SupportedFileType {
            id: "dxf".to_string(),
            label: "DXF".to_string(),
            extensions: vec!["dxf".to_string()],
            searchable: true,
        },
        SupportedFileType {
            id: "text".to_string(),
            label: "Text".to_string(),
            extensions: text_extensions(),
            searchable: true,
        },
        SupportedFileType {
            id: "spreadsheet".to_string(),
            label: "Spreadsheet".to_string(),
            extensions: spreadsheet_extensions(),
            searchable: true,
        },
        SupportedFileType {
            id: "document".to_string(),
            label: "Document".to_string(),
            extensions: document_extensions(),
            searchable: true,
        },
        SupportedFileType {
            id: "parquet".to_string(),
            label: "Parquet".to_string(),
            extensions: parquet_extensions(),
            searchable: false,
        },
        SupportedFileType {
            id: "duckdb".to_string(),
            label: "DuckDB".to_string(),
            extensions: duckdb_extensions(),
            searchable: false,
        },
        SupportedFileType {
            id: "sqlite".to_string(),
            label: "SQLite".to_string(),
            extensions: sqlite_extensions(),
            searchable: false,
        },
        SupportedFileType {
            id: "gpx".to_string(),
            label: "GPX".to_string(),
            extensions: gpx_extensions(),
            searchable: false,
        },
        SupportedFileType {
            id: "kml".to_string(),
            label: "KML".to_string(),
            extensions: kml_extensions(),
            searchable: false,
        },
        SupportedFileType {
            id: "image".to_string(),
            label: "Image".to_string(),
            extensions: vec![
                "png".to_string(),
                "jpg".to_string(),
                "jpeg".to_string(),
                "gif".to_string(),
                "webp".to_string(),
                "svg".to_string(),
                "bmp".to_string(),
                "ico".to_string(),
                "avif".to_string(),
                "tif".to_string(),
                "tiff".to_string(),
            ],
            searchable: false,
        },
        SupportedFileType {
            id: "pdf".to_string(),
            label: "PDF".to_string(),
            extensions: vec!["pdf".to_string()],
            searchable: false,
        },
    ]
}

fn is_extension_in(path: &Path, extensions: &[String]) -> bool {
    path.extension()
        .and_then(|ext| ext.to_str())
        .map(|ext| extensions.iter().any(|e| ext.eq_ignore_ascii_case(e)))
        .unwrap_or(false)
}

fn is_file_name_in(path: &Path, names: &[String]) -> bool {
    path.file_name()
        .and_then(|name| name.to_str())
        .map(|name| names.iter().any(|n| name.eq_ignore_ascii_case(n)))
        .unwrap_or(false)
}

fn is_text_special_file(path: &Path) -> bool {
    is_file_name_in(path, &text_special_file_names())
}

fn is_hidden_path_except_text_special(path: &Path) -> bool {
    let mut components = path.components().peekable();
    while let Some(component) = components.next() {
        let part = component.as_os_str().to_string_lossy();
        if !part.starts_with('.') {
            continue;
        }

        let is_last = components.peek().is_none();
        if is_last && is_text_special_file(path) {
            continue;
        }

        return true;
    }
    false
}

fn is_supported_file(path: &Path) -> bool {
    supported_file_types().iter().any(|kind| {
        is_extension_in(path, &kind.extensions) || (kind.id == "text" && is_text_special_file(path))
    })
}

fn matches_search_target(path: &Path, extensions: &[String], include_text_special: bool) -> bool {
    is_extension_in(path, extensions) || (include_text_special && is_text_special_file(path))
}

fn should_include_hidden_name(name: &str, path: &Path, is_dir: bool) -> bool {
    if !name.starts_with('.') {
        return true;
    }

    if is_dir {
        return false;
    }

    is_text_special_file(path)
}

fn include_text_special_for_filter(file_type_filter: &str) -> bool {
    file_type_filter == "all" || file_type_filter == "text"
}

fn has_supported_file_in_dir(path: &Path) -> bool {
    WalkDir::new(path)
        .into_iter()
        .filter_map(|e| e.ok())
        .filter(|e| !is_hidden_path_except_text_special(e.path()))
        .any(|e| e.file_type().is_file() && is_supported_file(e.path()))
}

fn extensions_from_filter(file_type_filter: &str) -> Vec<String> {
    if file_type_filter == "all" {
        return supported_file_types()
            .into_iter()
            .filter(|kind| kind.searchable)
            .flat_map(|kind| kind.extensions)
            .collect();
    }

    supported_file_types()
        .into_iter()
        .find(|kind| kind.id == file_type_filter && kind.searchable)
        .map(|kind| kind.extensions)
        .unwrap_or_default()
}

fn has_extension(path: &Path, expected_extension: &str) -> bool {
    path.extension()
        .and_then(|ext| ext.to_str())
        .map(|ext| ext.eq_ignore_ascii_case(expected_extension))
        .unwrap_or(false)
}

fn platform_bin_dir_name() -> &'static str {
    if cfg!(target_os = "windows") {
        "windows"
    } else if cfg!(target_os = "macos") {
        "macos"
    } else {
        "linux"
    }
}

fn pandoc_binary_name() -> &'static str {
    if cfg!(target_os = "windows") {
        "pandoc.exe"
    } else {
        "pandoc"
    }
}

fn tectonic_binary_name() -> &'static str {
    if cfg!(target_os = "windows") {
        "tectonic.exe"
    } else {
        "tectonic"
    }
}

fn resolve_bundled_binary(app: &AppHandle, binary_name: &str) -> Result<PathBuf, String> {
    let platform_dir = platform_bin_dir_name();
    let mut candidates: Vec<PathBuf> = Vec::new();

    if let Ok(resource_dir) = app.path().resource_dir() {
        candidates.push(
            resource_dir
                .join("bin")
                .join(platform_dir)
                .join(binary_name),
        );
    }

    if let Ok(cwd) = std::env::current_dir() {
        candidates.push(
            cwd.join("resources")
                .join("bin")
                .join(platform_dir)
                .join(binary_name),
        );
        candidates.push(
            cwd.join("..")
                .join("resources")
                .join("bin")
                .join(platform_dir)
                .join(binary_name),
        );
    }

    for candidate in candidates {
        if candidate.is_file() {
            return candidate
                .canonicalize()
                .map_err(|e| format!("Failed to resolve binary path: {}", e));
        }
    }

    Err(format!(
        "Bundled binary not found: {} (platform: {})",
        binary_name, platform_dir
    ))
}

fn ensure_pdf_extension(path: &Path) -> PathBuf {
    if has_extension(path, "pdf") {
        return path.to_path_buf();
    }
    path.with_extension("pdf")
}

fn parse_delimiter_hint(delimiter_hint: Option<String>) -> Option<u8> {
    delimiter_hint.and_then(|delimiter| match delimiter.as_str() {
        "," => Some(b','),
        "\t" => Some(b'\t'),
        ";" => Some(b';'),
        _ => None,
    })
}

fn split_csv_line_simple(line: &str, delimiter: char) -> Vec<String> {
    let mut cells: Vec<String> = Vec::new();
    let mut current = String::new();
    let mut in_quotes = false;
    let chars: Vec<char> = line.chars().collect();
    let mut i = 0usize;

    while i < chars.len() {
        let ch = chars[i];
        if ch == '"' {
            if in_quotes && i + 1 < chars.len() && chars[i + 1] == '"' {
                current.push('"');
                i += 2;
                continue;
            }
            in_quotes = !in_quotes;
            i += 1;
            continue;
        }

        if !in_quotes && ch == delimiter {
            cells.push(current);
            current = String::new();
            i += 1;
            continue;
        }

        current.push(ch);
        i += 1;
    }

    cells.push(current);
    cells
}

fn score_delimiter(lines: &[String], delimiter: char) -> i64 {
    let mut total_columns = 0i64;
    let mut stable_rows = 0i64;
    let mut expected: Option<usize> = None;

    for line in lines {
        let columns = split_csv_line_simple(line, delimiter).len();
        total_columns += columns as i64;
        if let Some(value) = expected {
            if value == columns {
                stable_rows += 1;
            }
        } else {
            expected = Some(columns);
            stable_rows += 1;
        }
    }

    total_columns + stable_rows * 2
}

fn detect_csv_delimiter(file_path: &Path, file: &mut fs::File) -> Result<u8, String> {
    if has_extension(file_path, "tsv") {
        return Ok(b'\t');
    }

    let mut buf = vec![0u8; 128 * 1024];
    file.seek(SeekFrom::Start(0))
        .map_err(|e| format!("Failed to seek csv file: {}", e))?;
    let len = file
        .read(&mut buf)
        .map_err(|e| format!("Failed to read csv sample: {}", e))?;
    let sample = String::from_utf8_lossy(&buf[..len]).to_string();
    let lines = sample
        .lines()
        .map(|line| line.trim().to_string())
        .filter(|line| !line.is_empty())
        .take(20)
        .collect::<Vec<String>>();

    if lines.is_empty() {
        return Ok(b',');
    }

    let candidates = [',', '\t', ';'];
    let mut best = ',';
    let mut best_score = i64::MIN;
    for candidate in candidates {
        let score = score_delimiter(&lines, candidate);
        if score > best_score {
            best_score = score;
            best = candidate;
        }
    }
    Ok(best as u8)
}

fn record_to_row(record: &ByteRecord) -> Vec<String> {
    record
        .iter()
        .map(|field| String::from_utf8_lossy(field).to_string())
        .collect::<Vec<String>>()
}

fn row_has_visible_content(row: &[String]) -> bool {
    row.len() > 1
        || row
            .first()
            .map(|cell| !cell.trim().is_empty())
            .unwrap_or(false)
}

fn parse_xlsx(path: &Path) -> Result<XlsxData, String> {
    let mut workbook =
        open_workbook_auto(path).map_err(|e| format!("Failed to open xlsx workbook: {}", e))?;
    let sheet_names = workbook.sheet_names().to_owned();

    let mut sheets: Vec<XlsxSheetData> = Vec::new();

    for (index, name) in sheet_names.iter().enumerate() {
        let range = match workbook.worksheet_range_at(index) {
            Some(Ok(range)) => range,
            Some(Err(err)) => {
                return Err(format!("Failed to read sheet '{}': {}", name, err));
            }
            None => continue,
        };

        let rows = range
            .rows()
            .map(|row| {
                row.iter()
                    .map(|cell| cell.to_string())
                    .collect::<Vec<String>>()
            })
            .collect::<Vec<Vec<String>>>();

        sheets.push(XlsxSheetData {
            name: name.clone(),
            rows,
        });
    }

    Ok(XlsxData { sheets })
}

fn parse_docx_text(path: &Path) -> Result<String, String> {
    let file = fs::File::open(path).map_err(|e| format!("Failed to open docx file: {}", e))?;
    let mut archive =
        ZipArchive::new(file).map_err(|e| format!("Failed to read docx archive: {}", e))?;
    let mut document_xml = archive
        .by_name("word/document.xml")
        .map_err(|e| format!("Failed to open word/document.xml: {}", e))?;

    let mut xml = String::new();
    document_xml
        .read_to_string(&mut xml)
        .map_err(|e| format!("Failed to read document XML: {}", e))?;

    let mut reader = XmlReader::from_str(&xml);
    reader.config_mut().trim_text(true);
    let mut buf = Vec::new();
    let mut text = String::new();

    loop {
        match reader.read_event_into(&mut buf) {
            Ok(Event::Eof) => break,
            Ok(Event::Text(event)) => {
                if let Ok(decoded) = event.decode() {
                    text.push_str(&decoded);
                }
            }
            Ok(Event::End(event)) => {
                if event.name().as_ref() == b"w:p" {
                    text.push('\n');
                }
            }
            Ok(Event::Empty(event)) => {
                let name = event.name().as_ref().to_vec();
                if name.as_slice() == b"w:tab" {
                    text.push('\t');
                } else if name.as_slice() == b"w:br" || name.as_slice() == b"w:cr" {
                    text.push('\n');
                }
            }
            Ok(_) => {}
            Err(err) => {
                return Err(format!("Failed to parse document XML: {}", err));
            }
        }
        buf.clear();
    }

    Ok(text)
}

fn parse_odt_text(path: &Path) -> Result<String, String> {
    let file = fs::File::open(path).map_err(|e| format!("Failed to open odt file: {}", e))?;
    let mut archive =
        ZipArchive::new(file).map_err(|e| format!("Failed to read odt archive: {}", e))?;
    let mut content_xml = archive
        .by_name("content.xml")
        .map_err(|e| format!("Failed to open content.xml: {}", e))?;

    let mut xml = String::new();
    content_xml
        .read_to_string(&mut xml)
        .map_err(|e| format!("Failed to read content XML: {}", e))?;

    let mut reader = XmlReader::from_str(&xml);
    reader.config_mut().trim_text(true);
    let mut buf = Vec::new();
    let mut text = String::new();

    loop {
        match reader.read_event_into(&mut buf) {
            Ok(Event::Eof) => break,
            Ok(Event::Text(event)) => {
                if let Ok(decoded) = event.decode() {
                    text.push_str(&decoded);
                }
            }
            Ok(Event::End(event)) => {
                let name = event.name();
                if name.as_ref() == b"text:p" || name.as_ref() == b"text:h" {
                    text.push('\n');
                }
            }
            Ok(Event::Empty(event)) => {
                let name = event.name().as_ref().to_vec();
                if name.as_slice() == b"text:tab" {
                    text.push('\t');
                } else if name.as_slice() == b"text:line-break" {
                    text.push('\n');
                }
            }
            Ok(_) => {}
            Err(err) => {
                return Err(format!("Failed to parse content XML: {}", err));
            }
        }
        buf.clear();
    }

    Ok(text)
}

fn parse_rtf_text(path: &Path) -> Result<String, String> {
    let raw = fs::read(path).map_err(|e| format!("Failed to read rtf file: {}", e))?;
    let bytes = &raw;
    let mut text = String::new();
    let mut i = 0;
    let mut depth: i32 = 0;
    let mut skip_depth: Option<i32> = None;

    while i < bytes.len() {
        let ch = bytes[i];

        if let Some(sd) = skip_depth {
            if ch == b'{' {
                depth += 1;
            } else if ch == b'}' {
                depth -= 1;
                if depth < sd {
                    skip_depth = None;
                }
            }
            i += 1;
            continue;
        }

        match ch {
            b'{' => {
                depth += 1;
                i += 1;
            }
            b'}' => {
                depth -= 1;
                i += 1;
            }
            b'\\' => {
                i += 1;
                if i >= bytes.len() {
                    break;
                }
                let next = bytes[i];

                if next == b'\'' {
                    // Hex escape: \'xx
                    i += 1;
                    if i + 1 < bytes.len() {
                        if let Ok(hex_str) = std::str::from_utf8(&bytes[i..i + 2]) {
                            if let Ok(val) = u8::from_str_radix(hex_str, 16) {
                                text.push(val as char);
                            }
                        }
                        i += 2;
                    }
                } else if next == b'\\' || next == b'{' || next == b'}' {
                    text.push(next as char);
                    i += 1;
                } else if next == b'\n' || next == b'\r' {
                    i += 1;
                } else {
                    // Read control word
                    let start = i;
                    while i < bytes.len() && bytes[i].is_ascii_alphabetic() {
                        i += 1;
                    }
                    let word = std::str::from_utf8(&bytes[start..i]).unwrap_or("");
                    // Read optional numeric parameter
                    let mut param: Option<i32> = None;
                    if i < bytes.len() && (bytes[i] == b'-' || bytes[i].is_ascii_digit()) {
                        let param_start = i;
                        if bytes[i] == b'-' {
                            i += 1;
                        }
                        while i < bytes.len() && bytes[i].is_ascii_digit() {
                            i += 1;
                        }
                        param = std::str::from_utf8(&bytes[param_start..i])
                            .ok()
                            .and_then(|s| s.parse().ok());
                    }
                    // Consume trailing space delimiter
                    if i < bytes.len() && bytes[i] == b' ' {
                        i += 1;
                    }

                    match word {
                        "par" | "line" => text.push('\n'),
                        "tab" => text.push('\t'),
                        "u" => {
                            if let Some(cp) = param {
                                let cp = if cp < 0 {
                                    (cp + 65536) as u32
                                } else {
                                    cp as u32
                                };
                                if let Some(ch) = char::from_u32(cp) {
                                    text.push(ch);
                                }
                            }
                            // Skip replacement character
                            if i < bytes.len()
                                && bytes[i] != b'\\'
                                && bytes[i] != b'{'
                                && bytes[i] != b'}'
                            {
                                i += 1;
                            }
                        }
                        "fonttbl" | "colortbl" | "stylesheet" | "info" | "pict" | "header"
                        | "footer" | "headerl" | "headerr" | "footerl" | "footerr" | "footnote" => {
                            skip_depth = Some(depth);
                        }
                        _ => {}
                    }
                }
            }
            b'\n' | b'\r' => {
                i += 1;
            }
            _ => {
                if depth >= 1 {
                    text.push(ch as char);
                }
                i += 1;
            }
        }
    }

    Ok(text)
}

fn parse_gpx_to_geojson(path: &Path) -> Result<String, String> {
    let xml = fs::read_to_string(path).map_err(|e| format!("Failed to read GPX file: {}", e))?;
    let mut reader = XmlReader::from_str(&xml);
    reader.config_mut().trim_text(true);

    let mut features: Vec<serde_json::Value> = Vec::new();
    let mut buf = Vec::new();

    #[derive(Default)]
    struct WptState {
        lat: Option<f64>,
        lon: Option<f64>,
        name: Option<String>,
        desc: Option<String>,
        ele: Option<f64>,
    }

    #[derive(Default)]
    struct TrkState {
        name: Option<String>,
        desc: Option<String>,
        segments: Vec<Vec<[f64; 2]>>,
        current_segment: Vec<[f64; 2]>,
        in_trkseg: bool,
    }

    #[derive(Default)]
    struct RteState {
        name: Option<String>,
        desc: Option<String>,
        points: Vec<[f64; 2]>,
    }

    enum ParseContext {
        None,
        Wpt(WptState),
        Trk(TrkState),
        Rte(RteState),
    }

    let mut context = ParseContext::None;
    let mut current_text = String::new();
    let mut in_trkpt = false;

    fn parse_lat_lon(e: &quick_xml::events::BytesStart<'_>) -> (Option<f64>, Option<f64>) {
        let mut lat: Option<f64> = None;
        let mut lon: Option<f64> = None;
        for attr in e.attributes().filter_map(|a| a.ok()) {
            let local = attr.key.local_name();
            let key = std::str::from_utf8(local.as_ref()).unwrap_or("");
            let val = String::from_utf8_lossy(&attr.value);
            match key {
                "lat" => lat = val.parse().ok(),
                "lon" => lon = val.parse().ok(),
                _ => {}
            }
        }
        (lat, lon)
    }

    loop {
        match reader.read_event_into(&mut buf) {
            Ok(Event::Start(ref e)) | Ok(Event::Empty(ref e)) => {
                let local = e.local_name();
                let tag = std::str::from_utf8(local.as_ref()).unwrap_or("");
                match tag {
                    "wpt" => {
                        let (lat, lon) = parse_lat_lon(e);
                        let wpt = WptState {
                            lat,
                            lon,
                            ..Default::default()
                        };
                        context = ParseContext::Wpt(wpt);
                    }
                    "trk" => {
                        context = ParseContext::Trk(TrkState::default());
                    }
                    "rte" => {
                        context = ParseContext::Rte(RteState::default());
                    }
                    "trkseg" => {
                        if let ParseContext::Trk(ref mut trk) = context {
                            trk.in_trkseg = true;
                            trk.current_segment = Vec::new();
                        }
                    }
                    "trkpt" => {
                        if let ParseContext::Trk(ref mut trk) = context {
                            if trk.in_trkseg {
                                let (lat, lon) = parse_lat_lon(e);
                                if let (Some(lon_v), Some(lat_v)) = (lon, lat) {
                                    trk.current_segment.push([lon_v, lat_v]);
                                }
                                in_trkpt = true;
                            }
                        }
                    }
                    "rtept" => {
                        if let ParseContext::Rte(ref mut rte) = context {
                            let (lat, lon) = parse_lat_lon(e);
                            if let (Some(lon_v), Some(lat_v)) = (lon, lat) {
                                rte.points.push([lon_v, lat_v]);
                            }
                        }
                    }
                    _ => {}
                }
                current_text.clear();
            }
            Ok(Event::Text(ref e)) => {
                if let Ok(decoded) = e.decode() {
                    current_text = decoded.to_string();
                }
            }
            Ok(Event::End(ref e)) => {
                let local = e.local_name();
                let tag = std::str::from_utf8(local.as_ref()).unwrap_or("");
                match tag {
                    "name" => match context {
                        ParseContext::Wpt(ref mut w) => w.name = Some(current_text.clone()),
                        ParseContext::Trk(ref mut t) => {
                            if !in_trkpt {
                                t.name = Some(current_text.clone());
                            }
                        }
                        ParseContext::Rte(ref mut r) => r.name = Some(current_text.clone()),
                        _ => {}
                    },
                    "desc" => match context {
                        ParseContext::Wpt(ref mut w) => w.desc = Some(current_text.clone()),
                        ParseContext::Trk(ref mut t) => {
                            if !in_trkpt {
                                t.desc = Some(current_text.clone());
                            }
                        }
                        ParseContext::Rte(ref mut r) => r.desc = Some(current_text.clone()),
                        _ => {}
                    },
                    "ele" => {
                        if let ParseContext::Wpt(ref mut w) = context {
                            w.ele = current_text.parse().ok();
                        }
                    }
                    "trkpt" => {
                        in_trkpt = false;
                    }
                    "trkseg" => {
                        if let ParseContext::Trk(ref mut trk) = context {
                            if !trk.current_segment.is_empty() {
                                let seg = std::mem::take(&mut trk.current_segment);
                                trk.segments.push(seg);
                            }
                            trk.in_trkseg = false;
                        }
                    }
                    "wpt" => {
                        if let ParseContext::Wpt(ref wpt) = context {
                            if let (Some(lon), Some(lat)) = (wpt.lon, wpt.lat) {
                                let mut props = serde_json::Map::new();
                                if let Some(ref n) = wpt.name {
                                    props.insert(
                                        "name".to_string(),
                                        serde_json::Value::String(n.clone()),
                                    );
                                }
                                if let Some(ref d) = wpt.desc {
                                    props.insert(
                                        "description".to_string(),
                                        serde_json::Value::String(d.clone()),
                                    );
                                }
                                if let Some(el) = wpt.ele {
                                    props.insert("elevation".to_string(), serde_json::json!(el));
                                }
                                features.push(serde_json::json!({
                                    "type": "Feature",
                                    "geometry": {
                                        "type": "Point",
                                        "coordinates": [lon, lat]
                                    },
                                    "properties": props
                                }));
                            }
                        }
                        context = ParseContext::None;
                    }
                    "trk" => {
                        if let ParseContext::Trk(ref trk) = context {
                            for seg in &trk.segments {
                                if seg.len() >= 2 {
                                    let mut props = serde_json::Map::new();
                                    props.insert(
                                        "featureType".to_string(),
                                        serde_json::Value::String("track".to_string()),
                                    );
                                    if let Some(ref n) = trk.name {
                                        props.insert(
                                            "name".to_string(),
                                            serde_json::Value::String(n.clone()),
                                        );
                                    }
                                    if let Some(ref d) = trk.desc {
                                        props.insert(
                                            "description".to_string(),
                                            serde_json::Value::String(d.clone()),
                                        );
                                    }
                                    features.push(serde_json::json!({
                                        "type": "Feature",
                                        "geometry": {
                                            "type": "LineString",
                                            "coordinates": seg
                                        },
                                        "properties": props
                                    }));
                                }
                            }
                        }
                        context = ParseContext::None;
                    }
                    "rte" => {
                        if let ParseContext::Rte(ref rte) = context {
                            if rte.points.len() >= 2 {
                                let mut props = serde_json::Map::new();
                                props.insert(
                                    "featureType".to_string(),
                                    serde_json::Value::String("route".to_string()),
                                );
                                if let Some(ref n) = rte.name {
                                    props.insert(
                                        "name".to_string(),
                                        serde_json::Value::String(n.clone()),
                                    );
                                }
                                if let Some(ref d) = rte.desc {
                                    props.insert(
                                        "description".to_string(),
                                        serde_json::Value::String(d.clone()),
                                    );
                                }
                                features.push(serde_json::json!({
                                    "type": "Feature",
                                    "geometry": {
                                        "type": "LineString",
                                        "coordinates": rte.points
                                    },
                                    "properties": props
                                }));
                            }
                        }
                        context = ParseContext::None;
                    }
                    _ => {}
                }
                current_text.clear();
            }
            Ok(Event::Eof) => break,
            Err(e) => return Err(format!("Failed to parse GPX XML: {}", e)),
            _ => {}
        }
        buf.clear();
    }

    let collection = serde_json::json!({
        "type": "FeatureCollection",
        "features": features
    });

    serde_json::to_string(&collection).map_err(|e| format!("Failed to serialize GeoJSON: {}", e))
}

fn parse_kml_coordinates(text: &str) -> Vec<[f64; 3]> {
    text.split_whitespace()
        .filter_map(|token| {
            let parts: Vec<&str> = token.split(',').collect();
            if parts.len() >= 2 {
                let lon: f64 = parts[0].parse().ok()?;
                let lat: f64 = parts[1].parse().ok()?;
                let alt: f64 = parts.get(2).and_then(|a| a.parse().ok()).unwrap_or(0.0);
                Some([lon, lat, alt])
            } else {
                None
            }
        })
        .collect()
}

fn parse_kml_to_geojson(xml_str: &str) -> Result<String, String> {
    let mut reader = XmlReader::from_str(xml_str);
    reader.config_mut().trim_text(true);

    let mut features: Vec<serde_json::Value> = Vec::new();
    let mut buf = Vec::new();

    #[derive(Default)]
    struct PlacemarkState {
        name: Option<String>,
        description: Option<String>,
        geometries: Vec<serde_json::Value>,
        coord_text: String,
        in_outer: bool,
        in_inner: bool,
        outer_ring: Vec<[f64; 2]>,
        inner_rings: Vec<Vec<[f64; 2]>>,
    }

    enum GeoType {
        Point,
        LineString,
        Polygon,
    }

    let mut in_placemark = false;
    let mut placemark = PlacemarkState::default();
    let mut current_text = String::new();
    let mut geo_stack: Vec<GeoType> = Vec::new();
    let mut in_multi_geometry = false;

    loop {
        match reader.read_event_into(&mut buf) {
            Ok(Event::Start(ref e)) => {
                let local = e.local_name();
                let tag = std::str::from_utf8(local.as_ref()).unwrap_or("");
                match tag {
                    "Placemark" => {
                        in_placemark = true;
                        placemark = PlacemarkState::default();
                    }
                    "Point" if in_placemark => {
                        geo_stack.push(GeoType::Point);
                    }
                    "LineString" if in_placemark => {
                        geo_stack.push(GeoType::LineString);
                    }
                    "Polygon" if in_placemark => {
                        geo_stack.push(GeoType::Polygon);
                        placemark.outer_ring.clear();
                        placemark.inner_rings.clear();
                    }
                    "MultiGeometry" if in_placemark => {
                        in_multi_geometry = true;
                    }
                    "outerBoundaryIs" if in_placemark => {
                        placemark.in_outer = true;
                    }
                    "innerBoundaryIs" if in_placemark => {
                        placemark.in_inner = true;
                    }
                    _ => {}
                }
                current_text.clear();
            }
            Ok(Event::Text(ref e)) => {
                if let Ok(decoded) = e.decode() {
                    current_text = decoded.to_string();
                }
            }
            Ok(Event::End(ref e)) => {
                let local = e.local_name();
                let tag = std::str::from_utf8(local.as_ref()).unwrap_or("");
                match tag {
                    "name" if in_placemark && geo_stack.is_empty() => {
                        placemark.name = Some(current_text.clone());
                    }
                    "description" if in_placemark && geo_stack.is_empty() => {
                        placemark.description = Some(current_text.clone());
                    }
                    "coordinates" if in_placemark => {
                        placemark.coord_text = current_text.clone();

                        if placemark.in_outer || placemark.in_inner {
                            let coords = parse_kml_coordinates(&placemark.coord_text);
                            let ring: Vec<[f64; 2]> = coords.iter().map(|c| [c[0], c[1]]).collect();
                            if placemark.in_outer {
                                placemark.outer_ring = ring;
                            } else if placemark.in_inner {
                                placemark.inner_rings.push(ring);
                            }
                        }
                    }
                    "outerBoundaryIs" => {
                        placemark.in_outer = false;
                    }
                    "innerBoundaryIs" => {
                        placemark.in_inner = false;
                    }
                    "Point" if in_placemark => {
                        geo_stack.pop();
                        let coords = parse_kml_coordinates(&placemark.coord_text);
                        if let Some(c) = coords.first() {
                            placemark.geometries.push(serde_json::json!({
                                "type": "Point",
                                "coordinates": [c[0], c[1]]
                            }));
                        }
                    }
                    "LineString" if in_placemark && !placemark.in_outer && !placemark.in_inner => {
                        geo_stack.pop();
                        let coords = parse_kml_coordinates(&placemark.coord_text);
                        let line: Vec<[f64; 2]> = coords.iter().map(|c| [c[0], c[1]]).collect();
                        if line.len() >= 2 {
                            placemark.geometries.push(serde_json::json!({
                                "type": "LineString",
                                "coordinates": line
                            }));
                        }
                    }
                    "Polygon" if in_placemark => {
                        geo_stack.pop();
                        if !placemark.outer_ring.is_empty() {
                            let mut rings = vec![placemark.outer_ring.clone()];
                            for inner in &placemark.inner_rings {
                                rings.push(inner.clone());
                            }
                            placemark.geometries.push(serde_json::json!({
                                "type": "Polygon",
                                "coordinates": rings
                            }));
                        }
                        placemark.outer_ring.clear();
                        placemark.inner_rings.clear();
                    }
                    "MultiGeometry" if in_placemark => {
                        in_multi_geometry = false;
                    }
                    "Placemark" => {
                        let mut props = serde_json::Map::new();
                        if let Some(ref n) = placemark.name {
                            props.insert("name".to_string(), serde_json::Value::String(n.clone()));
                        }
                        if let Some(ref d) = placemark.description {
                            props.insert(
                                "description".to_string(),
                                serde_json::Value::String(d.clone()),
                            );
                        }

                        if placemark.geometries.len() == 1 && !in_multi_geometry {
                            features.push(serde_json::json!({
                                "type": "Feature",
                                "geometry": placemark.geometries[0],
                                "properties": props
                            }));
                        } else if !placemark.geometries.is_empty() {
                            features.push(serde_json::json!({
                                "type": "Feature",
                                "geometry": {
                                    "type": "GeometryCollection",
                                    "geometries": placemark.geometries
                                },
                                "properties": props
                            }));
                        }
                        in_placemark = false;
                    }
                    _ => {}
                }
                current_text.clear();
            }
            Ok(Event::Eof) => break,
            Err(e) => return Err(format!("Failed to parse KML XML: {}", e)),
            _ => {}
        }
        buf.clear();
    }

    let collection = serde_json::json!({
        "type": "FeatureCollection",
        "features": features
    });

    serde_json::to_string(&collection).map_err(|e| format!("Failed to serialize GeoJSON: {}", e))
}

fn extract_kml_from_kmz(path: &Path) -> Result<String, String> {
    let file = fs::File::open(path).map_err(|e| format!("Failed to open KMZ file: {}", e))?;
    let mut archive =
        ZipArchive::new(file).map_err(|e| format!("Failed to read KMZ archive: {}", e))?;

    for i in 0..archive.len() {
        let mut entry = archive
            .by_index(i)
            .map_err(|e| format!("Failed to read KMZ entry: {}", e))?;
        let name = entry.name().to_lowercase();
        if name.ends_with(".kml") {
            let mut xml = String::new();
            entry
                .read_to_string(&mut xml)
                .map_err(|e| format!("Failed to read KML from KMZ: {}", e))?;
            return Ok(xml);
        }
    }

    Err("No .kml file found in KMZ archive".to_string())
}

fn parse_parquet_preview(path: &Path, max_rows: usize) -> Result<ParquetPreviewData, String> {
    let file = fs::File::open(path).map_err(|e| format!("Failed to open parquet file: {}", e))?;
    let reader = SerializedFileReader::new(file)
        .map_err(|e| format!("Failed to open parquet reader: {}", e))?;
    let metadata = reader.metadata().file_metadata();
    let total_rows = metadata.num_rows() as usize;
    let columns = metadata
        .schema_descr()
        .columns()
        .iter()
        .map(|column| column.name().to_string())
        .collect::<Vec<String>>();

    let mut rows: Vec<Vec<String>> = Vec::new();
    let mut iter = reader
        .get_row_iter(None)
        .map_err(|e| format!("Failed to iterate parquet rows: {}", e))?;

    for _ in 0..max_rows {
        if let Some(row_result) = iter.next() {
            let row = row_result.map_err(|e| format!("Failed to read parquet row: {}", e))?;
            let values = row
                .get_column_iter()
                .map(|(_name, field)| field.to_string())
                .collect::<Vec<String>>();
            rows.push(values);
        } else {
            break;
        }
    }

    Ok(ParquetPreviewData {
        columns,
        total_rows,
        truncated: rows.len() < total_rows,
        rows,
    })
}

fn quote_sql_identifier(identifier: &str) -> String {
    format!("\"{}\"", identifier.replace('"', "\"\""))
}

fn read_duckdb_tables_internal(path: &Path) -> Result<Vec<DuckDbTableInfo>, String> {
    let connection =
        Connection::open(path).map_err(|e| format!("Failed to open DuckDB file: {}", e))?;
    let mut statement = connection
        .prepare(
            "
            SELECT table_schema, table_name
            FROM information_schema.tables
            WHERE table_schema NOT IN ('information_schema', 'pg_catalog')
              AND table_type = 'BASE TABLE'
            ORDER BY table_schema, table_name
            ",
        )
        .map_err(|e| format!("Failed to list DuckDB tables: {}", e))?;

    let mut rows = statement
        .query([])
        .map_err(|e| format!("Failed to query DuckDB tables: {}", e))?;
    let mut tables: Vec<DuckDbTableInfo> = Vec::new();

    while let Some(row) = rows
        .next()
        .map_err(|e| format!("Failed to read DuckDB table row: {}", e))?
    {
        let table_schema = row
            .get::<usize, String>(0)
            .map_err(|e| format!("Failed to parse DuckDB table schema: {}", e))?;
        let table_name = row
            .get::<usize, String>(1)
            .map_err(|e| format!("Failed to parse DuckDB table name: {}", e))?;
        let display_name = if table_schema.eq_ignore_ascii_case("main") {
            table_name.clone()
        } else {
            format!("{}.{}", table_schema, table_name)
        };
        tables.push(DuckDbTableInfo {
            schema_name: table_schema,
            table_name,
            display_name,
        });
    }

    Ok(tables)
}

fn resolve_duckdb_table_reference(
    connection: &Connection,
    schema_name: Option<&str>,
    table_name: &str,
) -> Result<String, String> {
    if let Some(schema) = schema_name {
        return Ok(format!(
            "{}.{}",
            quote_sql_identifier(schema),
            quote_sql_identifier(table_name)
        ));
    }

    let mut statement = connection
        .prepare(
            "
            SELECT table_schema, table_name
            FROM information_schema.tables
            WHERE table_schema NOT IN ('information_schema', 'pg_catalog')
              AND table_type = 'BASE TABLE'
              AND table_name = ?
            ORDER BY CASE WHEN table_schema = 'main' THEN 0 ELSE 1 END, table_schema
            LIMIT 2
            ",
        )
        .map_err(|e| format!("Failed to resolve DuckDB table name: {}", e))?;

    let mut rows = statement
        .query([table_name])
        .map_err(|e| format!("Failed to resolve DuckDB table query: {}", e))?;

    let first = rows
        .next()
        .map_err(|e| format!("Failed to resolve DuckDB table row: {}", e))?;
    let Some(first_row) = first else {
        return Ok(quote_sql_identifier(table_name));
    };

    let first_schema = first_row
        .get::<usize, String>(0)
        .map_err(|e| format!("Failed to read DuckDB resolved schema: {}", e))?;
    let first_table = first_row
        .get::<usize, String>(1)
        .map_err(|e| format!("Failed to read DuckDB resolved table: {}", e))?;

    let second = rows
        .next()
        .map_err(|e| format!("Failed to resolve DuckDB table ambiguity: {}", e))?;
    if second.is_some() {
        return Err(format!(
            "Ambiguous table name '{}'. Use schema.table (for example: {}.{})",
            table_name, first_schema, first_table
        ));
    }

    Ok(format!(
        "{}.{}",
        quote_sql_identifier(&first_schema),
        quote_sql_identifier(&first_table)
    ))
}

fn read_duckdb_table_preview_internal(
    path: &Path,
    schema_name: Option<&str>,
    table_name: &str,
    max_rows: usize,
) -> Result<DuckDbTablePreviewData, String> {
    let connection =
        Connection::open(path).map_err(|e| format!("Failed to open DuckDB file: {}", e))?;
    let resolved_table_reference =
        resolve_duckdb_table_reference(&connection, schema_name, table_name)?;

    let count_sql = format!("SELECT COUNT(*) FROM {}", resolved_table_reference);
    let total_rows_i64 = connection
        .query_row(&count_sql, [], |row| row.get::<usize, i64>(0))
        .map_err(|e| format!("Failed to count DuckDB table rows: {}", e))?;
    let total_rows = if total_rows_i64 < 0 {
        0
    } else {
        total_rows_i64 as usize
    };

    let mut columns_stmt = connection
        .prepare(
            "
            SELECT column_name
            FROM information_schema.columns
            WHERE table_schema = ? AND table_name = ?
            ORDER BY ordinal_position
            ",
        )
        .map_err(|e| format!("Failed to query DuckDB columns: {}", e))?;
    let schema_lookup = schema_name.unwrap_or("main");
    let mut columns_iter = columns_stmt
        .query([schema_lookup, table_name])
        .map_err(|e| format!("Failed to iterate DuckDB columns: {}", e))?;
    let mut columns: Vec<String> = Vec::new();
    while let Some(row) = columns_iter
        .next()
        .map_err(|e| format!("Failed to read DuckDB column row: {}", e))?
    {
        columns.push(
            row.get::<usize, String>(0)
                .map_err(|e| format!("Failed to parse DuckDB column name: {}", e))?,
        );
    }
    if columns.is_empty() {
        return Err(format!("No columns found for table '{}'", table_name));
    }

    let select_list = columns
        .iter()
        .map(|column| format!("CAST({} AS VARCHAR)", quote_sql_identifier(column)))
        .collect::<Vec<String>>()
        .join(", ");
    let preview_sql = format!(
        "SELECT {} FROM {} LIMIT {}",
        select_list, resolved_table_reference, max_rows
    );

    let mut statement = connection
        .prepare(&preview_sql)
        .map_err(|e| format!("Failed to query DuckDB preview rows: {}", e))?;

    let mut rows_iter = statement
        .query([])
        .map_err(|e| format!("Failed to iterate DuckDB preview rows: {}", e))?;
    let mut rows: Vec<Vec<String>> = Vec::new();

    while let Some(row) = rows_iter
        .next()
        .map_err(|e| format!("Failed to read DuckDB preview row: {}", e))?
    {
        let mut values: Vec<String> = Vec::with_capacity(columns.len());
        for column_index in 0..columns.len() {
            let value = row
                .get::<usize, Option<String>>(column_index)
                .map_err(|e| format!("Failed to parse DuckDB cell value: {}", e))?;
            values.push(value.unwrap_or_default());
        }
        rows.push(values);
    }

    let truncated = rows.len() < total_rows;

    Ok(DuckDbTablePreviewData {
        table_name: table_name.to_string(),
        columns,
        rows,
        total_rows,
        truncated,
    })
}

fn read_sqlite_tables_internal(path: &Path) -> Result<Vec<SqliteTableInfo>, String> {
    let connection =
        SqliteConnection::open_with_flags(path, rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY)
            .map_err(|e| format!("Failed to open SQLite file: {}", e))?;

    let mut statement = connection
        .prepare(
            "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
        )
        .map_err(|e| format!("Failed to list SQLite tables: {}", e))?;

    let tables = statement
        .query_map([], |row| {
            Ok(SqliteTableInfo {
                table_name: row.get::<usize, String>(0)?,
            })
        })
        .map_err(|e| format!("Failed to query SQLite tables: {}", e))?
        .filter_map(|r| r.ok())
        .collect();

    Ok(tables)
}

fn read_sqlite_table_preview_internal(
    path: &Path,
    table_name: &str,
    max_rows: usize,
) -> Result<SqliteTablePreviewData, String> {
    let connection =
        SqliteConnection::open_with_flags(path, rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY)
            .map_err(|e| format!("Failed to open SQLite file: {}", e))?;

    let quoted_table = quote_sql_identifier(table_name);

    let count_sql = format!("SELECT COUNT(*) FROM {}", quoted_table);
    let total_rows: usize = connection
        .query_row(&count_sql, [], |row| row.get::<usize, i64>(0))
        .map_err(|e| format!("Failed to count SQLite table rows: {}", e))?
        .max(0) as usize;

    let pragma_sql = format!("PRAGMA table_info({})", quoted_table);
    let mut pragma_stmt = connection
        .prepare(&pragma_sql)
        .map_err(|e| format!("Failed to query SQLite columns: {}", e))?;
    let columns: Vec<String> = pragma_stmt
        .query_map([], |row| row.get::<usize, String>(1))
        .map_err(|e| format!("Failed to iterate SQLite columns: {}", e))?
        .filter_map(|r| r.ok())
        .collect();

    if columns.is_empty() {
        return Err(format!("No columns found for table '{}'", table_name));
    }

    let select_list = columns
        .iter()
        .map(|col| format!("CAST({} AS TEXT)", quote_sql_identifier(col)))
        .collect::<Vec<String>>()
        .join(", ");
    let preview_sql = format!(
        "SELECT {} FROM {} LIMIT {}",
        select_list, quoted_table, max_rows
    );

    let mut stmt = connection
        .prepare(&preview_sql)
        .map_err(|e| format!("Failed to query SQLite preview rows: {}", e))?;

    let column_count = columns.len();
    let rows: Vec<Vec<String>> = stmt
        .query_map([], |row| {
            let mut values = Vec::with_capacity(column_count);
            for i in 0..column_count {
                let val: Option<String> = row.get(i)?;
                values.push(val.unwrap_or_default());
            }
            Ok(values)
        })
        .map_err(|e| format!("Failed to iterate SQLite preview rows: {}", e))?
        .filter_map(|r| r.ok())
        .collect();

    let truncated = rows.len() < total_rows;

    Ok(SqliteTablePreviewData {
        table_name: table_name.to_string(),
        columns,
        rows,
        total_rows,
        truncated,
    })
}

fn search_line_matches(
    lines: impl Iterator<Item = String>,
    query: &str,
    query_lower: &str,
    case_sensitive: bool,
) -> Vec<SearchMatch> {
    let mut matches: Vec<SearchMatch> = Vec::new();
    for (idx, line) in lines.enumerate() {
        let matched = if case_sensitive {
            line.contains(query)
        } else {
            line.to_lowercase().contains(query_lower)
        };
        if matched {
            matches.push(SearchMatch {
                line_number: idx + 1,
                line_text: line,
            });
        }
    }
    matches
}

fn search_plain_text_file(
    path: &Path,
    query: &str,
    query_lower: &str,
    case_sensitive: bool,
) -> Vec<SearchMatch> {
    let file = match fs::File::open(path) {
        Ok(file) => file,
        Err(_) => return Vec::new(),
    };
    let reader = std::io::BufReader::new(file);
    search_line_matches(
        reader.lines().map_while(Result::ok),
        query,
        query_lower,
        case_sensitive,
    )
}

fn search_xlsx_file(
    path: &Path,
    query: &str,
    query_lower: &str,
    case_sensitive: bool,
) -> Vec<SearchMatch> {
    let workbook = match parse_xlsx(path) {
        Ok(workbook) => workbook,
        Err(_) => return Vec::new(),
    };

    let mut lines: Vec<String> = Vec::new();
    for sheet in &workbook.sheets {
        for (row_index, row) in sheet.rows.iter().enumerate() {
            lines.push(format!(
                "[{}:{}] {}",
                sheet.name,
                row_index + 1,
                row.join(" | ")
            ));
        }
    }
    search_line_matches(lines.into_iter(), query, query_lower, case_sensitive)
}

fn search_document_file(
    path: &Path,
    query: &str,
    query_lower: &str,
    case_sensitive: bool,
) -> Vec<SearchMatch> {
    let text = if has_extension(path, "odt") {
        parse_odt_text(path)
    } else if has_extension(path, "rtf") {
        parse_rtf_text(path)
    } else {
        parse_docx_text(path)
    };
    let text = match text {
        Ok(text) => text,
        Err(_) => return Vec::new(),
    };
    search_line_matches(
        text.lines().map(|line| line.to_string()),
        query,
        query_lower,
        case_sensitive,
    )
}

/// Recursively build a filtered directory tree containing only supported files
/// and the directories that contain them. Hidden files/dirs are excluded.
fn build_tree(dir: &Path) -> Vec<FileEntry> {
    let mut entries: Vec<FileEntry> = Vec::new();

    let read_dir = match fs::read_dir(dir) {
        Ok(rd) => rd,
        Err(_) => return entries,
    };

    let mut items: Vec<_> = read_dir.filter_map(|e| e.ok()).collect();
    items.sort_by(|a, b| {
        let a_is_dir = a.file_type().map(|ft| ft.is_dir()).unwrap_or(false);
        let b_is_dir = b.file_type().map(|ft| ft.is_dir()).unwrap_or(false);
        b_is_dir.cmp(&a_is_dir).then_with(|| {
            a.file_name()
                .to_string_lossy()
                .to_lowercase()
                .cmp(&b.file_name().to_string_lossy().to_lowercase())
        })
    });

    for item in items {
        let name = item.file_name().to_string_lossy().to_string();
        let path = item.path();
        let is_dir = path.is_dir();

        if !should_include_hidden_name(&name, &path, is_dir) {
            continue;
        }

        if is_dir {
            // Check if directory contains any supported files (recursively)
            let has_supported = has_supported_file_in_dir(&path);

            if has_supported {
                let children = build_tree(&path);
                entries.push(FileEntry {
                    name,
                    path: path.to_string_lossy().to_string(),
                    is_dir: true,
                    children: Some(children),
                });
            }
        } else if is_supported_file(&path) {
            entries.push(FileEntry {
                name,
                path: path.to_string_lossy().to_string(),
                is_dir: false,
                children: None,
            });
        }
    }

    entries
}

fn resolve_launch_target_path(path_arg: &str) -> Result<Option<LaunchTarget>, String> {
    let raw_path = PathBuf::from(path_arg);
    let absolute_path = if raw_path.is_absolute() {
        raw_path
    } else {
        let cwd =
            std::env::current_dir().map_err(|e| format!("Failed to get current dir: {}", e))?;
        cwd.join(raw_path)
    };

    if !absolute_path.exists() {
        return Ok(None);
    }

    let canonical_path = absolute_path
        .canonicalize()
        .map_err(|e| format!("Failed to resolve launch path: {}", e))?;

    if canonical_path.is_dir() {
        return Ok(Some(LaunchTarget {
            workspace_path: canonical_path.to_string_lossy().to_string(),
            selected_file_path: None,
        }));
    }

    if canonical_path.is_file() {
        let Some(parent) = canonical_path.parent() else {
            return Err("Failed to resolve parent directory for launch file".to_string());
        };

        return Ok(Some(LaunchTarget {
            workspace_path: parent.to_string_lossy().to_string(),
            selected_file_path: Some(canonical_path.to_string_lossy().to_string()),
        }));
    }

    Ok(None)
}

#[tauri::command]
pub async fn get_launch_target() -> Result<Option<LaunchTarget>, String> {
    let mut args = std::env::args().skip(1);
    let Some(path_arg) = args.next() else {
        return Ok(None);
    };
    resolve_launch_target_path(&path_arg)
}

#[tauri::command]
pub async fn read_directory_tree(path: String) -> Result<Vec<FileEntry>, String> {
    let dir = Path::new(&path);
    if !dir.exists() {
        return Err(format!("Directory not found: {}", path));
    }
    if !dir.is_dir() {
        return Err(format!("Not a directory: {}", path));
    }
    Ok(build_tree(dir))
}

#[tauri::command]
pub async fn get_supported_file_types() -> Result<Vec<SupportedFileType>, String> {
    Ok(supported_file_types())
}

fn guess_mime_from_extension(path: &Path) -> String {
    let ext = path
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase();

    match ext.as_str() {
        "geojson" => "application/geo+json",
        "json" => "application/json",
        "csv" => "text/csv",
        "tsv" => "text/tab-separated-values",
        "txt" | "log" | "md" | "markdown" | "xml" => "text/plain",
        "kml" => "application/vnd.google-earth.kml+xml",
        "kmz" => "application/vnd.google-earth.kmz",
        _ => "application/octet-stream",
    }
    .to_string()
}

fn decode_text_bytes(bytes: &[u8]) -> Result<String, String> {
    if bytes.is_empty() {
        return Ok(String::new());
    }

    if let Ok(content) = std::str::from_utf8(bytes) {
        return Ok(content.to_string());
    }

    let mut detector = EncodingDetector::new();
    detector.feed(bytes, true);
    let encoding = detector.guess(None, true);
    let (decoded, _, _) = encoding.decode(bytes);
    Ok(decoded.into_owned())
}

fn is_finite_number(value: &Value) -> Option<f64> {
    let num = value.as_f64()?;
    if num.is_finite() {
        Some(num)
    } else {
        None
    }
}

fn merge_bbox(base: Option<BBox>, next: Option<BBox>) -> Option<BBox> {
    match (base, next) {
        (None, None) => None,
        (Some(b), None) => Some(b),
        (None, Some(n)) => Some(n),
        (Some(b), Some(n)) => Some(BBox {
            min_lng: b.min_lng.min(n.min_lng),
            min_lat: b.min_lat.min(n.min_lat),
            max_lng: b.max_lng.max(n.max_lng),
            max_lat: b.max_lat.max(n.max_lat),
        }),
    }
}

fn point_bbox(point: &[Value]) -> Option<BBox> {
    if point.len() < 2 {
        return None;
    }
    let lng = is_finite_number(&point[0])?;
    let lat = is_finite_number(&point[1])?;
    Some(BBox {
        min_lng: lng,
        min_lat: lat,
        max_lng: lng,
        max_lat: lat,
    })
}

fn bbox_from_coordinates(value: &Value) -> Option<BBox> {
    if let Some(point) = value.as_array() {
        if !point.is_empty() && point[0].is_number() {
            return point_bbox(point);
        }
        let mut bbox: Option<BBox> = None;
        for entry in point {
            bbox = merge_bbox(bbox, bbox_from_coordinates(entry));
        }
        return bbox;
    }
    None
}

fn geometry_bbox(geometry: &Value) -> Option<BBox> {
    let obj = geometry.as_object()?;
    let geometry_type = obj.get("type")?.as_str()?;
    if geometry_type == "GeometryCollection" {
        let geometries = obj.get("geometries")?.as_array()?;
        let mut bbox: Option<BBox> = None;
        for g in geometries {
            bbox = merge_bbox(bbox, geometry_bbox(g));
        }
        return bbox;
    }
    bbox_from_coordinates(obj.get("coordinates")?)
}

fn extract_indexed_features<F>(
    root: Value,
    mut on_progress: F,
) -> Result<(Vec<IndexedFeature>, Option<[f64; 4]>), String>
where
    F: FnMut(usize, usize),
{
    let mut indexed_features = Vec::new();
    let mut all_bounds: Option<BBox> = None;

    let Some(root_obj) = root.as_object() else {
        return Err("JSON root must be an object".to_string());
    };
    let Some(root_type) = root_obj.get("type").and_then(|v| v.as_str()) else {
        return Err("GeoJSON object must include type".to_string());
    };

    let push_feature = |feature: Value,
                        indexed_features: &mut Vec<IndexedFeature>,
                        all_bounds: &mut Option<BBox>| {
        let bbox = feature
            .as_object()
            .and_then(|obj| obj.get("geometry"))
            .and_then(geometry_bbox);
        *all_bounds = merge_bbox(*all_bounds, bbox);
        indexed_features.push(IndexedFeature { feature, bbox });
    };

    match root_type {
        "FeatureCollection" => {
            let features = root_obj
                .get("features")
                .and_then(|v| v.as_array())
                .ok_or_else(|| "FeatureCollection must include features array".to_string())?;
            let total = features.len();
            for (index, feature) in features.iter().enumerate() {
                push_feature(feature.clone(), &mut indexed_features, &mut all_bounds);
                on_progress(index + 1, total);
            }
        }
        "Feature" => {
            push_feature(root, &mut indexed_features, &mut all_bounds);
            on_progress(1, 1);
        }
        _ => {
            let feature = serde_json::json!({
                "type": "Feature",
                "properties": {},
                "geometry": root
            });
            push_feature(feature, &mut indexed_features, &mut all_bounds);
            on_progress(1, 1);
        }
    }

    let bounds = all_bounds.map(|b| [b.min_lng, b.min_lat, b.max_lng, b.max_lat]);
    Ok((indexed_features, bounds))
}

fn emit_geojson_prepare_progress(
    app: &AppHandle,
    progress_request_id: Option<&str>,
    stage: &str,
    percent: u8,
    message: String,
    total_features: Option<usize>,
    processed_features: Option<usize>,
) {
    let Some(request_id) = progress_request_id else {
        return;
    };
    let payload = GeoJsonPrepareProgressPayload {
        request_id: request_id.to_string(),
        stage: stage.to_string(),
        percent,
        message,
        total_features,
        processed_features,
    };
    let _ = app.emit("geojson_prepare_progress", payload);
}

fn tile_bbox(z: u8, x: u32, y: u32) -> BBox {
    let n = 2f64.powi(i32::from(z));
    let x_f = x as f64;
    let y_f = y as f64;
    let lng1 = (x_f / n) * 360.0 - 180.0;
    let lng2 = ((x_f + 1.0) / n) * 360.0 - 180.0;

    let lat1 = (std::f64::consts::PI * (1.0 - 2.0 * y_f / n))
        .sinh()
        .atan()
        .to_degrees();
    let lat2 = (std::f64::consts::PI * (1.0 - 2.0 * (y_f + 1.0) / n))
        .sinh()
        .atan()
        .to_degrees();

    BBox {
        min_lng: lng1,
        min_lat: lat2,
        max_lng: lng2,
        max_lat: lat1,
    }
}

fn bbox_intersects(a: BBox, b: BBox) -> bool {
    !(a.max_lng < b.min_lng
        || a.min_lng > b.max_lng
        || a.max_lat < b.min_lat
        || a.min_lat > b.max_lat)
}

fn lod_tolerance_for_zoom(z: u8, bbox: BBox) -> f64 {
    let span = (bbox.max_lng - bbox.min_lng)
        .abs()
        .max((bbox.max_lat - bbox.min_lat).abs())
        .max(0.000_001);
    let ratio = match z {
        0..=4 => 0.03,
        5..=7 => 0.012,
        8..=10 => 0.004,
        _ => 0.0008,
    };
    (span * ratio).max(0.000_000_1)
}

fn resolve_lod_mode(
    requested: Option<&str>,
    file_size_bytes: u64,
    total_features: usize,
    auto_cpu_cores: Option<u32>,
    auto_device_memory_gb: Option<f64>,
) -> &'static str {
    match requested {
        Some("low") => "low",
        Some("medium") => "medium",
        Some("high") => "high",
        Some("auto") | None => {
            let mut score = 0i32;
            if file_size_bytes >= 150 * 1024 * 1024 {
                score += 3;
            } else if file_size_bytes >= 40 * 1024 * 1024 {
                score += 2;
            } else if file_size_bytes >= 15 * 1024 * 1024 {
                score += 1;
            }

            if total_features >= 500_000 {
                score += 3;
            } else if total_features >= 150_000 {
                score += 2;
            } else if total_features >= 50_000 {
                score += 1;
            }

            if let Some(cores) = auto_cpu_cores {
                if cores <= 4 {
                    score += 2;
                } else if cores <= 8 {
                    score += 1;
                }
            }

            if let Some(memory_gb) = auto_device_memory_gb {
                if memory_gb <= 8.0 {
                    score += 2;
                } else if memory_gb <= 16.0 {
                    score += 1;
                }
            }

            if score >= 6 {
                "low"
            } else if score >= 3 {
                "medium"
            } else {
                "high"
            }
        }
        Some(_) => "medium",
    }
}

fn lod_mode_scale(mode: &str) -> f64 {
    match mode {
        "low" => 1.0,
        "medium" => 0.55,
        "high" => 0.25,
        _ => 0.55,
    }
}

fn point_xy(value: &Value) -> Option<(f64, f64)> {
    let point = value.as_array()?;
    if point.len() < 2 {
        return None;
    }
    let x = is_finite_number(&point[0])?;
    let y = is_finite_number(&point[1])?;
    Some((x, y))
}

fn point_line_distance(p: (f64, f64), start: (f64, f64), end: (f64, f64)) -> f64 {
    let (px, py) = p;
    let (sx, sy) = start;
    let (ex, ey) = end;
    let dx = ex - sx;
    let dy = ey - sy;
    if dx.abs() < f64::EPSILON && dy.abs() < f64::EPSILON {
        return ((px - sx).powi(2) + (py - sy).powi(2)).sqrt();
    }
    let area2 = (px - sx) * dy - (py - sy) * dx;
    area2.abs() / (dx.powi(2) + dy.powi(2)).sqrt()
}

fn dp_mark(points: &[(f64, f64)], keep: &mut [bool], start: usize, end: usize, tolerance: f64) {
    if end <= start + 1 {
        return;
    }

    let start_point = points[start];
    let end_point = points[end];
    let mut max_distance = 0.0;
    let mut max_index = 0usize;

    for idx in (start + 1)..end {
        let dist = point_line_distance(points[idx], start_point, end_point);
        if dist > max_distance {
            max_distance = dist;
            max_index = idx;
        }
    }

    if max_distance > tolerance {
        keep[max_index] = true;
        dp_mark(points, keep, start, max_index, tolerance);
        dp_mark(points, keep, max_index, end, tolerance);
    }
}

fn simplify_positions(coords: &[Value], tolerance: f64) -> Option<Vec<Value>> {
    if coords.len() <= 2 {
        return Some(coords.to_vec());
    }

    let mut points = Vec::with_capacity(coords.len());
    for value in coords {
        points.push(point_xy(value)?);
    }

    let mut keep = vec![false; coords.len()];
    keep[0] = true;
    keep[coords.len() - 1] = true;
    dp_mark(&points, &mut keep, 0, coords.len() - 1, tolerance);

    let mut simplified = Vec::new();
    for (idx, value) in coords.iter().enumerate() {
        if keep[idx] {
            simplified.push(value.clone());
        }
    }
    Some(simplified)
}

fn ring_signed_area(ring: &[Value]) -> Option<f64> {
    if ring.len() < 4 {
        return None;
    }
    let mut sum = 0.0;
    for idx in 0..(ring.len() - 1) {
        let (x1, y1) = point_xy(&ring[idx])?;
        let (x2, y2) = point_xy(&ring[idx + 1])?;
        sum += x1 * y2 - x2 * y1;
    }
    Some(0.5 * sum)
}

fn orientation(a: (f64, f64), b: (f64, f64), c: (f64, f64)) -> f64 {
    (b.0 - a.0) * (c.1 - a.1) - (b.1 - a.1) * (c.0 - a.0)
}

fn on_segment(a: (f64, f64), b: (f64, f64), p: (f64, f64)) -> bool {
    p.0 >= a.0.min(b.0) - 1e-12
        && p.0 <= a.0.max(b.0) + 1e-12
        && p.1 >= a.1.min(b.1) - 1e-12
        && p.1 <= a.1.max(b.1) + 1e-12
}

fn segments_intersect(a1: (f64, f64), a2: (f64, f64), b1: (f64, f64), b2: (f64, f64)) -> bool {
    let o1 = orientation(a1, a2, b1);
    let o2 = orientation(a1, a2, b2);
    let o3 = orientation(b1, b2, a1);
    let o4 = orientation(b1, b2, a2);

    if (o1 > 0.0 && o2 < 0.0 || o1 < 0.0 && o2 > 0.0)
        && (o3 > 0.0 && o4 < 0.0 || o3 < 0.0 && o4 > 0.0)
    {
        return true;
    }

    if o1.abs() <= 1e-12 && on_segment(a1, a2, b1) {
        return true;
    }
    if o2.abs() <= 1e-12 && on_segment(a1, a2, b2) {
        return true;
    }
    if o3.abs() <= 1e-12 && on_segment(b1, b2, a1) {
        return true;
    }
    if o4.abs() <= 1e-12 && on_segment(b1, b2, a2) {
        return true;
    }
    false
}

fn ring_self_intersects(ring: &[Value]) -> Option<bool> {
    if ring.len() < 5 {
        return Some(false);
    }
    let mut points = Vec::with_capacity(ring.len());
    for entry in ring {
        points.push(point_xy(entry)?);
    }

    let segment_count = points.len() - 1;
    for i in 0..segment_count {
        let a1 = points[i];
        let a2 = points[i + 1];
        for j in (i + 1)..segment_count {
            if j == i || j == i + 1 {
                continue;
            }
            if i == 0 && j == segment_count - 1 {
                continue;
            }
            let b1 = points[j];
            let b2 = points[j + 1];
            if segments_intersect(a1, a2, b1, b2) {
                return Some(true);
            }
        }
    }
    Some(false)
}

fn simplify_ring(ring: &[Value], tolerance: f64) -> Option<Vec<Value>> {
    if ring.len() < 4 {
        return Some(ring.to_vec());
    }

    let body = if ring.first() == ring.last() {
        &ring[..ring.len() - 1]
    } else {
        ring
    };
    if body.len() < 3 {
        return Some(ring.to_vec());
    }

    let mut simplified_body = simplify_positions(body, tolerance)?;
    if simplified_body.len() < 3 {
        return None;
    }

    simplified_body.push(simplified_body[0].clone());
    if simplified_body.len() < 4 {
        return None;
    }

    let original_area = ring_signed_area(ring).map(|v| v.abs()).unwrap_or(0.0);
    let simplified_area = ring_signed_area(&simplified_body)
        .map(|v| v.abs())
        .unwrap_or(0.0);
    if original_area > 0.0 && simplified_area < original_area * 0.01 {
        return None;
    }

    if ring_self_intersects(&simplified_body)? {
        return None;
    }

    Some(simplified_body)
}

fn simplify_geometry_inner(geometry: &Value, tolerance: f64) -> Option<Value> {
    let geometry_obj = geometry.as_object()?;
    let geometry_type = geometry_obj.get("type")?.as_str()?;

    match geometry_type {
        "Point" | "MultiPoint" => Some(geometry.clone()),
        "LineString" => {
            let coordinates = geometry_obj.get("coordinates")?.as_array()?;
            let simplified = simplify_positions(coordinates, tolerance)?;
            if simplified.len() < 2 {
                return None;
            }
            let mut out = geometry_obj.clone();
            out.insert("coordinates".to_string(), Value::Array(simplified));
            Some(Value::Object(out))
        }
        "MultiLineString" => {
            let lines = geometry_obj.get("coordinates")?.as_array()?;
            let mut simplified_lines = Vec::with_capacity(lines.len());
            for line in lines {
                let line_coords = line.as_array()?;
                let simplified = simplify_positions(line_coords, tolerance)?;
                if simplified.len() < 2 {
                    return None;
                }
                simplified_lines.push(Value::Array(simplified));
            }
            let mut out = geometry_obj.clone();
            out.insert("coordinates".to_string(), Value::Array(simplified_lines));
            Some(Value::Object(out))
        }
        "Polygon" => {
            let rings = geometry_obj.get("coordinates")?.as_array()?;
            if rings.is_empty() {
                return Some(geometry.clone());
            }

            let mut simplified_rings = Vec::with_capacity(rings.len());
            let outer_ring = rings[0].as_array()?;
            simplified_rings.push(Value::Array(simplify_ring(outer_ring, tolerance)?));

            for hole in rings.iter().skip(1) {
                let hole_ring = hole.as_array()?;
                match simplify_ring(hole_ring, tolerance) {
                    Some(simplified_hole) => simplified_rings.push(Value::Array(simplified_hole)),
                    None => simplified_rings.push(Value::Array(hole_ring.to_vec())),
                }
            }

            let mut out = geometry_obj.clone();
            out.insert("coordinates".to_string(), Value::Array(simplified_rings));
            Some(Value::Object(out))
        }
        "MultiPolygon" => {
            let polygons = geometry_obj.get("coordinates")?.as_array()?;
            let mut simplified_polygons = Vec::with_capacity(polygons.len());
            for polygon in polygons {
                let polygon_rings = polygon.as_array()?;
                if polygon_rings.is_empty() {
                    simplified_polygons.push(Value::Array(polygon_rings.to_vec()));
                    continue;
                }
                let mut simplified_rings = Vec::with_capacity(polygon_rings.len());
                let outer_ring = polygon_rings[0].as_array()?;
                simplified_rings.push(Value::Array(simplify_ring(outer_ring, tolerance)?));

                for hole in polygon_rings.iter().skip(1) {
                    let hole_ring = hole.as_array()?;
                    match simplify_ring(hole_ring, tolerance) {
                        Some(simplified_hole) => {
                            simplified_rings.push(Value::Array(simplified_hole))
                        }
                        None => simplified_rings.push(Value::Array(hole_ring.to_vec())),
                    }
                }
                simplified_polygons.push(Value::Array(simplified_rings));
            }

            let mut out = geometry_obj.clone();
            out.insert("coordinates".to_string(), Value::Array(simplified_polygons));
            Some(Value::Object(out))
        }
        "GeometryCollection" => {
            let geometries = geometry_obj.get("geometries")?.as_array()?;
            let mut simplified_geometries = Vec::with_capacity(geometries.len());
            for child in geometries {
                simplified_geometries.push(simplify_geometry_inner(child, tolerance)?);
            }
            let mut out = geometry_obj.clone();
            out.insert(
                "geometries".to_string(),
                Value::Array(simplified_geometries),
            );
            Some(Value::Object(out))
        }
        _ => Some(geometry.clone()),
    }
}

fn simplify_geometry_with_fallback(geometry: &Value, tolerance: f64) -> (Value, bool, bool) {
    if geometry.is_null() {
        return (Value::Null, false, false);
    }
    match simplify_geometry_inner(geometry, tolerance) {
        Some(simplified) => {
            let changed = simplified != *geometry;
            (simplified, changed, false)
        }
        None => (geometry.clone(), false, true),
    }
}

#[tauri::command]
pub async fn get_file_meta(path: String) -> Result<FileMetaData, String> {
    let file_path = Path::new(&path);
    if !file_path.exists() {
        return Err(format!("File not found: {}", path));
    }
    if !file_path.is_file() {
        return Err(format!("Not a file: {}", path));
    }

    let metadata =
        fs::metadata(file_path).map_err(|e| format!("Failed to read metadata: {}", e))?;
    let extension = file_path
        .extension()
        .and_then(|s| s.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase();

    Ok(FileMetaData {
        size_bytes: metadata.len(),
        extension,
        mime_guess: guess_mime_from_extension(file_path),
    })
}

#[tauri::command]
pub async fn prepare_geojson_tiles(
    app: AppHandle,
    path: String,
    state: tauri::State<'_, GeoJsonTileStore>,
    max_features_per_tile: Option<usize>,
    min_zoom: Option<u8>,
    max_zoom: Option<u8>,
    progress_request_id: Option<String>,
) -> Result<GeoJsonTileSessionData, String> {
    let progress_request_id = progress_request_id.as_deref();
    emit_geojson_prepare_progress(
        &app,
        progress_request_id,
        "reading",
        0,
        "Preparing GeoJSON tiles... 0%".to_string(),
        None,
        None,
    );

    let file_path = Path::new(&path);
    if !file_path.exists() {
        let message = format!("File not found: {}", path);
        emit_geojson_prepare_progress(
            &app,
            progress_request_id,
            "error",
            100,
            message.clone(),
            None,
            None,
        );
        return Err(message);
    }
    if !file_path.is_file() {
        let message = format!("Not a file: {}", path);
        emit_geojson_prepare_progress(
            &app,
            progress_request_id,
            "error",
            100,
            message.clone(),
            None,
            None,
        );
        return Err(message);
    }

    emit_geojson_prepare_progress(
        &app,
        progress_request_id,
        "reading",
        8,
        "Preparing GeoJSON tiles... 8%".to_string(),
        None,
        None,
    );

    let file_size_bytes = match fs::metadata(file_path) {
        Ok(metadata) => metadata.len(),
        Err(e) => {
            let message = format!("Failed to read metadata: {}", e);
            emit_geojson_prepare_progress(
                &app,
                progress_request_id,
                "error",
                100,
                message.clone(),
                None,
                None,
            );
            return Err(message);
        }
    };
    let bytes = match fs::read(file_path) {
        Ok(bytes) => bytes,
        Err(e) => {
            let message = format!("Failed to read file: {}", e);
            emit_geojson_prepare_progress(
                &app,
                progress_request_id,
                "error",
                100,
                message.clone(),
                None,
                None,
            );
            return Err(message);
        }
    };
    emit_geojson_prepare_progress(
        &app,
        progress_request_id,
        "parsing",
        20,
        "Preparing GeoJSON tiles... 20% (parsing JSON)".to_string(),
        None,
        None,
    );

    let raw = match decode_text_bytes(&bytes) {
        Ok(raw) => raw,
        Err(message) => {
            emit_geojson_prepare_progress(
                &app,
                progress_request_id,
                "error",
                100,
                message.clone(),
                None,
                None,
            );
            return Err(message);
        }
    };
    let root: Value = match serde_json::from_str(&raw) {
        Ok(root) => root,
        Err(e) => {
            let message = format!("Failed to parse JSON: {}", e);
            emit_geojson_prepare_progress(
                &app,
                progress_request_id,
                "error",
                100,
                message.clone(),
                None,
                None,
            );
            return Err(message);
        }
    };
    emit_geojson_prepare_progress(
        &app,
        progress_request_id,
        "indexing",
        30,
        "Preparing GeoJSON tiles... 30% (indexing features)".to_string(),
        None,
        None,
    );
    let mut last_percent = 29u8;
    let (indexed_features, bounds) = match extract_indexed_features(root, |processed, total| {
            if total == 0 {
                return;
            }
            let ratio = processed as f64 / total as f64;
            let percent = (30.0 + ratio * 65.0).round().clamp(30.0, 95.0) as u8;
            if percent <= last_percent {
                return;
            }
            last_percent = percent;
            let message = format!(
                "Preparing GeoJSON tiles... {}% (indexing {} / {})",
                percent, processed, total
            );
            emit_geojson_prepare_progress(
                &app,
                progress_request_id,
                "indexing",
                percent,
                message,
                Some(total),
                Some(processed),
            );
        }) {
            Ok(result) => result,
            Err(message) => {
                emit_geojson_prepare_progress(
                    &app,
                    progress_request_id,
                    "error",
                    100,
                    message.clone(),
                    None,
                    None,
                );
                return Err(message);
            }
        };

    let min_zoom = min_zoom.unwrap_or(0).min(20);
    let mut max_zoom = max_zoom.unwrap_or(12).min(20);
    if max_zoom < min_zoom {
        max_zoom = min_zoom;
    }
    let max_features_per_tile = max_features_per_tile.unwrap_or(1500).max(100);

    let dataset_id = format!(
        "geojson-{}",
        GEOJSON_TILE_SESSION_COUNTER.fetch_add(1, Ordering::Relaxed)
    );

    let total_features = indexed_features.len();
    let session = GeoJsonTileSession {
        indexed_features,
        file_size_bytes,
        total_features,
        min_zoom,
        max_zoom,
        max_features_per_tile,
        tile_cache: HashMap::new(),
        resolved_auto_mode: None,
    };

    emit_geojson_prepare_progress(
        &app,
        progress_request_id,
        "finalizing",
        97,
        "Preparing GeoJSON tiles... 97% (finalizing)".to_string(),
        Some(total_features),
        Some(total_features),
    );
    let mut sessions = match state.sessions.lock() {
        Ok(sessions) => sessions,
        Err(_) => {
            let message = "GeoJSON tile store is poisoned".to_string();
            emit_geojson_prepare_progress(
                &app,
                progress_request_id,
                "error",
                100,
                message.clone(),
                None,
                None,
            );
            return Err(message);
        }
    };
    sessions.insert(dataset_id.clone(), session);
    emit_geojson_prepare_progress(
        &app,
        progress_request_id,
        "done",
        100,
        format!(
            "Preparing GeoJSON tiles... 100% (prepared {} features)",
            total_features
        ),
        Some(total_features),
        Some(total_features),
    );

    Ok(GeoJsonTileSessionData {
        dataset_id,
        bounds,
        min_zoom,
        max_zoom,
        total_features,
        max_features_per_tile,
    })
}

#[tauri::command]
pub async fn read_geojson_tile(
    dataset_id: String,
    z: u8,
    x: u32,
    y: u32,
    resolution_mode: Option<String>,
    auto_cpu_cores: Option<u32>,
    auto_device_memory_gb: Option<f64>,
    state: tauri::State<'_, GeoJsonTileStore>,
) -> Result<GeoJsonTileData, String> {
    let mut sessions = state
        .sessions
        .lock()
        .map_err(|_| "GeoJSON tile store is poisoned".to_string())?;
    let session = sessions
        .get_mut(&dataset_id)
        .ok_or_else(|| format!("GeoJSON tile session not found: {}", dataset_id))?;

    let z = z.clamp(session.min_zoom, session.max_zoom);
    let target_bbox = tile_bbox(z, x, y);
    let mode = match resolution_mode.as_deref() {
        Some("low") => "low".to_string(),
        Some("medium") => "medium".to_string(),
        Some("high") => "high".to_string(),
        Some("auto") | None => {
            if let Some(mode) = &session.resolved_auto_mode {
                mode.clone()
            } else {
                let resolved = resolve_lod_mode(
                    Some("auto"),
                    session.file_size_bytes,
                    session.total_features,
                    auto_cpu_cores,
                    auto_device_memory_gb,
                )
                .to_string();
                session.resolved_auto_mode = Some(resolved.clone());
                resolved
            }
        }
        Some(_) => "medium".to_string(),
    };
    let cache_key = format!("{}/{}/{}/{}", z, x, y, mode);
    if let Some(cached) = session.tile_cache.get(&cache_key) {
        return Ok(cached.clone());
    }

    let lod_tolerance = lod_tolerance_for_zoom(z, target_bbox) * lod_mode_scale(&mode);

    let mut features = Vec::new();
    let mut total_features = 0usize;
    let mut simplified_features = 0usize;
    let mut fallback_features = 0usize;

    for indexed in &session.indexed_features {
        let matches = match indexed.bbox {
            Some(bbox) => bbox_intersects(bbox, target_bbox),
            None => true,
        };
        if !matches {
            continue;
        }

        total_features += 1;
        if features.len() < session.max_features_per_tile {
            let mut feature = indexed.feature.clone();
            let mut simplified_applied = false;
            let mut fallback_applied = false;

            if let Some(feature_obj) = feature.as_object_mut() {
                if let Some(geometry) = feature_obj.get("geometry") {
                    let (geometry_out, changed, fallback) =
                        simplify_geometry_with_fallback(geometry, lod_tolerance);
                    feature_obj.insert("geometry".to_string(), geometry_out);
                    simplified_applied = changed;
                    fallback_applied = fallback;
                }
            }

            if simplified_applied {
                simplified_features += 1;
            }
            if fallback_applied {
                fallback_features += 1;
            }
            features.push(feature);
        }
    }

    let result = GeoJsonTileData {
        features,
        total_features,
        truncated: total_features > session.max_features_per_tile,
        simplified_features,
        fallback_features,
        lod_tolerance,
        lod_mode: mode,
    };
    session.tile_cache.insert(cache_key, result.clone());
    Ok(result)
}

#[tauri::command]
pub async fn release_geojson_tiles(
    dataset_id: String,
    state: tauri::State<'_, GeoJsonTileStore>,
) -> Result<(), String> {
    let mut sessions = state
        .sessions
        .lock()
        .map_err(|_| "GeoJSON tile store is poisoned".to_string())?;
    sessions.remove(&dataset_id);
    Ok(())
}

#[tauri::command]
pub async fn read_file_content(path: String) -> Result<FileContentData, String> {
    let file_path = Path::new(&path);
    if !file_path.exists() {
        return Err(format!("File not found: {}", path));
    }
    if !file_path.is_file() {
        return Err(format!("Not a file: {}", path));
    }
    let bytes = fs::read(file_path).map_err(|e| format!("Failed to read file: {}", e))?;

    // dxf-parser expects ASCII text DXF. Binary DXF starts with this fixed signature.
    if has_extension(file_path, "dxf") && bytes.starts_with(b"AutoCAD Binary DXF") {
        return Err("Failed to read file: Binary DXF is not supported yet".to_string());
    }

    if bytes.is_empty() {
        return Ok(FileContentData {
            content: String::new(),
            encoding: "UTF-8".to_string(),
            is_utf8: true,
        });
    }

    if let Ok(content) = std::str::from_utf8(&bytes) {
        return Ok(FileContentData {
            content: content.to_string(),
            encoding: "UTF-8".to_string(),
            is_utf8: true,
        });
    }

    let mut detector = EncodingDetector::new();
    detector.feed(&bytes, true);
    let encoding = detector.guess(None, true);
    let (decoded, _, _) = encoding.decode(&bytes);

    Ok(FileContentData {
        content: decoded.into_owned(),
        encoding: encoding.name().to_string(),
        is_utf8: false,
    })
}

#[tauri::command]
pub async fn open_in_file_manager(path: String) -> Result<(), String> {
    let input_path = Path::new(&path);
    if !input_path.exists() {
        return Err(format!("Path not found: {}", path));
    }

    let folder_path = if input_path.is_dir() {
        input_path.to_path_buf()
    } else if input_path.is_file() {
        input_path
            .parent()
            .ok_or_else(|| format!("Failed to resolve parent directory: {}", path))?
            .to_path_buf()
    } else {
        return Err(format!("Unsupported path type: {}", path));
    };

    let status = if cfg!(target_os = "macos") {
        Command::new("open")
            .arg(&folder_path)
            .status()
            .map_err(|e| format!("Failed to launch Finder: {}", e))?
    } else if cfg!(target_os = "windows") {
        Command::new("explorer")
            .arg(&folder_path)
            .status()
            .map_err(|e| format!("Failed to launch Explorer: {}", e))?
    } else {
        Command::new("xdg-open")
            .arg(&folder_path)
            .status()
            .map_err(|e| format!("Failed to launch file manager: {}", e))?
    };

    if !status.success() {
        return Err(format!(
            "File manager command failed for path: {}",
            folder_path.to_string_lossy()
        ));
    }

    Ok(())
}

#[tauri::command]
pub async fn export_markdown_to_pdf(
    app: AppHandle,
    input_path: String,
    output_path: String,
) -> Result<String, String> {
    let markdown_path = Path::new(&input_path);
    if !markdown_path.exists() {
        return Err(format!("File not found: {}", input_path));
    }
    if !markdown_path.is_file() {
        return Err(format!("Not a file: {}", input_path));
    }
    if !has_extension(markdown_path, "md") && !has_extension(markdown_path, "markdown") {
        return Err("Markdownファイル（.md/.markdown）のみ書き出し可能です".to_string());
    }

    let target_pdf_path = ensure_pdf_extension(Path::new(&output_path));
    let output_parent = target_pdf_path.parent().unwrap_or(Path::new("."));
    if !output_parent.exists() {
        return Err(format!(
            "Output directory not found: {}",
            output_parent.to_string_lossy()
        ));
    }
    if !output_parent.is_dir() {
        return Err(format!(
            "Output path parent is not a directory: {}",
            output_parent.to_string_lossy()
        ));
    }

    let pandoc_path = resolve_bundled_binary(&app, pandoc_binary_name())?;
    let tectonic_path = resolve_bundled_binary(&app, tectonic_binary_name())?;

    let output = Command::new(&pandoc_path)
        .arg("--from")
        .arg("gfm")
        .arg("--pdf-engine")
        .arg(&tectonic_path)
        .arg("--variable")
        .arg("papersize:a4")
        .arg("--variable")
        .arg("geometry:margin=25mm")
        .arg("-o")
        .arg(&target_pdf_path)
        .arg(markdown_path)
        .output()
        .map_err(|e| format!("Failed to execute pandoc: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
        let details = if !stderr.is_empty() { stderr } else { stdout };
        return Err(format!("Failed to export markdown to PDF: {}", details));
    }

    Ok(target_pdf_path.to_string_lossy().to_string())
}

#[tauri::command]
pub async fn read_xlsx(path: String) -> Result<XlsxData, String> {
    let file_path = Path::new(&path);
    if !file_path.exists() {
        return Err(format!("File not found: {}", path));
    }
    if !file_path.is_file() {
        return Err(format!("Not a file: {}", path));
    }
    if !is_extension_in(file_path, &spreadsheet_extensions()) {
        return Err("Target file is not a spreadsheet file (.xlsx/.xlsm/.xls/.ods)".to_string());
    }

    parse_xlsx(file_path)
}

#[tauri::command]
pub async fn read_docx_text(path: String) -> Result<DocxTextData, String> {
    let file_path = Path::new(&path);
    if !file_path.exists() {
        return Err(format!("File not found: {}", path));
    }
    if !file_path.is_file() {
        return Err(format!("Not a file: {}", path));
    }
    if !is_extension_in(file_path, &document_extensions()) {
        return Err("対象ファイルはドキュメント形式(.docx/.odt/.rtf)ではありません".to_string());
    }

    let text = if has_extension(file_path, "odt") {
        parse_odt_text(file_path)
    } else if has_extension(file_path, "rtf") {
        parse_rtf_text(file_path)
    } else {
        parse_docx_text(file_path)
    }?;
    Ok(DocxTextData { text })
}

#[tauri::command]
pub async fn read_parquet(
    path: String,
    max_rows: Option<usize>,
) -> Result<ParquetPreviewData, String> {
    let file_path = Path::new(&path);
    if !file_path.exists() {
        return Err(format!("File not found: {}", path));
    }
    if !file_path.is_file() {
        return Err(format!("Not a file: {}", path));
    }
    if !has_extension(file_path, "parquet") {
        return Err("Target file is not .parquet".to_string());
    }

    let rows_limit = max_rows.unwrap_or(1000).max(1);
    parse_parquet_preview(file_path, rows_limit)
}

#[tauri::command]
pub async fn read_duckdb_tables(path: String) -> Result<Vec<DuckDbTableInfo>, String> {
    let file_path = Path::new(&path);
    if !file_path.exists() {
        return Err(format!("File not found: {}", path));
    }
    if !file_path.is_file() {
        return Err(format!("Not a file: {}", path));
    }
    if !is_extension_in(file_path, &duckdb_extensions()) {
        return Err("Target file is not a DuckDB file (.duckdb/.ddb)".to_string());
    }

    read_duckdb_tables_internal(file_path)
}

#[tauri::command]
pub async fn read_duckdb_table_preview(
    path: String,
    schema_name: Option<String>,
    table_name: String,
    max_rows: Option<usize>,
) -> Result<DuckDbTablePreviewData, String> {
    let file_path = Path::new(&path);
    if !file_path.exists() {
        return Err(format!("File not found: {}", path));
    }
    if !file_path.is_file() {
        return Err(format!("Not a file: {}", path));
    }
    if !is_extension_in(file_path, &duckdb_extensions()) {
        return Err("Target file is not a DuckDB file (.duckdb/.ddb)".to_string());
    }
    if table_name.trim().is_empty() {
        return Err("table_name must not be empty".to_string());
    }

    let rows_limit = max_rows.unwrap_or(200).max(1);
    let schema_name = schema_name
        .as_ref()
        .map(|value| value.trim())
        .filter(|value| !value.is_empty());
    read_duckdb_table_preview_internal(file_path, schema_name, table_name.trim(), rows_limit)
}

#[tauri::command]
pub async fn read_sqlite_tables(path: String) -> Result<Vec<SqliteTableInfo>, String> {
    let file_path = Path::new(&path);
    if !file_path.exists() {
        return Err(format!("File not found: {}", path));
    }
    if !file_path.is_file() {
        return Err(format!("Not a file: {}", path));
    }
    if !is_extension_in(file_path, &sqlite_extensions()) {
        return Err("対象ファイルはSQLite形式(.sqlite/.sqlite3/.db)ではありません".to_string());
    }
    read_sqlite_tables_internal(file_path)
}

#[tauri::command]
pub async fn read_sqlite_table_preview(
    path: String,
    table_name: String,
    max_rows: Option<usize>,
) -> Result<SqliteTablePreviewData, String> {
    let file_path = Path::new(&path);
    if !file_path.exists() {
        return Err(format!("File not found: {}", path));
    }
    if !file_path.is_file() {
        return Err(format!("Not a file: {}", path));
    }
    if !is_extension_in(file_path, &sqlite_extensions()) {
        return Err("対象ファイルはSQLite形式(.sqlite/.sqlite3/.db)ではありません".to_string());
    }
    if table_name.trim().is_empty() {
        return Err("table_name must not be empty".to_string());
    }
    let rows_limit = max_rows.unwrap_or(200).max(1);
    read_sqlite_table_preview_internal(file_path, table_name.trim(), rows_limit)
}

#[tauri::command]
pub async fn read_gpx(path: String) -> Result<GeoJsonData, String> {
    let file_path = Path::new(&path);
    if !file_path.exists() {
        return Err(format!("File not found: {}", path));
    }
    if !file_path.is_file() {
        return Err(format!("Not a file: {}", path));
    }
    if !is_extension_in(file_path, &gpx_extensions()) {
        return Err("Target file is not .gpx".to_string());
    }

    let geojson = parse_gpx_to_geojson(file_path)?;
    Ok(GeoJsonData { geojson })
}

#[tauri::command]
pub async fn read_kml(path: String) -> Result<GeoJsonData, String> {
    let file_path = Path::new(&path);
    if !file_path.exists() {
        return Err(format!("File not found: {}", path));
    }
    if !file_path.is_file() {
        return Err(format!("Not a file: {}", path));
    }
    if !is_extension_in(file_path, &kml_extensions()) {
        return Err("Target file is not .kml or .kmz".to_string());
    }

    let xml_str = if has_extension(file_path, "kmz") {
        extract_kml_from_kmz(file_path)?
    } else {
        fs::read_to_string(file_path).map_err(|e| format!("Failed to read KML file: {}", e))?
    };

    let geojson = parse_kml_to_geojson(&xml_str)?;
    Ok(GeoJsonData { geojson })
}

#[tauri::command]
pub async fn read_csv_chunk(
    path: String,
    cursor: Option<u64>,
    max_rows: Option<usize>,
    delimiter_hint: Option<String>,
) -> Result<CsvChunkData, String> {
    let file_path = Path::new(&path);
    if !file_path.exists() {
        return Err(format!("File not found: {}", path));
    }
    if !file_path.is_file() {
        return Err(format!("Not a file: {}", path));
    }
    if !has_extension(file_path, "csv") && !has_extension(file_path, "tsv") {
        return Err("Target file is not .csv or .tsv".to_string());
    }

    let start_cursor = cursor.unwrap_or(0);
    let rows_limit = max_rows.unwrap_or(500).max(1);

    let mut file = fs::File::open(file_path).map_err(|e| format!("Failed to open file: {}", e))?;

    let delimiter = if let Some(hint) = parse_delimiter_hint(delimiter_hint.clone()) {
        hint
    } else {
        detect_csv_delimiter(file_path, &mut file)?
    };

    file.seek(SeekFrom::Start(start_cursor))
        .map_err(|e| format!("Failed to seek csv file: {}", e))?;

    let mut reader = ReaderBuilder::new()
        .has_headers(false)
        .flexible(true)
        .delimiter(delimiter)
        .from_reader(file);

    let mut header: Vec<String> = Vec::new();
    let mut rows: Vec<Vec<String>> = Vec::new();
    let mut next_cursor = start_cursor;
    let mut eof = false;
    let mut record = ByteRecord::new();

    if start_cursor == 0 {
        loop {
            match reader.read_byte_record(&mut record) {
                Ok(true) => {
                    next_cursor = reader.position().byte();
                    let row = record_to_row(&record);
                    if row_has_visible_content(&row) {
                        header = row;
                        break;
                    }
                }
                Ok(false) => {
                    eof = true;
                    break;
                }
                Err(err) => return Err(format!("Failed to parse csv header: {}", err)),
            }
        }
    }

    while rows.len() < rows_limit {
        match reader.read_byte_record(&mut record) {
            Ok(true) => {
                next_cursor = reader.position().byte();
                let row = record_to_row(&record);
                if row_has_visible_content(&row) {
                    rows.push(row);
                }
            }
            Ok(false) => {
                eof = true;
                break;
            }
            Err(err) => return Err(format!("Failed to parse csv rows: {}", err)),
        }
    }

    let response_next_cursor = if eof { None } else { Some(next_cursor) };
    let delimiter_string = match delimiter {
        b'\t' => "\t".to_string(),
        b';' => ";".to_string(),
        _ => ",".to_string(),
    };

    Ok(CsvChunkData {
        delimiter: delimiter_string,
        header,
        rows,
        next_cursor: response_next_cursor,
        eof,
    })
}

#[derive(Debug, Clone, Serialize)]
pub struct SearchMatch {
    pub line_number: usize,
    pub line_text: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct SearchFileResult {
    pub file_path: String,
    pub file_name: String,
    pub matches: Vec<SearchMatch>,
}

#[tauri::command]
pub async fn search_files(
    root_path: String,
    query: String,
    case_sensitive: bool,
    file_type_filter: String,
) -> Result<Vec<SearchFileResult>, String> {
    if query.is_empty() {
        return Ok(Vec::new());
    }

    let root = Path::new(&root_path);
    if !root.is_dir() {
        return Err(format!("Not a directory: {}", root_path));
    }

    let query_lower = if case_sensitive {
        String::new()
    } else {
        query.to_lowercase()
    };
    let extensions = extensions_from_filter(&file_type_filter);
    if extensions.is_empty() {
        return Ok(Vec::new());
    }
    let include_text_special = include_text_special_for_filter(&file_type_filter);

    let mut results: Vec<SearchFileResult> = Vec::new();

    for entry in WalkDir::new(root)
        .into_iter()
        .filter_map(|e| e.ok())
        .filter(|e| !is_hidden_path_except_text_special(e.path()))
        .filter(|e| {
            e.file_type().is_file()
                && matches_search_target(e.path(), &extensions, include_text_special)
        })
    {
        let path = entry.path();
        let file_matches = if is_extension_in(path, &spreadsheet_extensions()) {
            search_xlsx_file(path, &query, &query_lower, case_sensitive)
        } else if is_extension_in(path, &document_extensions()) {
            search_document_file(path, &query, &query_lower, case_sensitive)
        } else {
            search_plain_text_file(path, &query, &query_lower, case_sensitive)
        };

        if !file_matches.is_empty() {
            let file_name = path
                .file_name()
                .map(|n| n.to_string_lossy().to_string())
                .unwrap_or_default();
            results.push(SearchFileResult {
                file_path: path.to_string_lossy().to_string(),
                file_name,
                matches: file_matches,
            });
        }
    }

    Ok(results)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn contains_extension(extensions: &[String], expected: &str) -> bool {
        extensions.iter().any(|ext| ext == expected)
    }

    #[test]
    fn text_filter_returns_text_extensions() {
        let extensions = extensions_from_filter("text");
        assert!(contains_extension(&extensions, "txt"));
        assert!(contains_extension(&extensions, "log"));
        assert!(contains_extension(&extensions, "yaml"));
        assert!(contains_extension(&extensions, "ts"));
        assert!(contains_extension(&extensions, "jsonl"));
    }

    #[test]
    fn all_filter_includes_text_extensions() {
        let extensions = extensions_from_filter("all");
        assert!(contains_extension(&extensions, "md"));
        assert!(contains_extension(&extensions, "txt"));
        assert!(contains_extension(&extensions, "dxf"));
        assert!(contains_extension(&extensions, "geojson"));
        assert!(contains_extension(&extensions, "xlsx"));
        assert!(contains_extension(&extensions, "xlsm"));
        assert!(contains_extension(&extensions, "xls"));
        assert!(contains_extension(&extensions, "ods"));
        assert!(contains_extension(&extensions, "docx"));
        assert!(contains_extension(&extensions, "odt"));
        assert!(contains_extension(&extensions, "rtf"));
        assert!(!contains_extension(&extensions, "png"));
        assert!(!contains_extension(&extensions, "sqlite"));
        assert!(!contains_extension(&extensions, "db"));
    }

    #[test]
    fn document_filter_includes_odt_and_rtf() {
        let extensions = extensions_from_filter("document");
        assert!(contains_extension(&extensions, "docx"));
        assert!(contains_extension(&extensions, "odt"));
        assert!(contains_extension(&extensions, "rtf"));
    }

    #[test]
    fn sqlite_extensions_in_supported_types() {
        let types = supported_file_types();
        let sqlite_type = types.iter().find(|t| t.id == "sqlite").unwrap();
        assert!(sqlite_type.extensions.contains(&"sqlite".to_string()));
        assert!(sqlite_type.extensions.contains(&"sqlite3".to_string()));
        assert!(sqlite_type.extensions.contains(&"db".to_string()));
        assert!(!sqlite_type.searchable);
    }

    #[test]
    fn json_filter_includes_geojson_extension() {
        let extensions = extensions_from_filter("json");
        assert!(contains_extension(&extensions, "json"));
        assert!(contains_extension(&extensions, "geojson"));
    }

    #[test]
    fn extension_check_is_case_insensitive() {
        let path = Path::new("/tmp/sample.TXT");
        let extensions = vec!["txt".to_string()];
        assert!(is_extension_in(path, &extensions));
    }

    #[test]
    fn recognizes_text_special_file_names() {
        assert!(is_text_special_file(Path::new("/tmp/Dockerfile")));
        assert!(is_text_special_file(Path::new("/tmp/.env.local")));
        assert!(is_text_special_file(Path::new("/tmp/.gitignore")));
    }

    #[test]
    fn hidden_filter_allows_text_special_files_only() {
        assert!(!is_hidden_path_except_text_special(Path::new("/tmp/.env")));
        assert!(is_hidden_path_except_text_special(Path::new("/tmp/.git")));
        assert!(is_hidden_path_except_text_special(Path::new(
            "/tmp/.secret/notes.txt"
        )));
    }

    #[test]
    fn gpx_extensions_in_supported_types() {
        let types = supported_file_types();
        let gpx_type = types.iter().find(|t| t.id == "gpx").unwrap();
        assert!(gpx_type.extensions.contains(&"gpx".to_string()));
        assert!(!gpx_type.searchable);
    }

    #[test]
    fn kml_extensions_in_supported_types() {
        let types = supported_file_types();
        let kml_type = types.iter().find(|t| t.id == "kml").unwrap();
        assert!(kml_type.extensions.contains(&"kml".to_string()));
        assert!(kml_type.extensions.contains(&"kmz".to_string()));
        assert!(!kml_type.searchable);
    }

    #[test]
    fn parse_gpx_waypoint() {
        let gpx = r#"<?xml version="1.0"?>
<gpx version="1.1">
  <wpt lat="35.6812" lon="139.7671">
    <name>Tokyo</name>
    <ele>40</ele>
  </wpt>
</gpx>"#;
        let tmp = std::env::temp_dir().join("test_wpt.gpx");
        fs::write(&tmp, gpx).unwrap();
        let result = parse_gpx_to_geojson(&tmp).unwrap();
        let parsed: serde_json::Value = serde_json::from_str(&result).unwrap();
        assert_eq!(parsed["type"], "FeatureCollection");
        let features = parsed["features"].as_array().unwrap();
        assert_eq!(features.len(), 1);
        assert_eq!(features[0]["geometry"]["type"], "Point");
        assert_eq!(features[0]["properties"]["name"], "Tokyo");
        assert_eq!(features[0]["properties"]["elevation"], 40.0);
        fs::remove_file(&tmp).ok();
    }

    #[test]
    fn parse_gpx_track() {
        let gpx = r#"<?xml version="1.0"?>
<gpx version="1.1">
  <trk>
    <name>Morning Run</name>
    <trkseg>
      <trkpt lat="35.68" lon="139.76"/>
      <trkpt lat="35.69" lon="139.77"/>
      <trkpt lat="35.70" lon="139.78"/>
    </trkseg>
  </trk>
</gpx>"#;
        let tmp = std::env::temp_dir().join("test_trk.gpx");
        fs::write(&tmp, gpx).unwrap();
        let result = parse_gpx_to_geojson(&tmp).unwrap();
        let parsed: serde_json::Value = serde_json::from_str(&result).unwrap();
        let features = parsed["features"].as_array().unwrap();
        assert_eq!(features.len(), 1);
        assert_eq!(features[0]["geometry"]["type"], "LineString");
        let coords = features[0]["geometry"]["coordinates"].as_array().unwrap();
        assert_eq!(coords.len(), 3);
        assert_eq!(features[0]["properties"]["name"], "Morning Run");
        fs::remove_file(&tmp).ok();
    }

    #[test]
    fn parse_kml_point() {
        let kml = r#"<?xml version="1.0"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
    <Placemark>
      <name>Test Point</name>
      <Point>
        <coordinates>139.7671,35.6812,0</coordinates>
      </Point>
    </Placemark>
  </Document>
</kml>"#;
        let result = parse_kml_to_geojson(kml).unwrap();
        let parsed: serde_json::Value = serde_json::from_str(&result).unwrap();
        assert_eq!(parsed["type"], "FeatureCollection");
        let features = parsed["features"].as_array().unwrap();
        assert_eq!(features.len(), 1);
        assert_eq!(features[0]["geometry"]["type"], "Point");
        assert_eq!(features[0]["properties"]["name"], "Test Point");
    }

    #[test]
    fn parse_kml_polygon() {
        let kml = r#"<?xml version="1.0"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
    <Placemark>
      <name>Area</name>
      <Polygon>
        <outerBoundaryIs>
          <LinearRing>
            <coordinates>
              0,0,0 1,0,0 1,1,0 0,1,0 0,0,0
            </coordinates>
          </LinearRing>
        </outerBoundaryIs>
      </Polygon>
    </Placemark>
  </Document>
</kml>"#;
        let result = parse_kml_to_geojson(kml).unwrap();
        let parsed: serde_json::Value = serde_json::from_str(&result).unwrap();
        let features = parsed["features"].as_array().unwrap();
        assert_eq!(features.len(), 1);
        assert_eq!(features[0]["geometry"]["type"], "Polygon");
        let rings = features[0]["geometry"]["coordinates"].as_array().unwrap();
        assert_eq!(rings.len(), 1);
        assert_eq!(rings[0].as_array().unwrap().len(), 5);
    }

    #[test]
    fn parse_kml_linestring() {
        let kml = r#"<?xml version="1.0"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
    <Placemark>
      <name>Path</name>
      <LineString>
        <coordinates>0,0,0 1,1,0 2,2,0</coordinates>
      </LineString>
    </Placemark>
  </Document>
</kml>"#;
        let result = parse_kml_to_geojson(kml).unwrap();
        let parsed: serde_json::Value = serde_json::from_str(&result).unwrap();
        let features = parsed["features"].as_array().unwrap();
        assert_eq!(features.len(), 1);
        assert_eq!(features[0]["geometry"]["type"], "LineString");
    }
}
