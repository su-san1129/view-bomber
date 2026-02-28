import { convertFileSrc } from "@tauri-apps/api/core";
import type { ViewerPlugin } from "../types";

export const imageViewerPlugin: ViewerPlugin = {
  id: "image",
  label: "Image",
  extensions: ["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp", "ico", "avif"],
  supportsFind: false,
  render({ filePath }) {
    const src = convertFileSrc(filePath);
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
};
