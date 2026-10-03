import { MACHINE_TYPES } from '../data/machines';
import { computeFeatures, FEATURES } from '../features';
import type { TelemetryWindow } from '../features';
import type { ModelBundle } from '../models/bundle';
import { forestContributions, predictProba, predictRegressionTrees } from '../models/forest';
import { anomalyScore } from '../models/isolationForest';
import { quantile } from '../evaluation/metrics';
import { CONDITIONS, FAILURE_MODES } from '../types';
import type { Condition, FailureMode, MachineType, ParameterGroup, SensorBaseline } from '../types';
import { GROUP_LABEL, recommend } from './knowledge';
import type { Recommendation } from './knowledge';

export interface FeatureContribution {
  key: string;
  label: string;
  value: number;
  points: number;
}

export interface FactorContribution {
  group: ParameterGroup;
  label: string;
  /** Risk points this parameter group adds (+) or removes (−) relative to the fleet-average base risk. */
  points: number;
  evidence: string;
  features: FeatureContribution[];
}

export interface SubsystemHealth {
  vibration: number;
  thermal: number;
  electrical: number;
  rotational: number;
  load: number;
}

export interface Prediction {
  source: 'model' | 'rules';
  risk: number;
  condition: Condition;
  probabilities: Record<Condition, number>;
  confidence: number;
  anomalyScore: number;
  anomalous: boolean;
  health: number;
  subsystems: SubsystemHealth;
  failureMode: FailureMode | null;
  modeProbabilities: { mode: FailureMode; p: number }[];
  /** Estimated hours until the machine reaches functional failure (model estimate, not validated RUL). */
  ttf: { hours: number; low: number; high: number } | null;
  baseRisk: number;
  factors: FactorContribution[];
  recommendation: Recommendation;
  features: Record<string, number>;
}

const clamp = (v: number, lo = 0, hi = 100) => Math.min(hi, Math.max(lo, v));

export function conditionFor(risk: number, t: { warning: number; critical: number } = { warning: 40, critical: 70 }): Condition {
  if (risk >= t.critical) return 'critical';
  if (risk >= t.warning) return 'warning';
  return 'normal';
}

/** Rule-based condition indices from engineered features (independent of the ML model). */
export function subsystemHealth(f: Record<string, number>): SubsystemHealth {
  return {
    vibration: clamp(100 - Math.max(0, f.vib_dev) * 110 - f.vib_spike * 250 - f.vib_dur * 25),
    thermal: clamp(100 - Math.max(0, f.temp_dev) * 230 - f.temp_dur * 25 - Math.max(0, f.temp_slope) * 150),
    electrical: clamp(100 - Math.max(0, f.cur_dev) * 170 - Math.max(0, f.cur_vol - 0.03) * 450 - f.cur_dur * 25),
    rotational: clamp(100 - Math.max(0, f.rpm_jitter - 0.006) * 2200 - Math.max(0, -f.rpm_dev - 0.01) * 700),
    load: clamp(100 - Math.max(0, f.load_mean - 0.78) * 250 - Math.max(0, f.service_khrs - 1.5) * 12),
  };
}

function overallHealth(s: SubsystemHealth, anomaly: number, threshold: number): number {
  const weakest = Math.min(s.vibration, s.thermal, s.electrical, s.rotational);
  const avg = 0.26 * s.vibration + 0.22 * s.thermal + 0.22 * s.electrical + 0.18 * s.rotational + 0.12 * s.load;
  const anomalyPenalty = Math.max(0, anomaly - threshold) * 120;
  return clamp(0.65 * avg + 0.35 * weakest - anomalyPenalty);
}

const pct = (v: number) => `${v >= 0 ? '+' : ''}${(v * 100).toFixed(0)}%`;

function evidence(group: ParameterGroup, f: Record<string, number>): string {
  switch (group) {
    case 'vibration':
      return `${pct(f.vib_dev)} vs load-adjusted baseline · trend ${pct(f.vib_slope)}/h · ${(f.vib_dur * 100).toFixed(0)}% of last 3 h abnormal`;
    case 'temperature':
      return `${pct(f.temp_dev)} vs baseline · trend ${pct(f.temp_slope)}/h · ${(f.temp_dur * 100).toFixed(0)}% of last 3 h above 3σ`;
    case 'current':
      return `${pct(f.cur_dev)} vs baseline · instability ${(f.cur_vol * 100).toFixed(1)}% · ${(f.cur_dur * 100).toFixed(0)}% of last 3 h abnormal`;
    case 'rpm':
      return `jitter ${(f.rpm_jitter * 100).toFixed(2)}% per min (${f.rpm_jitter_trend >= 0 ? 'rising' : 'falling'}) · speed ${pct(f.rpm_dev)} vs setpoint model`;
    case 'workload':
      return `average load ${(f.load_mean * 100).toFixed(0)}% · variability ${(f.load_vol * 100).toFixed(1)}%`;
    case 'service':
      return `${Math.round(f.service_khrs * 1000)} h since last service`;
    default:
      return '';
  }
}

export class InferenceEngine {
  readonly bundle: ModelBundle;
  private readonly riskScore: (v: number[]) => number;

  constructor(bundle: ModelBundle) {
    this.bundle = bundle;
    const w = bundle.riskWeights;
    this.riskScore = (v) => v.reduce((a, p, i) => a + p * w[i], 0);
  }

  features(win: TelemetryWindow, type: MachineType): Float64Array | null {
    return computeFeatures(win, MACHINE_TYPES[type].baseline, this.bundle.baseline);
  }

