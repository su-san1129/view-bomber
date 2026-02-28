import { useRef } from "react";
import { Search, X } from "lucide-react";
import { useAppDispatch, useAppState } from "../context/AppContext";

export function SearchBar() {
  const { searchQuery, caseSensitive, searchFileType, supportedFileTypes } = useAppState();
  const dispatch = useAppDispatch();
  const inputRef = useRef<HTMLInputElement>(null);

  return (
    <div
      style={{
        padding: "var(--sp-2) var(--sp-2)",
        borderBottom: "1px solid var(--border-color)"
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          height: "var(--h-icon-btn)",
          backgroundColor: "var(--bg-main)",
          borderRadius: "var(--radius-sm)",
          padding: "0 var(--sp-1)",
          gap: "var(--sp-1)"
        }}
      >
        <select
          value={searchFileType}
          onChange={(e) => dispatch({ type: "SET_SEARCH_FILE_TYPE", payload: e.target.value })}
          style={{
            height: 22,
            border: "none",
            outline: "none",
            background: "transparent",
            color: "var(--text-secondary)",
            fontSize: "var(--font-label)",
            fontFamily: "inherit",
            cursor: "pointer",
            minWidth: 70
          }}
          title="検索対象ファイル"
        >
          <option value="all">All</option>
          {supportedFileTypes.filter((type) => type.searchable).map((type) => (
            <option key={type.id} value={type.id}>
              {type.label}
            </option>
          ))}
        </select>
        <Search
          size={14}
          style={{ flexShrink: 0, color: "var(--text-secondary)" }}
        />
        <input
          ref={inputRef}
          type="text"
          value={searchQuery}
          onChange={(e) => dispatch({ type: "SET_SEARCH_QUERY", payload: e.target.value })}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              dispatch({ type: "CLEAR_SEARCH" });
              inputRef.current?.blur();
            }
          }}
          placeholder="検索"
          style={{
            flex: 1,
            border: "none",
            outline: "none",
            background: "transparent",
            color: "var(--text-primary)",
            fontSize: "var(--font-ui)",
            fontFamily: "inherit",
            minWidth: 0
          }}
        />
        <button
          onClick={() => dispatch({ type: "TOGGLE_CASE_SENSITIVE" })}
          title="大文字小文字を区別"
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            width: 22,
            height: 22,
            border: "1px solid",
            borderColor: caseSensitive
              ? "var(--text-secondary)"
              : "transparent",
            borderRadius: "var(--radius-sm)",
            background: caseSensitive
              ? "var(--bg-hover)"
              : "transparent",
            color: caseSensitive
              ? "var(--text-primary)"
              : "var(--text-secondary)",
            cursor: "pointer",
            fontSize: "var(--font-label)",
            fontWeight: 600,
            flexShrink: 0,
            padding: 0
          }}
        >
          Aa
        </button>
        {searchQuery && (
          <button
            onClick={() => dispatch({ type: "CLEAR_SEARCH" })}
            title="クリア"
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              width: 22,
              height: 22,
              border: "none",
              borderRadius: "var(--radius-sm)",
              background: "transparent",
              color: "var(--text-secondary)",
              cursor: "pointer",
              flexShrink: 0,
              padding: 0
            }}
            onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = "var(--bg-hover)")}
            onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "transparent")}
          >
            <X size={14} />
          </button>
        )}
      </div>
    </div>
  );
}
