'use client';

interface Column<T> {
  key: keyof T;
  header: string;
  render?: (value: T[keyof T], row: T) => React.ReactNode;
}

interface DataTableProps<T> {
  data: T[];
  columns: Column<T>[];
  onExport?: () => void;
}

export default function DataTable<T extends Record<string, unknown>>({
  data,
  columns,
  onExport,
}: DataTableProps<T>) {
  const handleExport = () => {
    if (onExport) {
      onExport();
      return;
    }

    const headers = columns.map((c) => c.header).join(',');
    const rows = data.map((row) =>
      columns.map((col) => {
        const value = row[col.key];
        return typeof value === 'string' && value.includes(',') ? `"${value}"` : value;
      }).join(',')
    );

    const csv = [headers, ...rows].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'export.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="h-full flex flex-col">
      {onExport !== undefined && (
        <div className="flex justify-end mb-3">
          <button
            onClick={handleExport}
            className="text-xs text-zinc-500 hover:text-foreground transition-colors"
          >
            Export CSV
          </button>
        </div>
      )}
      <div className="flex-1 overflow-auto">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-transparent">
            <tr className="border-b border-white/5">
              {columns.map((col) => (
                <th
                  key={String(col.key)}
                  className="text-left py-3 px-4 text-zinc-500 font-medium"
                >
                  {col.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.map((row, index) => (
              <tr key={index} className="border-b border-white/5 hover:bg-white/5 transition-colors">
                {columns.map((col) => (
                  <td key={String(col.key)} className="py-3 px-4 text-foreground">
                    {col.render ? col.render(row[col.key], row) : String(row[col.key] ?? '')}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
