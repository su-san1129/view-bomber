import { useEffect, useMemo, useRef, useState } from "react";
import { FileText, LocateFixed, Search, X } from "lucide-react";
import { useAppDispatch, useAppState } from "../context/AppContext";
import { openInFileManager } from "../lib/tauri";
import { useSearch } from "../lib/useSearch";
import { useOpenFolder } from "../lib/useOpenFolder";
import type { FileEntry } from "../types";
import { FileTree } from "./FileTree";
import { SearchBar } from "./SearchBar";
import { SearchResults } from "./SearchResults";

const CONTEXT_MENU_WIDTH = 164;
const CONTEXT_MENU_ROW_HEIGHT = 30;
const CONTEXT_MENU_BASE_HEIGHT = CONTEXT_MENU_ROW_HEIGHT * 2 + 1;
const SUBMENU_WIDTH = 186;
const VIEWPORT_PADDING = 8;

interface ContextMenuState {
  x: number;
  y: number;
  targetPath: string;
  targetName: string;
  workspacePath: string;
  submenuOpen: boolean;
}

function filterFileTree(entries: FileEntry[], query: string): FileEntry[] {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) return entries;

  const filtered: FileEntry[] = [];
  for (const entry of entries) {
    const matched = entry.name.toLowerCase().includes(normalizedQuery);
    if (!entry.is_dir) {
      if (matched) filtered.push(entry);
      continue;
    }

    if (matched) {
      filtered.push(entry);
      continue;
    }

    const children = filterFileTree(entry.children ?? [], query);
    if (children.length > 0) {
      filtered.push({
        ...entry,
        children
      });
    }
  }
  return filtered;
}

function normalizePath(path: string): string {
  return path.replace(/\\/g, "/").replace(/\/+$/, "");
}

function toRelativePath(targetPath: string, workspacePath: string): string {
  const normalizedTarget = normalizePath(targetPath);
  const normalizedWorkspace = normalizePath(workspacePath);

  if (!normalizedTarget || !normalizedWorkspace) return targetPath;
  if (normalizedTarget === normalizedWorkspace) return ".";
  if (!normalizedTarget.startsWith(`${normalizedWorkspace}/`)) return targetPath;
  return normalizedTarget.slice(normalizedWorkspace.length + 1);
}

