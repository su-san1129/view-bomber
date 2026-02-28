import { useEffect, useRef, useState } from "react";
import mermaid from "mermaid";

let idCounter = 0;

function getCurrentTheme(): "dark" | "default" {
  return document.documentElement.getAttribute("data-theme") === "light" ? "default" : "dark";
}

export function MermaidBlock({ children }: { children: string; }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const render = async () => {
      if (!containerRef.current) return;

      const theme = getCurrentTheme();
      mermaid.initialize({ startOnLoad: false, theme });

      const id = `mermaid-${idCounter++}`;
      try {
        const { svg } = await mermaid.render(id, children);
        containerRef.current.innerHTML = svg;
        setError(null);
      } catch (e) {
        setError(String(e));
      }
    };
    render();
  }, [children]);

  // Re-render on theme change
  useEffect(() => {
    const observer = new MutationObserver(() => {
      if (!containerRef.current) return;
      const theme = getCurrentTheme();
      mermaid.initialize({ startOnLoad: false, theme });
      const id = `mermaid-${idCounter++}`;
      mermaid.render(id, children).then(({ svg }) => {
        containerRef.current!.innerHTML = svg;
      }).catch(() => {});
    });
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme"]
    });
    return () => observer.disconnect();
  }, [children]);

  if (error) {
    return (
      <pre
        style={{
          color: "#f14c4c",
          border: "1px solid var(--border-color)",
          borderRadius: 6,
          padding: 16
        }}
      >
        <code>{children}</code>
      </pre>
    );
  }

  return (
    <div
      ref={containerRef}
      style={{ display: "flex", justifyContent: "center", margin: "16px 0" }}
    />
  );
}
