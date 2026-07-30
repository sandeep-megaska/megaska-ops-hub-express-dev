// Dependency-free RFC 4180 CSV parser. The repo intentionally ships no CSV
// library (export is hand-rolled too); review imports are bounded in size
// (a merchant's review backup, not a streaming firehose), so a correct
// in-memory state-machine parser is the right trade-off. Handles: quoted
// fields, embedded commas/quotes/newlines, "" escaping, CRLF or LF line
// endings, a leading UTF-8 BOM, and a trailing newline.

export interface CsvParseResult {
  headers: string[];
  // Each record maps normalized-header -> raw cell value. Rows shorter than the
  // header are padded with ""; extra cells beyond the header are dropped.
  records: Record<string, string>[];
  rawRowCount: number;
}

// Split raw CSV text into a matrix of cells. Exposed for tests; most callers
// want parseCsvToRecords below.
export function parseCsvMatrix(input: string): string[][] {
  const text = stripBom(input);
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  let sawAnyChar = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];

    if (inQuotes) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"') {
      inQuotes = true;
      sawAnyChar = true;
    } else if (char === ",") {
      row.push(field);
      field = "";
      sawAnyChar = true;
    } else if (char === "\n" || char === "\r") {
      // Collapse a CRLF pair into one line break.
      if (char === "\r" && text[i + 1] === "\n") i += 1;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      sawAnyChar = false;
    } else {
      field += char;
      sawAnyChar = true;
    }
  }

  // Flush the final field/row unless the input ended exactly on a line break
  // (trailing newline) with nothing after it.
  if (sawAnyChar || field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  return rows;
}

// Normalize a header cell into a stable key: lowercased, trimmed, and any run of
// non-alphanumeric characters collapsed to a single underscore. So "Reviewer
// Name", "reviewer_name", and "Reviewer-Name" all resolve to "reviewer_name".
export function normalizeHeader(header: string): string {
  return String(header || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

export function parseCsvToRecords(input: string): CsvParseResult {
  const matrix = parseCsvMatrix(input);
  if (matrix.length === 0) return { headers: [], records: [], rawRowCount: 0 };

  const rawHeaders = matrix[0];
  const headers = rawHeaders.map(normalizeHeader);
  const dataRows = matrix.slice(1).filter((row) => !isBlankRow(row));

  const records = dataRows.map((row) => {
    const record: Record<string, string> = {};
    headers.forEach((key, index) => {
      if (!key) return;
      // Last-wins on duplicate normalized headers keeps behavior deterministic.
      record[key] = (row[index] ?? "").trim();
    });
    return record;
  });

  return { headers, records, rawRowCount: dataRows.length };
}

function stripBom(value: string): string {
  return value.charCodeAt(0) === 0xfeff ? value.slice(1) : value;
}

function isBlankRow(row: string[]): boolean {
  return row.every((cell) => String(cell ?? "").trim() === "");
}
