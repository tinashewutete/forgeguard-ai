import type { SupabaseClient } from '@supabase/supabase-js';
import type { FailureMode } from '../ml/types';

export type AlertStatus = 'open' | 'acknowledged' | 'scheduled' | 'resolved' | 'archived';

export interface AlertRecord {
  id: string;
  machineId: string;
  machineName: string;
  severity: 'warning' | 'critical' | 'failure';
  risk: number;
  confidence: number;
  failureMode: FailureMode | null;
  factors: string[];
  trendPerHour: number;
  recommendation: string;
  message: string;
  createdAt: string;
  status: AlertStatus;
  acknowledgedAt?: string;
  workOrderId?: string;
  source: 'model' | 'rules' | 'cloud';
}

export type WorkOrderStatus = 'scheduled' | 'in_progress' | 'completed';

export interface WorkOrder {
  id: string;
  machineId: string;
  machineName: string;
  alertId?: string;
  failureMode: FailureMode | null;
  title: string;
  priority: 'P1' | 'P2' | 'P3';
  status: WorkOrderStatus;
  technician: string;
  scheduledFor: string;
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
  findings?: string;
  actionTaken?: string;
  riskBefore: number;
  healthBefore: number;
  riskAfter?: number;
  healthAfter?: number;
  verifiedAt?: string;
}

export type TimelineKind = 'alert' | 'acknowledged' | 'scheduled' | 'inspection' | 'repair' | 'verified' | 'failure' | 'note';

export interface TimelineEvent {
  id: string;
  machineId: string;
  machineName: string;
  kind: TimelineKind;
  title: string;
  detail: string;
  createdAt: string;
  risk?: number;
  source?: 'local' | 'cloud';
}

export interface RecordsState {
  alerts: AlertRecord[];
  workOrders: WorkOrder[];
  timeline: TimelineEvent[];
}

export type SyncStatus = 'offline' | 'connecting' | 'synced' | 'error';

const STORAGE_KEY = 'forgeguard.records.v2';
const MAX_ALERTS = 200;
const MAX_EVENTS = 400;

export function uid(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

export interface KeyValueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

function browserStorage(): KeyValueStorage | null {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null;
  } catch {
    return null;
  }
}

/**
 * Local-first record store. localStorage is the source of truth so the demo works offline;
 * when Supabase is configured, alerts and maintenance events are mirrored to the cloud tables
 * best-effort and cloud history is merged in on start.
 */
export class RecordsStore {
  state: RecordsState = { alerts: [], workOrders: [], timeline: [] };
  sync: SyncStatus;
  syncError: string | null = null;
  private listeners = new Set<() => void>();
  private storage: KeyValueStorage | null;
  private cloud: SupabaseClient | null;