  /** Fast path used for every simulation tick. */
  quickRisk(x: Float64Array): number {
    return clamp(this.riskScore(predictProba(this.bundle.riskForest, x)));
  }

  analyze(x: Float64Array): Prediction {
    try {
      return this.analyzeModel(x);
    } catch (err) {
      console.error('[ForgeGuard] model inference failed, using rule-based fallback', err);
      return ruleBasedPrediction(x);
    }
  }

  private analyzeModel(x: Float64Array): Prediction {
    const b = this.bundle;
    const probs = predictProba(b.riskForest, x);
    const risk = clamp(this.riskScore(probs));
    const condition = conditionFor(risk, b.thresholds);
    const entropy = -probs.reduce((a, p) => a + (p > 0 ? p * Math.log(p) : 0), 0) / Math.log(probs.length);
    const confidence = clamp(100 * (0.6 * Math.max(...probs) + 0.4 * (1 - entropy)), 35, 99);

    const aScore = anomalyScore(b.isolation, x);
    const anomalous = aScore > b.isolation.threshold;
    const f = featureRecord(x);
    const subsystems = subsystemHealth(f);
    const health = overallHealth(subsystems, aScore, b.isolation.threshold);

    const modeP = predictProba(b.modeForest, x);
    const modeProbabilities = FAILURE_MODES.map((mode, i) => ({ mode, p: modeP[i] })).sort((a, c) => c.p - a.p);
    const failureMode = risk >= b.thresholds.warning || anomalous ? modeProbabilities[0].mode : null;

    let ttf: Prediction['ttf'] = null;
    if (risk >= b.thresholds.warning) {
      const trees = predictRegressionTrees(b.ttfForest, x).map((v) => Math.expm1(v));
      ttf = { hours: quantile(trees, 0.5), low: quantile(trees, 0.1) * 0.8, high: quantile(trees, 0.9) * 1.25 };
    }

    const { bias, contributions } = forestContributions(b.riskForest, x, FEATURES.length, this.riskScore);
    const byGroup = new Map<ParameterGroup, FactorContribution>();
    FEATURES.forEach((spec, i) => {
      const g = byGroup.get(spec.group) ?? { group: spec.group, label: GROUP_LABEL[spec.group], points: 0, evidence: evidence(spec.group, f), features: [] };
      g.points += contributions[i];
      g.features.push({ key: spec.key, label: spec.label, value: x[i], points: contributions[i] });
      byGroup.set(spec.group, g);
    });
    const factors = [...byGroup.values()]
      .map((g) => ({ ...g, features: g.features.sort((a, c) => Math.abs(c.points) - Math.abs(a.points)) }))
      .sort((a, c) => c.points - a.points);

    return {
      source: 'model',
      risk,
      condition,
      probabilities: { normal: probs[0], warning: probs[1], critical: probs[2] },
      confidence,
      anomalyScore: aScore,
      anomalous,
      health,
      subsystems,
      failureMode,
      modeProbabilities,
      ttf,
      baseRisk: bias,
      factors,
      recommendation: recommend(condition, failureMode, ttf?.hours ?? null, anomalous),
      features: f,
    };
  }
}

export function featureRecord(x: ArrayLike<number>): Record<string, number> {
  const f: Record<string, number> = {};
  FEATURES.forEach((spec, i) => {
    f[spec.key] = x[i];
  });
  return f;
}

/** Deterministic fallback used only if the model artifact cannot be loaded or evaluated. */
export function ruleBasedPrediction(x: ArrayLike<number>): Prediction {
  const f = featureRecord(x);
  const subsystems = subsystemHealth(f);
  const entries: [FailureMode, number][] = [
    ['bearing_wear', subsystems.vibration],
    ['overheating', subsystems.thermal],
    ['electrical_anomaly', subsystems.electrical],
    ['rpm_instability', subsystems.rotational],
    ['motor_overload', Math.min(subsystems.electrical + 10, subsystems.thermal + 10)],
  ];
  entries.sort((a, b) => a[1] - b[1]);
  const health = overallHealth(subsystems, 0, 1);
  const risk = clamp(100 - entries[0][1] * 0.9 - health * 0.1);
  const condition = conditionFor(risk);
  const groups: ParameterGroup[] = ['vibration', 'temperature', 'current', 'rpm', 'workload', 'service'];
  const sub: Record<ParameterGroup, number> = { vibration: subsystems.vibration, temperature: subsystems.thermal, current: subsystems.electrical, rpm: subsystems.rotational, workload: subsystems.load, service: subsystems.load };
  return {
    source: 'rules',
    risk,
    condition,
    probabilities: { normal: condition === 'normal' ? 1 : 0, warning: condition === 'warning' ? 1 : 0, critical: condition === 'critical' ? 1 : 0 },
    confidence: 50,
    anomalyScore: 0,
    anomalous: false,
    health,
    subsystems,
    failureMode: condition === 'normal' ? null : entries[0][0],
    modeProbabilities: entries.map(([mode, h]) => ({ mode, p: (100 - h) / 100 })),
    ttf: null,
    baseRisk: 0,
    factors: groups.map((g) => ({ group: g, label: GROUP_LABEL[g], points: (100 - sub[g]) / 5, evidence: evidence(g, f), features: [] })).sort((a, b) => b.points - a.points),
    recommendation: recommend(condition, condition === 'normal' ? null : entries[0][0], null, false),
    features: f,
  };
}

export { CONDITIONS };
