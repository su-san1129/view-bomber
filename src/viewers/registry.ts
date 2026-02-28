import { htmlViewerPlugin } from "./plugins/html";
import { imageViewerPlugin } from "./plugins/image";
import { csvViewerPlugin } from "./plugins/csv";
import { dxfViewerPlugin } from "./plugins/dxf";
import { jsonViewerPlugin } from "./plugins/json";
import { markdownViewerPlugin } from "./plugins/markdown";
import { pdfViewerPlugin } from "./plugins/pdf";
import { textViewerPlugin } from "./plugins/text";
import { getFileExtension } from "./fileTypes";
import { isTextSpecialFileName } from "./textFormats";
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
registerViewer(dxfViewerPlugin);
registerViewer(textViewerPlugin);
registerViewer(imageViewerPlugin);
registerViewer(pdfViewerPlugin);

export function resolveViewer(filePath: string): ViewerPlugin | null {
  const extension = getFileExtension(filePath);

  if (!extension && isTextSpecialFileName(filePath)) return textViewerPlugin;
  if (!extension) return null;

  const plugin = viewerPlugins.find((plugin) =>
    plugin.extensions.some((ext) => ext.toLowerCase() === extension)
  );

  if (plugin) return plugin;
  if (isTextSpecialFileName(filePath)) return textViewerPlugin;

  return null;
}
