import { useEffect } from "react";
import { useAppState } from "../context/AppContext";
import { useSearch } from "../lib/useSearch";
import { useOpenFolder } from "../lib/useOpenFolder";
import { FileTree } from "./FileTree";
import { SearchBar } from "./SearchBar";
import { SearchResults } from "./SearchResults";

export function Sidebar() {
  const { activeWorkspaceId, workspaces } = useAppState();
  const activeWorkspace = activeWorkspaceId ? workspaces[activeWorkspaceId] : null;
  const openFolder = useOpenFolder();

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

  const hasSearch = activeWorkspace ? activeWorkspace.searchQuery.trim().length > 0 : false;
  const hasWorkspace = !!activeWorkspace;
  const fileTree = activeWorkspace?.fileTree ?? [];

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        backgroundColor: "var(--bg-sidebar)"
      }}
    >
      {hasWorkspace && <SearchBar />}
      <div style={{ flex: 1, overflowY: "auto" }}>
        {hasSearch ? <SearchResults /> : (
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
                エクスプローラー
              </div>
            )}
            {fileTree.length > 0 ? <FileTree entries={fileTree} depth={0} /> : hasWorkspace
              ? (
                <div
                  style={{
                    padding: "var(--sp-2) var(--sp-5)",
                    fontSize: "var(--font-ui)",
                    color: "var(--text-secondary)"
                  }}
                >
                  対応ファイルが見つかりません
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
