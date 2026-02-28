import { FolderOpen, Moon, Sun } from "lucide-react";
import { useAppState } from "../context/AppContext";
import { useOpenFolder } from "../lib/useOpenFolder";
import { useTheme } from "../lib/useTheme";

export function Toolbar() {
  const { rootPath } = useAppState();
  const openFolder = useOpenFolder();
  const { theme, toggleTheme } = useTheme();

  const folderName = rootPath ? rootPath.split("/").pop() : null;

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        height: "var(--h-toolbar)",
        padding: "0 var(--sp-3)",
        gap: "var(--sp-2)",
        backgroundColor: "var(--bg-toolbar)",
        borderBottom: "1px solid var(--border-color)",
        userSelect: "none",
        flexShrink: 0,
        fontSize: "var(--font-ui)"
      }}
    >
      <button
        onClick={() => openFolder()}
        style={{
          display: "flex",
          alignItems: "center",
          gap: "var(--sp-2)",
          height: "var(--h-icon-btn)",
          padding: "0 var(--sp-3)",
          borderRadius: "var(--radius-sm)",
          border: "none",
          cursor: "pointer",
          fontSize: "var(--font-ui)",
          backgroundColor: "var(--bg-hover)",
          color: "var(--text-primary)"
        }}
      >
        <FolderOpen size={14} />
        フォルダを開く
      </button>
      {folderName && (
        <span style={{ color: "var(--text-secondary)", fontSize: "var(--font-ui)" }}>
          {folderName}
        </span>
      )}
      <div style={{ flex: 1 }} />
      <button
        onClick={toggleTheme}
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          width: "var(--h-icon-btn)",
          height: "var(--h-icon-btn)",
          borderRadius: "var(--radius-sm)",
          border: "none",
          cursor: "pointer",
          backgroundColor: "transparent",
          color: "var(--text-secondary)"
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.backgroundColor = "var(--bg-hover)";
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.backgroundColor = "transparent";
        }}
        title={theme === "dark" ? "ライトモードに切り替え" : "ダークモードに切り替え"}
      >
        {theme === "dark" ? <Sun size={16} /> : <Moon size={16} />}
      </button>
    </div>
  );
}
