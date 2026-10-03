import { memo } from 'react';

export interface ChartSeries {
  values: number[];
  color: string;
  label: string;
  width?: number;
  dashed?: boolean;
  fill?: boolean;
}

export interface Threshold {
  value: number;
  color: string;
  label: string;
}

interface LineChartProps {
  series: ChartSeries[];
  band?: { lo: number[]; hi: number[]; label: string };
  min?: number;
  max?: number;
  thresholds?: Threshold[];
  height?: number;
  xLabels?: string[];
  ariaLabel: string;
  format?: (v: number) => string;
}

const W = 600;

function bounds(series: ChartSeries[], band: LineChartProps['band'], min?: number, max?: number) {
  let lo = Infinity;
  let hi = -Infinity;
  for (const s of series) for (const v of s.values) {
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  if (band) {
    for (const v of band.lo) lo = Math.min(lo, v);
    for (const v of band.hi) hi = Math.max(hi, v);
  }
  if (!Number.isFinite(lo)) {
    lo = 0;
    hi = 1;
  }
  const pad = (hi - lo) * 0.08 || Math.abs(hi) * 0.05 || 1;
  return { lo: min ?? lo - pad, hi: max ?? hi + pad };
}

function path(values: number[], n: number, y: (v: number) => number): string {
  if (!values.length) return '';
  const step = n > 1 ? W / (n - 1) : 0;
  const offset = n - values.length;
  return values.map((v, i) => `${i ? 'L' : 'M'}${((i + offset) * step).toFixed(1)},${y(v).toFixed(1)}`).join('');
}

export const LineChart = memo(function LineChart({ series, band, min, max, thresholds = [], height = 170, xLabels, ariaLabel, format = (v) => v.toFixed(0) }: LineChartProps) {
  const n = Math.max(2, ...series.map((s) => s.values.length));
  const b = bounds(series, band, min, max);
  const y = (v: number) => height - ((v - b.lo) / (b.hi - b.lo || 1)) * height;
  const ticks = [b.hi, (b.hi + b.lo) / 2, b.lo];
  let bandPath = '';
  if (band && band.lo.length > 1) {
    const step = W / (n - 1);
    const off = n - band.lo.length;
    const top = band.hi.map((v, i) => `${i ? 'L' : 'M'}${((i + off) * step).toFixed(1)},${y(v).toFixed(1)}`).join('');
    const bottom = band.lo.map((v, i) => [((i + off) * step).toFixed(1), y(v).toFixed(1)]).reverse().map(([x, yy]) => `L${x},${yy}`).join('');
    bandPath = `${top}${bottom}Z`;
  }
  return (
    <figure className="chart" aria-label={ariaLabel} role="img">
      <div className="chart-y" aria-hidden="true">
        {ticks.map((t, i) => (
          <span key={i}>{format(t)}</span>
        ))}
      </div>
      <div className="chart-body">
        <svg viewBox={`0 0 ${W} ${height}`} preserveAspectRatio="none" style={{ height }}>
          {[0.25, 0.5, 0.75].map((f) => (
            <line key={f} x1={0} x2={W} y1={height * f} y2={height * f} className="chart-grid" />
          ))}
          {bandPath && <path d={bandPath} className="chart-band" />}
          {thresholds.map((t) => (
            <line key={t.label} x1={0} x2={W} y1={y(t.value)} y2={y(t.value)} stroke={t.color} strokeDasharray="5 5" strokeOpacity={0.7} vectorEffect="non-scaling-stroke" />
          ))}
          {series.map((s) => (
            <g key={s.label}>
              {s.fill && s.values.length > 1 && (
                <path d={`${path(s.values, n, y)}L${W},${height}L${((n - s.values.length) * W) / (n - 1)},${height}Z`} fill={s.color} opacity={0.08} />
              )}
              <path d={path(s.values, n, y)} fill="none" stroke={s.color} strokeWidth={s.width ?? 1.8} strokeDasharray={s.dashed ? '4 4' : undefined} vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
            </g>
          ))}
        </svg>
        {thresholds.map((t) => (
          <span key={t.label} className="chart-threshold-label" style={{ top: `${(y(t.value) / height) * 100}%`, color: t.color }}>
            {t.label}
          </span>
        ))}
        {xLabels && (
          <div className="chart-x" aria-hidden="true">
            {xLabels.map((l, i) => (
              <span key={i}>{l}</span>
            ))}
          </div>
        )}
      </div>
    </figure>
  );
});

export function Sparkline({ values, color, height = 28, max = 100, min = 0 }: { values: number[]; color: string; height?: number; max?: number; min?: number }) {
  const w = 100;
  if (values.length < 2) return <svg className="sparkline" viewBox={`0 0 ${w} ${height}`} aria-hidden="true" />;
  const d = values.map((v, i) => `${i ? 'L' : 'M'}${((i / (values.length - 1)) * w).toFixed(1)},${(height - ((Math.min(max, Math.max(min, v)) - min) / (max - min)) * height).toFixed(1)}`).join('');
  return (
    <svg className="sparkline" viewBox={`0 0 ${w} ${height}`} preserveAspectRatio="none" aria-hidden="true">
      <path d={d} fill="none" stroke={color} strokeWidth={1.6} vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

export function RiskRing({ value, size = 132, label = 'Risk index', color }: { value: number; size?: number; label?: string; color: string }) {
  const r = size / 2 - 9;
  const c = 2 * Math.PI * r;
  const v = Math.min(100, Math.max(0, value));
  return (
    <div className="risk-ring" style={{ width: size, height: size }} role="img" aria-label={`${label} ${Math.round(v)} out of 100`}>
      <svg viewBox={`0 0 ${size} ${size}`}>
        <circle cx={size / 2} cy={size / 2} r={r} className="ring-track" strokeWidth={8} fill="none" />
        <circle cx={size / 2} cy={size / 2} r={r} stroke={color} strokeWidth={8} fill="none" strokeLinecap="round" strokeDasharray={`${(v / 100) * c} ${c}`} transform={`rotate(-90 ${size / 2} ${size / 2})`} style={{ transition: 'stroke-dasharray .5s ease' }} />
      </svg>
      <div className="ring-copy">
        <strong>{Math.round(v)}<small>/100</small></strong>
        <span>{label}</span>
      </div>
    </div>
  );
}

export function Meter({ value, color, label }: { value: number; color: string; label: string }) {
  const v = Math.min(100, Math.max(0, value));
  return (
    <div className="meter" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(v)} aria-label={label}>
      <div className="meter-fill" style={{ width: `${v}%`, background: color }} />
    </div>
  );
}
