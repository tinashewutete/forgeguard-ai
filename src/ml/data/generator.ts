import { Rng } from '../rng';
import type { FailureMode, MachineType, Sample } from '../types';
import { MACHINE_TYPES } from './machines';

/**
 * Physics-inspired synthetic telemetry generator. Every value produced here is SIMULATED.
 *
 * A hidden degradation level d ∈ [0, 1] grows non-linearly (d = progress^shape) and each
 * failure mode perturbs a different, partially overlapping set of signals. Workload follows
 * shift cycles and job changes, temperature has thermal inertia, sensors drift and are noisy,
 * so a high reading is not automatically a degraded machine.
 */

export interface DegradationState {
  mode: FailureMode;
  /** 0 at onset, 1 at functional failure. */
  progress: number;
  hoursToFailure: number;
  shape: number;
}

export interface SimControls {
  /** Fixed workload in percent, or null for the automatic shift/job pattern. */
  workloadOverride: number | null;
  /** Sensor-noise multiplier (1 = nominal). */
  noise: number;
  /** Multiplier on degradation progression speed (1 = nominal). */
  degradationSpeed: number;
}

export const DEFAULT_CONTROLS: SimControls = { workloadOverride: null, noise: 1, degradationSpeed: 1 };

export interface MachineSimState {
  type: MachineType;
  rng: Rng;
  minute: number;
  thermal: number;
  jobLevel: number;
  jobRemaining: number;
  rpmSetFactor: number;
  drift: { temperature: number; vibration: number; current: number };
  hoursSinceService: number;
  degradation: DegradationState | null;
  failed: boolean;
}

export interface GroundTruth {
  degradation: number;
  mode: FailureMode | null;
  failed: boolean;
  /** Remaining simulated minutes until functional failure (Infinity when healthy). */
  ttfMinutes: number;
}

export function createSimState(type: MachineType, seed: number, hoursSinceService: number, startMinute = 0): MachineSimState {
  const base = MACHINE_TYPES[type].baseline;
  return {
    type,
    rng: new Rng(seed),
    minute: startMinute,
    thermal: base.temperature,
    jobLevel: 0,
    jobRemaining: 0,
    rpmSetFactor: 1,
    drift: { temperature: 0, vibration: 0, current: 0 },
    hoursSinceService,
    degradation: null,
    failed: false,
  };
}

export function degradationLevel(state: MachineSimState): number {
  if (state.failed) return 1;
  if (!state.degradation) return 0;
  return Math.min(1, Math.max(0, state.degradation.progress) ** state.degradation.shape);
}

