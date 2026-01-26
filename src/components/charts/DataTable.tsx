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
            className="text-xs text-zinc-400 hover:text-white transition-colors"
          >
            Export CSV
          </button>
        </div>
      )}
      <div className="flex-1 overflow-auto">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-zinc-900">
            <tr className="border-b border-zinc-800">
              {columns.map((col) => (
                <th
                  key={String(col.key)}
                  className="text-left py-3 px-4 text-zinc-400 font-medium"
                >
                  {col.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.map((row, index) => (
              <tr key={index} className="border-b border-zinc-800/50 hover:bg-zinc-800/30">
                {columns.map((col) => (
                  <td key={String(col.key)} className="py-3 px-4 text-white">
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
