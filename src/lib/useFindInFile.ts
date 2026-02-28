import { useCallback, useEffect, useRef, useState } from "react";

interface FindResult {
  matchCount: number;
  currentIndex: number;
  next: () => void;
  prev: () => void;
  clear: () => void;
}

export function useFindInFile(
  containerRef: React.RefObject<HTMLDivElement | null>,
  query: string
): FindResult {
  const [matchCount, setMatchCount] = useState(0);
  const [currentIndex, setCurrentIndex] = useState(0);
  const marksRef = useRef<HTMLElement[]>([]);

  const clearMarks = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;
    const marks = container.querySelectorAll("mark.find-highlight");
    marks.forEach((mark) => {
      const parent = mark.parentNode;
      if (!parent) return;
      const text = document.createTextNode(mark.textContent ?? "");
      parent.replaceChild(text, mark);
      parent.normalize();
    });
    marksRef.current = [];
  }, [containerRef]);

  const highlight = useCallback(
    (q: string) => {
      clearMarks();
      const container = containerRef.current;
      if (!container || !q) {
        setMatchCount(0);
        setCurrentIndex(0);
        return;
      }

      const lowerQ = q.toLowerCase();
      const walker = document.createTreeWalker(
        container,
        NodeFilter.SHOW_TEXT,
        null
      );

      const matches: { node: Text; index: number; }[] = [];
      let textNode: Text | null;
      while ((textNode = walker.nextNode() as Text | null)) {
        const value = textNode.nodeValue ?? "";
        const lower = value.toLowerCase();
        let startIdx = 0;
        let pos: number;
        while ((pos = lower.indexOf(lowerQ, startIdx)) !== -1) {
          matches.push({ node: textNode, index: pos });
          startIdx = pos + lowerQ.length;
        }
      }

      // Wrap matches in <mark> – process in reverse to keep node offsets valid
      const created: HTMLElement[] = [];
      const processed = new Map<Text, { node: Text; splits: { index: number; }[]; }>();

      for (const m of matches) {
        const entry = processed.get(m.node);
        if (entry) {
          entry.splits.push(m);
        } else {
          processed.set(m.node, { node: m.node, splits: [m] });
        }
      }

      for (const { node, splits } of processed.values()) {
        // Sort descending by index so splitting doesn't shift earlier positions
        splits.sort((a, b) => b.index - a.index);
        let current: Text = node;
        const nodeMarks: HTMLElement[] = [];
        for (const s of splits) {
          const after = current.splitText(s.index + lowerQ.length);
          const matched = current.splitText(s.index);
          const mark = document.createElement("mark");
          mark.className = "find-highlight";
          mark.textContent = matched.textContent;
          matched.parentNode!.replaceChild(mark, matched);
          nodeMarks.unshift(mark); // reverse back to document order within this node
          void after;
        }
        created.push(...nodeMarks); // append in document order across nodes
      }

      marksRef.current = created;
      setMatchCount(created.length);
      if (created.length > 0) {
        setCurrentIndex(0);
        created[0].classList.add("find-highlight-current");
        created[0].scrollIntoView({ block: "center", behavior: "smooth" });
      } else {
        setCurrentIndex(0);
      }
    },
    [containerRef, clearMarks]
  );

  useEffect(() => {
    highlight(query);
    return () => {
      clearMarks();
    };
  }, [query, highlight, clearMarks]);

  const goTo = useCallback(
    (index: number) => {
      const marks = marksRef.current;
      if (marks.length === 0) return;
      marks.forEach((m) => m.classList.remove("find-highlight-current"));
      const wrapped = ((index % marks.length) + marks.length) % marks.length;
      setCurrentIndex(wrapped);
      marks[wrapped].classList.add("find-highlight-current");
      marks[wrapped].scrollIntoView({ block: "center", behavior: "smooth" });
    },
    []
  );

  const next = useCallback(() => {
    goTo(currentIndex + 1);
  }, [goTo, currentIndex]);

  const prev = useCallback(() => {
    goTo(currentIndex - 1);
  }, [goTo, currentIndex]);

  const clear = useCallback(() => {
    clearMarks();
    setMatchCount(0);
    setCurrentIndex(0);
  }, [clearMarks]);

  return { matchCount, currentIndex, next, prev, clear };
}
