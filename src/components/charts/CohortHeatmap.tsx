'use client';

interface CohortRow {
  week: string;
  size: number;
  retention: (number | null)[];
}

interface CohortHeatmapProps {
  cohorts: CohortRow[];
  weeks: number;
}

/** Lake intensity ramp for a 0–100 retention value (Wk0 is always the deepest). */
function cellClass(v: number | null) {
  if (v == null) return 'bg-transparent';
  if (v <= 0) return 'bg-paper-deep border border-line';
  if (v < 10) return 'bg-lake-tint';
  if (v < 25) return 'bg-lake/30';
  if (v < 50) return 'bg-lake/55';
  if (v < 75) return 'bg-lake/75';
  return 'bg-lake';
}
function textClass(v: number | null) {
  if (v == null) return '';
  return v >= 50 ? 'text-[#F6EFE4]' : 'text-ink';
}

function shortWeek(w: string) {
  const [, m, d] = w.split('-');
  return `${m}/${d}`;
}

export default function CohortHeatmap({ cohorts, weeks }: CohortHeatmapProps) {
  if (cohorts.length === 0) {
    return <div className="empty-state py-10">Not enough signups to build cohorts yet</div>;
  }

  const colCount = weeks + 1;

  return (
    <div className="overflow-x-auto">
      <table className="border-separate" style={{ borderSpacing: '4px' }}>
        <thead>
          <tr>
            <th className="text-left eyebrow text-ink-faint px-2 pb-1 font-normal">Cohort</th>
            <th className="text-right eyebrow text-ink-faint px-2 pb-1 font-normal">Users</th>
            {Array.from({ length: colCount }).map((_, w) => (
              <th key={w} className="eyebrow text-ink-faint pb-1 font-normal w-12 text-center">W{w}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {cohorts.map((c) => (
            <tr key={c.week}>
              <td className="text-sm text-ink-soft font-mono whitespace-nowrap px-2">{shortWeek(c.week)}</td>
              <td className="text-sm text-ink font-mono tabular-nums text-right px-2">{c.size}</td>
              {c.retention.map((v, w) => (
                <td key={w} className="p-0">
                  <div
                    className={`w-12 h-9 rounded-md flex items-center justify-center text-xs font-mono tabular-nums ${cellClass(v)} ${textClass(v)}`}
                    title={v == null ? 'Not yet aged' : `${shortWeek(c.week)} · Week ${w}: ${v}%`}
                  >
                    {v == null ? '' : `${Math.round(v)}`}
                  </div>
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-3 text-xs font-mono text-ink-faint">% of each weekly signup cohort active in week N · blank = not yet aged</p>
    </div>
  );
}
