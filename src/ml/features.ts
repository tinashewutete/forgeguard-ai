import type { ParameterGroup, SensorBaseline } from './types';

/**
 * Time-window feature engineering. Raw readings are converted into baseline-normalised,
 * load-adjusted features that capture level, trend, volatility, rate-of-change and the
 * duration of abnormal behaviour, so the model sees trajectories rather than single points.
 */

export const SHORT_WINDOW = 30; // 30 simulated minutes
export const LONG_WINDOW = 180; // 3 simulated hours
export const MIN_WINDOW = 30;

export interface LinearBaseline {
  /** normalised value ≈ a + b · workloadFraction (fit on healthy operation). */
  a: number;
  b: number;
  /** Residual standard deviation on healthy data (normalised units). */
  sd: number;
}

export interface BaselineModel {
  temperature: LinearBaseline;
  vibration: LinearBaseline;
  current: LinearBaseline;
  rpm: LinearBaseline;
}

export interface FeatureSpec {
  key: string;
  label: string;
  group: ParameterGroup;
  description: string;
}

export const FEATURES: FeatureSpec[] = [
  { key: 'temp_dev', label: 'Temperature deviation', group: 'temperature', description: 'Mean of last 30 min vs load-adjusted healthy baseline (fraction of nominal)' },
  { key: 'temp_slope', label: 'Temperature trend', group: 'temperature', description: 'Linear slope of baseline residual over last 3 h (per hour)' },
  { key: 'temp_roc', label: 'Temperature rate of change', group: 'temperature', description: 'Last 30 min mean minus the 30 min block 2.5 h earlier' },
  { key: 'temp_dur', label: 'Temperature deviation duration', group: 'temperature', description: 'Share of last 3 h above baseline + 3σ' },
  { key: 'vib_dev', label: 'Vibration deviation', group: 'vibration', description: 'Mean of last 30 min vs load-adjusted healthy baseline' },
  { key: 'vib_slope', label: 'Vibration trend', group: 'vibration', description: 'Linear slope of vibration residual over last 3 h (per hour)' },
  { key: 'vib_vol', label: 'Vibration volatility', group: 'vibration', description: 'Rolling std of vibration over last 30 min' },
  { key: 'vib_dur', label: 'Vibration deviation duration', group: 'vibration', description: 'Share of last 3 h above baseline + 3σ' },
  { key: 'vib_spike', label: 'Vibration impulse rate', group: 'vibration', description: 'Share of last 3 h with impulsive spikes (> median + 4·MAD)' },
  { key: 'cur_dev', label: 'Motor current deviation', group: 'current', description: 'Mean of last 30 min vs load-adjusted healthy baseline' },
  { key: 'cur_slope', label: 'Motor current trend', group: 'current', description: 'Linear slope of current residual over last 3 h (per hour)' },
  { key: 'cur_vol', label: 'Motor current instability', group: 'current', description: 'Rolling std of current residual over last 30 min' },
  { key: 'cur_dur', label: 'Current deviation duration', group: 'current', description: 'Share of last 3 h above baseline + 3σ' },
  { key: 'rpm_jitter', label: 'RPM jitter', group: 'rpm', description: 'Median absolute minute-to-minute RPM change (last 30 min)' },
  { key: 'rpm_dev', label: 'RPM deviation', group: 'rpm', description: 'Mean RPM vs load-adjusted baseline (negative = sag)' },
  { key: 'rpm_jitter_trend', label: 'RPM jitter trend', group: 'rpm', description: 'Jitter now minus jitter 2.5 h earlier' },
  { key: 'load_mean', label: 'Workload level', group: 'workload', description: 'Mean workload fraction over last 30 min' },
  { key: 'load_vol', label: 'Workload variability', group: 'workload', description: 'Std of workload fraction over last 60 min' },
  { key: 'thermal_load_ratio', label: 'Temperature per unit load', group: 'temperature', description: 'Temperature deviation divided by load (load interaction)' },
  { key: 'current_per_load', label: 'Current per unit load', group: 'current', description: 'Current deviation divided by load (load interaction)' },
  { key: 'service_khrs', label: 'Hours since service', group: 'service', description: 'Operating hours since last maintenance (thousands)' },
];

export const FEATURE_KEYS = FEATURES.map((f) => f.key);

export interface TelemetryWindow {
  temperature: ArrayLike<number>;
  vibration: ArrayLike<number>;
  current: ArrayLike<number>;
  rpm: ArrayLike<number>;
  workload: ArrayLike<number>;
  hoursSinceService: number;
}

function mean(a: ArrayLike<number>, from: number, to: number): number {
  let s = 0;
  for (let i = from; i < to; i += 1) s += a[i];
  return to > from ? s / (to - from) : 0;
}

