'use client';

import { useRouter } from 'next/navigation';

interface Column<T> {
  key: keyof T;
  header: string;
  render?: (value: T[keyof T], row: T) => React.ReactNode;
  /** Right-align + mono for numeric columns. */
  numeric?: boolean;
}

interface DataTableProps<T> {
  data: T[];
  columns: Column<T>[];
  onExport?: () => void;
  /** Return a route to make each row a clickable link (e.g. customer drill-down). */
  getRowHref?: (row: T) => string | null;
  /** Alternative to getRowHref for non-navigation row clicks. */
  onRowClick?: (row: T) => void;
}

export default function DataTable<T extends Record<string, unknown>>({
  data,
  columns,
  onExport,
  getRowHref,
  onRowClick,
}: DataTableProps<T>) {
  const router = useRouter();

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

  const handleRowActivate = (row: T) => {
    const href = getRowHref?.(row);
    if (href) {
      router.push(href);
    } else if (onRowClick) {
      onRowClick(row);
    }
  };

  const interactive = Boolean(getRowHref || onRowClick);

  return (
    <div className="h-full flex flex-col">
      {onExport !== undefined && (
        <div className="flex justify-end mb-3">
          <button
            onClick={handleExport}
            className="text-xs font-medium text-ember-deep hover:underline transition-colors"
          >
            Export CSV
          </button>
        </div>
      )}
      <div className="flex-1 overflow-auto">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-card z-10">
            <tr className="border-b border-line">
              {columns.map((col) => (
                <th
                  key={String(col.key)}
                  className={`py-3 px-4 eyebrow text-ink-faint ${col.numeric ? 'text-right' : 'text-left'}`}
                >
                  {col.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.map((row, index) => {
              const rowInteractive = interactive && (getRowHref?.(row) || onRowClick);
              return (
                <tr
                  key={index}
                  onClick={rowInteractive ? () => handleRowActivate(row) : undefined}
                  className={`border-b border-line transition-colors ${
                    rowInteractive
                      ? 'cursor-pointer hover:bg-paper-deep/60'
                      : 'hover:bg-paper-deep/40'
                  }`}
                >
                  {columns.map((col) => (
                    <td
                      key={String(col.key)}
                      className={`py-3 px-4 text-ink ${col.numeric ? 'text-right font-mono tabular-nums' : ''}`}
                    >
                      {col.render ? col.render(row[col.key], row) : String(row[col.key] ?? '')}
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
