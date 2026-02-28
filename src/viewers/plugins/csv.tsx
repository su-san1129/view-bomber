import type { ViewerPlugin } from "../types";

function splitCsvLine(line: string, delimiter: string): string[] {
  const cells: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];

    if (char === "\"") {
      if (inQuotes && line[i + 1] === "\"") {
        current += "\"";
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (!inQuotes && char === delimiter) {
      cells.push(current);
      current = "";
      continue;
    }

    current += char;
  }

  cells.push(current);
  return cells;
}

function parseCsv(text: string, delimiter: string): string[][] {
  const rows: string[][] = [];
  let currentLine = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];

    if (char === "\"") {
      if (inQuotes && text[i + 1] === "\"") {
        currentLine += "\"\"";
        i += 1;
      } else {
        inQuotes = !inQuotes;
        currentLine += char;
      }
      continue;
    }

    if (!inQuotes && (char === "\n" || char === "\r")) {
      rows.push(splitCsvLine(currentLine, delimiter));
      currentLine = "";

      if (char === "\r" && text[i + 1] === "\n") {
        i += 1;
      }
      continue;
    }

    currentLine += char;
  }

  if (currentLine.length > 0) {
    rows.push(splitCsvLine(currentLine, delimiter));
  }

  return rows.filter((row) => row.length > 1 || row[0]?.trim().length > 0);
}

function scoreDelimiter(sampleLines: string[], delimiter: string): number {
  let totalColumns = 0;
  let stableRows = 0;
  let expected: number | null = null;

  for (const line of sampleLines) {
    const columns = splitCsvLine(line, delimiter).length;
    totalColumns += columns;

    if (expected === null) {
      expected = columns;
      stableRows += 1;
    } else if (columns === expected) {
      stableRows += 1;
    }
  }

  return totalColumns + stableRows * 2;
}

function detectDelimiter(text: string): string {
  const candidates = [",", "\t", ";"];
  const sampleLines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .slice(0, 10);

  if (sampleLines.length === 0) return ",";

  let best = ",";
  let bestScore = -1;

  for (const delimiter of candidates) {
    const score = scoreDelimiter(sampleLines, delimiter);
    if (score > bestScore) {
      bestScore = score;
      best = delimiter;
    }
  }

  return best;
}

function normalizeRows(rows: string[][]): string[][] {
  const maxColumns = rows.reduce((max, row) => Math.max(max, row.length), 0);
  return rows.map((row) => {
    if (row.length >= maxColumns) return row;
    return [...row, ...Array(maxColumns - row.length).fill("")];
  });
}

function delimiterLabel(delimiter: string): string {
  if (delimiter === "\t") return "Tab";
  if (delimiter === ";") return "Semicolon";
  return "Comma";
}

export const csvViewerPlugin: ViewerPlugin = {
  id: "csv",
  label: "CSV",
  extensions: ["csv", "tsv"],
  supportsFind: true,
  render({ content, contentRef }) {
    try {
      const delimiter = detectDelimiter(content);
      const parsed = parseCsv(content, delimiter);
      if (parsed.length === 0) {
        return (
          <div ref={contentRef} style={{ maxWidth: 1200, margin: "0 auto" }}>
            <p style={{ color: "var(--text-secondary)" }}>
              CSV/TSVに表示可能なデータがありません。
            </p>
          </div>
        );
      }

      const normalized = normalizeRows(parsed);
      const [header, ...body] = normalized;

      return (
        <div ref={contentRef} style={{ maxWidth: 1400, margin: "0 auto" }}>
          <p className="csv-meta">
            Delimiter: {delimiterLabel(delimiter)} / Rows: {normalized.length} / Columns:{" "}
            {header.length}
          </p>
          <div className="csv-table-wrap">
            <table className="csv-table">
              <thead>
                <tr>
                  {header.map((cell, index) => (
                    <th key={`h-${index}`}>{cell || `Column ${index + 1}`}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {body.map((row, rowIndex) => (
                  <tr key={`r-${rowIndex}`}>
                    {row.map((cell, colIndex) => <td key={`c-${rowIndex}-${colIndex}`}>{cell}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      );
    } catch {
      return (
        <div ref={contentRef} style={{ maxWidth: 1200, margin: "0 auto" }}>
          <p style={{ marginBottom: "var(--sp-3)", color: "#f14c4c" }}>
            CSVの解析に失敗しました。生テキストを表示します。
          </p>
          <pre className="plain-text-view">{content}</pre>
        </div>
      );
    }
  }
};
