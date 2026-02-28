import { useEffect, useRef, useState } from "react";
import { ChevronDown, ChevronUp, X } from "lucide-react";
import { useFindInFile } from "../lib/useFindInFile";

interface FindBarProps {
  contentRef: React.RefObject<HTMLDivElement | null>;
  onClose: () => void;
}

export function FindBar({ contentRef, onClose }: FindBarProps) {
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const { matchCount, currentIndex, next, prev, clear } = useFindInFile(
    contentRef,
    query
  );

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const handleClose = () => {
    clear();
    onClose();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      handleClose();
    } else if (e.key === "Enter" && e.shiftKey) {
      e.preventDefault();
      prev();
    } else if (e.key === "Enter") {
      e.preventDefault();
      next();
    }
  };

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        height: "var(--h-tab)",
        padding: "0 var(--sp-3)",
        gap: "var(--sp-2)",
        backgroundColor: "var(--bg-toolbar)",
        borderBottom: "1px solid var(--border-color)",
        flexShrink: 0,
        userSelect: "none"
      }}
    >
      <input
        ref={inputRef}
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="検索..."
        style={{
          flex: 1,
          maxWidth: 240,
          height: 22,
          padding: "0 var(--sp-2)",
          fontSize: "var(--font-ui)",
          color: "var(--text-primary)",
          backgroundColor: "var(--bg-main)",
          border: "1px solid var(--border-color)",
          borderRadius: "var(--radius-sm)",
          outline: "none"
        }}
      />
      <span
        style={{
          fontSize: "var(--font-label)",
          color: "var(--text-secondary)",
          minWidth: 48,
          textAlign: "center"
        }}
      >
        {query
          ? matchCount > 0
            ? `${currentIndex + 1}/${matchCount}`
            : "0/0"
          : ""}
      </span>
      <button onClick={prev} title="前のマッチ" style={btnStyle}>
        <ChevronUp size={14} />
      </button>
      <button onClick={next} title="次のマッチ" style={btnStyle}>
        <ChevronDown size={14} />
      </button>
      <button onClick={handleClose} title="閉じる" style={btnStyle}>
        <X size={14} />
      </button>
    </div>
  );
}

const btnStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  width: 22,
  height: 22,
  background: "none",
  border: "none",
  borderRadius: "var(--radius-sm)",
  color: "var(--text-secondary)",
  cursor: "pointer"
};
