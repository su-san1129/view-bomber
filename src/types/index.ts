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

export interface CsvChunkData {
  delimiter: string;
  header: string[];
  rows: string[][];
  next_cursor: number | null;
  eof: boolean;
}
