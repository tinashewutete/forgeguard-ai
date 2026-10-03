import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import type { ReactNode } from 'react';
import { supabase } from '../lib/supabase';
import { InferenceEngine } from '../ml/inference/engine';
import { MODE_LABEL } from '../ml/inference/knowledge';
import type { ModelBundle } from '../ml/models/bundle';
import { DEMO_MACHINE_ID } from '../ml/data/machines';
import { FleetEngine, TICK_MS } from '../sim/fleet';
import type { AlertDraft, MachineRuntime } from '../sim/fleet';
import { DEMO_STEPS } from './demo';
import type { DemoContext } from './demo';
import { RecordsStore, uid } from './records';
import type { AlertRecord, RecordsState, SyncStatus, WorkOrder } from './records';

export type ModelStatus = 'loading' | 'ready' | 'fallback';

export interface Toast {
  id: number;
  tone: 'info' | 'warning' | 'critical' | 'success';
  text: string;
}

export interface DemoState {
  active: boolean;
  step: number;
  ctx: DemoContext;
  autopilot: boolean;
}

export interface ScheduleOptions {
  technician?: string;
  inHours?: number;
  alertId?: string;
}

interface AppApi {
  fleet: FleetEngine;
  records: RecordsStore;
  model: ModelBundle | null;
  inference: InferenceEngine | null;
  modelStatus: ModelStatus;
  toasts: Toast[];
  dismissToast: (id: number) => void;
  notify: (tone: Toast['tone'], text: string) => void;
  acknowledge: (alertId: string) => void;
  schedule: (machineId: string, opts?: ScheduleOptions) => WorkOrder | null;
  startWork: (orderId: string) => void;
  completeWork: (orderId: string, findings: string, actionTaken: string) => void;
  resetSimulation: () => void;
  demo: DemoState;
  startDemo: () => void;
  stopDemo: () => void;
  demoAction: () => void;
  setAutopilot: (on: boolean) => void;
}

const Ctx = createContext<AppApi | null>(null);

const MODEL_URL = `${import.meta.env.BASE_URL}models/forgeguard-model.json`;
const TECHNICIANS = ['A. Moyo', 'R. Naidoo', 'S. Dlamini', 'K. Perera'];

function priorityFor(risk: number): WorkOrder['priority'] {
  if (risk >= 70) return 'P1';
  if (risk >= 40) return 'P2';
  return 'P3';
}

const INITIAL_DEMO: DemoState = { active: false, step: 0, ctx: { stepStartedMinute: 0, scheduled: false, repaired: false, verified: false }, autopilot: true };

