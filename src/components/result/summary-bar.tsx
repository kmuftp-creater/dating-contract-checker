import type { AnalysisResult } from '@/lib/types';

/** 結果頁頂部的統計列：符合、不符合、建議修正、不適用各幾項。 */

const TILES: { key: keyof AnalysisResult['summary']; label: string; colorClassName: string }[] = [
  { key: 'pass', label: '符合', colorClassName: 'text-ok' },
  { key: 'fail', label: '不符合', colorClassName: 'text-danger' },
  { key: 'fix', label: '建議修正', colorClassName: 'text-warn' },
  { key: 'na', label: '不適用', colorClassName: 'text-ink-muted' },
];

export function SummaryBar({ summary }: { summary: AnalysisResult['summary'] }) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      {TILES.map((tile) => (
        <div key={tile.key} className="card p-4 text-center">
          <p className={`text-2xl font-semibold ${tile.colorClassName}`}>{summary[tile.key]}</p>
          <p className="mt-1 text-sm text-ink-muted">{tile.label}</p>
        </div>
      ))}
    </div>
  );
}
