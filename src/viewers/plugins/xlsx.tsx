import { type RefObject, useEffect, useMemo, useState } from "react";
import { readXlsx } from "../../lib/tauri";
import type { XlsxData } from "../../types";
import type { ViewerPlugin } from "../types";

const INITIAL_VISIBLE_ROWS = 1000;

function XlsxViewer(
  { filePath, contentRef }: { filePath: string; contentRef: RefObject<HTMLDivElement | null>; }
) {
  const [data, setData] = useState<XlsxData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeSheetIndex, setActiveSheetIndex] = useState(0);
  const [visibleRows, setVisibleRows] = useState(INITIAL_VISIBLE_ROWS);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setData(null);
    setActiveSheetIndex(0);
    setVisibleRows(INITIAL_VISIBLE_ROWS);

    readXlsx(filePath)
      .then((result) => {
        if (cancelled) return;
        setData(result);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(`XLSXの読み込みに失敗しました: ${String(err)}`);
      })
      .finally(() => {
        if (cancelled) return;
        setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [filePath]);

  const sheet = useMemo(() => {
    if (!data || data.sheets.length === 0) return null;
    return data.sheets[Math.min(activeSheetIndex, data.sheets.length - 1)];
  }, [activeSheetIndex, data]);

  if (loading) {
    return <p style={{ color: "var(--text-secondary)" }}>XLSXを読み込み中...</p>;
  }

  if (error) {
    return <p style={{ color: "#f14c4c" }}>{error}</p>;
  }

  if (!sheet) {
    return <p style={{ color: "var(--text-secondary)" }}>表示可能なシートがありません。</p>;
  }

  const [header = [], ...body] = sheet.rows;
  const hasMore = body.length > visibleRows;
  const visibleBody = hasMore ? body.slice(0, visibleRows) : body;

  return (
    <div ref={contentRef} style={{ maxWidth: 1400, margin: "0 auto" }}>
      <div className="xlsx-tabs">
        {data?.sheets.map((entry, index) => (
          <button
            key={entry.name}
            type="button"
            className={`xlsx-tab ${index === activeSheetIndex ? "is-active" : ""}`}
            onClick={() => {
              setActiveSheetIndex(index);
              setVisibleRows(INITIAL_VISIBLE_ROWS);
            }}
          >
            {entry.name}
          </button>
        ))}
      </div>
      <p className="csv-meta">
        Sheet: {sheet.name} / Rows: {sheet.rows.length} / Columns: {header.length}
      </p>
      <div className="csv-table-wrap">
        <table className="csv-table">
          <thead>
            <tr>
              {header.map((cell, index) => (
                <th key={`xh-${index}`}>{cell || `Column ${index + 1}`}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visibleBody.map((row, rowIndex) => (
              <tr key={`xr-${rowIndex}`}>
                {row.map((cell, colIndex) => <td key={`xc-${rowIndex}-${colIndex}`}>{cell}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {hasMore && (
        <div style={{ marginTop: "var(--sp-3)" }}>
          <button
            type="button"
            className="text-wrap-toggle"
            onClick={() => setVisibleRows((prev) => prev + INITIAL_VISIBLE_ROWS)}
          >
            Load more ({visibleBody.length}/{body.length})
          </button>
        </div>
      )}
    </div>
  );
}

export const xlsxViewerPlugin: ViewerPlugin = {
  id: "xlsx",
  label: "Spreadsheet",
  extensions: ["xlsx", "xlsm", "xls", "ods"],
  supportsFind: true,
  render({ filePath, contentRef }) {
    return <XlsxViewer filePath={filePath} contentRef={contentRef} />;
  }
};
