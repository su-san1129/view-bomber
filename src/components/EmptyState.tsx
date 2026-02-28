import { Clock, FolderOpen } from "lucide-react";
import { getRecentFolders } from "../lib/recentFiles";
import { useOpenFolder } from "../lib/useOpenFolder";

export function EmptyState() {
  const recentFolders = getRecentFolders();
  const openFolder = useOpenFolder();

  const shortenPath = (path: string) => {
    const home = path.match(/^\/Users\/[^/]+/)?.[0];
    if (home) return path.replace(home, "~");
    return path;
  };

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        height: "100%",
        backgroundColor: "var(--bg-main)",
        userSelect: "none"
      }}
    >
      <div style={{ maxWidth: 420, width: "100%" }}>
        {/* Title */}
        <h1
          style={{
            fontSize: "var(--font-welcome)",
            fontWeight: 300,
            color: "var(--welcome-title)",
            marginBottom: 4
          }}
        >
          View Bomber
        </h1>
        <p
          style={{
            fontSize: "var(--font-ui)",
            color: "var(--text-secondary)",
            marginBottom: "var(--sp-8)"
          }}
        >
          ローカルフォルダの対応ファイルを快適に閲覧
        </p>

        {/* Start */}
        <div style={{ marginBottom: "var(--sp-6)" }}>
          <h2
            style={{
              fontSize: "var(--font-ui)",
              fontWeight: 600,
              color: "var(--welcome-heading)",
              marginBottom: "var(--sp-3)"
            }}
          >
            はじめる
          </h2>
          <button
            onClick={() => openFolder()}
            style={{
              display: "flex",
              alignItems: "center",
              gap: "var(--sp-2)",
              height: "var(--h-icon-btn)",
              padding: "0 var(--sp-2)",
              border: "none",
              borderRadius: "var(--radius-sm)",
              cursor: "pointer",
              backgroundColor: "transparent",
              color: "var(--md-link)",
              fontSize: "var(--font-ui)"
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.backgroundColor = "var(--bg-hover)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.backgroundColor = "transparent";
            }}
          >
            <FolderOpen size={16} />
            フォルダを開く...
          </button>
        </div>

        {/* Recent folders */}
        {recentFolders.length > 0 && (
          <div>
            <h2
              style={{
                display: "flex",
                alignItems: "center",
                gap: "var(--sp-2)",
                fontSize: "var(--font-ui)",
                fontWeight: 600,
                color: "var(--welcome-heading)",
                marginBottom: "var(--sp-3)"
              }}
            >
              <Clock size={14} />
              最近開いたフォルダ
            </h2>
            <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
              {recentFolders.map((folder) => (
                <li key={folder.path}>
                  <button
                    onClick={() => openFolder(folder.path)}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "var(--sp-3)",
                      width: "100%",
                      height: "var(--h-icon-btn)",
                      padding: "0 var(--sp-2)",
                      border: "none",
                      borderRadius: "var(--radius-sm)",
                      cursor: "pointer",
                      backgroundColor: "transparent",
                      fontSize: "var(--font-ui)",
                      textAlign: "left"
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.backgroundColor = "var(--bg-hover)";
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.backgroundColor = "transparent";
                    }}
                  >
                    <span style={{ color: "var(--md-link)" }}>{folder.name}</span>
                    <span style={{ color: "var(--text-secondary)", fontSize: "var(--font-label)" }}>
                      {shortenPath(folder.path.replace(/\/[^/]+$/, ""))}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}
