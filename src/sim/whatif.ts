import { MACHINE_TYPES } from '../ml/data/machines';
import { computeFeatures, FALLBACK_BASELINE } from '../ml/features';
import type { TelemetryWindow } from '../ml/features';
import type { InferenceEngine, Prediction } from '../ml/inference/engine';
import { ruleBasedPrediction } from '../ml/inference/engine';
import { Rng } from '../ml/rng';
import type { MachineType } from '../ml/types';

export interface WhatIfAdjustments {
  /** Additional temperature in °C. */
  temperature: number;
  /** Vibration change in percent of current reading. */
  vibration: number;
  /** Motor current change in percent. */
  current: number;
  /** Extra RPM jitter as percent of setpoint (standard deviation). */
  rpmInstability: number;
  /** Absolute workload in percent, or null to keep the recorded workload. */
  workload: number | null;
  /** Hours since last service. */
  hoursSinceService: number;
  /** Minutes over which the change develops (ramps in) at the end of the window. */
  rampMinutes: number;
}

export const NO_CHANGE = (hoursSinceService: number): WhatIfAdjustments => ({
  temperature: 0,
  vibration: 0,
  current: 0,
  rpmInstability: 0,
  workload: null,
  hoursSinceService,
  rampMinutes: 90,
});

/**
 * Applies hypothetical changes to the most recent telemetry window and re-runs the full
 * inference pipeline. Workload changes propagate physically (load raises temperature, current
 * and vibration) so the model's load-adjustment is exercised honestly.
 */
export function applyWhatIf(win: TelemetryWindow, type: MachineType, adj: WhatIfAdjustments): TelemetryWindow {
  const base = MACHINE_TYPES[type].baseline;
  const n = win.temperature.length;
  const rng = new Rng(7919);
  const out = {
    temperature: Array.from(win.temperature),
    vibration: Array.from(win.vibration),
    current: Array.from(win.current),
    rpm: Array.from(win.rpm),
    workload: Array.from(win.workload),
    hoursSinceService: adj.hoursSinceService,
  };
  const ramp = Math.max(1, Math.min(n, Math.round(adj.rampMinutes)));
  for (let i = 0; i < n; i += 1) {
    const k = Math.min(1, Math.max(0, (i - (n - ramp)) / ramp + 1 / ramp));
    if (adj.workload !== null) {
      const dw = (adj.workload - out.workload[i]) / 100;
      out.workload[i] += dw * 100 * k;
      out.temperature[i] += 20 * dw * k;
      out.current[i] += base.current * 0.72 * dw * k;
      out.vibration[i] += base.vibration * 0.45 * dw * k;
    }
    out.temperature[i] += adj.temperature * k;
    out.vibration[i] *= 1 + (adj.vibration / 100) * k;
    out.current[i] *= 1 + (adj.current / 100) * k;
    out.rpm[i] += rng.gauss(0, (adj.rpmInstability / 100) * base.rpm * k);
  }
  return out;
}

export function runWhatIf(engine: InferenceEngine | null, win: TelemetryWindow, type: MachineType, adj: WhatIfAdjustments): Prediction | null {
  const modified = applyWhatIf(win, type, adj);
  if (engine) {
    const x = engine.features(modified, type);
    return x ? engine.analyze(x) : null;
  }
  const x = computeFeatures(modified, MACHINE_TYPES[type].baseline, FALLBACK_BASELINE);
  return x ? ruleBasedPrediction(x) : null;
}
