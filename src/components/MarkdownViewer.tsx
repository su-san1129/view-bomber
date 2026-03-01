import { useCallback, useEffect, useRef, useState } from "react";
import { watchImmediate } from "@tauri-apps/plugin-fs";
import { FileText } from "lucide-react";
import { useActiveWorkspace, useAppDispatch, useAppState } from "../context/AppContext";
import { exportMarkdownToPdf, readFileContent, savePdfDialog } from "../lib/tauri";
import { EmptyState } from "./EmptyState";
import { FindBar } from "./FindBar";
import { requiresRawTextContent } from "../viewers/fileTypes";
import { resolveViewer } from "../viewers/registry";

export function MarkdownViewer() {
  const { activeWorkspaceId } = useAppState();
  const activeWorkspace = useActiveWorkspace();
  const dispatch = useAppDispatch();
  const unwatchRef = useRef<(() => void) | null>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const [findVisible, setFindVisible] = useState(false);
  const [exportingPdf, setExportingPdf] = useState(false);

  const selectedFilePath = activeWorkspace?.selectedFilePath ?? null;
  const fileContent = activeWorkspace?.fileContent ?? null;
  const fileEncoding = activeWorkspace?.fileEncoding ?? null;
  const fileIsUtf8 = activeWorkspace?.fileIsUtf8 ?? null;
  const loading = activeWorkspace?.loading ?? false;
  const error = activeWorkspace?.error ?? null;
  const closeFindBar = useCallback(() => setFindVisible(false), []);
  const viewer = selectedFilePath ? resolveViewer(selectedFilePath) : null;
  const supportsFind = viewer?.supportsFind ?? true;
  const isMarkdownViewer = viewer?.id === "markdown";
  const fileName = selectedFilePath?.split("/").pop() ?? "";
  const content = fileContent ?? "";

  const onExportPdf = useCallback(async () => {
    if (!activeWorkspaceId || !selectedFilePath || !isMarkdownViewer || exportingPdf) return;
    const defaultPath = selectedFilePath.replace(/\.(md|markdown)$/i, ".pdf");
    const selectedPath = await savePdfDialog(defaultPath);
    if (!selectedPath) return;

    try {
      setExportingPdf(true);
      await exportMarkdownToPdf(selectedFilePath, selectedPath);
      dispatch({
        type: "SET_WORKSPACE_ERROR",
        payload: { workspaceId: activeWorkspaceId, error: null }
      });
    } catch (error) {
      dispatch({
        type: "SET_WORKSPACE_ERROR",
        payload: { workspaceId: activeWorkspaceId, error: String(error) }
      });
    } finally {
      setExportingPdf(false);
    }
  }, [activeWorkspaceId, dispatch, exportingPdf, isMarkdownViewer, selectedFilePath]);

  useEffect(() => {
    if (!selectedFilePath) return;

    let cancelled = false;

    const setupWatch = async () => {
      if (unwatchRef.current) {
        unwatchRef.current();
        unwatchRef.current = null;
      }

      try {
        const unwatch = await watchImmediate(selectedFilePath, async (event) => {
          if (cancelled) return;
          const kind = event.type;
          if (typeof kind === "object" && "modify" in kind) {
            try {
              const fileContent = requiresRawTextContent(selectedFilePath)
                ? await readFileContent(selectedFilePath)
                : { content: "", encoding: null, isUtf8: null };
              if (!activeWorkspaceId) return;
              dispatch({
                type: "SET_WORKSPACE_FILE_CONTENT",
                payload: {
                  workspaceId: activeWorkspaceId,
                  content: fileContent.content,
                  encoding: fileContent.encoding,
                  isUtf8: fileContent.isUtf8
                }
              });
            } catch {
              // File may have been deleted
            }
          }
        });
        unwatchRef.current = unwatch;
      } catch {
        // Watching may not be supported
      }
    };

    setupWatch();

    return () => {
      cancelled = true;
      if (unwatchRef.current) {
        unwatchRef.current();
        unwatchRef.current = null;
      }
    };
  }, [selectedFilePath, dispatch, activeWorkspaceId]);

  // Cmd+F -> open find bar when viewer supports in-file find
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "f") {
        if (!supportsFind) return;
        e.preventDefault();
        setFindVisible(true);
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [supportsFind]);

  // Close find bar on file switch or when viewer does not support it
  useEffect(() => {
    setFindVisible(false);
  }, [selectedFilePath, supportsFind]);

  if (!activeWorkspaceId) {
    return <EmptyState />;
  }

  if (!selectedFilePath) {
    return (
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          height: "100%",
          gap: "var(--sp-4)",
          backgroundColor: "var(--bg-main)",
          color: "var(--text-secondary)",
          userSelect: "none"
        }}
      >
        <FileText size={40} strokeWidth={1} />
        <p style={{ fontSize: "var(--font-ui)" }}>対応ファイルを選択してプレビュー</p>
      </div>
    );
  }

  if (loading) {
    return (
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          height: "100%",
          backgroundColor: "var(--bg-main)",
          color: "var(--text-secondary)",
          fontSize: "var(--font-ui)"
        }}
      >
        読み込み中...
      </div>
    );
  }

  if (error) {
    return (
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          height: "100%",
          backgroundColor: "var(--bg-main)",
          color: "#f14c4c",
          fontSize: "var(--font-ui)"
        }}
      >
        {error}
      </div>
    );
  }

  return (
    <div
      style={{
        height: "100%",
        display: "flex",
        flexDirection: "column",
        backgroundColor: "var(--bg-main)"
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "var(--sp-2)",
          height: "var(--h-tab)",
          padding: "0 var(--sp-4)",
          fontSize: "var(--font-ui)",
          color: "var(--text-secondary)",
          borderBottom: "1px solid var(--border-color)",
          flexShrink: 0,
          userSelect: "none"
        }}
      >
        <span>{fileName}</span>
        {fileEncoding && (
          <span
            style={{
              fontSize: "var(--font-label)",
              lineHeight: "18px",
              padding: "0 6px",
              borderRadius: "var(--radius-sm)",
              backgroundColor: "var(--bg-hover)",
              color: "var(--text-secondary)"
            }}
          >
            Encoding: {fileEncoding}
            {fileIsUtf8 === false ? " (detected)" : ""}
          </span>
        )}
        {isMarkdownViewer && (
          <button
            type="button"
            onClick={() => void onExportPdf()}
            disabled={exportingPdf}
            style={{
              marginLeft: "auto",
              display: "inline-flex",
              alignItems: "center",
              height: 24,
              padding: "0 10px",
              borderRadius: "var(--radius-sm)",
              border: "1px solid var(--border-color)",
              backgroundColor: exportingPdf ? "transparent" : "var(--bg-hover)",
              color: exportingPdf ? "var(--text-muted)" : "var(--text-primary)",
              cursor: exportingPdf ? "default" : "pointer",
              fontSize: "var(--font-ui)"
            }}
            title="MarkdownをPDFとして書き出し"
          >
            {exportingPdf ? "書き出し中..." : "PDFとして書き出し"}
          </button>
        )}
      </div>
      {findVisible && supportsFind && <FindBar contentRef={contentRef} onClose={closeFindBar} />}
      <div
        style={{
          flex: 1,
          overflowY: viewer?.id === "html" || viewer?.id === "pdf" || viewer?.id === "dxf"
            ? "hidden"
            : "auto",
          padding: viewer?.id === "html" || viewer?.id === "pdf" || viewer?.id === "dxf"
            ? 0
            : "var(--sp-6) var(--sp-10)"
        }}
      >
        {viewer
          ? (
            viewer.render({
              filePath: selectedFilePath,
              content,
              contentRef
            })
          )
          : (
            <div ref={contentRef} style={{ maxWidth: 1200, margin: "0 auto" }}>
              <p style={{ marginBottom: "var(--sp-3)", color: "var(--text-secondary)" }}>
                この拡張子は未対応です。生テキストを表示します。
              </p>
              <pre className="plain-text-view">{content}</pre>
            </div>
          )}
      </div>
    </div>
  );
}
