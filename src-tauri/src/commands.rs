use serde::Serialize;
use std::fs;
use std::io::BufRead;
use std::path::Path;
use walkdir::WalkDir;

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
            extensions: vec!["json".to_string()],
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
        .filter(|e| {
            !is_hidden_path_except_text_special(e.path())
        })
        .filter(|e| e.file_type().is_file() && matches_search_target(e.path(), &extensions, include_text_special))
    {
        let path = entry.path();
        let file = match fs::File::open(path) {
            Ok(f) => f,
            Err(_) => continue,
        };

        let reader = std::io::BufReader::new(file);
        let mut file_matches: Vec<SearchMatch> = Vec::new();

        for (idx, line) in reader.lines().enumerate() {
            let line = match line {
                Ok(l) => l,
                Err(_) => continue,
            };

            let matched = if case_sensitive {
                line.contains(&query)
            } else {
                line.to_lowercase().contains(&query_lower)
            };

            if matched {
                file_matches.push(SearchMatch {
                    line_number: idx + 1,
                    line_text: line,
                });
            }
        }

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
        assert!(!contains_extension(&extensions, "png"));
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
