const STORAGE_KEY = "view-bomber:workspaces:v1";
const LEGACY_RECENT_KEY = "view-bomber:recent-folders";

interface LegacyRecentFolder {
  path: string;
  name: string;
  openedAt: number;
}

export interface StoredWorkspaceEntry {
  path: string;
  name: string;
  lastOpenedAt: number;
  selectedFilePath: string | null;
  searchQuery: string;
  caseSensitive: boolean;
  searchFileType: string;
}

interface StoredWorkspaceSnapshot {
  version: 1;
  activeWorkspaceId: string | null;
  workspaceOrder: string[];
  workspaces: Record<string, StoredWorkspaceEntry>;
}

function normalizeWorkspaceEntry(
  path: string,
  seed?: Partial<StoredWorkspaceEntry>
): StoredWorkspaceEntry {
  return {
    path,
    name: seed?.name ?? path.split("/").filter(Boolean).pop() ?? path,
    lastOpenedAt: seed?.lastOpenedAt ?? Date.now(),
    selectedFilePath: seed?.selectedFilePath ?? null,
    searchQuery: seed?.searchQuery ?? "",
    caseSensitive: seed?.caseSensitive ?? false,
    searchFileType: seed?.searchFileType ?? "all"
  };
}

function migrateLegacyRecentFolders(): StoredWorkspaceSnapshot {
  const raw = localStorage.getItem(LEGACY_RECENT_KEY);
  if (!raw) {
    return {
      version: 1,
      activeWorkspaceId: null,
      workspaceOrder: [],
      workspaces: {}
    };
  }

  try {
    const folders = JSON.parse(raw) as LegacyRecentFolder[];
    const workspaceOrder: string[] = [];
    const workspaces: Record<string, StoredWorkspaceEntry> = {};

    for (const folder of folders) {
      if (!folder?.path || workspaces[folder.path]) continue;
      workspaceOrder.push(folder.path);
      workspaces[folder.path] = normalizeWorkspaceEntry(folder.path, {
        name: folder.name,
        lastOpenedAt: folder.openedAt
      });
    }

    return {
      version: 1,
      activeWorkspaceId: workspaceOrder[0] ?? null,
      workspaceOrder,
      workspaces
    };
  } catch {
    return {
      version: 1,
      activeWorkspaceId: null,
      workspaceOrder: [],
      workspaces: {}
    };
  }
}

export function loadWorkspaceStore(): Omit<StoredWorkspaceSnapshot, "version"> {
  const fallback = migrateLegacyRecentFolders();
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) {
    return fallback;
  }

  try {
    const parsed = JSON.parse(raw) as Partial<StoredWorkspaceSnapshot>;
    if (parsed.version !== 1 || !Array.isArray(parsed.workspaceOrder) || !parsed.workspaces) {
      return fallback;
    }

    const workspaceOrder: string[] = [];
    const workspaces: Record<string, StoredWorkspaceEntry> = {};
    for (const workspaceId of parsed.workspaceOrder) {
      if (typeof workspaceId !== "string") continue;
      const workspace = parsed.workspaces[workspaceId];
      if (!workspace?.path) continue;
      workspaceOrder.push(workspaceId);
      workspaces[workspaceId] = normalizeWorkspaceEntry(workspace.path, workspace);
    }

    const activeWorkspaceId = typeof parsed.activeWorkspaceId === "string"
        && workspaces[parsed.activeWorkspaceId]
      ? parsed.activeWorkspaceId
      : workspaceOrder[0] ?? null;

    return {
      activeWorkspaceId,
      workspaceOrder,
      workspaces
    };
  } catch {
    return fallback;
  }
}

export function persistWorkspaceStore(snapshot: Omit<StoredWorkspaceSnapshot, "version">): void {
  const normalizedOrder = snapshot.workspaceOrder.filter((workspaceId, index, arr) =>
    typeof workspaceId === "string" && arr.indexOf(workspaceId) === index
    && snapshot.workspaces[workspaceId]
  );

  const normalizedWorkspaces: Record<string, StoredWorkspaceEntry> = {};
  for (const workspaceId of normalizedOrder) {
    const workspace = snapshot.workspaces[workspaceId];
    normalizedWorkspaces[workspaceId] = normalizeWorkspaceEntry(workspace.path, workspace);
  }

  const activeWorkspaceId =
    snapshot.activeWorkspaceId && normalizedWorkspaces[snapshot.activeWorkspaceId]
      ? snapshot.activeWorkspaceId
      : normalizedOrder[0] ?? null;

  const payload: StoredWorkspaceSnapshot = {
    version: 1,
    activeWorkspaceId,
    workspaceOrder: normalizedOrder,
    workspaces: normalizedWorkspaces
  };

  localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
}
