import { type ReactNode, useState } from "react";
import { ChevronDown, ChevronRight, FileText } from "lucide-react";
import type { SearchFileResult } from "../types";
import { useAppDispatch, useAppState } from "../context/AppContext";
import { readFileContent } from "../lib/tauri";
import { isTextPreviewPath } from "../viewers/fileTypes";

function highlightMatch(text: string, query: string, caseSensitive: boolean): ReactNode {
  if (!query) return text;

  const flags = caseSensitive ? "g" : "gi";
  const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const regex = new RegExp(`(${escaped})`, flags);
  const parts = text.split(regex);

  return parts.map((part, i) => {
    const isMatch = caseSensitive
      ? part === query
      : part.toLowerCase() === query.toLowerCase();
    if (isMatch) {
      return (
        <span
          key={i}
          style={{
            backgroundColor: "var(--bg-selected)",
            borderRadius: 2
          }}
        >
          {part}
        </span>
      );
    }
    return part;
  });
}

function SearchFileGroup({ result }: { result: SearchFileResult; }) {
  const [expanded, setExpanded] = useState(true);
  const { searchQuery, caseSensitive, selectedFilePath } = useAppState();
  const dispatch = useAppDispatch();

  const handleMatchClick = async (filePath: string) => {
    dispatch({ type: "SET_SELECTED_FILE", payload: filePath });
    try {
      const content = isTextPreviewPath(filePath)
        ? await readFileContent(filePath)
        : "";
      dispatch({ type: "SET_FILE_CONTENT", payload: content });
    } catch (err) {
      dispatch({ type: "SET_ERROR", payload: String(err) });
    }
  };

  const isFileSelected = selectedFilePath === result.file_path;

  return (
    <div>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          height: "var(--h-tree-item)",
          paddingLeft: 12,
          paddingRight: 12,
          cursor: "pointer",
          userSelect: "none",
          fontSize: "var(--font-ui)",
          color: "var(--text-primary)",
          backgroundColor: isFileSelected ? "var(--bg-selected)" : "transparent"
        }}
        onClick={() => setExpanded(!expanded)}
        onMouseEnter={(e) => {
          if (!isFileSelected) e.currentTarget.style.backgroundColor = "var(--bg-hover)";
        }}
        onMouseLeave={(e) => {
          if (!isFileSelected) e.currentTarget.style.backgroundColor = "transparent";
        }}
      >
        {expanded
          ? (
            <ChevronDown
              size={16}
              style={{ flexShrink: 0, marginRight: 2, color: "var(--text-secondary)" }}
            />
          )
          : (
            <ChevronRight
              size={16}
              style={{ flexShrink: 0, marginRight: 2, color: "var(--text-secondary)" }}
            />
          )}
        <FileText size={16} style={{ flexShrink: 0, marginRight: 6, color: "#519aba" }} />
        <span
          style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }}
        >
          {result.file_name}
        </span>
        <span
          style={{
            flexShrink: 0,
            marginLeft: "var(--sp-1)",
            fontSize: "var(--font-label)",
            color: "var(--text-secondary)",
            backgroundColor: "var(--bg-hover)",
            borderRadius: "var(--radius-sm)",
            padding: "0 5px",
            lineHeight: "18px"
          }}
        >
          {result.matches.length}
        </span>
      </div>
      {expanded
        && result.matches.map((match) => (
          <div
            key={`${result.file_path}:${match.line_number}`}
            style={{
              display: "flex",
              alignItems: "center",
              minHeight: "var(--h-tree-item)",
              paddingLeft: 44,
              paddingRight: 12,
              cursor: "pointer",
              userSelect: "none",
              fontSize: "var(--font-ui)",
              color: "var(--text-primary)"
            }}
            onClick={() => handleMatchClick(result.file_path)}
            onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = "var(--bg-hover)")}
            onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "transparent")}
          >
            <span
              style={{
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap"
              }}
            >
              {highlightMatch(match.line_text, searchQuery, caseSensitive)}
            </span>
          </div>
        ))}
    </div>
  );
}

export function SearchResults() {
  const { searchResults, searchLoading, searchQuery } = useAppState();

  if (searchLoading) {
    return (
      <div
        style={{
          padding: "var(--sp-2) var(--sp-5)",
          fontSize: "var(--font-ui)",
          color: "var(--text-secondary)"
        }}
      >
        検索中...
      </div>
    );
  }

  if (searchQuery && searchResults.length === 0) {
    return (
      <div
        style={{
          padding: "var(--sp-2) var(--sp-5)",
          fontSize: "var(--font-ui)",
          color: "var(--text-secondary)"
        }}
      >
        結果が見つかりません
      </div>
    );
  }

  const totalMatches = searchResults.reduce((sum, r) => sum + r.matches.length, 0);

  return (
    <div>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          height: "var(--h-section-header)",
          padding: "0 var(--sp-5)",
          fontSize: "var(--font-label)",
          color: "var(--text-secondary)",
          userSelect: "none"
        }}
      >
        {searchResults.length}件のファイル、{totalMatches}件の一致
      </div>
      {searchResults.map((result) => <SearchFileGroup key={result.file_path} result={result} />)}
    </div>
  );
}
