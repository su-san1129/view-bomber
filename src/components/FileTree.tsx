import type { FileEntry } from "../types";
import { FileTreeItem } from "./FileTreeItem";

interface FileTreeProps {
  entries: FileEntry[];
  depth: number;
  revealTargetPath?: string | null;
  revealToken?: number;
}

export function FileTree({ entries, depth, revealTargetPath, revealToken }: FileTreeProps) {
  return (
    <div>
      {entries.map((entry) => (
        <FileTreeItem
          key={entry.path}
          entry={entry}
          depth={depth}
          revealTargetPath={revealTargetPath}
          revealToken={revealToken}
        />
      ))}
    </div>
  );
}
