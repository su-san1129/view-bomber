import { type ClipboardEvent, type RefObject, useCallback, useMemo, useState } from "react";
import hljs from "highlight.js";
import type { ViewerPlugin } from "../types";
import { textExtensions } from "../textFormats";

const MAX_INITIAL_RENDER_LINES = 3000;
const MAX_HIGHLIGHT_CHARS = 250000;

function getLowerFileName(filePath: string): string {
  const rawName = filePath.split(/[/\\]/).pop() ?? "";
  return rawName.toLowerCase();
}

function resolveHighlightLanguage(filePath: string): string | null {
  const extension = filePath.split(".").pop()?.toLowerCase() ?? "";
  const fileName = getLowerFileName(filePath);

  const byExtension: Record<string, string> = {
    ts: "typescript",
    tsx: "typescript",
    js: "javascript",
    jsx: "javascript",
    mjs: "javascript",
    cjs: "javascript",
    py: "python",
    rb: "ruby",
    rs: "rust",
    go: "go",
    java: "java",
    c: "c",
    h: "c",
    cpp: "cpp",
    hpp: "cpp",
    sh: "bash",
    bash: "bash",
    zsh: "bash",
    fish: "bash",
    ps1: "powershell",
    bat: "dos",
    cmd: "dos",
    css: "css",
    scss: "scss",
    less: "less",
    json: "json",
    yaml: "yaml",
    yml: "yaml",
    toml: "ini",
    xml: "xml",
    sql: "sql",
    log: "plaintext",
    txt: "plaintext",
    text: "plaintext",
    swift: "swift",
    kt: "kotlin",
    dart: "dart",
    lua: "lua",
    php: "php",
    r: "r",
    properties: "properties",
    ini: "ini"
  };

  if (fileName === "dockerfile") return "dockerfile";
  if (fileName === "makefile" || fileName === "gnumakefile") return "makefile";
  if (fileName.startsWith(".env")) return "ini";
  if (fileName === ".editorconfig") return "ini";
  if (fileName === ".gitignore") return "plaintext";

  return byExtension[extension] ?? null;
}

function TextViewer(
  {
    filePath,
    content,
    contentRef
  }: { filePath: string; content: string; contentRef: RefObject<HTMLDivElement | null>; }
) {
  const [wrap, setWrap] = useState(true);
  const [showAll, setShowAll] = useState(false);
  const lines = useMemo(() => content.split(/\r?\n/), [content]);
  const totalLines = lines.length;
  const hasLineLimit = totalLines > MAX_INITIAL_RENDER_LINES;

  const visibleLines = useMemo(
    () => (showAll || !hasLineLimit ? lines : lines.slice(0, MAX_INITIAL_RENDER_LINES)),
    [hasLineLimit, lines, showAll]
  );
  const visibleText = useMemo(() => visibleLines.join("\n"), [visibleLines]);
  const lineOffset = 0;

  const highlightLines = useMemo(() => {
    if (visibleText.length > MAX_HIGHLIGHT_CHARS) return null;

    const language = resolveHighlightLanguage(filePath);
    try {
      const highlighted = language
        ? hljs.highlight(visibleText, { language, ignoreIllegals: true })
        : hljs.highlightAuto(visibleText);
      return highlighted.value.split("\n");
    } catch {
      return null;
    }
  }, [filePath, visibleText]);

  const handleCopy = useCallback((event: ClipboardEvent<HTMLDivElement>) => {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) return;

    const copied: string[] = [];

    for (let i = 0; i < selection.rangeCount; i += 1) {
      const fragment = selection.getRangeAt(i).cloneContents();
      const wrapper = document.createElement("div");

      wrapper.appendChild(fragment);
      wrapper.querySelectorAll(".text-line-no").forEach((element) => element.remove());

      copied.push(wrapper.innerText);
    }

    const nextValue = copied.join("\n");
    if (nextValue.length === 0) return;

    event.preventDefault();
    event.clipboardData.setData("text/plain", nextValue);
  }, []);

  return (
    <div ref={contentRef} className="text-viewer">
      <div className="text-toolbar">
        <button
          type="button"
          className="text-wrap-toggle"
          onClick={() => setWrap((prev) => !prev)}
          title="折り返し切替"
        >
          Wrap: {wrap ? "ON" : "OFF"}
        </button>
        <span className="text-meta">
          Lines: {totalLines}
        </span>
        {hasLineLimit && !showAll && (
          <span className="text-meta">
            Showing first {MAX_INITIAL_RENDER_LINES}
          </span>
        )}
        {hasLineLimit && !showAll && (
          <button
            type="button"
            className="text-wrap-toggle"
            onClick={() => setShowAll(true)}
            title="全行を表示"
          >
            Show all
          </button>
        )}
      </div>
      <div className={`text-grid ${wrap ? "is-wrap" : "is-no-wrap"}`} onCopy={handleCopy}>
        {visibleLines.map((line, index) => (
          <div key={index} className="text-line-row">
            <span className="text-line-no">{index + 1 + lineOffset}</span>
            {highlightLines
              ? (
                <span
                  className="text-line-content is-highlighted hljs"
                  dangerouslySetInnerHTML={{ __html: highlightLines[index] || " " }}
                />
              )
              : <span className="text-line-content">{line.length > 0 ? line : " "}</span>}
          </div>
        ))}
      </div>
    </div>
  );
}

export const textViewerPlugin: ViewerPlugin = {
  id: "text",
  label: "Text",
  extensions: textExtensions,
  supportsFind: true,
  render({ filePath, content, contentRef }) {
    return <TextViewer filePath={filePath} content={content} contentRef={contentRef} />;
  }
};
