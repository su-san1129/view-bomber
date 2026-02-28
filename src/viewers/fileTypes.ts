import { isTextSpecialFileName, textExtensions } from "./textFormats";

const TEXT_PREVIEW_EXTENSIONS = new Set([
  "md",
  "markdown",
  "html",
  "htm",
  "json",
  "geojson",
  "csv",
  "tsv",
  "dxf",
  ...textExtensions
]);

const RAW_TEXT_CONTENT_EXTENSIONS = new Set([
  "md",
  "markdown",
  "html",
  "htm",
  "json",
  "geojson",
  "dxf",
  ...textExtensions
]);

export function getFileExtension(filePath: string): string {
  const fileName = filePath.split("/").pop() ?? "";
  const dotIndex = fileName.lastIndexOf(".");
  if (dotIndex < 0) return "";
  return fileName.slice(dotIndex + 1).toLowerCase();
}

export function isTextPreviewPath(filePath: string): boolean {
  return TEXT_PREVIEW_EXTENSIONS.has(getFileExtension(filePath)) || isTextSpecialFileName(filePath);
}

export function requiresRawTextContent(filePath: string): boolean {
  return RAW_TEXT_CONTENT_EXTENSIONS.has(getFileExtension(filePath))
    || isTextSpecialFileName(filePath);
}
