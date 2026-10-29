import { useMemo, useRef, useState, type ReactNode } from 'react';
import { useI18n } from '@/lib/i18n';

// Validated categorical slots (light surface): blue, orange. Text stays in ink colours.
export const SERIES_COLORS = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100'];

export interface Series { name: string; values: number[]; color?: string }

function niceMax(v: number): number {
  if (v <= 0) return 1;
  const p = Math.pow(10, Math.floor(Math.log10(v)));
  const n = v / p;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * p;
}

const compact = (v: number) => {
  const a = Math.abs(v);
  const trim = (x: number) => x.toFixed(1).replace(/\.0$/, '');
  const s = a >= 1e6 ? `${trim(a / 1e6)}M` : a >= 1e3 ? `${trim(a / 1e3)}k` : a.toFixed(0);
  return `${v < 0 ? '−' : ''}${s}`;
};

function Legend({ series }: { series: Series[] }) {
  if (series.length < 2) return null;
  return (
    <div className="mb-2 flex flex-wrap gap-4 text-xs text-slate-600">
      {series.map((s, i) => (
        <span key={s.name} className="inline-flex items-center gap-1.5">
          <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: s.color ?? SERIES_COLORS[i] }} />{s.name}
        </span>
      ))}
    </div>
  );
}

function TableToggle({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const { lang } = useI18n();
  return (
    <div className="mt-1">
      <button className="text-xs text-ocean-700 hover:underline" onClick={() => setOpen(!open)}>
        {open ? (lang === 'dv' ? 'ޖަދުވަލު ފޮރުވާ' : 'Hide table') : (lang === 'dv' ? 'ޖަދުވަލުން ބަލާ' : 'Show as table')}
      </button>
      {open && <div className="mt-2 overflow-x-auto">{children}</div>}
    </div>
  );
}

/** Grouped vertical bars on one shared axis (e.g. income vs expenses per month). */
export function GroupedBarChart({ categories, series, format, height = 240 }: {
  categories: string[]; series: Series[]; format: (v: number) => string; height?: number;
}) {
  const { dir } = useI18n();
  const wrap = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<{ i: number; x: number; y: number } | null>(null);
  const W = 640, H = height, padL = 46, padB = 26, padT = 8, padR = 8;
  const max = niceMax(Math.max(0, ...series.flatMap((s) => s.values)));
  const plotW = W - padL - padR, plotH = H - padT - padB;
  const band = plotW / Math.max(1, categories.length);
  const gap = 2;
  const barW = Math.max(3, Math.min(22, (band * 0.7 - gap * (series.length - 1)) / series.length));
  const y = (v: number) => padT + plotH - (Math.max(0, v) / max) * plotH;
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => f * max);
  // RTL: time runs right-to-left
  const xAt = (i: number) => (dir === 'rtl' ? padL + plotW - (i + 1) * band : padL + i * band);
  const every = Math.ceil(categories.length / 12);

  return (
    <div ref={wrap} className="relative">
      <Legend series={series} />
      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" onMouseLeave={() => setHover(null)}>
        {ticks.map((tk) => (
          <g key={tk}>
            <line x1={padL} x2={W - padR} y1={y(tk)} y2={y(tk)} stroke="#e2e8f0" strokeWidth={1} />
            <text x={padL - 6} y={y(tk) + 3} fontSize="10" fill="#64748b" textAnchor="end">{compact(tk)}</text>
          </g>
        ))}
        {categories.map((c, i) => {
          const x0 = xAt(i) + (band - (barW * series.length + gap * (series.length - 1))) / 2;
          return (
            <g key={c}>
              {series.map((s, si) => {
                const v = s.values[i] ?? 0;
                const h = Math.max(0, padT + plotH - y(v));
                const x = x0 + si * (barW + gap);
                const r = Math.min(4, barW / 2, h);
                const top = padT + plotH - h;
                return h > 0 ? (
                  <path key={s.name} fill={s.color ?? SERIES_COLORS[si]}
                    d={`M${x},${padT + plotH} V${top + r} Q${x},${top} ${x + r},${top} H${x + barW - r} Q${x + barW},${top} ${x + barW},${top + r} V${padT + plotH} Z`} />
                ) : null;
              })}
              {i % every === 0 && <text x={xAt(i) + band / 2} y={H - 8} fontSize="10" fill="#64748b" textAnchor="middle">{c}</text>}
              <rect x={xAt(i)} y={padT} width={band} height={plotH} fill="transparent"
                onMouseMove={(e) => {
                  const box = wrap.current!.getBoundingClientRect();
                  setHover({ i, x: e.clientX - box.left, y: e.clientY - box.top });
                }} />
            </g>
          );
        })}
        <line x1={padL} x2={W - padR} y1={padT + plotH} y2={padT + plotH} stroke="#94a3b8" />
      </svg>
      {hover && (
        <div className="pointer-events-none absolute z-10 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs shadow-lg"
          style={{ left: Math.min(hover.x + 12, (wrap.current?.clientWidth ?? 300) - 170), top: Math.max(0, hover.y - 50) }}>
          <div className="mb-1 font-medium text-slate-800">{categories[hover.i]}</div>
          {series.map((s, si) => (
            <div key={s.name} className="flex items-center gap-2 text-slate-600">
              <span className="inline-block h-2 w-2 rounded-sm" style={{ background: s.color ?? SERIES_COLORS[si] }} />
              <span>{s.name}</span><span className="ms-auto ps-3 font-medium text-slate-900" dir="ltr">{format(s.values[hover.i] ?? 0)}</span>
            </div>
          ))}
        </div>
      )}
      <TableToggle>
        <table className="min-w-full text-xs">
          <thead><tr><th className="px-2 py-1 text-start text-slate-500" />{series.map((s) => <th key={s.name} className="px-2 py-1 text-end text-slate-500">{s.name}</th>)}</tr></thead>
          <tbody>{categories.map((c, i) => (
            <tr key={c} className="border-t border-slate-100"><td className="px-2 py-1">{c}</td>
              {series.map((s) => <td key={s.name} className="px-2 py-1 text-end" dir="ltr">{format(s.values[i] ?? 0)}</td>)}</tr>
          ))}</tbody>
        </table>
      </TableToggle>
    </div>
  );
}

