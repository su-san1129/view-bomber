import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import type {
  CsvChunkData,
  DocxTextData,
  FileEntry,
  SearchFileResult,
  SupportedFileType,
  XlsxData
} from "../types";

export async function openFolderDialog(): Promise<string | null> {
  const selected = await open({ directory: true, multiple: false });
  return selected as string | null;
}

export async function readDirectoryTree(path: string): Promise<FileEntry[]> {
  return invoke<FileEntry[]>("read_directory_tree", { path });
}

export async function readFileContent(path: string): Promise<string> {
  return invoke<string>("read_file_content", { path });
}

export async function searchFiles(
  rootPath: string,
  query: string,
  caseSensitive: boolean,
  fileTypeFilter: string
): Promise<SearchFileResult[]> {
  return invoke<SearchFileResult[]>("search_files", {
    rootPath,
    query,
    caseSensitive,
    fileTypeFilter
  });
}

export async function getSupportedFileTypes(): Promise<SupportedFileType[]> {
  return invoke<SupportedFileType[]>("get_supported_file_types");
}

export async function readXlsx(path: string): Promise<XlsxData> {
  return invoke<XlsxData>("read_xlsx", { path });
}

export async function readDocxText(path: string): Promise<DocxTextData> {
  return invoke<DocxTextData>("read_docx_text", { path });
}

export async function readCsvChunk(
  path: string,
  cursor: number | null,
  maxRows: number,
  delimiterHint: string | null
): Promise<CsvChunkData> {
  return invoke<CsvChunkData>("read_csv_chunk", {
    path,
    cursor,
    maxRows,
    delimiterHint
  });
}
