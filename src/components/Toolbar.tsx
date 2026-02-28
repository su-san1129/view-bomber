import { FolderOpen, Moon, Sun } from "lucide-react";
import { useActiveWorkspace, useAppState } from "../context/AppContext";
import { useOpenFolder } from "../lib/useOpenFolder";
import { useTheme } from "../lib/useTheme";

const OPEN_FOLDER_OPTION = "__open_folder__";

export function Toolbar() {
  const { workspaceOrder, workspaces } = useAppState();
  const activeWorkspace = useActiveWorkspace();
  const openFolder = useOpenFolder();
  const { theme, toggleTheme } = useTheme();

  const workspaceItems = workspaceOrder
    .map((workspaceId) => workspaces[workspaceId])
    .filter((workspace) => !!workspace);
  const activeWorkspaceId = activeWorkspace?.id ?? "";

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
      <select
        value={activeWorkspaceId}
        onChange={(event) => {
          const next = event.target.value;
          if (next === OPEN_FOLDER_OPTION) {
            void openFolder();
            return;
          }
          if (next) {
            void openFolder(next);
          }
        }}
        style={{
          height: "var(--h-icon-btn)",
          maxWidth: 320,
          borderRadius: "var(--radius-sm)",
          border: "1px solid var(--border-color)",
          backgroundColor: "var(--bg-main)",
          color: "var(--text-primary)",
          padding: "0 var(--sp-2)",
          fontSize: "var(--font-ui)"
        }}
      >
        {!activeWorkspace && (
          <option value="" disabled>
            Workspaceを選択
          </option>
        )}
        {workspaceItems.map((workspace) => (
          <option key={workspace.id} value={workspace.id}>
            {workspace.name}
          </option>
        ))}
        <option value={OPEN_FOLDER_OPTION}>フォルダを開く...</option>
      </select>
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