export function AppProvider({ children }: { children: ReactNode }) {
  const [model, setModel] = useState<ModelBundle | null>(null);
  const [modelStatus, setModelStatus] = useState<ModelStatus>('loading');
  const [fleet, setFleet] = useState<FleetEngine | null>(null);
  const records = useMemo(() => new RecordsStore(supabase), []);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [demo, setDemo] = useState<DemoState>(INITIAL_DEMO);
  const demoRef = useRef(demo);
  demoRef.current = demo;
  const toastId = useRef(0);

  const inference = useMemo(() => (model ? new InferenceEngine(model) : null), [model]);

  const notify = useCallback((tone: Toast['tone'], text: string) => {
    toastId.current += 1;
    const id = toastId.current;
    setToasts((t) => [...t.slice(-1), { id, tone, text }]);
    window.setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 5200);
  }, []);
  const dismissToast = useCallback((id: number) => setToasts((t) => t.filter((x) => x.id !== id)), []);

  useEffect(() => {
    let cancelled = false;
    fetch(MODEL_URL)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json() as Promise<ModelBundle>;
      })
      .then((bundle) => {
        if (cancelled) return;
        if (!bundle.riskForest?.trees?.length) throw new Error('invalid model artifact');
        setModel(bundle);
        setModelStatus('ready');
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        console.error('[ForgeGuard] model artifact failed to load; using rule-based fallback', err);
        setModelStatus('fallback');
      });
    records.pullCloud();
    return () => {
      cancelled = true;
    };
  }, [records]);

  const buildFleet = useCallback(() => new FleetEngine(inference), [inference]);

  useEffect(() => {
    if (modelStatus === 'loading') return;
    setFleet(buildFleet());
  }, [modelStatus, buildFleet]);

  // Wire simulation events into persistent records.
  useEffect(() => {
    if (!fleet) return;
    const ts = (minute: number) => fleet.timeAt(minute).toISOString();
    fleet.setEvents({
      onAlert: (d: AlertDraft) => {
        const p = d.prediction;
        const factors = p.factors.filter((f) => f.points > 0.5).slice(0, 3).map((f) => `${f.label}: ${f.evidence}`);
        const mode = p.failureMode ? MODE_LABEL[p.failureMode] : 'Unclassified degradation';
        const alert: AlertRecord = {
          id: uid(),
          machineId: d.machine.def.id,
          machineName: d.machine.def.name,
          severity: d.severity,
          risk: p.risk,
          confidence: p.confidence,
          failureMode: p.failureMode,
          factors,
          trendPerHour: d.trendPerHour,
          recommendation: p.recommendation.headline,
          message: `${mode} pattern — risk index ${Math.round(p.risk)}/100${p.ttf ? `, est. ${p.ttf.hours.toFixed(0)} h to failure` : ''}`,
          createdAt: ts(d.minute),
          status: 'open',
          source: p.source,
        };
        records.addAlert(alert);
        records.addEvent({ id: uid(), machineId: alert.machineId, machineName: alert.machineName, kind: 'alert', title: `${d.severity === 'critical' ? 'Critical' : 'Warning'} alert raised`, detail: alert.message, createdAt: alert.createdAt, risk: p.risk });
        notify(d.severity, `${alert.machineName}: ${alert.message}`);
      },
      onFailure: (m: MachineRuntime, minute: number) => {
        const mode = m.sim.degradation?.mode;
        const alert: AlertRecord = {
          id: uid(),
          machineId: m.def.id,
          machineName: m.def.name,
          severity: 'failure',
          risk: 100,
          confidence: 99,
          failureMode: mode ?? null,
          factors: [],
          trendPerHour: 0,
          recommendation: 'Machine down — dispatch repair',
          message: `Unplanned failure${mode ? ` (${MODE_LABEL[mode]})` : ''} — production stopped`,
          createdAt: ts(minute),
          status: 'open',
          source: 'model',
        };
        records.addAlert(alert);
        records.addEvent({ id: uid(), machineId: m.def.id, machineName: m.def.name, kind: 'failure', title: 'Unplanned failure', detail: alert.message, createdAt: alert.createdAt, risk: 100 });
        notify('critical', `${m.def.name} has failed — production stopped`);
      },
    });
    return () => fleet.setEvents({});
  }, [fleet, records, notify]);

  const verifyRepairs = useCallback(() => {
    if (!fleet) return;
    for (const wo of records.state.workOrders) {
      if (wo.status !== 'completed' || wo.verifiedAt) continue;
      const m = fleet.get(wo.machineId);
      const p = m?.prediction;
      if (!m || !p || m.lastServiceMinute === null || fleet.minute - m.lastServiceMinute < 45) continue;
      const verified = { ...wo, riskAfter: p.risk, healthAfter: p.health, verifiedAt: fleet.now.toISOString() };
      records.upsertWorkOrder(verified);
      const ok = p.condition === 'normal';
      records.addEvent({ id: uid(), machineId: wo.machineId, machineName: wo.machineName, kind: 'verified', title: ok ? 'Recovery verified' : 'Post-repair check: risk still elevated', detail: `Risk ${Math.round(wo.riskBefore)}% → ${Math.round(p.risk)}%, health ${Math.round(wo.healthBefore)} → ${Math.round(p.health)}`, createdAt: verified.verifiedAt, risk: p.risk });
      records.state.alerts.filter((a) => a.machineId === wo.machineId && a.status !== 'archived' && a.status !== 'resolved').forEach((a) => records.updateAlert(a.id, { status: ok ? 'resolved' : a.status }));
      notify(ok ? 'success' : 'warning', `${wo.machineName}: ${ok ? 'recovery verified' : 'risk still elevated after repair'}`);
      if (wo.machineId === DEMO_MACHINE_ID && demoRef.current.active) setDemo((d) => ({ ...d, ctx: { ...d.ctx, verified: true } }));
    }
  }, [fleet, records, notify]);

  const acknowledge = useCallback((alertId: string) => {
    const a = records.state.alerts.find((x) => x.id === alertId);
    if (!a || !fleet) return;
    const at = fleet.now.toISOString();
    records.updateAlert(alertId, { status: 'acknowledged', acknowledgedAt: at });
    records.addEvent({ id: uid(), machineId: a.machineId, machineName: a.machineName, kind: 'acknowledged', title: 'Alert acknowledged', detail: a.message, createdAt: at, risk: a.risk });
  }, [fleet, records]);

  const schedule = useCallback((machineId: string, opts: ScheduleOptions = {}): WorkOrder | null => {
    if (!fleet) return null;
    const m = fleet.get(machineId);
    if (!m) return null;
    const existing = records.state.workOrders.find((w) => w.machineId === machineId && w.status !== 'completed');
    if (existing) return existing;
    const p = m.prediction;
    const risk = p?.risk ?? 0;
    const alert = opts.alertId ? records.state.alerts.find((a) => a.id === opts.alertId) : records.state.alerts.find((a) => a.machineId === machineId && (a.status === 'open' || a.status === 'acknowledged'));
    const mode = p?.failureMode ?? alert?.failureMode ?? null;
    const now = fleet.now;
    const order: WorkOrder = {
      id: uid(),
      machineId,
      machineName: m.def.name,
      alertId: alert?.id,
      failureMode: mode,
      title: p?.recommendation.headline && p.condition !== 'normal' ? p.recommendation.headline : `Preventive inspection — ${m.def.name}`,
      priority: m.status === 'failed' ? 'P1' : priorityFor(risk),
      status: 'scheduled',
      technician: opts.technician ?? TECHNICIANS[records.state.workOrders.length % TECHNICIANS.length],
      scheduledFor: new Date(now.getTime() + (opts.inHours ?? (risk >= 70 ? 0.5 : 4)) * 3600_000).toISOString(),
      createdAt: now.toISOString(),
      riskBefore: risk,
      healthBefore: p?.health ?? 0,
    };
    records.upsertWorkOrder(order);
    if (alert) records.updateAlert(alert.id, { status: 'scheduled', workOrderId: order.id, acknowledgedAt: alert.acknowledgedAt ?? now.toISOString() });
    records.addEvent({ id: uid(), machineId, machineName: m.def.name, kind: 'scheduled', title: `${order.priority} work order scheduled`, detail: `${order.title} · ${order.technician}`, createdAt: order.createdAt, risk });
    notify('info', `Work order ${order.priority} scheduled for ${m.def.name}`);
    if (machineId === DEMO_MACHINE_ID && demoRef.current.active) setDemo((d) => ({ ...d, ctx: { ...d.ctx, scheduled: true } }));
    return order;
  }, [fleet, records, notify]);

  const startWork = useCallback((orderId: string) => {
    const wo = records.state.workOrders.find((w) => w.id === orderId);
    if (!wo || !fleet || wo.status !== 'scheduled') return;
    const at = fleet.now.toISOString();
    fleet.beginMaintenance(wo.machineId);
    records.upsertWorkOrder({ ...wo, status: 'in_progress', startedAt: at });
    records.addEvent({ id: uid(), machineId: wo.machineId, machineName: wo.machineName, kind: 'inspection', title: 'Inspection started', detail: `${wo.technician} — machine locked out for maintenance`, createdAt: at });
  }, [fleet, records]);

  const completeWork = useCallback((orderId: string, findings: string, actionTaken: string) => {
    const wo = records.state.workOrders.find((w) => w.id === orderId);
    if (!wo || !fleet || wo.status === 'completed') return;
    const at = fleet.now.toISOString();
    fleet.completeRepair(wo.machineId);
    records.upsertWorkOrder({ ...wo, status: 'completed', startedAt: wo.startedAt ?? at, completedAt: at, findings, actionTaken });
    records.addEvent({ id: uid(), machineId: wo.machineId, machineName: wo.machineName, kind: 'repair', title: 'Repair completed', detail: `Findings: ${findings} · Action: ${actionTaken}`, createdAt: at });
    notify('success', `${wo.machineName} recommissioned — verifying recovery`);
    if (wo.machineId === DEMO_MACHINE_ID && demoRef.current.active) setDemo((d) => ({ ...d, ctx: { ...d.ctx, repaired: true } }));
  }, [fleet, records, notify]);

  const resetSimulation = useCallback(() => {
    setDemo(INITIAL_DEMO);
    setFleet(buildFleet());
    notify('info', 'Simulation reset to the initial fleet state');
  }, [buildFleet, notify]);

  // Main simulation loop.
  useEffect(() => {
    if (!fleet) return;
    const id = window.setInterval(() => {
      fleet.tick();
      verifyRepairs();
      const d = demoRef.current;
      if (!d.active) return;
      const step = DEMO_STEPS[d.step];
      if (step && step.done(fleet, d.ctx) && d.step < DEMO_STEPS.length - 1) {
        const next = DEMO_STEPS[d.step + 1];
        if (next.id === 'degrade') fleet.injectFault(DEMO_MACHINE_ID, 'bearing_wear', 26);
        fleet.speed = next.speed;
        fleet.running = true;
        setDemo({ ...d, step: d.step + 1, ctx: { ...d.ctx, stepStartedMinute: fleet.minute } });
      }
    }, TICK_MS);
    return () => window.clearInterval(id);
  }, [fleet, verifyRepairs]);

  const startDemo = useCallback(() => {
    const f = buildFleet();
    // The demo machine starts fresh from service so the story is deterministic.
    f.completeRepair(DEMO_MACHINE_ID);
    f.advance(40);
    f.speed = DEMO_STEPS[0].speed;
    records.clearLocal();
    setFleet(f);
    setDemo({ ...INITIAL_DEMO, active: true, ctx: { ...INITIAL_DEMO.ctx, stepStartedMinute: f.minute } });
    notify('info', 'Judge demo started — follow the guided steps');
  }, [buildFleet, notify, records]);

  const stopDemo = useCallback(() => {
    setDemo(INITIAL_DEMO);
    if (fleet) fleet.speed = 1;
  }, [fleet]);

  const demoAction = useCallback(() => {
    const d = demoRef.current;
    const step = DEMO_STEPS[d.step];
    if (!fleet || !step) return;
    if (step.id === 'critical') schedule(DEMO_MACHINE_ID);
    if (step.id === 'schedule') {
      const wo = records.state.workOrders.find((w) => w.machineId === DEMO_MACHINE_ID && w.status !== 'completed');
      if (wo) {
        startWork(wo.id);
        completeWork(wo.id, 'Outer-race spalling on front spindle bearing; grease discoloured', 'Replaced spindle bearing set, re-greased, verified run-out < 2 µm');
      }
    }
  }, [fleet, records, schedule, startWork, completeWork]);

  // Autopilot performs operator actions after a short pause so the presenter can talk over it.
  useEffect(() => {
    if (!demo.active || !demo.autopilot) return;
    const step = DEMO_STEPS[demo.step];
    if (!step?.action) return;
    const t = window.setTimeout(demoAction, 6000);
    return () => window.clearTimeout(t);
  }, [demo.active, demo.autopilot, demo.step, demoAction]);

  const setAutopilot = useCallback((on: boolean) => setDemo((d) => ({ ...d, autopilot: on })), []);

  if (!fleet) {
    return (
      <div className="boot-screen" role="status" aria-live="polite">
        <div className="brand-mark large" aria-hidden="true">
          <svg width="28" height="28" viewBox="0 0 28 28" fill="none" aria-hidden="true">
            <path d="M14 3L25 8.5V19.5L14 25L3 19.5V8.5L14 3Z" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinejoin="round" />
            <circle cx="14" cy="14" r="4" fill="currentColor" opacity=".6" />
          </svg>
        </div>
        <strong>ForgeGuard AI</strong>
        <span style={{ fontSize: 13, color: 'var(--muted)' }}>
          {modelStatus === 'loading'
            ? 'Loading degradation model & warming up fleet telemetry…'
            : 'Starting simulation engine…'}
        </span>
        <div className="boot-loader" aria-hidden="true" />
        <p style={{ margin: 0, fontSize: 11, color: '#3a5060', letterSpacing: '.1em', fontFamily: 'var(--mono)', textTransform: 'uppercase' }}>
          Machine Health Intelligence Platform
        </p>
      </div>
    );
  }

  const api: AppApi = { fleet, records, model, inference, modelStatus, toasts, dismissToast, notify, acknowledge, schedule, startWork, completeWork, resetSimulation, demo, startDemo, stopDemo, demoAction, setAutopilot };
  return <Ctx.Provider value={api}>{children}</Ctx.Provider>;
}

export function useApp(): AppApi {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useApp must be used inside AppProvider');
  return ctx;
}

/** Re-render on every simulation tick. */
export function useFleet(): FleetEngine {
  const { fleet } = useApp();
  useSyncExternalStore(fleet.subscribe, fleet.getVersion);
  return fleet;
}

export function useRecords(): RecordsState & { sync: SyncStatus; syncError: string | null } {
  const { records } = useApp();
  const state = useSyncExternalStore(records.subscribe, records.getState);
  return { ...state, sync: records.sync, syncError: records.syncError };
}
