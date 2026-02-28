import { useEffect, useRef } from "react";
import { useActiveWorkspace, useAppDispatch, useAppState } from "../context/AppContext";
import { searchFiles } from "./tauri";

export function useSearch() {
  const { activeWorkspaceId } = useAppState();
  const activeWorkspace = useActiveWorkspace();
  const dispatch = useAppDispatch();
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const rootPath = activeWorkspace?.path ?? null;
  const searchQuery = activeWorkspace?.searchQuery ?? "";
  const caseSensitive = activeWorkspace?.caseSensitive ?? false;
  const searchFileType = activeWorkspace?.searchFileType ?? "all";

  useEffect(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
    }

    if (!activeWorkspaceId || !rootPath || !searchQuery.trim()) {
      if (activeWorkspaceId) {
        dispatch({
          type: "SET_WORKSPACE_SEARCH_RESULTS",
          payload: { workspaceId: activeWorkspaceId, results: [] }
        });
      }
      return;
    }

    dispatch({
      type: "SET_WORKSPACE_SEARCH_LOADING",
      payload: { workspaceId: activeWorkspaceId, loading: true }
    });

    timerRef.current = setTimeout(async () => {
      try {
        const results = await searchFiles(
          rootPath,
          searchQuery,
          caseSensitive,
          searchFileType
        );
        dispatch({
          type: "SET_WORKSPACE_SEARCH_RESULTS",
          payload: { workspaceId: activeWorkspaceId, results }
        });
      } catch {
        dispatch({
          type: "SET_WORKSPACE_SEARCH_RESULTS",
          payload: { workspaceId: activeWorkspaceId, results: [] }
        });
      }
    }, 300);

    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }
    };
  }, [
    activeWorkspaceId,
    rootPath,
    searchQuery,
    caseSensitive,
    searchFileType,
    dispatch
  ]);
}
