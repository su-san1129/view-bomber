import { useCallback } from "react";
import { useAppDispatch, useAppState } from "../context/AppContext";
import {
  getSupportedFileTypes,
  openFolderDialog,
  readDirectoryTree,
  readFileContent
} from "./tauri";
import { requiresRawTextContent } from "../viewers/fileTypes";

export function useOpenFolder() {
  const state = useAppState();
  const dispatch = useAppDispatch();

  const openFolder = useCallback(async (path?: string) => {
    const folderPath = path ?? (await openFolderDialog());
    if (!folderPath) return;

    dispatch({ type: "ACTIVATE_WORKSPACE", payload: folderPath });
    const workspace = state.workspaces[folderPath];
    const shouldLoadTree = !workspace?.treeLoaded;
    const shouldLoadSelectedFile = !!workspace?.selectedFilePath && workspace.fileContent === null;

    try {
      if (shouldLoadTree) {
        dispatch({
          type: "SET_WORKSPACE_LOADING",
          payload: { workspaceId: folderPath, loading: true }
        });
      }

      const tasks: Promise<void>[] = [];

      if (shouldLoadTree) {
        tasks.push(
          readDirectoryTree(folderPath).then((tree) => {
            dispatch({
              type: "SET_WORKSPACE_TREE",
              payload: { workspaceId: folderPath, tree }
            });
          })
        );
      }

      const selectedFilePath = workspace?.selectedFilePath;
      if (shouldLoadSelectedFile && selectedFilePath) {
        tasks.push(
          (async () => {
            try {
              const fileContent = requiresRawTextContent(selectedFilePath)
                ? await readFileContent(selectedFilePath)
                : { content: "", encoding: null, isUtf8: null };
              dispatch({
                type: "SET_WORKSPACE_FILE_CONTENT",
                payload: {
                  workspaceId: folderPath,
                  content: fileContent.content,
                  encoding: fileContent.encoding,
                  isUtf8: fileContent.isUtf8
                }
              });
            } catch (error) {
              dispatch({
                type: "SET_WORKSPACE_SELECTED_FILE",
                payload: { workspaceId: folderPath, filePath: null }
              });
              dispatch({
                type: "SET_WORKSPACE_ERROR",
                payload: { workspaceId: folderPath, error: String(error) }
              });
            }
          })()
        );
      }

      if (tasks.length > 0) {
        await Promise.all(tasks);
      }

      const supportedTypes = await getSupportedFileTypes();
      dispatch({ type: "SET_SUPPORTED_FILE_TYPES", payload: supportedTypes });
    } catch (err) {
      dispatch({
        type: "SET_WORKSPACE_ERROR",
        payload: { workspaceId: folderPath, error: String(err) }
      });
    }
  }, [dispatch, state.workspaces]);

  return openFolder;
}
