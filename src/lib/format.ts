import type { Condition } from '../ml/types';

export const fmt = (v: number, digits = 0) => (Number.isFinite(v) ? v.toFixed(digits) : '—');
export const pct = (v: number, digits = 0) => `${fmt(v, digits)}%`;
/** Risk index and model-agreement values are 0–100 scores, not probabilities. */
export const riskIdx = (v: number) => `${fmt(v)}/100`;
export const signed = (v: number, digits = 0) => `${v > 0 ? '+' : ''}${fmt(v, digits)}`;

export function time(d: Date | string): string {
  const date = typeof d === 'string' ? new Date(d) : d;
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export function dateTime(d: Date | string): string {
  const date = typeof d === 'string' ? new Date(d) : d;
  return date.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export function hours(h: number): string {
  if (!Number.isFinite(h)) return '—';
  if (h < 1) return `${Math.max(1, Math.round(h * 60))} min`;
  if (h < 48) return `${h.toFixed(h < 10 ? 1 : 0)} h`;
  return `${(h / 24).toFixed(1)} d`;
}

export const CONDITION_LABEL: Record<Condition, string> = { normal: 'Normal', warning: 'Warning', critical: 'Critical' };

export function trendLabel(perHour: number): { label: string; tone: 'up' | 'down' | 'flat' } {
  if (perHour > 1.5) return { label: `Rising ${signed(perHour, 1)}/h`, tone: 'up' };
  if (perHour < -1.5) return { label: `Falling ${signed(perHour, 1)}/h`, tone: 'down' };
  return { label: 'Stable', tone: 'flat' };
}