export function groundTruth(state: MachineSimState, controls: SimControls = DEFAULT_CONTROLS): GroundTruth {
  const d = state.degradation;
  const ttf = state.failed ? 0 : d ? ((1 - d.progress) * d.hoursToFailure * 60) / Math.max(controls.degradationSpeed, 1e-6) : Infinity;
  return { degradation: degradationLevel(state), mode: d?.mode ?? null, failed: state.failed, ttfMinutes: ttf };
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Advance the machine by one simulated minute and return the observed sensor sample. */
export function stepMachine(state: MachineSimState, controls: SimControls = DEFAULT_CONTROLS): Sample {
  const { rng } = state;
  const base = MACHINE_TYPES[state.type].baseline;
  const noise = clamp(controls.noise, 0, 5);
  const m = state.minute;
  state.minute += 1;

  if (state.degradation && !state.failed) {
    state.degradation.progress += clamp(controls.degradationSpeed, 0, 50) / (state.degradation.hoursToFailure * 60);
    if (state.degradation.progress >= 1) {
      state.degradation.progress = 1;
      state.failed = true;
    }
  }

  const ambient = 2.5 * Math.sin((2 * Math.PI * (m - 480)) / 1440);

  if (state.failed) {
    state.thermal += (24 + ambient - state.thermal) * 0.03;
    return {
      temperature: state.thermal + rng.gauss(0, 0.2 * noise),
      vibration: Math.max(0.02, 0.05 + rng.gauss(0, 0.02)),
      current: Math.max(0, base.current * 0.04 + rng.gauss(0, 0.05)),
      rpm: 0,
      workload: 0,
      hoursSinceService: state.hoursSinceService,
    };
  }

  state.hoursSinceService += 1 / 60;

  // Workload: shift cycle + discrete jobs + small jitter.
  if (state.jobRemaining <= 0) {
    state.jobLevel = rng.gauss(0, 0.09);
    state.jobRemaining = rng.int(20, 95);
    state.rpmSetFactor = rng.range(0.9, 1.07);
  }
  state.jobRemaining -= 1;
  const w0 = base.workload / 100;
  const shift = 0.13 * Math.sin((2 * Math.PI * m) / 480) + 0.05 * Math.sin((2 * Math.PI * m) / 1440 + 1);
  const w = controls.workloadOverride !== null
    ? clamp(controls.workloadOverride / 100 + rng.gauss(0, 0.015 * noise), 0.05, 1)
    : clamp(w0 + shift + state.jobLevel + rng.gauss(0, 0.02 * noise), 0.12, 0.98);

  // Slow sensor drift (bounded random walk).
  state.drift.temperature = clamp(state.drift.temperature + rng.gauss(0, 0.01), -0.8, 0.8);
  state.drift.vibration = clamp(state.drift.vibration + rng.gauss(0, 0.0004), -0.04, 0.04);
  state.drift.current = clamp(state.drift.current + rng.gauss(0, 0.002), -0.15, 0.15);

  const d = degradationLevel(state);
  const mode = state.degradation?.mode ?? null;
  let tempAdd = 0;
  let vibAdd = base.vibration * 0.03 * Math.min(state.hoursSinceService / 2000, 1.5);
  let curMul = 1;
  let spikeProb = 0.0015;
  let curOsc = 0;
  let curSpikeProb = 0;
  let rpmJitter = 0;
  let rpmSag = 0;
  let slip = 0;

  switch (mode) {
    case 'bearing_wear':
      vibAdd += base.vibration * 2.6 * d ** 1.7;
      tempAdd += 9 * d ** 2;
      curMul += 0.08 * d ** 2;
      spikeProb += 0.07 * d ** 2;
      break;
    case 'overheating':
      tempAdd += 30 * d ** 1.5 * (0.6 + 0.6 * w);
      curMul += 0.06 * d;
      vibAdd += base.vibration * 0.12 * d;
      break;
    case 'motor_overload':
      curMul += 0.42 * d ** 1.3;
      tempAdd += 16 * d ** 1.4;
      slip += 0.035 * d;
      vibAdd += base.vibration * 0.35 * d;
      break;
    case 'electrical_anomaly':
      curOsc = 0.2 * d * base.current;
      curSpikeProb = 0.1 * d ** 1.5;
      rpmJitter += 0.012 * d;
      tempAdd += 7 * d;
      break;
    case 'rpm_instability':
      rpmJitter += 0.04 * d ** 1.3;
      rpmSag += 0.03 * d;
      vibAdd += base.vibration * 0.9 * d ** 1.5;
      break;
    default:
      break;
  }

  const thermalTarget = base.temperature + 20 * (w - w0) + ambient + tempAdd;
  state.thermal += (thermalTarget - state.thermal) * 0.06 + rng.gauss(0, 0.12 * noise);
  const temperature = state.thermal + rng.gauss(0, 0.25 * noise) + state.drift.temperature;

  let vibration = base.vibration * (0.78 + 0.45 * w) + vibAdd + state.drift.vibration * base.vibration + rng.gauss(0, 0.045 * base.vibration * noise);
  if (rng.next() < spikeProb) vibration += base.vibration * rng.range(0.8, 2.2);

  let current = base.current * (0.5 + 0.72 * w) * curMul + state.drift.current + rng.gauss(0, 0.018 * base.current * noise);
  if (curOsc > 0) current += curOsc * Math.sin(m * 1.7) * rng.range(0.5, 1);
  if (rng.next() < curSpikeProb) current += base.current * rng.range(0.15, 0.4);

  const setpoint = base.rpm * state.rpmSetFactor;
  const rpm = setpoint * (1 - 0.012 - 0.01 * (w - w0) - slip - rpmSag) + rng.gauss(0, setpoint * (0.003 * noise + rpmJitter));

  return {
    temperature,
    vibration: Math.max(0.05, vibration),
    current: Math.max(0.1, current),
    rpm: Math.max(0, rpm),
    workload: w * 100,
    hoursSinceService: state.hoursSinceService,
  };
}

export function startDegradation(state: MachineSimState, mode: FailureMode, hoursToFailure: number, progress = 0, shape?: number): void {
  state.failed = false;
  state.degradation = { mode, hoursToFailure, progress, shape: shape ?? 1.9 + state.rng.next() * 0.5 };
}

export function repairMachine(state: MachineSimState): void {
  state.degradation = null;
  state.failed = false;
  state.hoursSinceService = 0;
  state.drift = { temperature: 0, vibration: 0, current: 0 };
}
