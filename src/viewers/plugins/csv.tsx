import { type RefObject, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { readCsvChunk } from "../../lib/tauri";
import type { CsvChunkData } from "../../types";
import type { ViewerPlugin } from "../types";

const CHUNK_SIZE = 500;
const ROW_HEIGHT = 36;
const OVERSCAN = 10;
const AUTO_FETCH_THRESHOLD = 120;

interface CsvViewState {
  delimiter: string;
  header: string[];
  rows: string[][];
  columnCount: number;
  cursor: number | null;
  eof: boolean;
  loading: boolean;
  error: string | null;
}

const initialCsvState: CsvViewState = {
  delimiter: ",",
  header: [],
  rows: [],
  columnCount: 0,
  cursor: null,
  eof: false,
  loading: true,
  error: null
};

function padRow(row: string[], columnCount: number): string[] {
  if (row.length >= columnCount) return row;
  return [...row, ...Array(columnCount - row.length).fill("")];
}

function buildColumnHeader(columnCount: number): string[] {
  return Array.from({ length: columnCount }, (_, index) => `Column ${index + 1}`);
}

function mergeCsvChunk(prev: CsvViewState, chunk: CsvChunkData, reset: boolean): CsvViewState {
  const previousHeader = reset ? [] : prev.header;
  const previousRows = reset ? [] : prev.rows;
  const headerBase = chunk.header.length > 0 ? chunk.header : previousHeader;

  let nextColumnCount = Math.max(
    prev.columnCount,
    headerBase.length,
    ...chunk.rows.map((row) => row.length)
  );
  if (nextColumnCount === 0) {
    nextColumnCount = prev.columnCount;
  }

  const normalizedHeader = headerBase.length > 0
    ? padRow(headerBase, nextColumnCount)
    : buildColumnHeader(nextColumnCount);
  const normalizedPreviousRows = previousRows.map((row) => padRow(row, nextColumnCount));
  const normalizedIncomingRows = chunk.rows.map((row) => padRow(row, nextColumnCount));

  return {
    delimiter: chunk.delimiter || prev.delimiter,
    header: normalizedHeader,
    rows: [...normalizedPreviousRows, ...normalizedIncomingRows],
    columnCount: nextColumnCount,
    cursor: chunk.next_cursor,
    eof: chunk.eof,
    loading: false,
    error: null
  };
}

function delimiterLabel(delimiter: string): string {
  if (delimiter === "\t") return "Tab";
  if (delimiter === ";") return "Semicolon";
  return "Comma";
}

function CsvViewer(
  { filePath, contentRef }: { filePath: string; contentRef: RefObject<HTMLDivElement | null>; }
) {
  const [state, setState] = useState<CsvViewState>(initialCsvState);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(500);
  const [loadingMore, setLoadingMore] = useState(false);
  const tableWrapRef = useRef<HTMLDivElement | null>(null);

  const fetchChunk = useCallback(
    async (cursor: number | null, delimiter: string | null) =>
      readCsvChunk(filePath, cursor, CHUNK_SIZE, delimiter),
    [filePath]
  );

  useEffect(() => {
    let cancelled = false;
    setState(initialCsvState);
    setScrollTop(0);
    setLoadingMore(false);

    fetchChunk(0, null)
      .then((chunk) => {
        if (cancelled) return;
        setState((prev) => mergeCsvChunk(prev, chunk, true));
      })
      .catch((err) => {
        if (cancelled) return;
        setState((prev) => ({
          ...prev,
          loading: false,
          error: `CSVの読み込みに失敗しました: ${String(err)}`
        }));
      });

    return () => {
      cancelled = true;
    };
  }, [fetchChunk, filePath]);

  const fetchNext = useCallback(async () => {
    if (loadingMore || state.loading || state.eof || state.cursor === null) return;
    setLoadingMore(true);
    try {
      const chunk = await fetchChunk(state.cursor, state.delimiter);
      setState((prev) => mergeCsvChunk(prev, chunk, false));
    } catch (err) {
      setState((prev) => ({
        ...prev,
        error: `CSVの追加読み込みに失敗しました: ${String(err)}`
      }));
    } finally {
      setLoadingMore(false);
    }
  }, [
    fetchChunk,
    loadingMore,
    state.cursor,
    state.delimiter,
    state.eof,
    state.loading
  ]);

  useEffect(() => {
    const element = tableWrapRef.current;
    if (!element) return;

    const updateViewport = () => setViewportHeight(Math.max(element.clientHeight, 200));
    updateViewport();
    window.addEventListener("resize", updateViewport);
    return () => window.removeEventListener("resize", updateViewport);
  }, []);

  const totalRows = state.rows.length;
  const startIndex = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN);
  const visibleCount = Math.ceil(viewportHeight / ROW_HEIGHT) + OVERSCAN * 2;
  const endIndex = Math.min(totalRows, startIndex + visibleCount);
  const topSpacerHeight = startIndex * ROW_HEIGHT;
  const bottomSpacerHeight = Math.max((totalRows - endIndex) * ROW_HEIGHT, 0);

  const visibleRows = useMemo(
    () => state.rows.slice(startIndex, endIndex),
    [endIndex, startIndex, state.rows]
  );

  useEffect(() => {
    if (state.loading || state.eof || loadingMore) return;
    const remaining = totalRows - endIndex;
    if (remaining <= AUTO_FETCH_THRESHOLD) {
      void fetchNext();
    }
  }, [endIndex, fetchNext, loadingMore, state.eof, state.loading, totalRows]);

  if (state.loading) {
    return <p style={{ color: "var(--text-secondary)" }}>CSVを読み込み中...</p>;
  }

  if (state.error) {
    return <p style={{ color: "#f14c4c" }}>{state.error}</p>;
  }

  if (state.columnCount === 0) {
    return (
      <div ref={contentRef} style={{ maxWidth: 1200, margin: "0 auto" }}>
        <p style={{ color: "var(--text-secondary)" }}>CSV/TSVに表示可能なデータがありません。</p>
      </div>
    );
  }

  return (
    <div ref={contentRef} style={{ maxWidth: 1400, margin: "0 auto" }}>
      <p className="csv-meta">
        Delimiter: {delimiterLabel(state.delimiter)} / Rows: {state.rows.length}
        {state.eof ? "" : "+"} / Columns: {state.columnCount}
      </p>
      <p className="csv-meta csv-meta-note">
        Find targets loaded and currently rendered rows.
      </p>
      <div
        ref={tableWrapRef}
        className="csv-table-wrap csv-table-wrap-virtual"
        onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
      >
        <table className="csv-table">
          <thead>
            <tr>
              {state.header.map((cell, index) => (
                <th key={`h-${index}`}>{cell || `Column ${index + 1}`}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {topSpacerHeight > 0 && (
              <tr aria-hidden="true">
                <td
                  colSpan={state.columnCount}
                  style={{ border: 0, height: topSpacerHeight, padding: 0 }}
                />
              </tr>
            )}
            {visibleRows.map((row, index) => {
              const rowIndex = startIndex + index;
              return (
                <tr key={`r-${rowIndex}`}>
                  {row.map((cell, colIndex) => <td key={`c-${rowIndex}-${colIndex}`}>{cell}</td>)}
                </tr>
              );
            })}
            {bottomSpacerHeight > 0 && (
              <tr aria-hidden="true">
                <td
                  colSpan={state.columnCount}
                  style={{ border: 0, height: bottomSpacerHeight, padding: 0 }}
                />
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {!state.eof && (
        <div style={{ marginTop: "var(--sp-3)" }}>
          <button
            type="button"
            className="text-wrap-toggle"
            onClick={() => {
              void fetchNext();
            }}
            disabled={loadingMore}
          >
            {loadingMore ? "Loading..." : `Load more (${state.rows.length})`}
          </button>
        </div>
      )}
    </div>
  );
}

export const csvViewerPlugin: ViewerPlugin = {
  id: "csv",
  label: "CSV",
  extensions: ["csv", "tsv"],
  supportsFind: true,
  render({ filePath, contentRef }) {
    return <CsvViewer filePath={filePath} contentRef={contentRef} />;
  }
};
