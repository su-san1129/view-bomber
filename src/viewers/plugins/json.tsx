import { type ReactNode, useMemo, useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { parseGeoJson } from "../geojson";
import { GeoJsonMapViewer } from "./geojson";
import type { ViewerPlugin } from "../types";

type JsonPrimitive = string | number | boolean | null;
type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue; };

interface JsonNode {
  path: string;
  key?: string;
  kind: "object" | "array" | "primitive";
  value?: JsonPrimitive;
  children?: JsonNode[];
}

function getNodeKind(value: JsonValue): JsonNode["kind"] {
  if (Array.isArray(value)) return "array";
  if (value !== null && typeof value === "object") return "object";
  return "primitive";
}

function toNode(value: JsonValue, path: string, key?: string): JsonNode {
  const kind = getNodeKind(value);
  if (kind === "primitive") {
    return { path, key, kind, value: value as JsonPrimitive };
  }

  if (kind === "array") {
    const arrayValue = value as JsonValue[];
    return {
      path,
      key,
      kind,
      children: arrayValue.map((item, index) => toNode(item, `${path}[${index}]`, `[${index}]`))
    };
  }

  const objectValue = value as Record<string, JsonValue>;
  return {
    path,
    key,
    kind,
    children: Object.keys(objectValue).map((childKey) =>
      toNode(objectValue[childKey], `${path}.${childKey}`, childKey)
    )
  };
}

function formatPrimitive(value: JsonPrimitive): string {
  if (typeof value === "string") return `"${value}"`;
  if (value === null) return "null";
  return String(value);
}

function primitiveClassName(value: JsonPrimitive): string {
  if (typeof value === "string") return "json-value-string";
  if (typeof value === "number") return "json-value-number";
  if (typeof value === "boolean") return "json-value-boolean";
  return "json-value-null";
}

function summaryForNode(node: JsonNode): string {
  if (node.kind === "array") {
    return `Array(${node.children?.length ?? 0})`;
  }
  if (node.kind === "object") {
    return `Object(${node.children?.length ?? 0})`;
  }
  return formatPrimitive(node.value ?? null);
}

function JsonTreeNode({ node, depth }: { node: JsonNode; depth: number; }) {
  const hasChildren = (node.children?.length ?? 0) > 0;
  const initiallyExpanded = depth === 0;
  const [expanded, setExpanded] = useState(initiallyExpanded);

  const label = node.key ?? "$";

  let valueElement: ReactNode;
  if (node.kind === "primitive") {
    valueElement = (
      <span className={primitiveClassName(node.value ?? null)}>
        {formatPrimitive(node.value ?? null)}
      </span>
    );
  } else {
    valueElement = <span className="json-struct-summary">{summaryForNode(node)}</span>;
  }

  return (
    <div>
      <div
        className="json-node-row"
        style={{ paddingLeft: `${depth * 18}px` }}
      >
        {hasChildren
          ? (
            <button
              type="button"
              className="json-toggle"
              onClick={() => setExpanded((prev) => !prev)}
              title={expanded ? "折りたたむ" : "展開する"}
            >
              {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            </button>
          )
          : <span className="json-toggle-placeholder" />}
        <span className="json-key">{label}</span>
        <span className="json-separator">:</span>
        {valueElement}
      </div>
      {hasChildren && expanded && (
        <div>
          {node.children?.map((child) => (
            <JsonTreeNode key={child.path} node={child} depth={depth + 1} />
          ))}
        </div>
      )}
    </div>
  );
}

function JsonTreeViewer({ value }: { value: JsonValue; }) {
  const rootNode = useMemo(() => toNode(value, "$"), [value]);
  return <JsonTreeNode node={rootNode} depth={0} />;
}

export const jsonViewerPlugin: ViewerPlugin = {
  id: "json",
  label: "JSON",
  extensions: ["json", "geojson"],
  supportsFind: true,
  render({ content, contentRef }) {
    try {
      const parsed = JSON.parse(content) as JsonValue;
      const geoJsonResult = parseGeoJson(content);

      if (geoJsonResult.ok) {
        return <GeoJsonMapViewer geojson={geoJsonResult.geojson} contentRef={contentRef} />;
      }

      return (
        <div ref={contentRef} className="json-tree" style={{ maxWidth: 1200, margin: "0 auto" }}>
          <JsonTreeViewer value={parsed} />
        </div>
      );
    } catch {
      return (
        <div ref={contentRef} style={{ maxWidth: 1200, margin: "0 auto" }}>
          <p style={{ marginBottom: "var(--sp-3)", color: "#f14c4c" }}>
            JSONの解析に失敗しました。生テキストを表示します。
          </p>
          <pre className="plain-text-view">{content}</pre>
        </div>
      );
    }
  }
};