export function Sidebar() {
  const { activeWorkspaceId, workspaces } = useAppState();
  const dispatch = useAppDispatch();
  const activeWorkspace = activeWorkspaceId ? workspaces[activeWorkspaceId] : null;
  const openFolder = useOpenFolder();
  const [fileNameQuery, setFileNameQuery] = useState("");
  const [revealToken, setRevealToken] = useState(0);
  const [searchMode, setSearchMode] = useState<"content" | "fileName">("content");
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [contextHighlightPath, setContextHighlightPath] = useState<string | null>(null);
  const contextMenuRef = useRef<HTMLDivElement | null>(null);

  useSearch();

  const closeContextMenu = () => {
    setContextMenu(null);
    setContextHighlightPath(null);
  };
  const openInFileManagerLabel = navigator.userAgent.toLowerCase().includes("mac")
    ? "Finderで開く"
    : "フォルダで開く";

  useEffect(() => {
    if (!activeWorkspace) return;
    if (activeWorkspace.treeLoaded || activeWorkspace.loading) return;
    void openFolder(activeWorkspace.path);
  }, [
    activeWorkspace?.id,
    activeWorkspace?.treeLoaded,
    activeWorkspace?.loading,
    activeWorkspace?.path,
    openFolder
  ]);

  const hasContentSearch = activeWorkspace ? activeWorkspace.searchQuery.trim().length > 0 : false;
  const hasFileNameSearch = fileNameQuery.trim().length > 0;
  const hasSearch = searchMode === "content" ? hasContentSearch : hasFileNameSearch;
  const hasWorkspace = !!activeWorkspace;
  const fileTree = activeWorkspace?.fileTree ?? [];
  const filteredTree = useMemo(() => filterFileTree(fileTree, fileNameQuery), [
    fileNameQuery,
    fileTree
  ]);
  const selectedFilePath = activeWorkspace?.selectedFilePath ?? null;

  useEffect(() => {
    if (!contextMenu) return;

    const handleMouseDown = (event: MouseEvent) => {
      if (!contextMenuRef.current) return;
      const targetNode = event.target as Node | null;
      if (targetNode && contextMenuRef.current.contains(targetNode)) return;
      closeContextMenu();
    };

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        closeContextMenu();
      }
    };

    const handleViewportChange = () => {
      closeContextMenu();
    };

    window.addEventListener("mousedown", handleMouseDown);
    window.addEventListener("keydown", handleEscape);
    window.addEventListener("resize", handleViewportChange);
    window.addEventListener("scroll", handleViewportChange, true);

    return () => {
      window.removeEventListener("mousedown", handleMouseDown);
      window.removeEventListener("keydown", handleEscape);
      window.removeEventListener("resize", handleViewportChange);
      window.removeEventListener("scroll", handleViewportChange, true);
    };
  }, [contextMenu]);

  const handleItemContextMenu = (payload: {
    entryPath: string;
    entryName: string;
    clientX: number;
    clientY: number;
  }) => {
    if (!activeWorkspace) return;

    const maxX = window.innerWidth - CONTEXT_MENU_WIDTH - VIEWPORT_PADDING;
    const maxY = window.innerHeight - CONTEXT_MENU_BASE_HEIGHT - VIEWPORT_PADDING;

    setContextHighlightPath(payload.entryPath);
    setContextMenu({
      x: Math.max(VIEWPORT_PADDING, Math.min(payload.clientX, maxX)),
      y: Math.max(VIEWPORT_PADDING, Math.min(payload.clientY, maxY)),
      targetPath: payload.entryPath,
      targetName: payload.entryName,
      workspacePath: activeWorkspace.path,
      submenuOpen: false
    });
  };

  const handleCopyPath = async (pathType: "absolute" | "relative") => {
    if (!contextMenu) return;

    const value = pathType === "absolute"
      ? contextMenu.targetPath
      : toRelativePath(contextMenu.targetPath, contextMenu.workspacePath);

    try {
      await navigator.clipboard.writeText(value);
      closeContextMenu();
    } catch (error) {
      if (!activeWorkspaceId) {
        closeContextMenu();
        return;
      }
      dispatch({
        type: "SET_WORKSPACE_ERROR",
        payload: { workspaceId: activeWorkspaceId, error: String(error) }
      });
      closeContextMenu();
    }
  };

  const handleOpenInFileManager = async () => {
    if (!contextMenu) return;

    try {
      await openInFileManager(contextMenu.targetPath);
      closeContextMenu();
    } catch (error) {
      if (!activeWorkspaceId) {
        closeContextMenu();
        return;
      }
      dispatch({
        type: "SET_WORKSPACE_ERROR",
        payload: {
          workspaceId: activeWorkspaceId,
          error: `フォルダを開けませんでした: ${String(error)}`
        }
      });
      closeContextMenu();
    }
  };

  const submenuLeft = contextMenu
      && contextMenu.x + CONTEXT_MENU_WIDTH + SUBMENU_WIDTH + VIEWPORT_PADDING <= window.innerWidth
    ? CONTEXT_MENU_WIDTH - 6
    : -SUBMENU_WIDTH + 6;

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        backgroundColor: "var(--bg-sidebar)"
      }}
    >
      {hasWorkspace && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: "var(--sp-1)",
            padding: "var(--sp-2) var(--sp-2) 0"
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-1)" }}>
            <button
              type="button"
              onClick={() => setSearchMode("content")}
              title="全文検索"
              style={{
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                width: 24,
                height: 24,
                border: "1px solid var(--border-color)",
                borderRadius: "var(--radius-sm)",
                backgroundColor: searchMode === "content" ? "var(--bg-hover)" : "transparent",
                color: searchMode === "content" ? "var(--text-primary)" : "var(--text-secondary)",
                cursor: "pointer"
              }}
            >
              <Search size={14} />
            </button>
            <button
              type="button"
              onClick={() => setSearchMode("fileName")}
              title="ファイル名検索"
              style={{
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                width: 24,
                height: 24,
                border: "1px solid var(--border-color)",
                borderRadius: "var(--radius-sm)",
                backgroundColor: searchMode === "fileName" ? "var(--bg-hover)" : "transparent",
                color: searchMode === "fileName" ? "var(--text-primary)" : "var(--text-secondary)",
                cursor: "pointer"
              }}
            >
              <FileText size={14} />
            </button>
          </div>
          <button
            type="button"
            onClick={() => {
              if (!selectedFilePath) return;
              setRevealToken((prev) => prev + 1);
            }}
            disabled={!selectedFilePath}
            title="現在開いているファイルへ移動"
            style={{
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              width: 24,
              height: 24,
              border: "1px solid var(--border-color)",
              borderRadius: "var(--radius-sm)",
              background: selectedFilePath ? "var(--bg-hover)" : "transparent",
              color: selectedFilePath ? "var(--text-secondary)" : "var(--text-muted)",
              cursor: selectedFilePath ? "pointer" : "default",
              flexShrink: 0
            }}
          >
            <LocateFixed size={14} />
          </button>
        </div>
      )}
      {hasWorkspace && searchMode === "content" && <SearchBar />}
      {hasWorkspace && searchMode === "fileName" && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "var(--sp-1)",
            padding: "var(--sp-2) var(--sp-2)",
            borderBottom: "1px solid var(--border-color)"
          }}
        >
          <Search size={14} style={{ color: "var(--text-secondary)", marginLeft: 6 }} />
          <input
            type="text"
            value={fileNameQuery}
            onChange={(event) => setFileNameQuery(event.target.value)}
            placeholder="ファイル名で絞り込み"
            style={{
              flex: 1,
              minWidth: 0,
              height: 26,
              border: "1px solid var(--border-color)",
              borderRadius: "var(--radius-sm)",
              backgroundColor: "var(--bg-main)",
              color: "var(--text-primary)",
              fontSize: "var(--font-ui)",
              padding: "0 8px"
            }}
          />
          {fileNameQuery && (
            <button
              type="button"
              onClick={() => setFileNameQuery("")}
              title="クリア"
              style={{
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                width: 24,
                height: 24,
                border: "none",
                borderRadius: "var(--radius-sm)",
                background: "transparent",
                color: "var(--text-secondary)",
                cursor: "pointer"
              }}
            >
              <X size={14} />
            </button>
          )}
        </div>
      )}
      <div style={{ flex: 1, overflowY: "auto" }}>
        {hasSearch && searchMode === "content" ? <SearchResults /> : (
          <>
            {hasWorkspace && (
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  height: "var(--h-section-header)",
                  padding: "0 var(--sp-5)",
                  fontSize: "var(--font-label)",
                  fontWeight: 600,
                  textTransform: "uppercase",
                  letterSpacing: "0.08em",
                  color: "var(--text-secondary)",
                  userSelect: "none"
                }}
              >
                <span>エクスプローラー</span>
              </div>
            )}
            {(searchMode === "fileName" ? filteredTree : fileTree).length > 0
              ? (
                <FileTree
                  entries={searchMode === "fileName" ? filteredTree : fileTree}
                  depth={0}
                  revealTargetPath={selectedFilePath}
                  revealToken={revealToken}
                  contextHighlightPath={contextHighlightPath}
                  onItemContextMenu={handleItemContextMenu}
                />
              )
              : hasWorkspace
              ? (
                <div
                  style={{
                    padding: "var(--sp-2) var(--sp-5)",
                    fontSize: "var(--font-ui)",
                    color: "var(--text-secondary)"
                  }}
                >
                  {searchMode === "fileName" && fileNameQuery
                    ? "一致するファイル名がありません"
                    : "対応ファイルが見つかりません"}
                </div>
              )
              : (
                <div
                  style={{
                    padding: "var(--sp-8) var(--sp-5)",
                    fontSize: "var(--font-ui)",
                    color: "var(--text-secondary)",
                    textAlign: "center"
                  }}
                >
                  フォルダを開いて対応ファイルを閲覧
                </div>
              )}
          </>
        )}
      </div>
      {contextMenu && (
        <div
          ref={contextMenuRef}
          style={{
            position: "fixed",
            top: contextMenu.y,
            left: contextMenu.x,
            width: CONTEXT_MENU_WIDTH,
            border: "1px solid var(--border-color)",
            borderRadius: "var(--radius-sm)",
            backgroundColor: "var(--bg-sidebar)",
            boxShadow: "0 10px 24px rgba(0, 0, 0, 0.35)",
            zIndex: 2000,
            userSelect: "none",
            overflow: "visible"
          }}
        >
          <button
            type="button"
            onClick={() => void handleOpenInFileManager()}
            style={{
              width: "100%",
              height: CONTEXT_MENU_ROW_HEIGHT,
              border: "none",
              backgroundColor: "transparent",
              color: "var(--text-primary)",
              fontSize: "var(--font-ui)",
              textAlign: "left",
              padding: "0 10px",
              cursor: "pointer"
            }}
            onMouseEnter={(event) => {
              event.currentTarget.style.backgroundColor = "var(--bg-hover)";
            }}
            onMouseLeave={(event) => {
              event.currentTarget.style.backgroundColor = "transparent";
            }}
          >
            {openInFileManagerLabel}
          </button>
          <div
            style={{
              height: 1,
              backgroundColor: "var(--border-color)"
            }}
          />
          <div
            style={{
              height: CONTEXT_MENU_ROW_HEIGHT,
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              padding: "0 10px",
              fontSize: "var(--font-ui)",
              color: "var(--text-primary)",
              cursor: "default",
              backgroundColor: contextMenu.submenuOpen ? "var(--bg-hover)" : "transparent",
              whiteSpace: "nowrap",
              textOverflow: "ellipsis",
              overflow: "hidden"
            }}
            onMouseEnter={() =>
              setContextMenu((prev) => (prev ? { ...prev, submenuOpen: true } : prev))}
            onMouseLeave={() =>
              setContextMenu((prev) => (prev ? { ...prev, submenuOpen: false } : prev))}
            title={contextMenu.targetName}
          >
            <span>Copy Path</span>
            <span style={{ color: "var(--text-secondary)" }}>▶</span>
          </div>
          {contextMenu.submenuOpen && (
            <div
              style={{
                position: "absolute",
                top: 0,
                left: submenuLeft,
                width: SUBMENU_WIDTH,
                border: "1px solid var(--border-color)",
                borderRadius: "var(--radius-sm)",
                backgroundColor: "var(--bg-sidebar)",
                boxShadow: "0 10px 24px rgba(0, 0, 0, 0.35)",
                overflow: "hidden"
              }}
              onMouseEnter={() =>
                setContextMenu((prev) => (prev ? { ...prev, submenuOpen: true } : prev))}
              onMouseLeave={() =>
                setContextMenu((prev) => (prev ? { ...prev, submenuOpen: false } : prev))}
            >
              <button
                type="button"
                onClick={() => void handleCopyPath("absolute")}
                style={{
                  width: "100%",
                  height: CONTEXT_MENU_ROW_HEIGHT,
                  border: "none",
                  backgroundColor: "transparent",
                  color: "var(--text-primary)",
                  fontSize: "var(--font-ui)",
                  textAlign: "left",
                  padding: "0 10px",
                  cursor: "pointer"
                }}
                onMouseEnter={(event) => {
                  event.currentTarget.style.backgroundColor = "var(--bg-hover)";
                }}
                onMouseLeave={(event) => {
                  event.currentTarget.style.backgroundColor = "transparent";
                }}
              >
                絶対パスをコピー
              </button>
              <button
                type="button"
                onClick={() => void handleCopyPath("relative")}
                style={{
                  width: "100%",
                  height: CONTEXT_MENU_ROW_HEIGHT,
                  border: "none",
                  backgroundColor: "transparent",
                  color: "var(--text-primary)",
                  fontSize: "var(--font-ui)",
                  textAlign: "left",
                  padding: "0 10px",
                  cursor: "pointer"
                }}
                onMouseEnter={(event) => {
                  event.currentTarget.style.backgroundColor = "var(--bg-hover)";
                }}
                onMouseLeave={(event) => {
                  event.currentTarget.style.backgroundColor = "transparent";
                }}
              >
                相対パスをコピー
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
