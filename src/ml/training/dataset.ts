import { MACHINE_TYPES } from '../data/machines';
import { createSimState, groundTruth, startDegradation, stepMachine } from '../data/generator';
import type { SimControls } from '../data/generator';
import { computeFeatures, LONG_WINDOW } from '../features';
import type { BaselineModel, LinearBaseline } from '../features';
import { Rng } from '../rng';
import type { FailureMode, MachineType } from '../types';

export interface TrajectorySpec {
  id: number;
  type: MachineType;
  seed: number;
  healthyHours: number;
  degradation: { mode: FailureMode; hoursToFailure: number } | null;
  controls: SimControls;
  hoursSinceService: number;
}

export interface Trajectory {
  spec: TrajectorySpec;
  temperature: Float64Array;
  vibration: Float64Array;
  current: Float64Array;
  rpm: Float64Array;
  workload: Float64Array;
  hoursSinceService: Float64Array;
  degradation: Float64Array;
  ttfMinutes: Float64Array;
  length: number;
}

const TYPES: MachineType[] = ['cnc', 'lathe', 'printer', 'motor'];

export function generateSpecs(count: number, seed: number, healthyShare = 0.36): TrajectorySpec[] {
  const rng = new Rng(seed);
  const specs: TrajectorySpec[] = [];
  for (let id = 0; id < count; id += 1) {
    const type = TYPES[id % TYPES.length];
    const healthy = rng.next() < healthyShare;
    const stress = rng.next() < 0.25;
    const controls: SimControls = {
      workloadOverride: stress ? rng.range(82, 96) : null,
      noise: rng.range(0.8, stress ? 2 : 1.4),
      degradationSpeed: 1,
    };
    specs.push({
      id,
      type,
      seed: rng.int(1, 2 ** 31),
      healthyHours: healthy ? rng.range(72, 110) : rng.range(8, 40),
      degradation: healthy ? null : { mode: rng.pick(MACHINE_TYPES[type].modes), hoursToFailure: rng.range(28, 120) },
      controls,
      hoursSinceService: rng.range(50, 2200),
    });
  }
  return specs;
}

export function simulateTrajectory(spec: TrajectorySpec): Trajectory {
  const state = createSimState(spec.type, spec.seed, spec.hoursSinceService);
  const healthyMinutes = Math.round(spec.healthyHours * 60);
  const maxLen = healthyMinutes + (spec.degradation ? Math.ceil(spec.degradation.hoursToFailure * 60) + 2 : 0);
  const arrays = {
    temperature: new Float64Array(maxLen),
    vibration: new Float64Array(maxLen),
    current: new Float64Array(maxLen),
    rpm: new Float64Array(maxLen),
    workload: new Float64Array(maxLen),
    hoursSinceService: new Float64Array(maxLen),
    degradation: new Float64Array(maxLen),
    ttfMinutes: new Float64Array(maxLen),
  };
  let len = 0;
  for (let i = 0; i < maxLen; i += 1) {
    if (i === healthyMinutes && spec.degradation) startDegradation(state, spec.degradation.mode, spec.degradation.hoursToFailure);
    const s = stepMachine(state, spec.controls);
    if (state.failed) break;
    const truth = groundTruth(state, spec.controls);
    arrays.temperature[i] = s.temperature;
    arrays.vibration[i] = s.vibration;
    arrays.current[i] = s.current;
    arrays.rpm[i] = s.rpm;
    arrays.workload[i] = s.workload;
    arrays.hoursSinceService[i] = s.hoursSinceService;
    arrays.degradation[i] = truth.degradation;
    // Healthy segments before a scheduled onset still have a finite time-to-failure.
    arrays.ttfMinutes[i] = spec.degradation ? truth.ttfMinutes === Infinity ? healthyMinutes - i + spec.degradation.hoursToFailure * 60 : truth.ttfMinutes : Infinity;
    len = i + 1;
  }
  return { spec, ...arrays, length: len };
}

/** Least-squares fit of normalised sensor value against workload on healthy data. */
export function fitBaseline(trajectories: Trajectory[]): BaselineModel {
  const fit = (key: 'temperature' | 'vibration' | 'current' | 'rpm'): LinearBaseline => {
    let n = 0;
    let sx = 0;
    let sy = 0;
    let sxx = 0;
    let sxy = 0;
    const pts: [number, number][] = [];
    for (const t of trajectories) {
      const base = MACHINE_TYPES[t.spec.type].baseline[key];
      for (let i = 120; i < t.length; i += 5) {
        if (t.degradation[i] > 0) break;
        const x = t.workload[i] / 100;
        const y = t[key][i] / base;
        pts.push([x, y]);
        n += 1;
        sx += x;
        sy += y;
        sxx += x * x;
        sxy += x * y;
      }
    }
    const b = (n * sxy - sx * sy) / (n * sxx - sx * sx);
    const a = (sy - b * sx) / n;
    let sse = 0;
    for (const [x, y] of pts) sse += (y - (a + b * x)) ** 2;
    return { a, b, sd: Math.sqrt(sse / Math.max(1, n - 2)) };
  };
  return { temperature: fit('temperature'), vibration: fit('vibration'), current: fit('current'), rpm: fit('rpm') };
}

export interface WindowRow {
  x: Float64Array;
  condition: number;
  mode: number;
  degradation: number;
  ttfHours: number;
  trajectory: number;
  index: number;
}

export const CRITICAL_HOURS = 8;
export const WARNING_HOURS = 36;

export function conditionFromTtf(ttfHours: number): number {
  if (ttfHours <= CRITICAL_HOURS) return 2;
  if (ttfHours <= WARNING_HOURS) return 1;
  return 0;
}

export function windowAt(t: Trajectory, i: number) {
  const from = Math.max(0, i + 1 - LONG_WINDOW);
  return {
    temperature: t.temperature.subarray(from, i + 1),
    vibration: t.vibration.subarray(from, i + 1),
    current: t.current.subarray(from, i + 1),
    rpm: t.rpm.subarray(from, i + 1),
    workload: t.workload.subarray(from, i + 1),
    hoursSinceService: t.hoursSinceService[i],
  };
}

export function extractRows(trajectories: Trajectory[], baseline: BaselineModel, modes: FailureMode[]): WindowRow[] {
  const rows: WindowRow[] = [];
  for (const t of trajectories) {
    const base = MACHINE_TYPES[t.spec.type].baseline;
    let i = LONG_WINDOW;
    while (i < t.length) {
      const ttfHours = t.ttfMinutes[i] / 60;
      const x = computeFeatures(windowAt(t, i), base, baseline);
      if (x) {
        rows.push({
          x,
          condition: conditionFromTtf(ttfHours),
          mode: t.spec.degradation ? modes.indexOf(t.spec.degradation.mode) : -1,
          degradation: t.degradation[i],
          ttfHours,
          trajectory: t.spec.id,
          index: i,
        });
      }
      i += ttfHours <= 60 ? 9 : 31;
    }
  }
  return rows;
}
