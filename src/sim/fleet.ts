import { FLEET, MACHINE_TYPES } from '../ml/data/machines';
import type { MachineDefinition } from '../ml/data/machines';
import { createSimState, DEFAULT_CONTROLS, groundTruth, repairMachine, startDegradation, stepMachine } from '../ml/data/generator';
import type { MachineSimState, SimControls } from '../ml/data/generator';
import { computeFeatures, FALLBACK_BASELINE, LONG_WINDOW } from '../ml/features';
import type { TelemetryWindow } from '../ml/features';
import type { InferenceEngine, Prediction } from '../ml/inference/engine';
import { ruleBasedPrediction } from '../ml/inference/engine';
import { recommend } from '../ml/inference/knowledge';
import type { Condition, FailureMode, Sample } from '../ml/types';

export const HISTORY_MINUTES = 1440;
export const WARMUP_HOURS = 12;
export const RISK_SAMPLE_EVERY = 5;
export const TICK_MS = 250;
const ALERT_DEBOUNCE = 3;

export interface SeriesBuffer {
  minute: number[];
  temperature: number[];
  vibration: number[];
  current: number[];
  rpm: number[];
  workload: number[];
}

export interface RiskPoint {
  minute: number;
  risk: number;
  health: number;
}

export type MachineStatus = 'running' | 'maintenance' | 'failed';

export interface MachineRuntime {
  def: MachineDefinition;
  sim: MachineSimState;
  controls: SimControls;
  series: SeriesBuffer;
  riskHistory: RiskPoint[];
  prediction: Prediction | null;
  latest: Sample | null;
  status: MachineStatus;
  operatingHours: number;
  lastServiceMinute: number | null;
  /** Debounced condition that has already raised an alert (0 none, 1 warning, 2 critical). */
  alertedLevel: number;
  levelStreak: { level: number; count: number };
  failedAtMinute: number | null;
  /** Feature windows only use samples recorded at or after this minute (reset on recommissioning). */
  windowStartMinute: number;
}

export interface AlertDraft {
  machine: MachineRuntime;
  severity: 'warning' | 'critical';
  prediction: Prediction;
  trendPerHour: number;
  minute: number;
}

export interface FleetEvents {
  onAlert?: (draft: AlertDraft) => void;
  onFailure?: (machine: MachineRuntime, minute: number) => void;
}

const LEVEL: Record<Condition, number> = { normal: 0, warning: 1, critical: 2 };

function emptySeries(): SeriesBuffer {
  return { minute: [], temperature: [], vibration: [], current: [], rpm: [], workload: [] };
}

function failedPrediction(base: Prediction | null, mode: FailureMode | null): Prediction {
  const p = base ?? ruleBasedPrediction(new Float64Array(21));
  return {
    ...p,
    risk: 100,
    condition: 'critical',
    probabilities: { normal: 0, warning: 0, critical: 1 },
    confidence: 99,
    health: 0,
    ttf: { hours: 0, low: 0, high: 0 },
    failureMode: mode ?? p.failureMode,
    recommendation: {
      ...recommend('critical', mode ?? p.failureMode ?? 'bearing_wear', 0, true),
      headline: 'Machine down — unplanned failure',
      urgency: 'stop',
      window: 'Now — production stopped',
    },
  };
}

export class FleetEngine {
  readonly machines: MachineRuntime[];
  minute = 0;
  readonly epoch: number;
  speed = 1;
  running = true;
  version = 0;
  private listeners = new Set<() => void>();
  private events: FleetEvents = {};
  private inference: InferenceEngine | null;

  constructor(inference: InferenceEngine | null, epoch = Date.now(), fleet: MachineDefinition[] = FLEET) {
    this.inference = inference;
    this.epoch = epoch - WARMUP_HOURS * 3600_000;
    this.machines = fleet.map((def) => ({
      def,
      sim: createSimState(def.type, def.seed, Math.max(0, def.hoursSinceService - WARMUP_HOURS)),
      controls: { ...DEFAULT_CONTROLS },
      series: emptySeries(),
      riskHistory: [],
      prediction: null,
      latest: null,
      status: 'running',
      operatingHours: def.operatingHours - WARMUP_HOURS,
      lastServiceMinute: null,
      alertedLevel: 0,
      levelStreak: { level: 0, count: 0 },
      failedAtMinute: null,
      windowStartMinute: 0,
    }));
    this.warmUp();
  }

  setEvents(events: FleetEvents) {
    this.events = events;
  }

