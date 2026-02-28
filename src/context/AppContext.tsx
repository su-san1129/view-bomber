import {
  createContext,
  type Dispatch,
  type ReactNode,
  useContext,
  useEffect,
  useReducer
} from "react";
import type { FileEntry, SearchFileResult, SupportedFileType } from "../types";
import {
  loadWorkspaceStore,
  persistWorkspaceStore,
  type StoredWorkspaceEntry
} from "../lib/workspaceStore";
import { textExtensions } from "../viewers/textFormats";

const MAX_WORKSPACES_IN_MEMORY = 5;
const MAX_WORKSPACES_PERSISTED = 20;

export interface WorkspaceSession {
  id: string;
  path: string;
  name: string;
  lastOpenedAt: number;
  treeLoaded: boolean;
  fileTree: FileEntry[];
  selectedFilePath: string | null;
  fileContent: string | null;
  loading: boolean;
  error: string | null;
  searchQuery: string;
  searchResults: SearchFileResult[];
  searchLoading: boolean;
  caseSensitive: boolean;
  searchFileType: string;
}

interface AppState {
  activeWorkspaceId: string | null;
  workspaceOrder: string[];
  workspaces: Record<string, WorkspaceSession>;
  supportedFileTypes: SupportedFileType[];
}

type AppAction =
  | { type: "ACTIVATE_WORKSPACE"; payload: string; }
  | { type: "SET_WORKSPACE_TREE"; payload: { workspaceId: string; tree: FileEntry[]; }; }
  | {
    type: "SET_WORKSPACE_SELECTED_FILE";
    payload: { workspaceId: string; filePath: string | null; };
  }
  | { type: "SET_WORKSPACE_FILE_CONTENT"; payload: { workspaceId: string; content: string; }; }
  | { type: "SET_WORKSPACE_LOADING"; payload: { workspaceId: string; loading: boolean; }; }
  | { type: "SET_WORKSPACE_ERROR"; payload: { workspaceId: string; error: string | null; }; }
  | { type: "SET_WORKSPACE_SEARCH_QUERY"; payload: { workspaceId: string; query: string; }; }
  | {
    type: "SET_WORKSPACE_SEARCH_RESULTS";
    payload: { workspaceId: string; results: SearchFileResult[]; };
  }
  | { type: "SET_WORKSPACE_SEARCH_LOADING"; payload: { workspaceId: string; loading: boolean; }; }
  | { type: "TOGGLE_WORKSPACE_CASE_SENSITIVE"; payload: { workspaceId: string; }; }
  | { type: "SET_WORKSPACE_SEARCH_FILE_TYPE"; payload: { workspaceId: string; fileType: string; }; }
  | { type: "SET_SUPPORTED_FILE_TYPES"; payload: SupportedFileType[]; }
  | { type: "CLEAR_WORKSPACE_SEARCH"; payload: { workspaceId: string; }; };

interface StoreHydration {
  activeWorkspaceId: string | null;
  workspaceOrder: string[];
  workspaces: Record<string, WorkspaceSession>;
}

function basename(path: string): string {
  const trimmed = path.replace(/[\\/]+$/, "");
  const parts = trimmed.split(/[\\/]/);
  return parts[parts.length - 1] || path;
}

function createWorkspaceSession(
  path: string,
  seed?: Partial<StoredWorkspaceEntry>
): WorkspaceSession {
  return {
    id: path,
    path,
    name: seed?.name ?? basename(path),
    lastOpenedAt: seed?.lastOpenedAt ?? Date.now(),
    treeLoaded: false,
    fileTree: [],
    selectedFilePath: seed?.selectedFilePath ?? null,
    fileContent: null,
    loading: false,
    error: null,
    searchQuery: seed?.searchQuery ?? "",
    searchResults: [],
    searchLoading: false,
    caseSensitive: seed?.caseSensitive ?? false,
    searchFileType: seed?.searchFileType ?? "all"
  };
}

function touchWorkspaceOrder(order: string[], workspaceId: string): string[] {
  return [workspaceId, ...order.filter((id) => id !== workspaceId)];
}