  constructor(cloud: SupabaseClient | null, storage: KeyValueStorage | null = browserStorage()) {
    this.cloud = cloud;
    this.storage = storage;
    this.sync = cloud ? 'connecting' : 'offline';
    this.load();
  }

  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  };

  getState = () => this.state;

  private set(next: RecordsState) {
    this.state = next;
    this.persist();
    this.listeners.forEach((fn) => fn());
  }

  private load() {
    if (!this.storage) return;
    try {
      const raw = this.storage.getItem(STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as Partial<RecordsState>;
      this.state = { alerts: parsed.alerts ?? [], workOrders: parsed.workOrders ?? [], timeline: parsed.timeline ?? [] };
    } catch (err) {
      console.warn('[ForgeGuard] could not read local history, starting fresh', err);
    }
  }

  private persist() {
    try {
      this.storage?.setItem(STORAGE_KEY, JSON.stringify(this.state));
    } catch (err) {
      console.warn('[ForgeGuard] could not save local history', err);
    }
  }

  private markSync(ok: boolean, message?: string) {
    if (!this.cloud) return;
    this.sync = ok ? 'synced' : 'error';
    this.syncError = ok ? null : message ?? 'Cloud sync failed';
    this.state = { ...this.state };
    this.listeners.forEach((fn) => fn());
  }

  /** Merge recent cloud history (best effort). Older prototype rows are shown as archived history. */
  async pullCloud(): Promise<void> {
    if (!this.cloud) return;
    try {
      const [alerts, events] = await Promise.all([
        this.cloud.from('machine_alerts').select('*').order('created_at', { ascending: false }).limit(40),
        this.cloud.from('maintenance_events').select('*').order('created_at', { ascending: false }).limit(60),
      ]);
      if (alerts.error) throw alerts.error;
      if (events.error) throw events.error;
      const known = new Set(this.state.alerts.map((a) => a.id));
      const knownEvents = new Set(this.state.timeline.map((e) => e.id));
      const cloudAlerts: AlertRecord[] = (alerts.data ?? [])
        .filter((r) => !known.has(String(r.id)))
        .map((r) => ({
          id: String(r.id),
          machineId: String(r.machine_id),
          machineName: String(r.machine_name),
          severity: r.severity === 'critical' ? 'critical' : 'warning',
          risk: Number(r.risk_score) || 0,
          confidence: 0,
          failureMode: null,
          factors: Array.isArray(r.contributing_factors) ? r.contributing_factors.map(String) : [],
          trendPerHour: 0,
          recommendation: '',
          message: String(r.message ?? ''),
          createdAt: String(r.created_at),
          status: 'archived',
          source: 'cloud',
        }));
      const cloudEvents: TimelineEvent[] = (events.data ?? [])
        .filter((r) => !knownEvents.has(String(r.id)))
        .map((r) => ({
          id: String(r.id),
          machineId: String(r.machine_id),
          machineName: String(r.machine_name),
          kind: 'note',
          title: String(r.action),
          detail: String(r.result),
          createdAt: String(r.created_at),
          source: 'cloud',
        }));
      this.set({
        ...this.state,
        alerts: [...this.state.alerts, ...cloudAlerts].slice(0, MAX_ALERTS),
        timeline: [...this.state.timeline, ...cloudEvents].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, MAX_EVENTS),
      });
      this.markSync(true);
    } catch (err) {
      this.markSync(false, err instanceof Error ? err.message : String(err));
    }
  }

  private push(task: () => PromiseLike<{ error: { message: string } | null }>) {
    if (!this.cloud) return;
    Promise.resolve(task())
      .then(({ error }) => this.markSync(!error, error?.message))
      .catch((err: unknown) => this.markSync(false, err instanceof Error ? err.message : String(err)));
  }

  addAlert(alert: AlertRecord) {
    this.set({ ...this.state, alerts: [alert, ...this.state.alerts].slice(0, MAX_ALERTS) });
    this.push(() =>
      this.cloud!.from('machine_alerts').insert({
        id: alert.id,
        machine_id: alert.machineId,
        machine_name: alert.machineName,
        severity: alert.severity === 'warning' ? 'warning' : 'critical',
        message: alert.message,
        failure_type: alert.failureMode ?? 'unknown',
        risk_score: Math.round(alert.risk),
        contributing_factors: alert.factors,
        acknowledged: false,
        created_at: alert.createdAt,
      }),
    );
  }

  updateAlert(id: string, patch: Partial<AlertRecord>) {
    this.set({ ...this.state, alerts: this.state.alerts.map((a) => (a.id === id ? { ...a, ...patch } : a)) });
    if (patch.status && patch.status !== 'open') {
      this.push(() => this.cloud!.from('machine_alerts').update({ acknowledged: true }).eq('id', id));
    }
  }

  addEvent(event: TimelineEvent) {
    this.set({ ...this.state, timeline: [event, ...this.state.timeline].slice(0, MAX_EVENTS) });
    this.push(() =>
      this.cloud!.from('maintenance_events').insert({
        id: event.id,
        machine_id: event.machineId,
        machine_name: event.machineName,
        action: event.title,
        result: event.detail,
        created_at: event.createdAt,
      }),
    );
  }

  upsertWorkOrder(order: WorkOrder) {
    const exists = this.state.workOrders.some((w) => w.id === order.id);
    this.set({ ...this.state, workOrders: exists ? this.state.workOrders.map((w) => (w.id === order.id ? order : w)) : [order, ...this.state.workOrders] });
  }

  /** Clears local history only; cloud rows are left untouched. */
  clearLocal() {
    this.set({ alerts: [], workOrders: [], timeline: [] });
  }
}