/** Horizontal bars for comparing a single measure across boats (handles losses). */
export function HBarChart({ items, format, color = SERIES_COLORS[0] }: {
  items: { label: string; value: number; sub?: string }[]; format: (v: number) => string; color?: string;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const { maxAbs, hasNeg } = useMemo(() => ({
    maxAbs: Math.max(1, ...items.map((i) => Math.abs(i.value))),
    hasNeg: items.some((i) => i.value < 0),
  }), [items]);
  return (
    <div className="space-y-2">
      {items.map((it, i) => {
        const pct = (Math.abs(it.value) / maxAbs) * (hasNeg ? 50 : 100);
        return (
          <div key={it.label + i} className="text-sm" onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
            <div className="mb-0.5 flex justify-between gap-2">
              <span className="truncate text-slate-700">{it.label}</span>
              <span className="font-medium tabular-nums text-slate-900" dir="ltr">{format(it.value)}</span>
            </div>
            <div className="relative h-2.5 rounded bg-slate-100">
              {hasNeg && <div className="absolute inset-y-0 start-1/2 w-px bg-slate-300" />}
              <div className="absolute inset-y-0 rounded" title={it.sub}
                style={{
                  background: color, opacity: hover === null || hover === i ? 1 : 0.55, width: `${pct}%`,
                  insetInlineStart: hasNeg ? (it.value < 0 ? `${50 - pct}%` : '50%') : 0,
                }} />
            </div>
            {hover === i && it.sub && <div className="mt-0.5 text-xs text-slate-500">{it.sub}</div>}
          </div>
        );
      })}
    </div>
  );
}