function evictWorkspaceMemory(workspace: WorkspaceSession): WorkspaceSession {
  return {
    ...workspace,
    treeLoaded: false,
    fileTree: [],
    fileContent: null,
    searchResults: [],
    searchLoading: false,
    loading: false,
    error: null
  };
}

function applyMemoryLimit(state: AppState): AppState {
  if (state.workspaceOrder.length <= MAX_WORKSPACES_IN_MEMORY) {
    return state;
  }

  const keepIds = new Set(state.workspaceOrder.slice(0, MAX_WORKSPACES_IN_MEMORY));
  const nextWorkspaces = { ...state.workspaces };

  for (const workspaceId of state.workspaceOrder) {
    if (!keepIds.has(workspaceId) && nextWorkspaces[workspaceId]) {
      nextWorkspaces[workspaceId] = evictWorkspaceMemory(nextWorkspaces[workspaceId]);
    }
  }

  return {
    ...state,
    workspaces: nextWorkspaces
  };
}

function initializeFromStore(): StoreHydration {
  const stored = loadWorkspaceStore();
  const workspaces: Record<string, WorkspaceSession> = {};
  const workspaceOrder: string[] = [];

  for (const path of stored.workspaceOrder) {
    const entry = stored.workspaces[path];
    if (!entry) continue;
    workspaces[path] = createWorkspaceSession(path, entry);
    workspaceOrder.push(path);
  }

  const activeWorkspaceId = stored.activeWorkspaceId && workspaces[stored.activeWorkspaceId]
    ? stored.activeWorkspaceId
    : workspaceOrder[0] ?? null;

  return { activeWorkspaceId, workspaceOrder, workspaces };
}

const initialState: AppState = {
  activeWorkspaceId: null,
  workspaceOrder: [],
  workspaces: {},
  supportedFileTypes: [
    { id: "md", label: "Markdown", extensions: ["md", "markdown"], searchable: true },
    { id: "html", label: "HTML", extensions: ["html", "htm"], searchable: true },
    { id: "json", label: "JSON", extensions: ["json"], searchable: true },
    { id: "csv", label: "CSV", extensions: ["csv", "tsv"], searchable: true },
    { id: "dxf", label: "DXF", extensions: ["dxf"], searchable: true },
    {
      id: "text",
      label: "Text",
      extensions: textExtensions,
      searchable: true
    },
    { id: "spreadsheet", label: "Spreadsheet", extensions: ["xlsx"], searchable: true },
    { id: "document", label: "Document", extensions: ["docx"], searchable: true },
    {
      id: "image",
      label: "Image",
      extensions: ["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp", "ico", "avif"],
      searchable: false
    },
    { id: "pdf", label: "PDF", extensions: ["pdf"], searchable: false }
  ]
};

