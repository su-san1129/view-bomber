import type { FileEntry } from "../types";
import { FileTreeItem } from "./FileTreeItem";

interface FileTreeProps {
  entries: FileEntry[];
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

export function FileTree({
  entries,
  depth,
  revealTargetPath,
  revealToken,
  contextHighlightPath,
  onItemContextMenu
}: FileTreeProps) {
  return (
    <div>
      {entries.map((entry) => (
        <FileTreeItem
          key={entry.path}
          entry={entry}
          depth={depth}
          revealTargetPath={revealTargetPath}
          revealToken={revealToken}
          contextHighlightPath={contextHighlightPath}
          onItemContextMenu={onItemContextMenu}
        />
      ))}
    </div>
  );
}
