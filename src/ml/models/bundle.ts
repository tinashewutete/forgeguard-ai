import type { BaselineModel } from '../features';
import type { SerializedForest } from './forest';
import type { SerializedIsolationForest } from './isolationForest';

export interface ClassReport {
  label: string;
  precision: number;
  recall: number;
  f1: number;
  support: number;
}

export interface EvaluationReport {
  dataset: {
    synthetic: true;
    trajectories: { train: number; validation: number; test: number };
    windows: { train: number; validation: number; test: number };
    healthyTrajectories: number;
    failingTrajectories: number;
    simulatedHours: number;
    classBalance: Record<string, number>;
  };
  risk: {
    accuracy: number;
    macroF1: number;
    perClass: ClassReport[];
    confusion: number[][];
    rocAucAtRisk: number;
    rocAucCritical: number;
    selectedMaxDepth: number;
    validationMacroF1: Record<string, number>;
  };
  anomaly: { threshold: number; falsePositiveRateHealthy: number; detectionRateCritical: number; detectionRateWarning: number };
  failureMode: { accuracy: number; macroF1: number; confusion: number[][]; labels: string[] };
  timeToFailure: { maeHours: number; medianAbsErrorHours: number; intervalCoverage: number; evaluatedWindows: number };
  leadTime: { failuresDetected: number; failuresTotal: number; meanWarningLeadHours: number; medianWarningLeadHours: number; meanCriticalLeadHours: number; falseAlarmsPer1000h: number };
  permutationImportance: { key: string; importance: number }[];
  trainingSeconds: number;
}

export interface ModelBundle {
  name: string;
  version: string;
  createdAt: string;
  seed: number;
  featureKeys: string[];
  baseline: BaselineModel;
  thresholds: { warning: number; critical: number };
  horizons: { criticalHours: number; warningHours: number };
  /** Risk = Σ P(class) · weight; normal 0, warning 55, critical 100. */
  riskWeights: number[];
  riskForest: SerializedForest;
  modeForest: SerializedForest;
  ttfForest: SerializedForest;
  isolation: SerializedIsolationForest;
  metrics: EvaluationReport;
}
