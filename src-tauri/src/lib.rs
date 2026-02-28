mod commands;

use commands::{
    get_supported_file_types, read_csv_chunk, read_directory_tree, read_docx_text,
    read_file_content, read_xlsx, search_files,
};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .invoke_handler(tauri::generate_handler![
            read_directory_tree,
            read_file_content,
            read_csv_chunk,
            read_xlsx,
            read_docx_text,
            search_files,
            get_supported_file_types
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
