import { FEATURE_KEYS } from '../features';
import { accuracy, classReports, confusionMatrix, macroF1, quantile, rocAuc } from '../evaluation/metrics';
import type { EvaluationReport, ModelBundle } from '../models/bundle';
import { predictProba, predictRegressionTrees, trainForestClassifier, trainForestRegressor } from '../models/forest';
import type { ForestParams, SerializedForest } from '../models/forest';
import { anomalyScore, trainIsolationForest } from '../models/isolationForest';
import { binFeatures } from '../models/tree';
import { CONDITIONS, FAILURE_MODES } from '../types';
import { CRITICAL_HOURS, extractRows, fitBaseline, generateSpecs, simulateTrajectory, WARNING_HOURS, windowAt } from './dataset';
import type { Trajectory, WindowRow } from './dataset';
import { computeFeatures } from '../features';
import { MACHINE_TYPES } from '../data/machines';

export const MODEL_VERSION = '2.0.0';
export const RISK_WEIGHTS = [0, 55, 100];
export const RISK_THRESHOLDS = { warning: 40, critical: 70 };

export interface TrainConfig {
  seed: number;
  trajectories: number;
  riskTrees: number;
  auxTrees: number;
  depthGrid: number[];
}

export const DEFAULT_TRAIN_CONFIG: TrainConfig = { seed: 20261002, trajectories: 240, riskTrees: 48, auxTrees: 32, depthGrid: [7, 10] };

export type ProgressFn = (stage: string, fraction: number) => void;

export function riskFromProba(p: number[]): number {
  return p.reduce((a, v, i) => a + v * RISK_WEIGHTS[i], 0);
}

export function conditionIndex(risk: number): number {
  if (risk >= RISK_THRESHOLDS.critical) return 2;
  if (risk >= RISK_THRESHOLDS.warning) return 1;
  return 0;
}

function split<T>(items: T[]): { train: T[]; validation: T[]; test: T[] } {
  const train: T[] = [];
  const validation: T[] = [];
  const test: T[] = [];
  items.forEach((item, i) => {
    const r = i % 10;
    if (r < 7) train.push(item);
    else if (r < 8.5) validation.push(item);
    else test.push(item);
  });
  return { train, validation, test };
}

const range = (n: number) => Uint32Array.from({ length: n }, (_, i) => i);

function evalRisk(forest: SerializedForest, rows: WindowRow[]) {
  const pred = rows.map((r) => conditionIndex(riskFromProba(predictProba(forest, r.x))));
  const confusion = confusionMatrix(rows.map((r) => r.condition), pred, 3);
  const reports = classReports(confusion, CONDITIONS);
  return { confusion, reports, macro: macroF1(reports), acc: accuracy(confusion) };
}

