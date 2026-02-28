import { useAppState } from "../context/AppContext";
import { useSearch } from "../lib/useSearch";
import { FileTree } from "./FileTree";
import { SearchBar } from "./SearchBar";
import { SearchResults } from "./SearchResults";

export function Sidebar() {
  const { fileTree, rootPath, searchQuery } = useAppState();

  useSearch();

  const hasSearch = searchQuery.trim().length > 0;

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        backgroundColor: "var(--bg-sidebar)"
      }}
    >
      {rootPath && <SearchBar />}
      <div style={{ flex: 1, overflowY: "auto" }}>
        {hasSearch ? <SearchResults /> : (
          <>
            {rootPath && (
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
            {fileTree.length > 0 ? <FileTree entries={fileTree} depth={0} /> : rootPath
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
