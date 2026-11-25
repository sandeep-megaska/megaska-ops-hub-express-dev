// RFC 4180 CSV parser: quoted fields, "" escapes, commas and newlines inside
// quotes, CRLF or LF line endings, and a UTF-8 byte-order mark (Excel adds one).

export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  let i = text.charCodeAt(0) === 0xfeff ? 1 : 0;

  for (; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += ch;
    }
  }
  if (inQuotes) throw new Error("CSV ends inside a quoted field");
  if (field !== "" || row.length) {
    row.push(field);
    rows.push(row);
  }
  // Drop blank lines.
  return rows.filter((r) => r.some((cell) => cell.trim() !== ""));
}

/** Rows as objects keyed by header. Headers are trimmed; duplicates keep the first. */
export function parseCsvRecords(text: string): { headers: string[]; records: Array<Record<string, string>> } {
  const [header, ...body] = parseCsv(text);
  if (!header) return { headers: [], records: [] };
  const headers = header.map((h) => h.trim());
  const records = body.map((cells) => {
    const record: Record<string, string> = {};
    headers.forEach((h, index) => {
      if (!(h in record)) record[h] = (cells[index] ?? "").trim();
    });
    return record;
  });
  return { headers, records };
}
