export interface FileEntry {
  name: string;
  path: string;
  is_dir: boolean;
  children?: FileEntry[];
}

export interface SearchMatch {
  line_number: number;
  line_text: string;
}

export interface SearchFileResult {
  file_path: string;
  file_name: string;
  matches: SearchMatch[];
}

export interface SupportedFileType {
  id: string;
  label: string;
  extensions: string[];
  searchable: boolean;
}

export interface LaunchTarget {
  workspacePath: string;
  selectedFilePath: string | null;
}

export interface XlsxSheetData {
  name: string;
  rows: string[][];
}

export interface XlsxData {
  sheets: XlsxSheetData[];
}

export interface DocxTextData {
  text: string;
}

export interface FileContentData {
  content: string;
  encoding: string;
  isUtf8: boolean;
}

export interface CsvChunkData {
  delimiter: string;
  header: string[];
  rows: string[][];
  next_cursor: number | null;
  eof: boolean;
}

export interface ParquetPreviewData {
  columns: string[];
  rows: string[][];
  totalRows: number;
  truncated: boolean;
}

export interface DuckDbTablePreviewData {
  tableName: string;
  columns: string[];
  rows: string[][];
  totalRows: number;
  truncated: boolean;
}

export interface DuckDbTableInfo {
  schemaName: string;
  tableName: string;
  displayName: string;
}
