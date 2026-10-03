import { describe, expect, it } from 'vitest';
import { RecordsStore, uid } from '../state/records';
import type { AlertRecord, KeyValueStorage } from '../state/records';

function memory(): KeyValueStorage {
  const m = new Map<string, string>();
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => void m.set(k, v), removeItem: (k) => void m.delete(k) };
}

const alert = (): AlertRecord => ({
  id: uid(), machineId: 'cnc-01', machineName: 'CNC Mill 01', severity: 'critical', risk: 82, confidence: 77, failureMode: 'bearing_wear',
  factors: ['Vibration'], trendPerHour: 4, recommendation: 'Inspect bearing', message: 'Bearing wear', createdAt: new Date().toISOString(), status: 'open', source: 'model',
});

describe('RecordsStore', () => {
  it('works offline and persists alerts, work orders and events across reloads', () => {
    const storage = memory();
    const a = new RecordsStore(null, storage);
    expect(a.sync).toBe('offline');
    const al = alert();
    a.addAlert(al);
    a.updateAlert(al.id, { status: 'acknowledged' });
    a.addEvent({ id: uid(), machineId: 'cnc-01', machineName: 'CNC Mill 01', kind: 'repair', title: 'Repair completed', detail: 'Replaced bearing', createdAt: new Date().toISOString() });
    a.upsertWorkOrder({ id: 'wo1', machineId: 'cnc-01', machineName: 'CNC Mill 01', failureMode: 'bearing_wear', title: 'Inspect', priority: 'P1', status: 'scheduled', technician: 'A', scheduledFor: '', createdAt: '', riskBefore: 82, healthBefore: 30 });
    a.upsertWorkOrder({ ...a.state.workOrders[0], status: 'completed' });

    const b = new RecordsStore(null, storage);
    expect(b.state.alerts[0].status).toBe('acknowledged');
    expect(b.state.timeline).toHaveLength(1);
    expect(b.state.workOrders).toHaveLength(1);
    expect(b.state.workOrders[0].status).toBe('completed');
  });

  it('keeps working in memory when storage is unavailable', () => {
    const s = new RecordsStore(null, null);
    s.addAlert(alert());
    expect(s.state.alerts).toHaveLength(1);
  });

  it('notifies subscribers with a new snapshot', () => {
    const s = new RecordsStore(null, memory());
    const before = s.getState();
    let calls = 0;
    s.subscribe(() => (calls += 1));
    s.addAlert(alert());
    expect(calls).toBe(1);
    expect(s.getState()).not.toBe(before);
  });
});
