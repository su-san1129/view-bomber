import { useEffect, useRef } from "react";
import { Allotment } from "allotment";
import { Toolbar } from "./components/Toolbar";
import { Sidebar } from "./components/Sidebar";
import { MarkdownViewer } from "./components/MarkdownViewer";
import { useAppDispatch } from "./context/AppContext";
import { getLaunchTarget, readFileContent } from "./lib/tauri";
import { useOpenFolder } from "./lib/useOpenFolder";
import { requiresRawTextContent } from "./viewers/fileTypes";

function App() {
  const dispatch = useAppDispatch();
  const openFolder = useOpenFolder();
  const hasHandledLaunchTarget = useRef(false);

  useEffect(() => {
    if (hasHandledLaunchTarget.current) {
      return;
    }
    hasHandledLaunchTarget.current = true;

    const applyLaunchTarget = async () => {
      const target = await getLaunchTarget();
      if (!target) return;

      const workspaceId = target.workspacePath;
      await openFolder(workspaceId);

      if (!target.selectedFilePath) return;

      const filePath = target.selectedFilePath;
      dispatch({
        type: "SET_WORKSPACE_SELECTED_FILE",
        payload: { workspaceId, filePath }
      });

      try {
        const fileContent = requiresRawTextContent(filePath)
          ? await readFileContent(filePath)
          : { content: "", encoding: null, isUtf8: null };
        dispatch({
          type: "SET_WORKSPACE_FILE_CONTENT",
          payload: {
            workspaceId,
            content: fileContent.content,
            encoding: fileContent.encoding,
            isUtf8: fileContent.isUtf8
          }
        });
      } catch (error) {
        dispatch({
          type: "SET_WORKSPACE_ERROR",
          payload: { workspaceId, error: String(error) }
        });
      }
    };

    void applyLaunchTarget();
  }, [dispatch, openFolder]);

  return (
    <div className="flex flex-col h-screen w-screen overflow-hidden">
      <Toolbar />
      <div className="flex-1 min-h-0">
        <Allotment defaultSizes={[250, 750]}>
          <Allotment.Pane minSize={180} maxSize={500}>
            <Sidebar />
          </Allotment.Pane>
          <Allotment.Pane>
            <MarkdownViewer />
          </Allotment.Pane>
        </Allotment>
      </div>
    </div>
  );
}

export default App;
