import { useEffect, useState } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { exists } from "@tauri-apps/plugin-fs";
import { readFileContent } from "../../lib/tauri";
import type { ViewerPlugin } from "../types";

function isViteDevEntrypoint(content: string): boolean {
  return /<script[^>]+type=["']module["'][^>]+src=["']\/src\/[^"']+\.(ts|tsx|js|jsx)["']/i.test(
    content
  );
}

function getDistIndexPath(filePath: string): string {
  return filePath.replace(/[/\\]index\.html$/i, "/dist/index.html");
}

function toBasePath(filePath: string): string {
  return filePath.replace(/[/\\][^/\\]*$/, "/");
}

function transformHtmlForPreview(content: string, filePath: string): string {
  const baseHref = convertFileSrc(toBasePath(filePath));
  let html = content;

  if (!/<base\b/i.test(html)) {
    html = html.replace(/<head(\s[^>]*)?>/i, (headTag) => `${headTag}<base href="${baseHref}" />`);
  }

  html = html.replace(
    /\b(src|href)=["']\/(?!\/)([^"']+)["']/gi,
    (_all, attr: string, path: string) => {
      return `${attr}="./${path}"`;
    }
  );

  return html;
}

function HtmlPreview({ filePath, content }: { filePath: string; content: string; }) {
  const [previewHtml, setPreviewHtml] = useState(() => transformHtmlForPreview(content, filePath));
  const [usingDistFallback, setUsingDistFallback] = useState(false);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      let targetPath = filePath;
      let targetContent = content;
      let usedFallback = false;

      if (isViteDevEntrypoint(content)) {
        const distIndexPath = getDistIndexPath(filePath);
        if (await exists(distIndexPath)) {
          try {
            targetContent = await readFileContent(distIndexPath);
            targetPath = distIndexPath;
            usedFallback = true;
          } catch {
            // Keep original content when fallback read fails.
          }
        }
      }

      if (cancelled) return;
      setUsingDistFallback(usedFallback);
      setPreviewHtml(transformHtmlForPreview(targetContent, targetPath));
    };

    load();

    return () => {
      cancelled = true;
    };
  }, [filePath, content]);

  return (
    <>
      {usingDistFallback && (
        <p
          style={{
            padding: "var(--sp-2) var(--sp-4)",
            color: "var(--text-secondary)",
            fontSize: "var(--font-ui)"
          }}
        >
          Vite開発用のindex.htmlを検出したため、dist/index.htmlを表示しています。
        </p>
      )}
      <iframe
        title="HTML Preview"
        sandbox="allow-forms allow-modals allow-popups allow-same-origin allow-scripts"
        srcDoc={previewHtml}
        style={{
          width: "100%",
          height: "100%",
          border: "none",
          backgroundColor: "white"
        }}
      />
    </>
  );
}

export const htmlViewerPlugin: ViewerPlugin = {
  id: "html",
  label: "HTML",
  extensions: ["html", "htm"],
  supportsFind: false,
  render({ filePath, content }) {
    return <HtmlPreview filePath={filePath} content={content} />;
  }
};
