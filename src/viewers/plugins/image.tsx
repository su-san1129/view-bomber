import { useEffect, useState } from "react";
import { readFile } from "@tauri-apps/plugin-fs";
import type { ViewerPlugin } from "../types";

function getMimeType(filePath: string): string {
  const extension = filePath.split(".").pop()?.toLowerCase() ?? "";
  switch (extension) {
    case "jpg":
    case "jpeg":
      return "image/jpeg";
    case "png":
      return "image/png";
    case "gif":
      return "image/gif";
    case "webp":
      return "image/webp";
    case "svg":
      return "image/svg+xml";
    case "bmp":
      return "image/bmp";
    case "ico":
      return "image/x-icon";
    case "avif":
      return "image/avif";
    case "tif":
    case "tiff":
      return "image/tiff";
    default:
      return "application/octet-stream";
  }
}

function ImageViewer({ filePath }: { filePath: string; }) {
  const [src, setSrc] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let blobUrl: string | null = null;

    const load = async () => {
      try {
        setSrc(null);
        setError(null);
        const bytes = await readFile(filePath);
        if (cancelled) return;
        const blob = new Blob([bytes], { type: getMimeType(filePath) });
        blobUrl = URL.createObjectURL(blob);
        setSrc(blobUrl);
      } catch (err) {
        if (cancelled) return;
        setError(`画像の読み込みに失敗しました: ${String(err)}`);
      }
    };

    load();

    return () => {
      cancelled = true;
      if (blobUrl) {
        URL.revokeObjectURL(blobUrl);
      }
    };
  }, [filePath]);

  if (error) {
    return (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "#f14c4c"
        }}
      >
        {error}
      </div>
    );
  }

  if (!src) {
    return (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center"
        }}
      >
        読み込み中...
      </div>
    );
  }

  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "var(--sp-6)"
      }}
    >
      <img
        src={src}
        alt={filePath.split("/").pop() ?? "image"}
        style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain", borderRadius: 8 }}
      />
    </div>
  );
}

export const imageViewerPlugin: ViewerPlugin = {
  id: "image",
  label: "Image",
  extensions: ["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp", "ico", "avif", "tif", "tiff"],
  supportsFind: false,
  render({ filePath }) {
    return <ImageViewer filePath={filePath} />;
  }
};
