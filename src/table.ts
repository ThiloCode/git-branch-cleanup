import { stripVTControlCharacters } from "node:util";

export interface Column {
  header: string;
  minWidth?: number;
}

export interface Table {
  heading: string;
  rows: string[];
}

const GAP = "  ";
const ELLIPSIS = "…";
const ANSI_CODE_OR_CHAR = /\u001b\[[\d;]*m|[\s\S]/gu;

function visibleLength(text: string): number {
  return [...stripVTControlCharacters(text)].length;
}

// Escape codes after the cut are kept so that colors opened before it still get closed.
function truncate(text: string, width: number): string {
  if (visibleLength(text) <= width) {
    return text;
  }
  let remaining = width - 1;
  let result = "";
  for (const [token] of text.matchAll(ANSI_CODE_OR_CHAR)) {
    if (token.startsWith("\u001b")) {
      result += token;
    } else if (remaining > 0) {
      result += token;
      remaining--;
    } else if (remaining === 0) {
      result += ELLIPSIS;
      remaining--;
    }
  }
  return result;
}

function pad(text: string, width: number): string {
  return text + " ".repeat(Math.max(0, width - visibleLength(text)));
}

function fitWidths(columns: Column[], widths: number[], available: number): number[] {
  const fitted = [...widths];
  let excess = fitted.reduce((sum, width) => sum + width, 0) - available;
  while (excess > 0) {
    let widest = -1;
    fitted.forEach((width, i) => {
      const { minWidth } = columns[i];
      const canShrink = minWidth !== undefined && width > minWidth;
      if (canShrink && (widest === -1 || width >= fitted[widest])) {
        widest = i;
      }
    });
    if (widest === -1) {
      break;
    }
    fitted[widest]--;
    excess--;
  }
  return fitted;
}

export function formatTable(columns: Column[], rows: string[][], maxWidth: number): Table {
  const used = columns
    .map((_, i) => i)
    .filter((i) => rows.some((row) => visibleLength(row[i]) > 0));
  const usedColumns = used.map((i) => columns[i]);
  const usedRows = rows.map((row) => used.map((i) => row[i]));

  const naturalWidths = usedColumns.map((column, i) =>
    Math.max(visibleLength(column.header), ...usedRows.map((row) => visibleLength(row[i]))),
  );
  const available = maxWidth - GAP.length * (usedColumns.length - 1);
  const widths = fitWidths(usedColumns, naturalWidths, available);

  const formatLine = (cells: string[]) =>
    cells
      .map((cell, i) => pad(truncate(cell, widths[i]), widths[i]))
      .join(GAP)
      .trimEnd();

  return {
    heading: formatLine(usedColumns.map((column) => column.header)),
    rows: usedRows.map(formatLine),
  };
}
