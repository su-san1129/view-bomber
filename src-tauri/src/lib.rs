mod commands;

use commands::{
    export_markdown_to_pdf, get_launch_target, get_supported_file_types, open_in_file_manager,
    read_csv_chunk, read_directory_tree, read_docx_text, read_duckdb_table_preview,
    read_duckdb_tables, read_file_content, read_parquet, read_xlsx, search_files,
};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .invoke_handler(tauri::generate_handler![
            read_directory_tree,
            read_file_content,
            open_in_file_manager,
            read_csv_chunk,
            read_xlsx,
            read_docx_text,
            read_parquet,
            read_duckdb_tables,
            read_duckdb_table_preview,
            export_markdown_to_pdf,
            search_files,
            get_supported_file_types,
            get_launch_target
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
