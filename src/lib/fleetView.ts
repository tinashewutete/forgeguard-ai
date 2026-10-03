import { MACHINE_TYPES } from '../ml/data/machines';
import { FALLBACK_BASELINE } from '../ml/features';
import type { BaselineModel } from '../ml/features';
import type { FleetEngine, MachineRuntime } from '../sim/fleet';
import type { SensorKey } from '../ml/types';
import { time } from './format';

export type TelemetryKey = Exclude<SensorKey, 'workload'>;

export function downsample(values: number[], points: number): number[] {
  if (values.length <= points) return values;
  const out: number[] = [];
  const step = values.length / points;
  for (let i = 0; i < points; i += 1) {
    const from = Math.floor(i * step);
    const to = Math.floor((i + 1) * step);
    let s = 0;
    for (let k = from; k < to; k += 1) s += values[k];
    out.push(s / Math.max(1, to - from));
  }
  return out;
}

export function tail(m: MachineRuntime, key: TelemetryKey | 'workload', minutes: number, points = 120): number[] {
  const arr = m.series[key];
  return downsample(arr.slice(Math.max(0, arr.length - minutes)), points);
}

/** Expected healthy value given the recorded workload, ±3σ (load-adjusted baseline). */
export function baselineBand(m: MachineRuntime, key: TelemetryKey, minutes: number, baseline: BaselineModel = FALLBACK_BASELINE, points = 120) {
  const w = m.series.workload.slice(Math.max(0, m.series.workload.length - minutes));
  const base = MACHINE_TYPES[m.def.type].baseline[key];
  const model = baseline[key];
  const mid = w.map((wl) => base * (model.a + model.b * (wl / 100)));
  return {
    lo: downsample(mid.map((v) => v - 3 * model.sd * base), points),
    hi: downsample(mid.map((v) => v + 3 * model.sd * base), points),
  };
}

export function xLabels(fleet: FleetEngine, minutes: number, count = 4): string[] {
  const end = fleet.minute;
  return Array.from({ length: count }, (_, i) => time(fleet.timeAt(end - minutes + (minutes * i) / (count - 1))));
}

/** Maintenance priority: failed machines first, then by risk, urgency of time-to-failure and trend. */
export function priorityScore(fleet: FleetEngine, m: MachineRuntime): number {
  if (m.status === 'failed') return 1000;
  const p = m.prediction;
  if (!p) return 0;
  const ttfBoost = p.ttf ? Math.max(0, 48 - p.ttf.hours) : 0;
  return p.risk * 2 + ttfBoost + Math.max(0, fleet.trend(m)) * 2 + (p.anomalous ? 10 : 0) + (100 - p.health) * 0.3;
}

export function rankFleet(fleet: FleetEngine): MachineRuntime[] {
  return [...fleet.machines].sort((a, b) => priorityScore(fleet, b) - priorityScore(fleet, a));
}

export const SENSOR_META: Record<TelemetryKey | 'workload', { label: string; unit: string; digits: number; color: string }> = {
  temperature: { label: 'Temperature', unit: '°C', digits: 1, color: '#d08a4f' },
  vibration: { label: 'Vibration', unit: 'mm/s', digits: 2, color: '#6aa890' },
  current: { label: 'Motor current', unit: 'A', digits: 1, color: '#7f9fc7' },
  rpm: { label: 'Spindle / shaft speed', unit: 'rpm', digits: 0, color: '#9a8fb8' },
  workload: { label: 'Workload', unit: '%', digits: 0, color: '#8d98a6' },
};
