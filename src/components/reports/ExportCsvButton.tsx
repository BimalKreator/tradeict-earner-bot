"use client";

function escapeCsvCell(v: unknown): string {
  if (v == null) return "";
  const s = String(v);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function ExportCsvButton(props: {
  filename: string;
  columns: { key: string; header: string }[];
  rows: Record<string, string | number | boolean | null | undefined>[];
  label?: string;
}) {
  const { filename, columns, rows, label = "Download CSV" } = props;

  function download() {
    const head = columns.map((c) => escapeCsvCell(c.header)).join(",");
    const body = rows
      .map((r) => columns.map((c) => escapeCsvCell(r[c.key])).join(","))
      .join("\n");
    const bom = "\uFEFF";
    const blob = new Blob([bom + head + "\n" + body], {
      type: "text/csv;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename.endsWith(".csv") ? filename : `${filename}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <button
      type="button"
      onClick={download}
      className="rounded-lg border border-[var(--border-glass)] bg-white/5 px-3 py-1.5 text-xs font-semibold text-[var(--accent)] hover:bg-white/10"
    >
      {label}
    </button>
  );
}