function appReducer(state: AppState, action: AppAction): AppState {
  const updateWorkspace = (
    workspaceId: string,
    updater: (workspace: WorkspaceSession) => WorkspaceSession
  ): AppState => {
    const workspace = state.workspaces[workspaceId];
    if (!workspace) return state;
    return {
      ...state,
      workspaces: {
        ...state.workspaces,
        [workspaceId]: updater(workspace)
      }
    };
  };

  switch (action.type) {
    case "ACTIVATE_WORKSPACE": {
      const workspaceId = action.payload;
      const existingWorkspace = state.workspaces[workspaceId];
      const nextWorkspace = existingWorkspace
        ? { ...existingWorkspace, lastOpenedAt: Date.now(), name: basename(workspaceId) }
        : createWorkspaceSession(workspaceId);

      const nextState = {
        ...state,
        activeWorkspaceId: workspaceId,
        workspaceOrder: touchWorkspaceOrder(state.workspaceOrder, workspaceId),
        workspaces: {
          ...state.workspaces,
          [workspaceId]: nextWorkspace
        }
      };
      return applyMemoryLimit(nextState);
    }
    case "SET_WORKSPACE_TREE":
      return updateWorkspace(action.payload.workspaceId, (workspace) => ({
        ...workspace,
        fileTree: action.payload.tree,
        treeLoaded: true,
        loading: false,
        error: null
      }));
    case "SET_WORKSPACE_SELECTED_FILE":
      return updateWorkspace(action.payload.workspaceId, (workspace) => ({
        ...workspace,
        selectedFilePath: action.payload.filePath,
        loading: action.payload.filePath !== null,
        error: null,
        fileContent: null
      }));
    case "SET_WORKSPACE_FILE_CONTENT":
      return updateWorkspace(action.payload.workspaceId, (workspace) => ({
        ...workspace,
        fileContent: action.payload.content,
        loading: false
      }));
    case "SET_WORKSPACE_LOADING":
      return updateWorkspace(action.payload.workspaceId, (workspace) => ({
        ...workspace,
        loading: action.payload.loading
      }));
    case "SET_WORKSPACE_ERROR":
      return updateWorkspace(action.payload.workspaceId, (workspace) => ({
        ...workspace,
        error: action.payload.error,
        loading: false
      }));
    case "SET_WORKSPACE_SEARCH_QUERY":
      return updateWorkspace(action.payload.workspaceId, (workspace) => ({
        ...workspace,
        searchQuery: action.payload.query
      }));
    case "SET_WORKSPACE_SEARCH_RESULTS":
      return updateWorkspace(action.payload.workspaceId, (workspace) => ({
        ...workspace,
        searchResults: action.payload.results,
        searchLoading: false
      }));
    case "SET_WORKSPACE_SEARCH_LOADING":
      return updateWorkspace(action.payload.workspaceId, (workspace) => ({
        ...workspace,
        searchLoading: action.payload.loading
      }));
    case "TOGGLE_WORKSPACE_CASE_SENSITIVE":
      return updateWorkspace(action.payload.workspaceId, (workspace) => ({
        ...workspace,
        caseSensitive: !workspace.caseSensitive
      }));
    case "SET_WORKSPACE_SEARCH_FILE_TYPE":
      return updateWorkspace(action.payload.workspaceId, (workspace) => ({
        ...workspace,
        searchFileType: action.payload.fileType
      }));
    case "SET_SUPPORTED_FILE_TYPES":
      return { ...state, supportedFileTypes: action.payload };
    case "CLEAR_WORKSPACE_SEARCH":
      return updateWorkspace(action.payload.workspaceId, (workspace) => ({
        ...workspace,
        searchQuery: "",
        searchResults: [],
        searchLoading: false
      }));
    default:
      return state;
  }
}

const AppContext = createContext<AppState>(initialState);
const AppDispatchContext = createContext<Dispatch<AppAction>>(() => {});

export function AppProvider({ children }: { children: ReactNode; }) {
  const [state, dispatch] = useReducer(appReducer, initialState, (baseState) => {
    const hydrated = initializeFromStore();
    return {
      ...baseState,
      activeWorkspaceId: hydrated.activeWorkspaceId,
      workspaceOrder: hydrated.workspaceOrder,
      workspaces: hydrated.workspaces
    };
  });

  useEffect(() => {
    persistWorkspaceStore({
      activeWorkspaceId: state.activeWorkspaceId,
      workspaceOrder: state.workspaceOrder.slice(0, MAX_WORKSPACES_PERSISTED),
      workspaces: Object.fromEntries(
        state.workspaceOrder.slice(0, MAX_WORKSPACES_PERSISTED).map((workspaceId) => {
          const workspace = state.workspaces[workspaceId];
          return [workspaceId, {
            path: workspace.path,
            name: workspace.name,
            lastOpenedAt: workspace.lastOpenedAt,
            selectedFilePath: workspace.selectedFilePath,
            searchQuery: workspace.searchQuery,
            caseSensitive: workspace.caseSensitive,
            searchFileType: workspace.searchFileType
          }];
        })
      )
    });
  }, [state.activeWorkspaceId, state.workspaceOrder, state.workspaces]);

  return (
    <AppContext.Provider value={state}>
      <AppDispatchContext.Provider value={dispatch}>
        {children}
      </AppDispatchContext.Provider>
    </AppContext.Provider>
  );
}

export function useAppState() {
  return useContext(AppContext);
}

export function useAppDispatch() {
  return useContext(AppDispatchContext);
}

export function useActiveWorkspace() {
  const state = useAppState();
  if (!state.activeWorkspaceId) return null;
  return state.workspaces[state.activeWorkspaceId] ?? null;
}
