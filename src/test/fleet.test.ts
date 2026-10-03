import { describe, expect, it } from 'vitest';
import { FleetEngine } from '../sim/fleet';
import type { AlertDraft } from '../sim/fleet';
import { DEMO_STEPS } from '../state/demo';
import type { DemoContext } from '../state/demo';
import { DEMO_MACHINE_ID } from '../ml/data/machines';
import { engine } from './helpers';

const EPOCH = Date.UTC(2026, 9, 2, 8);

describe('FleetEngine', () => {
  it('warms up with predictions for every machine and a mixed fleet', () => {
    const fleet = new FleetEngine(engine(), EPOCH);
    expect(fleet.machines).toHaveLength(10);
    expect(fleet.machines.every((m) => m.prediction !== null)).toBe(true);
    expect(fleet.get(DEMO_MACHINE_ID)!.prediction!.condition).toBe('normal');
    expect(fleet.machines.some((m) => m.prediction!.condition !== 'normal')).toBe(true);
  });

  it('injected degradation escalates normal → warning → critical with one debounced alert per level, then repair recovers', () => {
    const fleet = new FleetEngine(engine(), EPOCH);
    const alerts: AlertDraft[] = [];
    fleet.setEvents({ onAlert: (a) => alerts.push(a) });
    fleet.injectFault(DEMO_MACHINE_ID, 'bearing_wear', 26);
    const risks: number[] = [];
    for (let h = 0; h < 25; h += 1) {
      fleet.advance(60);
      risks.push(fleet.get(DEMO_MACHINE_ID)!.prediction!.risk);
    }
    const mine = alerts.filter((a) => a.machine.def.id === DEMO_MACHINE_ID);
    expect(mine.map((a) => a.severity)).toEqual(['warning', 'critical']);
    expect(risks[2]).toBeLessThan(40);
    expect(Math.max(...risks)).toBeGreaterThanOrEqual(70);
    expect(mine[1].prediction.failureMode).toBe('bearing_wear');

    fleet.beginMaintenance(DEMO_MACHINE_ID);
    expect(fleet.get(DEMO_MACHINE_ID)!.status).toBe('maintenance');
    fleet.completeRepair(DEMO_MACHINE_ID);
    const m = fleet.get(DEMO_MACHINE_ID)!;
    expect(m.prediction).toBeNull();
    expect(fleet.recommissioning(m)).not.toBeNull();
    fleet.advance(60);
    expect(m.prediction!.condition).toBe('normal');
    expect(m.prediction!.risk).toBeLessThan(40);
  });

  it('emits a failure event when degradation is ignored', () => {
    const fleet = new FleetEngine(engine(), EPOCH);
    const failed: string[] = [];
    fleet.setEvents({ onFailure: (m) => failed.push(m.def.id) });
    fleet.injectFault('lathe-05', 'motor_overload', 4, 0.5);
    fleet.advance(5 * 60);
    expect(failed).toContain('lathe-05');
    expect(fleet.get('lathe-05')!.status).toBe('failed');
    expect(fleet.get('lathe-05')!.prediction!.risk).toBe(100);
  });

  it('runs on rule-based fallback without a model', () => {
    const fleet = new FleetEngine(null, EPOCH);
    expect(fleet.machines.every((m) => m.prediction?.source === 'rules')).toBe(true);
  });
});

describe('judge demo script', () => {
  it('reaches every step deterministically', () => {
    const fleet = new FleetEngine(engine(), EPOCH);
    fleet.completeRepair(DEMO_MACHINE_ID);
    fleet.advance(40);
    const ctx: DemoContext = { stepStartedMinute: fleet.minute, scheduled: false, repaired: false, verified: false };
    let step = 0;
    let guard = 0;
    const visited = [DEMO_STEPS[0].id];
    while (step < DEMO_STEPS.length - 1 && guard < 4000) {
      guard += 1;
      const s = DEMO_STEPS[step];
      if (s.id === 'critical') ctx.scheduled = true;
      if (s.id === 'schedule') {
        fleet.beginMaintenance(DEMO_MACHINE_ID);
        fleet.completeRepair(DEMO_MACHINE_ID);
        ctx.repaired = true;
      }
      if (s.id === 'repair' && fleet.get(DEMO_MACHINE_ID)!.prediction && fleet.minute - (fleet.get(DEMO_MACHINE_ID)!.lastServiceMinute ?? 0) >= 45) {
        ctx.verified = fleet.get(DEMO_MACHINE_ID)!.prediction!.condition === 'normal';
      }
      if (s.done(fleet, ctx)) {
        step += 1;
        visited.push(DEMO_STEPS[step].id);
        if (DEMO_STEPS[step].id === 'degrade') fleet.injectFault(DEMO_MACHINE_ID, 'bearing_wear', 26);
        ctx.stepStartedMinute = fleet.minute;
      } else {
        fleet.advance(5);
      }
    }
    expect(visited).toEqual(DEMO_STEPS.map((s) => s.id));
    // Story must fit a short pitch: well under 30 simulated hours.
    expect(fleet.minute).toBeLessThan(30 * 60 + 800);
  });
});
