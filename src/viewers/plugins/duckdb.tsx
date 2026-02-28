import { type RefObject, useEffect, useMemo, useState } from "react";
import { readDuckDbTablePreview, readDuckDbTables } from "../../lib/tauri";
import type { DuckDbTableInfo, DuckDbTablePreviewData } from "../../types";
import type { ViewerPlugin } from "../types";

const INITIAL_VISIBLE_ROWS = 200;

function DuckDbViewer(
  { filePath, contentRef }: { filePath: string; contentRef: RefObject<HTMLDivElement | null>; }
) {
  const [tables, setTables] = useState<DuckDbTableInfo[]>([]);
  const [activeSchema, setActiveSchema] = useState<string | null>(null);
  const [activeTable, setActiveTable] = useState<string | null>(null);
  const [visibleRows, setVisibleRows] = useState(INITIAL_VISIBLE_ROWS);
  const [data, setData] = useState<DuckDbTablePreviewData | null>(null);
  const [loadingTables, setLoadingTables] = useState(true);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setTables([]);
    setActiveSchema(null);
    setActiveTable(null);
    setVisibleRows(INITIAL_VISIBLE_ROWS);
    setData(null);
    setError(null);
    setLoadingTables(true);

    readDuckDbTables(filePath)
      .then((nextTables) => {
        if (cancelled) return;
        setTables(nextTables);
        const first = nextTables[0] ?? null;
        setActiveSchema(first?.schemaName ?? null);
        setActiveTable(first?.tableName ?? null);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(`DuckDBテーブル一覧の取得に失敗しました: ${String(err)}`);
      })
      .finally(() => {
        if (cancelled) return;
        setLoadingTables(false);
      });

    return () => {
      cancelled = true;
    };
  }, [filePath]);

  const schemaOptions = useMemo(() => {
    const seen = new Set<string>();
    const next: string[] = [];
    for (const table of tables) {
      if (seen.has(table.schemaName)) continue;
      seen.add(table.schemaName);
      next.push(table.schemaName);
    }
    return next;
  }, [tables]);

  const tableOptions = useMemo(() => {
    if (!activeSchema) return [];
    return tables.filter((table) => table.schemaName === activeSchema);
  }, [activeSchema, tables]);

  useEffect(() => {
    if (!activeSchema || tableOptions.length === 0) return;
    if (tableOptions.some((table) => table.tableName === activeTable)) return;
    setActiveTable(tableOptions[0]?.tableName ?? null);
    setVisibleRows(INITIAL_VISIBLE_ROWS);
  }, [activeSchema, activeTable, tableOptions]);

  useEffect(() => {
    if (!activeSchema || !activeTable) return;
    let cancelled = false;
    setLoadingPreview(true);
    setError(null);

    readDuckDbTablePreview(filePath, activeSchema, activeTable, visibleRows)
      .then((nextData) => {
        if (cancelled) return;
        setData(nextData);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(`DuckDBプレビュー取得に失敗しました: ${String(err)}`);
      })
      .finally(() => {
        if (cancelled) return;
        setLoadingPreview(false);
      });

    return () => {
      cancelled = true;
    };
  }, [activeSchema, activeTable, filePath, visibleRows]);

  const normalizedData = useMemo(() => {
    if (!data) return null;
    const columnCount = Math.max(data.columns.length, ...data.rows.map((row) => row.length), 0);
    const columns = data.columns.length > 0
      ? data.columns
      : Array.from({ length: columnCount }, (_, index) => `Column ${index + 1}`);
    const rows = data.rows.map((row) =>
      row.length >= columns.length ? row : [...row, ...Array(columns.length - row.length).fill("")]
    );
    return { columns, rows };
  }, [data]);

  if (loadingTables) {
    return <p style={{ color: "var(--text-secondary)" }}>DuckDBを読み込み中...</p>;
  }

  if (error && !data) {
    return <p style={{ color: "#f14c4c" }}>{error}</p>;
  }

  if (tables.length === 0) {
    return <p style={{ color: "var(--text-secondary)" }}>表示可能なテーブルがありません。</p>;
  }

  if (!normalizedData) {
    return <p style={{ color: "var(--text-secondary)" }}>テーブルを読み込み中...</p>;
  }

  const hasMore = data?.truncated ?? false;

  return (
    <div ref={contentRef} style={{ maxWidth: 1400, margin: "0 auto" }}>
      <div style={{ display: "flex", gap: 8, marginBottom: 10, flexWrap: "wrap" }}>
        <label
          style={{ display: "flex", alignItems: "center", gap: 6, fontSize: "var(--font-ui)" }}
        >
          <span style={{ color: "var(--text-secondary)" }}>DB</span>
          <select
            value={activeSchema ?? ""}
            onChange={(event) => {
              setActiveSchema(event.target.value || null);
              setVisibleRows(INITIAL_VISIBLE_ROWS);
            }}
            className="xlsx-tab"
          >
            {schemaOptions.map((schemaName) => (
              <option key={schemaName} value={schemaName}>{schemaName}</option>
            ))}
          </select>
        </label>
        <label
          style={{ display: "flex", alignItems: "center", gap: 6, fontSize: "var(--font-ui)" }}
        >
          <span style={{ color: "var(--text-secondary)" }}>Table</span>
          <select
            value={activeTable ?? ""}
            onChange={(event) => {
              setActiveTable(event.target.value || null);
              setVisibleRows(INITIAL_VISIBLE_ROWS);
            }}
            className="xlsx-tab"
          >
            {tableOptions.map((table) => (
              <option key={`${table.schemaName}.${table.tableName}`} value={table.tableName}>
                {table.displayName}
              </option>
            ))}
          </select>
        </label>
      </div>
      <p className="csv-meta">
        DB: {activeSchema} / Table: {activeTable} / Rows:{" "}
        {data?.rows.length ?? 0}/{data?.totalRows ?? 0} / Columns: {normalizedData.columns.length}
      </p>
      {error && <p style={{ color: "#f14c4c", marginBottom: 8 }}>{error}</p>}
      <div className="csv-table-wrap">
        <table className="csv-table">
          <thead>
            <tr>
              {normalizedData.columns.map((columnName, index) => (
                <th key={`dh-${index}`}>{columnName || `Column ${index + 1}`}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {normalizedData.rows.map((row, rowIndex) => (
              <tr key={`dr-${rowIndex}`}>
                {row.map((cell, colIndex) => <td key={`dc-${rowIndex}-${colIndex}`}>{cell}</td>)}
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
            disabled={loadingPreview}
          >
            {loadingPreview
              ? "Loading..."
              : `Load more (${data?.rows.length ?? 0}/${data?.totalRows ?? 0})`}
          </button>
        </div>
      )}
    </div>
  );
}

export const duckdbViewerPlugin: ViewerPlugin = {
  id: "duckdb",
  label: "DuckDB",
  extensions: ["duckdb", "ddb"],
  supportsFind: false,
  render({ filePath, contentRef }) {
    return <DuckDbViewer filePath={filePath} contentRef={contentRef} />;
  }
};