function std(a: ArrayLike<number>, from: number, to: number): number {
  const m = mean(a, from, to);
  let s = 0;
  for (let i = from; i < to; i += 1) s += (a[i] - m) ** 2;
  return to - from > 1 ? Math.sqrt(s / (to - from - 1)) : 0;
}

function slopePerHour(a: ArrayLike<number>, from: number, to: number): number {
  const n = to - from;
  if (n < 3) return 0;
  const xm = (n - 1) / 2;
  const ym = mean(a, from, to);
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i += 1) {
    num += (i - xm) * (a[from + i] - ym);
    den += (i - xm) ** 2;
  }
  return (num / den) * 60;
}

function median(values: number[]): number {
  if (!values.length) return 0;
  const s = [...values].sort((x, y) => x - y);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

function medianAbsDiff(a: ArrayLike<number>, from: number, to: number): number {
  const diffs: number[] = [];
  for (let i = Math.max(from + 1, 1); i < to; i += 1) diffs.push(Math.abs(a[i] - a[i - 1]));
  return median(diffs);
}

/** Returns null until enough history exists for a stable estimate. */
export function computeFeatures(win: TelemetryWindow, base: SensorBaseline, model: BaselineModel): Float64Array | null {
  const n = win.temperature.length;
  if (n < MIN_WINDOW) return null;
  const longFrom = Math.max(0, n - LONG_WINDOW);
  const len = n - longFrom;
  const shortFrom = n - SHORT_WINDOW;
  const earlyTo = Math.min(n, longFrom + SHORT_WINDOW);

  const w = new Float64Array(len);
  const rT = new Float64Array(len);
  const rV = new Float64Array(len);
  const rC = new Float64Array(len);
  const rR = new Float64Array(len);
  const vibNorm = new Float64Array(len);
  const rpmNorm = new Float64Array(len);
  for (let i = 0; i < len; i += 1) {
    const k = longFrom + i;
    const wf = win.workload[k] / 100;
    w[i] = wf;
    rT[i] = win.temperature[k] / base.temperature - (model.temperature.a + model.temperature.b * wf);
    rV[i] = win.vibration[k] / base.vibration - (model.vibration.a + model.vibration.b * wf);
    rC[i] = win.current[k] / base.current - (model.current.a + model.current.b * wf);
    rR[i] = win.rpm[k] / base.rpm - (model.rpm.a + model.rpm.b * wf);
    vibNorm[i] = win.vibration[k] / base.vibration;
    rpmNorm[i] = win.rpm[k] / base.rpm;
  }
  const s0 = shortFrom - longFrom;
  const e1 = earlyTo - longFrom;

  const dur = (r: Float64Array, sd: number) => {
    let c = 0;
    for (let i = 0; i < len; i += 1) if (r[i] > 3 * sd) c += 1;
    return c / len;
  };

  const vibVals = Array.from(vibNorm);
  const vibMed = median(vibVals);
  const mad = median(vibVals.map((v) => Math.abs(v - vibMed))) * 1.4826 + 1e-6;
  let spikes = 0;
  for (let i = 0; i < len; i += 1) if (vibNorm[i] > vibMed + 4 * mad) spikes += 1;

  const tempDev = mean(rT, s0, len);
  const curDev = mean(rC, s0, len);
  const loadMean = mean(w, s0, len);
  const jitterNow = medianAbsDiff(rpmNorm, s0, len);
  const jitterEarly = medianAbsDiff(rpmNorm, 0, e1);

  return Float64Array.from([
    tempDev,
    slopePerHour(rT, 0, len),
    tempDev - mean(rT, 0, e1),
    dur(rT, model.temperature.sd),
    mean(rV, s0, len),
    slopePerHour(rV, 0, len),
    std(vibNorm, s0, len),
    dur(rV, model.vibration.sd),
    spikes / len,
    curDev,
    slopePerHour(rC, 0, len),
    std(rC, s0, len),
    dur(rC, model.current.sd),
    jitterNow,
    mean(rR, s0, len),
    jitterNow - jitterEarly,
    loadMean,
    std(w, Math.max(0, len - 60), len),
    tempDev / (0.3 + loadMean),
    curDev / (0.3 + loadMean),
    win.hoursSinceService / 1000,
  ]);
}

/** Healthy-operation baseline from the reference training run; used only if the model artifact is unavailable. */
export const FALLBACK_BASELINE: BaselineModel = {
  temperature: { a: 0.7895, b: 0.3394, sd: 0.0534 },
  vibration: { a: 0.8042, b: 0.4441, sd: 0.0829 },
  current: { a: 0.4993, b: 0.7205, sd: 0.0225 },
  rpm: { a: 0.9791, b: -0.0092, sd: 0.0482 },
};
