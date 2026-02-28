import type { FileEntry } from "../types";
import { FileTreeItem } from "./FileTreeItem";

interface FileTreeProps {
  entries: FileEntry[];
  depth: number;
}

export function FileTree({ entries, depth }: FileTreeProps) {
  return (
    <div>
      {entries.map((entry) => <FileTreeItem key={entry.path} entry={entry} depth={depth} />)}
    </div>
  );
}
