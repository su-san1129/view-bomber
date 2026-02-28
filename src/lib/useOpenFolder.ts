import { useAppDispatch } from "../context/AppContext";
import { getSupportedFileTypes, openFolderDialog, readDirectoryTree } from "./tauri";
import { addRecentFolder } from "./recentFiles";

export function useOpenFolder() {
  const dispatch = useAppDispatch();

  const openFolder = async (path?: string) => {
    const folderPath = path ?? (await openFolderDialog());
    if (!folderPath) return;

    dispatch({ type: "SET_ROOT_PATH", payload: folderPath });
    dispatch({ type: "SET_LOADING", payload: true });
    addRecentFolder(folderPath);

    try {
      const [tree, supportedTypes] = await Promise.all([
        readDirectoryTree(folderPath),
        getSupportedFileTypes()
      ]);
      dispatch({ type: "SET_SUPPORTED_FILE_TYPES", payload: supportedTypes });
      dispatch({ type: "SET_FILE_TREE", payload: tree });
    } catch (err) {
      dispatch({ type: "SET_ERROR", payload: String(err) });
    }
  };

  return openFolder;
}
