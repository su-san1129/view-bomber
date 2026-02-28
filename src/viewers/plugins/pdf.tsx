import { useCallback, useEffect, useRef, useState } from "react";
import { readFile } from "@tauri-apps/plugin-fs";
import { openPath } from "@tauri-apps/plugin-opener";
import { ChevronLeft, ChevronRight, ExternalLink, Maximize, ZoomIn, ZoomOut } from "lucide-react";
import * as pdfjsLib from "pdfjs-dist/legacy/build/pdf.mjs";
import pdfWorkerUrl from "pdfjs-dist/legacy/build/pdf.worker.min.mjs?url";
import type { ViewerPlugin } from "../types";

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

function clampScale(scale: number): number {
  return Math.max(0.25, Math.min(4, scale));
}

function PdfViewer({ filePath }: { filePath: string; }) {
  const [pdfDoc, setPdfDoc] = useState<pdfjsLib.PDFDocumentProxy | null>(null);
  const [pageNumber, setPageNumber] = useState(1);
  const [numPages, setNumPages] = useState(0);
  const [scale, setScale] = useState(1);
  const [loadingDoc, setLoadingDoc] = useState(true);
  const [renderingPage, setRenderingPage] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const viewerRef = useRef<HTMLDivElement>(null);
  const renderTokenRef = useRef(0);

  useEffect(() => {
    let cancelled = false;
    let loadingTask: ReturnType<typeof pdfjsLib.getDocument> | null = null;

    setLoadingDoc(true);
    setError(null);
    setPageNumber(1);
    setScale(1);
    setPdfDoc(null);
    setNumPages(0);

    const load = async () => {
      try {
        const bytes = await readFile(filePath);
        if (cancelled) return;
        loadingTask = pdfjsLib.getDocument({ data: bytes });
        const doc = await loadingTask.promise;
        if (cancelled) return;
        setPdfDoc(doc);
        setNumPages(doc.numPages);
      } catch (err) {
        if (cancelled) return;
        setError(`PDFの読み込みに失敗しました: ${String(err)}`);
      } finally {
        if (!cancelled) {
          setLoadingDoc(false);
        }
      }
    };

    load();

    return () => {
      cancelled = true;
      loadingTask?.destroy();
    };
  }, [filePath]);

  useEffect(() => {
    if (!pdfDoc || !canvasRef.current) return;
    let cancelled = false;
    const token = ++renderTokenRef.current;

    const renderPage = async () => {
      setRenderingPage(true);
      setError(null);

      try {
        const page = await pdfDoc.getPage(pageNumber);
        const viewport = page.getViewport({ scale });
        const canvas = canvasRef.current;
        if (!canvas || cancelled || token !== renderTokenRef.current) return;

        const context = canvas.getContext("2d");
        if (!context) {
          setError("PDF描画用のCanvasコンテキストを取得できませんでした。");
          return;
        }

        canvas.width = Math.ceil(viewport.width);
        canvas.height = Math.ceil(viewport.height);
        canvas.style.width = `${viewport.width}px`;
        canvas.style.height = `${viewport.height}px`;

        await page.render({
          canvas,
          canvasContext: context,
          viewport
        }).promise;
      } catch (err) {
        if (!cancelled) {
          setError(`PDFの描画に失敗しました: ${String(err)}`);
        }
      } finally {
        if (!cancelled) {
          setRenderingPage(false);
        }
      }
    };

    renderPage();
    return () => {
      cancelled = true;
    };
  }, [pdfDoc, pageNumber, scale]);

  const fitWidth = useCallback(async () => {
    if (!pdfDoc || !viewerRef.current) return;
    try {
      const page = await pdfDoc.getPage(pageNumber);
      const viewport = page.getViewport({ scale: 1 });
      const targetWidth = Math.max(viewerRef.current.clientWidth - 40, 200);
      setScale(clampScale(targetWidth / viewport.width));
    } catch {
      // noop
    }
  }, [pdfDoc, pageNumber]);

  const openExternal = useCallback(async () => {
    try {
      await openPath(filePath);
    } catch (err) {
      setError(`外部アプリで開けませんでした: ${String(err)}`);
    }
  }, [filePath]);

  return (
    <div className="pdf-viewer">
      <div className="pdf-toolbar">
        <button
          type="button"
          className="pdf-toolbar-btn"
          onClick={() => setPageNumber((prev) => Math.max(1, prev - 1))}
          disabled={!pdfDoc || pageNumber <= 1}
          title="前のページ"
        >
          <ChevronLeft size={14} />
        </button>
        <span className="pdf-toolbar-label">
          {numPages > 0 ? `${pageNumber} / ${numPages}` : "- / -"}
        </span>
        <button
          type="button"
          className="pdf-toolbar-btn"
          onClick={() => setPageNumber((prev) => Math.min(numPages, prev + 1))}
          disabled={!pdfDoc || pageNumber >= numPages}
          title="次のページ"
        >
          <ChevronRight size={14} />
        </button>
        <div className="pdf-toolbar-sep" />
        <button
          type="button"
          className="pdf-toolbar-btn"
          onClick={() => setScale((prev) => clampScale(prev - 0.1))}
          disabled={!pdfDoc}
          title="縮小"
        >
          <ZoomOut size={14} />
        </button>
        <span className="pdf-toolbar-label">{Math.round(scale * 100)}%</span>
        <button
          type="button"
          className="pdf-toolbar-btn"
          onClick={() => setScale((prev) => clampScale(prev + 0.1))}
          disabled={!pdfDoc}
          title="拡大"
        >
          <ZoomIn size={14} />
        </button>
        <button
          type="button"
          className="pdf-toolbar-btn"
          onClick={fitWidth}
          disabled={!pdfDoc}
          title="幅に合わせる"
        >
          <Maximize size={14} />
        </button>
        <div style={{ flex: 1 }} />
        <button
          type="button"
          className="pdf-toolbar-btn"
          onClick={openExternal}
          title="外部アプリで開く"
        >
          <ExternalLink size={14} />
        </button>
      </div>
      <div className="pdf-canvas-wrap" ref={viewerRef}>
        {loadingDoc && <p className="pdf-status">PDFを読み込み中...</p>}
        {!loadingDoc && renderingPage && <p className="pdf-status">ページを描画中...</p>}
        {error && <p className="pdf-error">{error}</p>}
        {!error && <canvas ref={canvasRef} className="pdf-canvas" />}
      </div>
    </div>
  );
}

export const pdfViewerPlugin: ViewerPlugin = {
  id: "pdf",
  label: "PDF",
  extensions: ["pdf"],
  supportsFind: false,
  render({ filePath }) {
    return <PdfViewer filePath={filePath} />;
  }
};