/** Full offline pipeline: simulate → split by trajectory → features → train → evaluate. */
export function trainPipeline(config: TrainConfig = DEFAULT_TRAIN_CONFIG, progress: ProgressFn = () => {}): ModelBundle {
  const t0 = Date.now();
  progress('Simulating machine trajectories', 0);
  const specs = generateSpecs(config.trajectories, config.seed);
  const trajectories: Trajectory[] = specs.map((s, i) => {
    if (i % 20 === 0) progress('Simulating machine trajectories', i / specs.length);
    return simulateTrajectory(s);
  });
  // Split by trajectory (not by window) to avoid temporal leakage between train and test.
  const sets = split(trajectories);
  progress('Fitting healthy baselines', 0);
  const baseline = fitBaseline(sets.train);

  progress('Engineering time-window features', 0);
  const trainRows = extractRows(sets.train, baseline, FAILURE_MODES);
  const valRows = extractRows(sets.validation, baseline, FAILURE_MODES);
  const testRows = extractRows(sets.test, baseline, FAILURE_MODES);
  const nF = FEATURE_KEYS.length;
  const binned = binFeatures(trainRows.map((r) => r.x), nF);
  const yCond = Int32Array.from(trainRows.map((r) => r.condition));
  const mtry = Math.max(4, Math.round(Math.sqrt(nF)) + 1);

  // Hyperparameter selection on the validation split.
  const validationMacroF1: Record<string, number> = {};
  let bestDepth = config.depthGrid[0];
  let bestScore = -1;
  let riskForest: SerializedForest | null = null;
  config.depthGrid.forEach((depth, gi) => {
    progress(`Training risk forest (depth ${depth})`, gi / config.depthGrid.length);
    const params: ForestParams = { nTrees: config.riskTrees, sampleRate: 0.7, maxDepth: depth, minLeaf: 12, mtry };
    const forest = trainForestClassifier(binned, yCond, CONDITIONS, range(trainRows.length), params, config.seed + depth);
    const score = evalRisk(forest, valRows).macro;
    validationMacroF1[String(depth)] = score;
    if (score > bestScore) {
      bestScore = score;
      bestDepth = depth;
      riskForest = forest;
    }
  });
  if (!riskForest) throw new Error('risk forest training failed');
  const risk: SerializedForest = riskForest;

  progress('Training failure-mode classifier', 0);
  const modeRows = range(trainRows.length).filter((i) => trainRows[i].mode >= 0 && trainRows[i].degradation >= 0.12);
  const yMode = Int32Array.from(trainRows.map((r) => Math.max(0, r.mode)));
  const modeForest = trainForestClassifier(binned, yMode, FAILURE_MODES, Uint32Array.from(modeRows), { nTrees: config.auxTrees, sampleRate: 0.8, maxDepth: 9, minLeaf: 8, mtry }, config.seed + 101);

  progress('Training time-to-failure regressor', 0);
  const ttfRows = range(trainRows.length).filter((i) => trainRows[i].ttfHours <= 72 && trainRows[i].degradation > 0);
  const yTtf = Float64Array.from(trainRows.map((r) => (Number.isFinite(r.ttfHours) ? Math.log1p(Math.min(r.ttfHours, 200)) : Math.log1p(200))));
  const ttfForest = trainForestRegressor(binned, yTtf, Uint32Array.from(ttfRows), { nTrees: config.auxTrees, sampleRate: 0.7, maxDepth: 9, minLeaf: 10, mtry }, config.seed + 202);

  progress('Training isolation forest on healthy windows', 0);
  const healthyTrain = trainRows.filter((r) => r.degradation === 0).map((r) => r.x);
  const isolation = trainIsolationForest(healthyTrain, 100, 256, config.seed + 303);
  const healthyValScores = valRows.filter((r) => r.degradation === 0).map((r) => anomalyScore(isolation, r.x));
  isolation.threshold = Math.round(quantile(healthyValScores, 0.99) * 1e4) / 1e4;

  progress('Evaluating on held-out test machines', 0);
  const riskEval = evalRisk(risk, testRows);
  const testRisk = testRows.map((r) => riskFromProba(predictProba(risk, r.x)));
  const rocAucAtRisk = rocAuc(testRows.map((r) => (r.condition >= 1 ? 1 : 0)), testRisk);
  const rocAucCritical = rocAuc(testRows.map((r) => (r.condition === 2 ? 1 : 0)), testRisk);

  const anomalyRate = (rows: WindowRow[]) => (rows.length ? rows.filter((r) => anomalyScore(isolation, r.x) > isolation.threshold).length / rows.length : 0);

  const modeTest = testRows.filter((r) => r.mode >= 0 && r.degradation >= 0.12);
  const modePred = modeTest.map((r) => argmax(predictProba(modeForest, r.x)));
  const modeConfusion = confusionMatrix(modeTest.map((r) => r.mode), modePred, FAILURE_MODES.length);
  const modeReports = classReports(modeConfusion, FAILURE_MODES);

  const ttfTest = testRows.filter((r) => r.ttfHours <= 72 && r.degradation > 0);
  const errors: number[] = [];
  let covered = 0;
  for (const r of ttfTest) {
    const trees = predictRegressionTrees(ttfForest, r.x).map((v) => Math.expm1(v));
    const est = quantile(trees, 0.5);
    errors.push(Math.abs(est - r.ttfHours));
    if (r.ttfHours >= quantile(trees, 0.1) * 0.8 && r.ttfHours <= quantile(trees, 0.9) * 1.25) covered += 1;
  }

  progress('Measuring alert lead time', 0);
  const lead = leadTimeStudy(sets.test, baseline, risk);

  progress('Permutation feature importance', 0);
  const permutationImportance = permutationStudy(risk, testRows, riskEval.macro, config.seed);

  const classBalance: Record<string, number> = {};
  CONDITIONS.forEach((c, i) => {
    classBalance[c] = trainRows.filter((r) => r.condition === i).length;
  });
  const simulatedHours = Math.round(trajectories.reduce((a, t) => a + t.length, 0) / 60);

  const metrics: EvaluationReport = {
    dataset: {
      synthetic: true,
      trajectories: { train: sets.train.length, validation: sets.validation.length, test: sets.test.length },
      windows: { train: trainRows.length, validation: valRows.length, test: testRows.length },
      healthyTrajectories: specs.filter((s) => !s.degradation).length,
      failingTrajectories: specs.filter((s) => s.degradation).length,
      simulatedHours,
      classBalance,
    },
    risk: {
      accuracy: riskEval.acc,
      macroF1: riskEval.macro,
      perClass: riskEval.reports,
      confusion: riskEval.confusion,
      rocAucAtRisk,
      rocAucCritical,
      selectedMaxDepth: bestDepth,
      validationMacroF1,
    },
    anomaly: {
      threshold: isolation.threshold,
      falsePositiveRateHealthy: anomalyRate(testRows.filter((r) => r.degradation === 0)),
      detectionRateCritical: anomalyRate(testRows.filter((r) => r.condition === 2)),
      detectionRateWarning: anomalyRate(testRows.filter((r) => r.condition === 1)),
    },
    failureMode: { accuracy: accuracy(modeConfusion), macroF1: macroF1(modeReports.filter((r) => r.support > 0)), confusion: modeConfusion, labels: FAILURE_MODES },
    timeToFailure: { maeHours: errors.reduce((a, b) => a + b, 0) / Math.max(1, errors.length), medianAbsErrorHours: quantile(errors, 0.5), intervalCoverage: covered / Math.max(1, ttfTest.length), evaluatedWindows: ttfTest.length },
    leadTime: lead,
    permutationImportance,
    trainingSeconds: (Date.now() - t0) / 1000,
  };

  progress('Done', 1);
  return {
    name: 'ForgeGuard Degradation Ensemble',
    version: MODEL_VERSION,
    createdAt: new Date().toISOString(),
    seed: config.seed,
    featureKeys: FEATURE_KEYS,
    baseline,
    thresholds: RISK_THRESHOLDS,
    horizons: { criticalHours: CRITICAL_HOURS, warningHours: WARNING_HOURS },
    riskWeights: RISK_WEIGHTS,
    riskForest: risk,
    modeForest,
    ttfForest,
    isolation,
    metrics,
  };
}

