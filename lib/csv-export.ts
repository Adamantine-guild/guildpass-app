export function escapeCsvValue(value: unknown): string {
  const stringValue = String(value ?? "");

  if (
    stringValue.includes(",") ||
    stringValue.includes('"') ||
    stringValue.includes("\n") ||
    stringValue.includes("\r")
  ) {
    return `"${stringValue.replace(/"/g, '""')}"`;
  }

  return stringValue;
}

export function convertToCsv<T extends Record<string, unknown>>(
  data: T[],
  columns: { key: keyof T; label: string }[],
): string {
  const header = columns
    .map((column) => escapeCsvValue(column.label))
    .join(",");

  const rows = data.map((item) =>
    columns
      .map((column) => escapeCsvValue(item[column.key]))
      .join(","),
  );

  return [header, ...rows].join("\r\n");
}

export function downloadCsv(
  csv: string,
  filename: string,
): void {
  const blob = new Blob([csv], {
    type: "text/csv;charset=utf-8;",
  });

  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");

  link.href = url;
  link.download = filename;

  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);

  URL.revokeObjectURL(url);
}