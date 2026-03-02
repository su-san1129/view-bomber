import { invoke } from "@tauri-apps/api/core";
import { open, save } from "@tauri-apps/plugin-dialog";
import type {
  CsvChunkData,
  DocxTextData,
  DuckDbTableInfo,
  DuckDbTablePreviewData,
  FileContentData,
  FileEntry,
  FileMetaData,
  GeoJsonData,
  GeoJsonTileData,
  GeoJsonTileSessionData,
  LaunchTarget,
  ParquetPreviewData,
  SearchFileResult,
  SqliteTableInfo,
  SqliteTablePreviewData,
  SupportedFileType,
  XlsxData
} from "../types";

export async function openFolderDialog(): Promise<string | null> {
  const selected = await open({ directory: true, multiple: false });
  return selected as string | null;
}

export async function savePdfDialog(defaultPath: string): Promise<string | null> {
  const selected = await save({
    defaultPath,
    filters: [{ name: "PDF", extensions: ["pdf"] }]
  });
  return selected as string | null;
}

export async function readDirectoryTree(path: string): Promise<FileEntry[]> {
  return invoke<FileEntry[]>("read_directory_tree", { path });
}

export async function getFileMeta(path: string): Promise<FileMetaData> {
  return invoke<FileMetaData>("get_file_meta", { path });
}

export async function readFileContent(path: string): Promise<FileContentData> {
  return invoke<FileContentData>("read_file_content", { path });
}

export async function openInFileManager(path: string): Promise<void> {
  await invoke("open_in_file_manager", { path });
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

export async function getLaunchTarget(): Promise<LaunchTarget | null> {
  return invoke<LaunchTarget | null>("get_launch_target");
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

export async function readParquet(path: string, maxRows: number): Promise<ParquetPreviewData> {
  return invoke<ParquetPreviewData>("read_parquet", {
    path,
    maxRows
  });
}

export async function readDuckDbTables(path: string): Promise<DuckDbTableInfo[]> {
  return invoke<DuckDbTableInfo[]>("read_duckdb_tables", { path });
}

export async function readDuckDbTablePreview(
  path: string,
  schemaName: string | null,
  tableName: string,
  maxRows: number
): Promise<DuckDbTablePreviewData> {
  return invoke<DuckDbTablePreviewData>("read_duckdb_table_preview", {
    path,
    schemaName,
    tableName,
    maxRows
  });
}

export async function readSqliteTables(path: string): Promise<SqliteTableInfo[]> {
  return invoke<SqliteTableInfo[]>("read_sqlite_tables", { path });
}

export async function readSqliteTablePreview(
  path: string,
  tableName: string,
  maxRows: number
): Promise<SqliteTablePreviewData> {
  return invoke<SqliteTablePreviewData>("read_sqlite_table_preview", {
    path,
    tableName,
    maxRows
  });
}

export async function readGpx(path: string): Promise<GeoJsonData> {
  return invoke<GeoJsonData>("read_gpx", { path });
}

export async function readKml(path: string): Promise<GeoJsonData> {
  return invoke<GeoJsonData>("read_kml", { path });
}

export async function prepareGeoJsonTiles(
  path: string,
  options?: {
    maxFeaturesPerTile?: number;
    minZoom?: number;
    maxZoom?: number;
    progressRequestId?: string;
  }
): Promise<GeoJsonTileSessionData> {
  return invoke<GeoJsonTileSessionData>("prepare_geojson_tiles", {
    path,
    maxFeaturesPerTile: options?.maxFeaturesPerTile,
    minZoom: options?.minZoom,
    maxZoom: options?.maxZoom,
    progressRequestId: options?.progressRequestId
  });
}

export async function readGeoJsonTile(
  datasetId: string,
  z: number,
  x: number,
  y: number,
  options?: {
    resolutionMode?: "auto" | "low" | "medium" | "high";
    autoCpuCores?: number;
    autoDeviceMemoryGb?: number;
  }
): Promise<GeoJsonTileData> {
  return invoke<GeoJsonTileData>("read_geojson_tile", {
    datasetId,
    z,
    x,
    y,
    resolutionMode: options?.resolutionMode,
    autoCpuCores: options?.autoCpuCores,
    autoDeviceMemoryGb: options?.autoDeviceMemoryGb
  });
}

export async function releaseGeoJsonTiles(datasetId: string): Promise<void> {
  await invoke("release_geojson_tiles", { datasetId });
}

export async function exportMarkdownToPdf(inputPath: string, outputPath: string): Promise<string> {
  return invoke<string>("export_markdown_to_pdf", {
    inputPath,
    outputPath
  });
}