export function argmax(v: number[]): number {
  let best = 0;
  for (let i = 1; i < v.length; i += 1) if (v[i] > v[best]) best = i;
  return best;
}

/** Replay held-out machines window-by-window, as the live system would, with 3-window alert debouncing. */
function leadTimeStudy(trajectories: Trajectory[], baseline: ModelBundle['baseline'], forest: SerializedForest): EvaluationReport['leadTime'] {
  const warnLeads: number[] = [];
  const critLeads: number[] = [];
  let failuresTotal = 0;
  let falseAlarms = 0;
  let healthyHours = 0;
  for (const t of trajectories) {
    const base = MACHINE_TYPES[t.spec.type].baseline;
    let warnStreak = 0;
    let critStreak = 0;
    let warned = false;
    let crit = false;
    let inAlarm = false;
    const step = 10;
    if (t.spec.degradation) failuresTotal += 1;
    for (let i = 180; i < t.length; i += step) {
      const x = computeFeatures(windowAt(t, i), base, baseline);
      if (!x) continue;
      const r = riskFromProba(predictProba(forest, x));
      warnStreak = r >= RISK_THRESHOLDS.warning ? warnStreak + 1 : 0;
      critStreak = r >= RISK_THRESHOLDS.critical ? critStreak + 1 : 0;
      const ttfH = t.ttfMinutes[i] / 60;
      if (!t.spec.degradation) {
        healthyHours += step / 60;
        if (warnStreak >= 3 && !inAlarm) {
          falseAlarms += 1;
          inAlarm = true;
        }
        if (warnStreak === 0) inAlarm = false;
        continue;
      }
      if (!warned && warnStreak >= 3) {
        warned = true;
        warnLeads.push(ttfH);
      }
      if (!crit && critStreak >= 3) {
        crit = true;
        critLeads.push(ttfH);
      }
    }
  }
  const mean = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
  return {
    failuresDetected: warnLeads.length,
    failuresTotal,
    meanWarningLeadHours: mean(warnLeads),
    medianWarningLeadHours: quantile(warnLeads, 0.5),
    meanCriticalLeadHours: mean(critLeads),
    falseAlarmsPer1000h: healthyHours ? (falseAlarms / healthyHours) * 1000 : 0,
  };
}

function permutationStudy(forest: SerializedForest, rows: WindowRow[], baselineF1: number, seed: number): { key: string; importance: number }[] {
  const sample = rows.filter((_, i) => i % 2 === 0);
  const base = evalRisk(forest, sample).macro || baselineF1;
  let s = seed >>> 0;
  const rand = () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
  return FEATURE_KEYS.map((key, f) => {
    const perm = sample.map((r) => r.x[f]);
    for (let i = perm.length - 1; i > 0; i -= 1) {
      const j = Math.floor(rand() * (i + 1));
      [perm[i], perm[j]] = [perm[j], perm[i]];
    }
    const shuffled = sample.map((r, i) => {
      const x = Float64Array.from(r.x);
      x[f] = perm[i];
      return { ...r, x };
    });
    return { key, importance: Math.max(0, base - evalRisk(forest, shuffled).macro) };
  }).sort((a, b) => b.importance - a.importance);
}
