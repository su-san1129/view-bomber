import { useEffect, useRef, useState } from "react";
import { ChevronDown, ChevronRight, Folder } from "lucide-react";
import type { FileEntry } from "../types";
import { useActiveWorkspace, useAppDispatch, useAppState } from "../context/AppContext";
import { readFileContent } from "../lib/tauri";
import { requiresRawTextContent } from "../viewers/fileTypes";
import { resolveFileIcon } from "./fileIcon";
import { FileTree } from "./FileTree";

interface FileTreeItemProps {
  entry: FileEntry;
  depth: number;
  revealTargetPath?: string | null;
  revealToken?: number;
  contextHighlightPath?: string | null;
  onItemContextMenu: (payload: {
    entryPath: string;
    entryName: string;
    clientX: number;
    clientY: number;
  }) => void;
}

function normalizePath(path: string): string {
  return path.replace(/\\/g, "/");
}

function isAncestorPath(candidate: string, target: string): boolean {
  const normalizedCandidate = normalizePath(candidate).replace(/\/+$/, "");
  const normalizedTarget = normalizePath(target).replace(/\/+$/, "");
  if (!normalizedCandidate || !normalizedTarget) return false;
  return normalizedTarget === normalizedCandidate
    || normalizedTarget.startsWith(`${normalizedCandidate}/`);
}

export function FileTreeItem({
  entry,
  depth,
  revealTargetPath,
  revealToken,
  contextHighlightPath,
  onItemContextMenu
}: FileTreeItemProps) {
  const [expanded, setExpanded] = useState(depth < 1);
  const { activeWorkspaceId } = useAppState();
  const activeWorkspace = useActiveWorkspace();
  const dispatch = useAppDispatch();
  const itemRef = useRef<HTMLDivElement | null>(null);
  const lastHandledRevealTokenRef = useRef<number>(0);

  if (!activeWorkspaceId || !activeWorkspace) {
    return null;
  }

  const { selectedFilePath } = activeWorkspace;
  const isSelected = selectedFilePath === entry.path;
  const isContextHighlighted = contextHighlightPath === entry.path;
  const isRevealTarget = !!revealTargetPath && entry.path === revealTargetPath;
  const fileIcon = resolveFileIcon(entry.path);
  // 12px base + depth * 16px indent (4px grid)
  const paddingLeft = 12 + depth * 16;

  useEffect(() => {
    if (!revealToken || !revealTargetPath) return;
    if (lastHandledRevealTokenRef.current === revealToken) return;
    lastHandledRevealTokenRef.current = revealToken;

    if (entry.is_dir && isAncestorPath(entry.path, revealTargetPath)) {
      setExpanded(true);
      return;
    }

    if (!entry.is_dir && isRevealTarget && itemRef.current) {
      itemRef.current.scrollIntoView({ block: "center", behavior: "smooth" });
      itemRef.current.focus({ preventScroll: true });
    }
  }, [entry.is_dir, entry.path, isRevealTarget, revealTargetPath, revealToken]);

  const handleClick = async () => {
    if (entry.is_dir) {
      setExpanded(!expanded);
    } else {
      dispatch({
        type: "SET_WORKSPACE_SELECTED_FILE",
        payload: { workspaceId: activeWorkspaceId, filePath: entry.path }
      });
      try {
        const fileContent = requiresRawTextContent(entry.path)
          ? await readFileContent(entry.path)
          : { content: "", encoding: null, isUtf8: null };
        dispatch({
          type: "SET_WORKSPACE_FILE_CONTENT",
          payload: {
            workspaceId: activeWorkspaceId,
            content: fileContent.content,
            encoding: fileContent.encoding,
            isUtf8: fileContent.isUtf8
          }
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
        ref={itemRef}
        tabIndex={-1}
        style={{
          display: "flex",
          alignItems: "center",
          height: "var(--h-tree-item)",
          paddingLeft,
          paddingRight: 12,
          cursor: "pointer",
          userSelect: "none",
          fontSize: "var(--font-ui)",
          backgroundColor: isSelected
            ? "var(--bg-selected)"
            : isContextHighlighted
            ? "var(--bg-hover)"
            : "transparent",
          color: "var(--text-primary)"
        }}
        onClick={handleClick}
        onContextMenu={(event) => {
          event.preventDefault();
          onItemContextMenu({
            entryPath: entry.path,
            entryName: entry.name,
            clientX: event.clientX,
            clientY: event.clientY
          });
        }}
        onMouseEnter={(e) => {
          if (!isSelected && !isContextHighlighted) {
            e.currentTarget.style.backgroundColor = "var(--bg-hover)";
          }
        }}
        onMouseLeave={(e) => {
          if (!isSelected && !isContextHighlighted) {
            e.currentTarget.style.backgroundColor = "transparent";
          }
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
              <fileIcon.Icon
                size={16}
                style={{ flexShrink: 0, marginRight: 6, color: fileIcon.color }}
              />
            </>
          )}
        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {entry.name}
        </span>
      </div>
      {entry.is_dir && expanded && entry.children && (
        <FileTree
          entries={entry.children}
          depth={depth + 1}
          revealTargetPath={revealTargetPath}
          revealToken={revealToken}
          contextHighlightPath={contextHighlightPath}
          onItemContextMenu={onItemContextMenu}
        />
      )}
    </div>
  );
}