  get modelAvailable(): boolean {
    return this.inference !== null;
  }

  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  };

  getVersion = () => this.version;

  emit() {
    this.version += 1;
    this.listeners.forEach((fn) => fn());
  }

  timeAt(minute: number): Date {
    return new Date(this.epoch + minute * 60_000);
  }

  get now(): Date {
    return this.timeAt(this.minute);
  }

  get(id: string): MachineRuntime | undefined {
    return this.machines.find((m) => m.def.id === id);
  }

  private warmUp() {
    const warm = WARMUP_HOURS * 60;
    const onsets = this.machines.map((m) => {
      const init = m.def.initial;
      if (!init) return null;
      const startProgress = init.progress - WARMUP_HOURS / init.hoursToFailure;
      return { m, init, startMinute: startProgress >= 0 ? 0 : Math.round(-startProgress * init.hoursToFailure * 60), startProgress: Math.max(0, startProgress) };
    });
    for (let i = 0; i < warm; i += 1) {
      for (const o of onsets) {
        if (o && i === o.startMinute) startDegradation(o.m.sim, o.init.mode, o.init.hoursToFailure, o.startProgress, 2.1);
      }
      this.step(i % RISK_SAMPLE_EVERY === 0, false);
    }
    this.machines.forEach((m) => this.predict(m, true, false));
    this.machines.forEach((m) => {
      if (m.prediction) {
        m.alertedLevel = 0;
        m.levelStreak = { level: LEVEL[m.prediction.condition], count: ALERT_DEBOUNCE - 1 };
      }
    });
  }

  /** Advance every machine by one simulated minute. */
  private step(sampleRisk: boolean, raiseEvents: boolean) {
    this.minute += 1;
    for (const m of this.machines) {
      if (m.status === 'maintenance') {
        if (sampleRisk) this.predict(m, false, raiseEvents);
        continue;
      }
      const wasFailed = m.sim.failed;
      const sample = stepMachine(m.sim, m.controls);
      if (!m.sim.failed) m.operatingHours += 1 / 60;
      this.push(m, sample);
      if (!wasFailed && m.sim.failed) {
        m.status = 'failed';
        m.failedAtMinute = this.minute;
        if (raiseEvents) this.events.onFailure?.(m, this.minute);
      }
      if (sampleRisk) this.predict(m, false, raiseEvents);
    }
  }

  private push(m: MachineRuntime, s: Sample) {
    const b = m.series;
    b.minute.push(this.minute);
    b.temperature.push(s.temperature);
    b.vibration.push(s.vibration);
    b.current.push(s.current);
    b.rpm.push(s.rpm);
    b.workload.push(s.workload);
    m.latest = s;
    const excess = b.minute.length - HISTORY_MINUTES;
    if (excess > 120) {
      for (const key of Object.keys(b) as (keyof SeriesBuffer)[]) b[key].splice(0, excess);
    }
  }

  window(m: MachineRuntime, size = LONG_WINDOW): TelemetryWindow {
    const b = m.series;
    let from = Math.max(0, b.minute.length - size);
    while (from < b.minute.length && b.minute[from] < m.windowStartMinute) from += 1;
    return {
      temperature: b.temperature.slice(from),
      vibration: b.vibration.slice(from),
      current: b.current.slice(from),
      rpm: b.rpm.slice(from),
      workload: b.workload.slice(from),
      hoursSinceService: m.sim.hoursSinceService,
    };
  }

  private predict(m: MachineRuntime, full: boolean, raiseEvents: boolean) {
    if (m.status === 'failed') {
      m.prediction = failedPrediction(m.prediction, m.sim.degradation?.mode ?? null);
      this.recordRisk(m, 100, 0);
      return;
    }
    if (m.status === 'maintenance') {
      this.recordRisk(m, m.prediction?.risk ?? 0, m.prediction?.health ?? 0);
      return;
    }
    const win = this.window(m);
    const x = this.inference ? this.inference.features(win, m.def.type) : computeFeatures(win, MACHINE_TYPES[m.def.type].baseline, FALLBACK_BASELINE);
    if (!x) {
      m.prediction = null;
      return;
    }
    if (!full && this.inference) {
      const risk = this.inference.quickRisk(x);
      this.recordRisk(m, risk, m.prediction?.health ?? 100);
      return;
    }
    m.prediction = this.inference ? this.inference.analyze(x) : ruleBasedPrediction(x);
    this.recordRisk(m, m.prediction.risk, m.prediction.health);
    if (raiseEvents) this.checkAlert(m);
  }

  private recordRisk(m: MachineRuntime, risk: number, health: number) {
    const last = m.riskHistory[m.riskHistory.length - 1];
    if (last && this.minute - last.minute < RISK_SAMPLE_EVERY) return;
    m.riskHistory.push({ minute: this.minute, risk, health });
    if (m.riskHistory.length > 400) m.riskHistory.splice(0, m.riskHistory.length - 288);
  }

  private checkAlert(m: MachineRuntime) {
    const p = m.prediction;
    if (!p) return;
    const level = LEVEL[p.condition];
    m.levelStreak = m.levelStreak.level === level ? { level, count: m.levelStreak.count + 1 } : { level, count: 1 };
    if (m.levelStreak.count < ALERT_DEBOUNCE) return;
    if (level > m.alertedLevel) {
      m.alertedLevel = level;
      this.events.onAlert?.({ machine: m, severity: level === 2 ? 'critical' : 'warning', prediction: p, trendPerHour: this.trend(m), minute: this.minute });
    } else if (level === 0) {
      m.alertedLevel = 0;
    }
  }

  /** Risk change per simulated hour over the last hour of predictions. */
  trend(m: MachineRuntime, minutes = 60): number {
    const h = m.riskHistory;
    if (h.length < 2) return 0;
    const last = h[h.length - 1];
    let first = h[0];
    for (let i = h.length - 1; i >= 0; i -= 1) {
      if (last.minute - h[i].minute >= minutes) {
        first = h[i];
        break;
      }
    }
    const dt = (last.minute - first.minute) / 60;
    return dt > 0 ? (last.risk - first.risk) / dt : 0;
  }

  /** Called on every UI tick; advances the simulation according to `speed` (sim-minutes per second). */
  private carry = 0;
  tick() {
    if (!this.running) return;
    this.carry += (this.speed * TICK_MS) / 1000;
    const steps = Math.floor(this.carry);
    if (steps <= 0) return;
    this.carry -= steps;
    for (let i = 0; i < steps; i += 1) this.step(this.minute % RISK_SAMPLE_EVERY === 0, true);
    this.machines.forEach((m) => this.predict(m, true, true));
    this.emit();
  }

  advance(minutes: number) {
    for (let i = 0; i < minutes; i += 1) this.step(this.minute % RISK_SAMPLE_EVERY === 0, true);
    this.machines.forEach((m) => this.predict(m, true, true));
    this.emit();
  }

  setControls(id: string, patch: Partial<SimControls>) {
    const m = this.get(id);
    if (!m) return;
    m.controls = { ...m.controls, ...patch };
    this.emit();
  }

  injectFault(id: string, mode: FailureMode, hoursToFailure: number, progress = 0) {
    const m = this.get(id);
    if (!m || m.status !== 'running') return;
    startDegradation(m.sim, mode, hoursToFailure, progress, 2);
    this.emit();
  }

  /** Quick scenario presets for manual exploration. */
  setScenario(id: string, scenario: Condition, mode?: FailureMode) {
    const m = this.get(id);
    if (!m) return;
    if (scenario === 'normal') {
      this.completeRepair(id);
      return;
    }
    if (m.status !== 'running') return;
    const chosen = mode ?? m.sim.degradation?.mode ?? MACHINE_TYPES[m.def.type].modes[0];
    startDegradation(m.sim, chosen, scenario === 'warning' ? 60 : 30, scenario === 'warning' ? 0.6 : 0.82, 2);
    this.emit();
  }

  beginMaintenance(id: string) {
    const m = this.get(id);
    if (!m) return;
    m.status = 'maintenance';
    this.emit();
  }

  completeRepair(id: string) {
    const m = this.get(id);
    if (!m) return;
    repairMachine(m.sim);
    m.status = 'running';
    m.failedAtMinute = null;
    m.lastServiceMinute = this.minute;
    m.windowStartMinute = this.minute + 1;
    m.prediction = null;
    m.alertedLevel = 0;
    m.levelStreak = { level: 0, count: 0 };
    m.controls = { ...DEFAULT_CONTROLS };
    this.emit();
  }

  /** Minutes of fresh telemetry collected since recommissioning (null when not recommissioning). */
  recommissioning(m: MachineRuntime): number | null {
    if (m.prediction || m.status !== 'running' || m.lastServiceMinute === null) return null;
    return this.minute - m.windowStartMinute + 1;
  }

  truth(id: string) {
    const m = this.get(id);
    return m ? groundTruth(m.sim, m.controls) : null;
  }
}
