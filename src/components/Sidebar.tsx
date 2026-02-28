import { useEffect, useMemo, useState } from "react";
import { FileText, LocateFixed, Search, X } from "lucide-react";
import { useAppState } from "../context/AppContext";
import { useSearch } from "../lib/useSearch";
import { useOpenFolder } from "../lib/useOpenFolder";
import type { FileEntry } from "../types";
import { FileTree } from "./FileTree";
import { SearchBar } from "./SearchBar";
import { SearchResults } from "./SearchResults";

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

export function Sidebar() {
  const { activeWorkspaceId, workspaces } = useAppState();
  const activeWorkspace = activeWorkspaceId ? workspaces[activeWorkspaceId] : null;
  const openFolder = useOpenFolder();
  const [fileNameQuery, setFileNameQuery] = useState("");
  const [revealToken, setRevealToken] = useState(0);
  const [searchMode, setSearchMode] = useState<"content" | "fileName">("content");

  useSearch();

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
    </div>
  );
}
