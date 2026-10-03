import { describe, expect, it } from 'vitest';
import { Rng } from '../ml/rng';
import { MACHINE_TYPES } from '../ml/data/machines';
import { createSimState, startDegradation, stepMachine } from '../ml/data/generator';
import type { MachineSimState } from '../ml/data/generator';
import { computeFeatures, FALLBACK_BASELINE, FEATURE_KEYS } from '../ml/features';
import type { TelemetryWindow } from '../ml/features';
import { ruleBasedPrediction } from '../ml/inference/engine';
import { applyWhatIf, NO_CHANGE, runWhatIf } from '../sim/whatif';
import { engine, loadBundle } from './helpers';

interface Recorded { temperature: number[]; vibration: number[]; current: number[]; rpm: number[]; workload: number[]; hoursSinceService: number }

function record(state: MachineSimState, minutes: number): Recorded {
  const w = { temperature: [] as number[], vibration: [] as number[], current: [] as number[], rpm: [] as number[], workload: [] as number[], hoursSinceService: 0 };
  for (let i = 0; i < minutes; i += 1) {
    const s = stepMachine(state);
    w.temperature.push(s.temperature);
    w.vibration.push(s.vibration);
    w.current.push(s.current);
    w.rpm.push(s.rpm);
    w.workload.push(s.workload);
  }
  w.hoursSinceService = state.hoursSinceService;
  return w;
}

function last(win: Recorded, n = 180): TelemetryWindow {
  const from = Math.max(0, win.temperature.length - n);
  return { temperature: win.temperature.slice(from), vibration: win.vibration.slice(from), current: win.current.slice(from), rpm: win.rpm.slice(from), workload: win.workload.slice(from), hoursSinceService: win.hoursSinceService };
}

describe('Rng', () => {
  it('is deterministic for a seed', () => {
    const a = new Rng(42);
    const b = new Rng(42);
    expect(Array.from({ length: 5 }, () => a.next())).toEqual(Array.from({ length: 5 }, () => b.next()));
    expect(new Rng(1).next()).not.toBe(new Rng(2).next());
  });
});

describe('generator', () => {
  it('reproduces identical telemetry from the same seed', () => {
    const a = record(createSimState('cnc', 7, 100), 60);
    const b = record(createSimState('cnc', 7, 100), 60);
    expect(a.vibration).toEqual(b.vibration);
  });

  it('bearing wear raises vibration over time and eventually fails', () => {
    const s = createSimState('cnc', 11, 100);
    const healthy = record(s, 180);
    startDegradation(s, 'bearing_wear', 10, 0, 2);
    let late: Recorded = healthy;
    for (let h = 0; h < 12 && !s.failed; h += 1) late = record(s, 60);
    const mean = (v: number[]) => v.reduce((a, b) => a + b, 0) / v.length;
    expect(mean(late.vibration)).toBeGreaterThan(mean(healthy.vibration) * 1.3);
    expect(s.failed).toBe(true);
  });
});

describe('features', () => {
  it('needs at least 30 samples', () => {
    const w = record(createSimState('motor', 3, 50), 20);
    expect(computeFeatures(w, MACHINE_TYPES.motor.baseline, FALLBACK_BASELINE)).toBeNull();
  });

  it('produces one finite value per feature', () => {
    const w = record(createSimState('printer', 3, 50), 180);
    const x = computeFeatures(w, MACHINE_TYPES.printer.baseline, loadBundle().baseline)!;
    expect(x).toHaveLength(FEATURE_KEYS.length);
    expect(Array.from(x).every(Number.isFinite)).toBe(true);
  });
});

describe('inference', () => {
  const eng = engine();

  it('scores a healthy machine as normal and a near-failure machine as critical bearing wear', () => {
    const healthy = createSimState('cnc', 21, 120);
    const hw = last(record(healthy, 240));
    const hp = eng.analyze(eng.features(hw, 'cnc')!);
    expect(hp.source).toBe('model');
    expect(hp.risk).toBeLessThan(40);
    expect(hp.condition).toBe('normal');
    expect(hp.health).toBeGreaterThan(70);

    const sick = createSimState('cnc', 22, 120);
    record(sick, 180);
    startDegradation(sick, 'bearing_wear', 30, 0.9, 2);
    const sw = last(record(sick, 180));
    const sp = eng.analyze(eng.features(sw, 'cnc')!);
    expect(sp.risk).toBeGreaterThanOrEqual(70);
    expect(sp.condition).toBe('critical');
    expect(sp.failureMode).toBe('bearing_wear');
    expect(sp.ttf).not.toBeNull();
    expect(sp.ttf!.low).toBeLessThanOrEqual(sp.ttf!.hours);
    expect(sp.factors[0].group).toBe('vibration');
    expect(sp.recommendation.urgency === 'urgent' || sp.recommendation.urgency === 'stop').toBe(true);
  });

  it('explanation points add up to the predicted risk', () => {
    const s = createSimState('motor', 31, 200);
    record(s, 120);
    startDegradation(s, 'electrical_anomaly', 40, 0.7, 2);
    const p = eng.analyze(eng.features(last(record(s, 180)), 'motor')!);
    const total = p.baseRisk + p.factors.reduce((a, f) => a + f.points, 0);
    expect(total).toBeCloseTo(p.risk, 0);
  });

  it('rule-based fallback returns a valid prediction', () => {
    const w = last(record(createSimState('lathe', 5, 100), 180));
    const p = ruleBasedPrediction(computeFeatures(w, MACHINE_TYPES.lathe.baseline, FALLBACK_BASELINE)!);
    expect(p.source).toBe('rules');
    expect(p.risk).toBeGreaterThanOrEqual(0);
    expect(p.risk).toBeLessThanOrEqual(100);
  });
});

describe('what-if', () => {
  const eng = engine();
  const w = last(record(createSimState('cnc', 41, 150), 240));

  it('no change reproduces the baseline window', () => {
    const out = applyWhatIf(w, 'cnc', NO_CHANGE(w.hoursSinceService));
    expect(out.vibration).toEqual(Array.from(w.vibration));
  });

  it('a large vibration increase raises risk and flags vibration', () => {
    const base = runWhatIf(eng, w, 'cnc', NO_CHANGE(w.hoursSinceService))!;
    const worse = runWhatIf(eng, w, 'cnc', { ...NO_CHANGE(w.hoursSinceService), vibration: 150, temperature: 6 })!;
    expect(worse.risk).toBeGreaterThan(base.risk + 15);
    expect(worse.factors[0].group).toBe('vibration');
  });

  it('a heavier job alone is not treated as critical (load-adjusted baseline)', () => {
    const heavy = runWhatIf(eng, w, 'cnc', { ...NO_CHANGE(w.hoursSinceService), workload: 95 })!;
    expect(heavy.condition).not.toBe('critical');
  });

  it('falls back to rules without a model', () => {
    expect(runWhatIf(null, w, 'cnc', NO_CHANGE(w.hoursSinceService))?.source).toBe('rules');
  });
});
