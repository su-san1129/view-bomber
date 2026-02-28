import { useState } from "react";
import { ChevronDown, ChevronRight, FileText, Folder } from "lucide-react";
import type { FileEntry } from "../types";
import { useActiveWorkspace, useAppDispatch, useAppState } from "../context/AppContext";
import { readFileContent } from "../lib/tauri";
import { requiresRawTextContent } from "../viewers/fileTypes";
import { FileTree } from "./FileTree";

interface FileTreeItemProps {
  entry: FileEntry;
  depth: number;
}

export function FileTreeItem({ entry, depth }: FileTreeItemProps) {
  const [expanded, setExpanded] = useState(depth < 1);
  const { activeWorkspaceId } = useAppState();
  const activeWorkspace = useActiveWorkspace();
  const dispatch = useAppDispatch();

  if (!activeWorkspaceId || !activeWorkspace) {
    return null;
  }

  const { selectedFilePath } = activeWorkspace;
  const isSelected = selectedFilePath === entry.path;
  // 12px base + depth * 16px indent (4px grid)
  const paddingLeft = 12 + depth * 16;

  const handleClick = async () => {
    if (entry.is_dir) {
      setExpanded(!expanded);
    } else {
      dispatch({
        type: "SET_WORKSPACE_SELECTED_FILE",
        payload: { workspaceId: activeWorkspaceId, filePath: entry.path }
      });
      try {
        const content = requiresRawTextContent(entry.path)
          ? await readFileContent(entry.path)
          : "";
        dispatch({
          type: "SET_WORKSPACE_FILE_CONTENT",
          payload: { workspaceId: activeWorkspaceId, content }
        });
      } catch (err) {
        dispatch({
          type: "SET_WORKSPACE_ERROR",
          payload: { workspaceId: activeWorkspaceId, error: String(err) }
        });
      }
    }
  };

  return (
    <div>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          height: "var(--h-tree-item)",
          paddingLeft,
          paddingRight: 12,
          cursor: "pointer",
          userSelect: "none",
          fontSize: "var(--font-ui)",
          backgroundColor: isSelected ? "var(--bg-selected)" : "transparent",
          color: "var(--text-primary)"
        }}
        onClick={handleClick}
        onMouseEnter={(e) => {
          if (!isSelected) e.currentTarget.style.backgroundColor = "var(--bg-hover)";
        }}
        onMouseLeave={(e) => {
          if (!isSelected) e.currentTarget.style.backgroundColor = "transparent";
        }}
      >
        {entry.is_dir
          ? (
            <>
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
              <Folder size={16} style={{ flexShrink: 0, marginRight: 6, color: "#dcb67a" }} />
            </>
          )
          : (
            <>
              <span style={{ width: 16, flexShrink: 0, marginRight: 2 }} />
              <FileText size={16} style={{ flexShrink: 0, marginRight: 6, color: "#519aba" }} />
            </>
          )}
        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {entry.name}
        </span>
      </div>
      {entry.is_dir && expanded && entry.children && (
        <FileTree entries={entry.children} depth={depth + 1} />
      )}
    </div>
  );
}
