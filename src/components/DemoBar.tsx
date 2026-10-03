import { CheckCircle2, ChevronRight, FlaskConical, Square } from 'lucide-react';
import { DEMO_MACHINE_ID } from '../ml/data/machines';
import { DEMO_STEPS } from '../state/demo';
import { useApp, useFleet, useRecords } from '../state/AppContext';
import { riskColor } from './ui';
import { hours, riskIdx } from '../lib/format';

/** Simulated, illustrative economics for the impact summary. */
const UNPLANNED_DOWNTIME_H = 18;
const COST_PER_DOWNTIME_H = 1200;
const PARTS_UNPLANNED = 6500;
const PARTS_PLANNED = 900;

export function DemoBar() {
  const fleet = useFleet();
  const { demo, stopDemo, demoAction, setAutopilot } = useApp();
  const { workOrders, alerts } = useRecords();
  if (!demo.active) return null;
  const step = DEMO_STEPS[demo.step];
  const m = fleet.get(DEMO_MACHINE_ID)!;
  const p = m.prediction;
  const wo = workOrders.find((w) => w.machineId === DEMO_MACHINE_ID);
  const firstAlert = [...alerts].reverse().find((a) => a.machineId === DEMO_MACHINE_ID && a.source !== 'cloud');
  const lead = firstAlert && p === null ? null : firstAlert ? (new Date(wo?.completedAt ?? fleet.now).getTime() - new Date(firstAlert.createdAt).getTime()) / 3600_000 : null;
  const plannedDowntime = p?.recommendation.estimatedDowntimeHours || 3;
  const saved = UNPLANNED_DOWNTIME_H * COST_PER_DOWNTIME_H + PARTS_UNPLANNED - (plannedDowntime * COST_PER_DOWNTIME_H + PARTS_PLANNED);
  return (
    <section className="demo-bar" aria-label="Judge demo" aria-live="polite">
      <div className="demo-steps" aria-hidden="true">
        {DEMO_STEPS.map((s, i) => <span key={s.id} className={i < demo.step ? 'done' : i === demo.step ? 'current' : ''} />)}
      </div>
      <div className="demo-main">
        <div className="demo-copy">
          <span className="demo-kicker">Judge demo · step {demo.step + 1}/{DEMO_STEPS.length} · {m.def.name}</span>
          <strong>{step.title}</strong>
          <p>{step.narration}</p>
        </div>
        <div className="demo-live">
          <span>Risk index <strong style={{ color: riskColor(p?.risk ?? 0) }}>{p ? riskIdx(p.risk) : '—'}</strong></span>
          <span>Health <strong>{p ? Math.round(p.health) : '—'}</strong></span>
          {p?.ttf && <span>Est. TTF <strong>{hours(p.ttf.hours)}</strong></span>}
        </div>
        <div className="demo-actions">
          {step.action && <button className="button button-primary" onClick={demoAction}>{step.action} <ChevronRight size={14} /></button>}
          <label className="toggle">
            <input type="checkbox" checked={demo.autopilot} onChange={(e) => setAutopilot(e.target.checked)} /> Autopilot
          </label>
          <button className="icon-btn" onClick={stopDemo} aria-label="Exit demo"><Square size={13} /></button>
        </div>
      </div>
      {step.id === 'impact' && (
        <div className="impact">
          <div><CheckCircle2 size={15} /> <span>Failure predicted</span><strong>{lead !== null ? `${hours(lead)} before repair` : '—'}</strong></div>
          <div><span>Risk index before → after repair</span><strong>{wo ? `${Math.round(wo.riskBefore)}/100 → ${wo.riskAfter !== undefined ? `${Math.round(wo.riskAfter)}/100` : '…'}` : '—'}</strong></div>
          <div><span>Downtime avoided (simulated est.)</span><strong>{UNPLANNED_DOWNTIME_H - plannedDowntime} h</strong></div>
          <div><FlaskConical size={14} /><span>Cost avoided (simulated)</span><strong>${saved.toLocaleString()}</strong></div>
        </div>
      )}
    </section>
  );
}
