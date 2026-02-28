import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { readFile } from "@tauri-apps/plugin-fs";
import { openPath } from "@tauri-apps/plugin-opener";
import { ExternalLink, Maximize, ZoomIn, ZoomOut } from "lucide-react";
import * as pdfjsLib from "pdfjs-dist/legacy/build/pdf.mjs";
import pdfWorkerUrl from "pdfjs-dist/legacy/build/pdf.worker.min.mjs?url";
import type { ViewerPlugin } from "../types";

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

type PageRenderState = "idle" | "rendering" | "rendered" | "error";

function clampScale(scale: number): number {
  return Math.max(0.25, Math.min(4, scale));
}

function PdfViewer({ filePath }: { filePath: string; }) {
  const [pdfDoc, setPdfDoc] = useState<pdfjsLib.PDFDocumentProxy | null>(null);
  const [numPages, setNumPages] = useState(0);
  const [scale, setScale] = useState(1);
  const [loadingDoc, setLoadingDoc] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [pageStates, setPageStates] = useState<PageRenderState[]>([]);

  const viewerRef = useRef<HTMLDivElement>(null);
  const canvasRefs = useRef<Array<HTMLCanvasElement | null>>([]);
  const pageRefs = useRef<Array<HTMLDivElement | null>>([]);
  const pageRenderTokensRef = useRef<number[]>([]);
  const visiblePagesRef = useRef<Set<number>>(new Set());
  const isRenderingRef = useRef(false);
  const disposedRef = useRef(false);

  const priorityPages = useMemo(() => {
    if (numPages <= 0) return [] as number[];
    const pages = new Set<number>();
    for (const pageNum of visiblePagesRef.current) {
      pages.add(pageNum);
      if (pageNum > 1) pages.add(pageNum - 1);
      if (pageNum < numPages) pages.add(pageNum + 1);
    }
    if (pages.size === 0) {
      pages.add(1);
      if (numPages > 1) pages.add(2);
    }
    return Array.from(pages).sort((a, b) => a - b);
  }, [numPages, pageStates]);

  const updatePageState = useCallback((pageNum: number, state: PageRenderState) => {
    setPageStates((prev) => {
      if (pageNum < 1 || pageNum > prev.length) return prev;
      if (prev[pageNum - 1] === state) return prev;
      const next = [...prev];
      next[pageNum - 1] = state;
      return next;
    });
  }, []);

  const renderPage = useCallback(async (pageNum: number) => {
    if (!pdfDoc) return;
    const canvas = canvasRefs.current[pageNum - 1];
    if (!canvas) return;

    const token = (pageRenderTokensRef.current[pageNum - 1] ?? 0) + 1;
    pageRenderTokensRef.current[pageNum - 1] = token;

    updatePageState(pageNum, "rendering");

    try {
      const page = await pdfDoc.getPage(pageNum);
      const viewport = page.getViewport({ scale });
      const outputScale = window.devicePixelRatio || 1;
      const context = canvas.getContext("2d");
      if (!context) {
        updatePageState(pageNum, "error");
        return;
      }

      canvas.width = Math.ceil(viewport.width * outputScale);
      canvas.height = Math.ceil(viewport.height * outputScale);
      canvas.style.width = `${Math.ceil(viewport.width)}px`;
      canvas.style.height = `${Math.ceil(viewport.height)}px`;

      context.setTransform(outputScale, 0, 0, outputScale, 0, 0);

      await page.render({
        canvas,
        canvasContext: context,
        viewport
      }).promise;

      if (disposedRef.current) return;
      if (pageRenderTokensRef.current[pageNum - 1] !== token) return;

      updatePageState(pageNum, "rendered");
    } catch {
      if (disposedRef.current) return;
      if (pageRenderTokensRef.current[pageNum - 1] !== token) return;
      updatePageState(pageNum, "error");
    }
  }, [pdfDoc, scale, updatePageState]);

  const processRenderQueue = useCallback(async () => {
    if (!pdfDoc || isRenderingRef.current) return;
    const target = priorityPages.find((pageNum) => {
      const state = pageStates[pageNum - 1];
      return state === "idle" || state === "error";
    });
    if (!target) return;

    isRenderingRef.current = true;
    try {
      await renderPage(target);
    } finally {
      isRenderingRef.current = false;
    }
  }, [pageStates, pdfDoc, priorityPages, renderPage]);

  useEffect(() => {
    disposedRef.current = false;
    return () => {
      disposedRef.current = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    let loadingTask: ReturnType<typeof pdfjsLib.getDocument> | null = null;

    setLoadingDoc(true);
    setError(null);
    setPdfDoc(null);
    setNumPages(0);
    setScale(1);
    setCurrentPage(1);
    setPageStates([]);
    canvasRefs.current = [];
    pageRefs.current = [];
    pageRenderTokensRef.current = [];
    visiblePagesRef.current = new Set();

    const load = async () => {
      try {
        const bytes = await readFile(filePath);
        if (cancelled) return;
        loadingTask = pdfjsLib.getDocument({ data: bytes });
        const doc = await loadingTask.promise;
        if (cancelled) return;

        setPdfDoc(doc);
        setNumPages(doc.numPages);
        setPageStates(Array.from({ length: doc.numPages }, () => "idle"));
        pageRenderTokensRef.current = Array.from({ length: doc.numPages }, () => 0);
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
    if (!pdfDoc || numPages === 0) return;
    setPageStates(Array.from({ length: numPages }, () => "idle"));
  }, [pdfDoc, numPages, scale]);

  useEffect(() => {
    if (!pdfDoc || numPages === 0 || !viewerRef.current) return;

    const root = viewerRef.current;
    const observer = new IntersectionObserver((entries) => {
      let visibleChanged = false;

      for (const entry of entries) {
        const element = entry.target as HTMLDivElement;
        const pageNum = Number(element.dataset.pageNumber);
        if (!Number.isFinite(pageNum)) continue;

        if (entry.isIntersecting) {
          if (!visiblePagesRef.current.has(pageNum)) {
            visiblePagesRef.current.add(pageNum);
            visibleChanged = true;
          }
        } else if (visiblePagesRef.current.delete(pageNum)) {
          visibleChanged = true;
        }
      }

      if (visibleChanged) {
        setPageStates((prev) => [...prev]);
      }

      const visibleCandidates = entries
        .filter((entry) => entry.isIntersecting)
        .map((entry) => ({
          pageNum: Number((entry.target as HTMLDivElement).dataset.pageNumber),
          top: entry.boundingClientRect.top,
          height: entry.boundingClientRect.height
        }))
        .filter((item) => Number.isFinite(item.pageNum));

      if (visibleCandidates.length > 0) {
        const rootRect = root.getBoundingClientRect();
        const centerY = rootRect.top + rootRect.height / 2;
        let nearest = visibleCandidates[0];
        let nearestDist = Infinity;
        for (const candidate of visibleCandidates) {
          const candidateCenter = candidate.top + candidate.height / 2;
          const dist = Math.abs(candidateCenter - centerY);
          if (dist < nearestDist) {
            nearestDist = dist;
            nearest = candidate;
          }
        }
        setCurrentPage(nearest.pageNum);
      }
    }, {
      root,
      threshold: [0, 0.2, 0.5, 0.8, 1],
      rootMargin: "400px 0px"
    });

    for (const element of pageRefs.current) {
      if (element) observer.observe(element);
    }

    return () => {
      observer.disconnect();
    };
  }, [numPages, pdfDoc]);

  useEffect(() => {
    void processRenderQueue();
  }, [processRenderQueue]);

  const fitWidth = useCallback(async () => {
    if (!pdfDoc || !viewerRef.current) return;
    try {
      const page = await pdfDoc.getPage(1);
      const viewport = page.getViewport({ scale: 1 });
      const targetWidth = Math.max(viewerRef.current.clientWidth - 48, 200);
      setScale(clampScale(targetWidth / viewport.width));
    } catch {
      // noop
    }
  }, [pdfDoc]);

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
        <span className="pdf-toolbar-label">
          {numPages > 0 ? `${currentPage} / ${numPages}` : "- / -"}
        </span>
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
        {error && <p className="pdf-error">{error}</p>}
        {!loadingDoc && !error && numPages > 0 && (
          <div className="pdf-pages">
            {Array.from({ length: numPages }, (_, index) => {
              const pageNum = index + 1;
              const state = pageStates[index] ?? "idle";
              return (
                <div
                  key={pageNum}
                  className="pdf-page"
                  ref={(node) => {
                    pageRefs.current[index] = node;
                  }}
                  data-page-number={pageNum}
                >
                  {state === "rendering" && <p className="pdf-page-status">ページを描画中...</p>}
                  {state === "error" && (
                    <p className="pdf-page-error">ページの描画に失敗しました。</p>
                  )}
                  <canvas
                    ref={(node) => {
                      canvasRefs.current[index] = node;
                    }}
                    className="pdf-canvas"
                  />
                </div>
              );
            })}
          </div>
        )}
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
