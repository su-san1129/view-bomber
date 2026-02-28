import { htmlViewerPlugin } from "./plugins/html";
import { imageViewerPlugin } from "./plugins/image";
import { csvViewerPlugin } from "./plugins/csv";
import { jsonViewerPlugin } from "./plugins/json";
import { markdownViewerPlugin } from "./plugins/markdown";
import { pdfViewerPlugin } from "./plugins/pdf";
import { getFileExtension } from "./fileTypes";
import type { ViewerPlugin } from "./types";

const viewerPlugins: ViewerPlugin[] = [];

export function registerViewer(plugin: ViewerPlugin) {
  if (viewerPlugins.some((entry) => entry.id === plugin.id)) {
    return;
  }
  viewerPlugins.push(plugin);
}

registerViewer(markdownViewerPlugin);
registerViewer(htmlViewerPlugin);
registerViewer(jsonViewerPlugin);
registerViewer(csvViewerPlugin);
registerViewer(imageViewerPlugin);
registerViewer(pdfViewerPlugin);

export function resolveViewer(filePath: string): ViewerPlugin | null {
  const extension = getFileExtension(filePath);
  if (!extension) return null;

  return viewerPlugins.find((plugin) =>
    plugin.extensions.some((ext) => ext.toLowerCase() === extension)
  ) ?? null;
}
