import { type RefObject, useEffect, useMemo, useState } from "react";
import { readParquet } from "../../lib/tauri";
import type { ParquetPreviewData } from "../../types";
import type { ViewerPlugin } from "../types";

const INITIAL_VISIBLE_ROWS = 1000;

function padRow(row: string[], columnCount: number): string[] {
  if (row.length >= columnCount) return row;
  return [...row, ...Array(columnCount - row.length).fill("")];
}

function buildFallbackHeader(columnCount: number): string[] {
  return Array.from({ length: columnCount }, (_, index) => `Column ${index + 1}`);
}

function ParquetViewer(
  { filePath, contentRef }: { filePath: string; contentRef: RefObject<HTMLDivElement | null>; }
) {
  const [visibleRows, setVisibleRows] = useState(INITIAL_VISIBLE_ROWS);
  const [data, setData] = useState<ParquetPreviewData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setVisibleRows(INITIAL_VISIBLE_ROWS);
    setData(null);
    setError(null);
    setLoading(true);

    readParquet(filePath, INITIAL_VISIBLE_ROWS)
      .then((result) => {
        if (cancelled) return;
        setData(result);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(`Parquetの読み込みに失敗しました: ${String(err)}`);
      })
      .finally(() => {
        if (cancelled) return;
        setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [filePath]);

  const loadMore = async () => {
    const nextVisibleRows = visibleRows + INITIAL_VISIBLE_ROWS;
    setLoading(true);
    setError(null);
    try {
      const result = await readParquet(filePath, nextVisibleRows);
      setData(result);
      setVisibleRows(nextVisibleRows);
    } catch (err) {
      setError(`Parquetの追加読み込みに失敗しました: ${String(err)}`);
    } finally {
      setLoading(false);
    }
  };

  const normalized = useMemo(() => {
    if (!data) return null;
    const detectedColumns = Math.max(
      data.columns.length,
      ...data.rows.map((row) => row.length),
      0
    );
    const columns = data.columns.length > 0
      ? padRow(data.columns, detectedColumns)
      : buildFallbackHeader(detectedColumns);
    const rows = data.rows.map((row) => padRow(row, columns.length));
    return { columns, rows };
  }, [data]);

  if (loading && !data) {
    return <p style={{ color: "var(--text-secondary)" }}>Parquetを読み込み中...</p>;
  }

  if (error && !data) {
    return <p style={{ color: "#f14c4c" }}>{error}</p>;
  }

  if (!normalized || normalized.columns.length === 0) {
    return <p style={{ color: "var(--text-secondary)" }}>表示可能なデータがありません。</p>;
  }

  const hasMore = data?.truncated ?? false;

  return (
    <div ref={contentRef} style={{ maxWidth: 1400, margin: "0 auto" }}>
      <p className="csv-meta">
        Rows: {data?.rows.length ?? 0}/{data?.totalRows ?? 0} / Columns: {normalized.columns.length}
      </p>
      {error && <p style={{ color: "#f14c4c", marginBottom: 8 }}>{error}</p>}
      <div className="csv-table-wrap">
        <table className="csv-table">
          <thead>
            <tr>
              {normalized.columns.map((cell, index) => (
                <th key={`ph-${index}`}>{cell || `Column ${index + 1}`}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {normalized.rows.map((row, rowIndex) => (
              <tr key={`pr-${rowIndex}`}>
                {row.map((cell, colIndex) => <td key={`pc-${rowIndex}-${colIndex}`}>{cell}</td>)}
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
            onClick={() => void loadMore()}
            disabled={loading}
          >
            {loading
              ? "Loading..."
              : `Load more (${data?.rows.length ?? 0}/${data?.totalRows ?? 0})`}
          </button>
        </div>
      )}
    </div>
  );
}

export const parquetViewerPlugin: ViewerPlugin = {
  id: "parquet",
  label: "Parquet",
  extensions: ["parquet"],
  supportsFind: false,
  render({ filePath, contentRef }) {
    return <ParquetViewer filePath={filePath} contentRef={contentRef} />;
  }
};
