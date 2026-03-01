import {
  FileCode,
  FileImage,
  FileJson,
  FileSpreadsheet,
  FileText,
  FileType,
  type LucideIcon
} from "lucide-react";
import { getFileExtension } from "../viewers/fileTypes";
import { isTextSpecialFileName, textExtensions } from "../viewers/textFormats";

export interface FileIconMeta {
  Icon: LucideIcon;
  color: string;
}

const imageExtensions = new Set([
  "png",
  "jpg",
  "jpeg",
  "gif",
  "webp",
  "svg",
  "bmp",
  "ico",
  "avif",
  "tif",
  "tiff"
]);
const codeLikeExtensions = new Set([
  "md",
  "markdown",
  "html",
  "htm",
  ...textExtensions
]);

export function resolveFileIcon(path: string): FileIconMeta {
  const extension = getFileExtension(path);

  if (extension === "json" || extension === "geojson") {
    return { Icon: FileJson, color: "#cb8cff" };
  }

  if (
    extension === "csv"
    || extension === "tsv"
    || extension === "xlsx"
    || extension === "xlsm"
    || extension === "xls"
    || extension === "ods"
  ) {
    return { Icon: FileSpreadsheet, color: "#7fc97f" };
  }

  if (extension === "parquet") {
    return { Icon: FileSpreadsheet, color: "#63b7b2" };
  }

  if (extension === "duckdb" || extension === "ddb") {
    return { Icon: FileSpreadsheet, color: "#6da3f0" };
  }

  if (imageExtensions.has(extension)) {
    return { Icon: FileImage, color: "#f0c36d" };
  }

  if (extension === "pdf" || extension === "docx") {
    return { Icon: FileType, color: "#f08b8b" };
  }

  if (codeLikeExtensions.has(extension) || isTextSpecialFileName(path)) {
    return { Icon: FileCode, color: "#6bb5f6" };
  }

  return { Icon: FileText, color: "#519aba" };
}
