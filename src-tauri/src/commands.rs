use calamine::{open_workbook_auto, Reader};
use quick_xml::events::Event;
use quick_xml::Reader as XmlReader;
use serde::Serialize;
use std::fs;
use std::io::BufRead;
use std::io::Read;
use std::path::Path;
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
    vec!["xlsx".to_string(), "xlsm".to_string()]
}

fn document_extensions() -> Vec<String> {
    vec!["docx".to_string()]
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

fn parse_xlsx(path: &Path) -> Result<XlsxData, String> {
    let mut workbook = open_workbook_auto(path)
        .map_err(|e| format!("Failed to open xlsx workbook: {}", e))?;
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
            .map(|row| row.iter().map(|cell| cell.to_string()).collect::<Vec<String>>())
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

fn search_plain_text_file(path: &Path, query: &str, query_lower: &str, case_sensitive: bool) -> Vec<SearchMatch> {
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

fn search_xlsx_file(path: &Path, query: &str, query_lower: &str, case_sensitive: bool) -> Vec<SearchMatch> {
    let workbook = match parse_xlsx(path) {
        Ok(workbook) => workbook,
        Err(_) => return Vec::new(),
    };

    let mut lines: Vec<String> = Vec::new();
    for sheet in &workbook.sheets {
        for (row_index, row) in sheet.rows.iter().enumerate() {
            lines.push(format!("[{}:{}] {}", sheet.name, row_index + 1, row.join(" | ")));
        }
    }
    search_line_matches(lines.into_iter(), query, query_lower, case_sensitive)
}

fn search_docx_file(path: &Path, query: &str, query_lower: &str, case_sensitive: bool) -> Vec<SearchMatch> {
    let text = match parse_docx_text(path) {
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

#[tauri::command]
pub async fn read_file_content(path: String) -> Result<String, String> {
    let file_path = Path::new(&path);
    if !file_path.exists() {
        return Err(format!("File not found: {}", path));
    }
    if !file_path.is_file() {
        return Err(format!("Not a file: {}", path));
    }
    fs::read_to_string(file_path).map_err(|e| format!("Failed to read file: {}", e))
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
    if !has_extension(file_path, "xlsx") && !has_extension(file_path, "xlsm") {
        return Err("Target file is not .xlsx or .xlsm".to_string());
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
    if !has_extension(file_path, "docx") {
        return Err("Target file is not .docx".to_string());
    }

    parse_docx_text(file_path).map(|text| DocxTextData { text })
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
        .filter(|e| e.file_type().is_file() && matches_search_target(e.path(), &extensions, include_text_special))
    {
        let path = entry.path();
        let file_matches = if has_extension(path, "xlsx") || has_extension(path, "xlsm") {
            search_xlsx_file(path, &query, &query_lower, case_sensitive)
        } else if has_extension(path, "docx") {
            search_docx_file(path, &query, &query_lower, case_sensitive)
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
        assert!(contains_extension(&extensions, "docx"));
        assert!(!contains_extension(&extensions, "png"));
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
        assert!(is_hidden_path_except_text_special(Path::new("/tmp/.secret/notes.txt")));
    }
}
