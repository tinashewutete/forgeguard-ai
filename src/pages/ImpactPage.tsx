import { Activity, AlertTriangle, BarChart3, CheckCircle2, Clock, Shield, Timer, TrendingDown, TrendingUp, Wrench, Zap } from 'lucide-react';
import { useFleet, useRecords } from '../state/AppContext';
import { Empty, PageHeading, Panel, Stat, Tag } from '../components/ui';
import { fmt, hours, pct } from '../lib/format';

const HOURLY_PROD_LOSS = 1400;
const UNPLANNED_PARTS = 5800;
const PLANNED_PARTS = 780;
const TECHNICIAN_CALLOUT = 2200;
const AVG_UNPLANNED_DOWNTIME_H = 18;
const AVG_PLANNED_DOWNTIME_H = 2.5;
const MTTR_UNPLANNED_H = 22;
const MTTR_PLANNED_H = 2.8;

export function ImpactPage() {
  const fleet = useFleet();
  const { alerts, workOrders, timeline } = useRecords();

  const completed = workOrders.filter(w => w.status === 'completed');
  const scheduled = workOrders.filter(w => w.status !== 'completed');
  const openAlerts = alerts.filter(a => a.status === 'open' || a.status === 'acknowledged');
  const resolvedAlerts = alerts.filter(a => a.status === 'resolved');
  const critAlerts = alerts.filter(a => a.severity === 'critical' || a.severity === 'failure');
  const warnAlerts = alerts.filter(a => a.severity === 'warning');

  const imminentFailures = fleet.machines.filter(m =>
    m.status === 'failed' || (m.prediction?.ttf && m.prediction.ttf.hours <= 24)
  ).length;

  const withPreds = fleet.machines.filter(m => m.prediction);
  const avgHealth = withPreds.length
    ? withPreds.reduce((a, m) => a + m.prediction!.health, 0) / withPreds.length
    : 0;
  const normalCount = fleet.machines.filter(m => m.prediction?.condition === 'normal').length;
  const warningCount = fleet.machines.filter(m => m.prediction?.condition === 'warning').length;
  const criticalCount = fleet.machines.filter(m => m.prediction?.condition === 'critical' || m.status === 'failed').length;
  const availability = ((normalCount + warningCount) / fleet.machines.length) * 100;

  const interventions = Math.max(1, completed.length);
  const avgLeadH = completed.length
    ? completed.reduce((a, w) => {
        const alert = alerts.find(x => x.id === w.alertId);
        if (!alert || !w.completedAt) return a;
        return a + Math.max(0, (new Date(w.completedAt).getTime() - new Date(alert.createdAt).getTime()) / 3600_000);
      }, 0) / completed.length
    : 0;

  const unplannedEquivalent = Math.round(interventions * 0.9);
  const downtimeSaved = (AVG_UNPLANNED_DOWNTIME_H - AVG_PLANNED_DOWNTIME_H) * unplannedEquivalent;
  const costSaved = unplannedEquivalent * (
    (AVG_UNPLANNED_DOWNTIME_H - AVG_PLANNED_DOWNTIME_H) * HOURLY_PROD_LOSS
    + (UNPLANNED_PARTS - PLANNED_PARTS)
    + TECHNICIAN_CALLOUT
  );
  const mttrImprovement = ((MTTR_UNPLANNED_H - MTTR_PLANNED_H) / MTTR_UNPLANNED_H) * 100;

  const CAPABILITIES = [
    'Temperature, vibration, motor current, RPM, workload monitoring',
    'Physics-inspired synthetic machine data generator',
    'Gradual degradation detection via time-window features',
    'Abnormal-pattern detection — Isolation Forest',
    'Random Forest failure-risk classifier (Normal / Warning / Critical)',
    'Time-to-failure regressor with uncertainty range',
    'Failure mode classifier (5 categories)',
    'Explainable AI — additive feature contributions per sensor group',
    'Automatic maintenance alerts with debouncing',
    'Maintenance lifecycle (acknowledge ? schedule ? inspect ? verify)',
    'What-if scenario simulator with live re-prediction',
    'Fleet comparison and priority ranking',
    'Model performance page with held-out test metrics',
    'Deterministic hackathon demo mode (10-step narrative)',
    'Maintenance copilot querying live fleet data',
    'Incident report export (PDF · CSV · Markdown)',
  ];

  return (
    <>
      <PageHeading
        eyebrow="Operational intelligence"
        title="Platform impact & analytics"
        copy={
          <>
            Fleet-wide metrics from the live simulation. Cost figures use stated assumptions and are{' '}
            <Tag kind="estimate" />
            {' '}illustrative estimates.
          </>
        }
      />

      <div className="stat-grid">
        <Stat label="Fleet availability" value={`${pct(availability, 0)}`} sub={`${normalCount + warningCount}/${fleet.machines.length} machines producing`} icon={<Activity size={17} />} tone={availability >= 80 ? 'teal' : 'amber'} />
        <Stat label="Average fleet health" value={Math.round(avgHealth)} sub="Condition index 0-100" icon={<BarChart3 size={17} />} tone={avgHealth >= 70 ? 'teal' : avgHealth >= 50 ? 'amber' : 'red'} />
        <Stat label="Interventions completed" value={completed.length} sub={`${scheduled.length} active work orders`} icon={<Wrench size={17} />} tone="blue" />
        <Stat label="Total alerts raised" value={alerts.length} sub={`${critAlerts.length} critical · ${warnAlerts.length} warning`} icon={<AlertTriangle size={17} />} tone={openAlerts.length > 0 ? 'amber' : 'teal'} />
      </div>

      <div className="grid-2-1" style={{ marginBottom: 16 }}>
        <Panel title="Fleet condition breakdown" id="breakdown">
          <div style={{ display: 'grid', gap: 16 }}>
            {[
              { label: 'Normal operation', count: normalCount, color: 'var(--teal)', desc: 'Operating within healthy baseline parameters' },
              { label: 'Warning — degradation detected', count: warningCount, color: 'var(--amber)', desc: 'Elevated risk; scheduled maintenance recommended' },
              { label: 'Critical / Failed', count: criticalCount, color: 'var(--red)', desc: 'Immediate intervention required' },
            ].map(({ label, count, color, desc }) => (
              <div key={label} style={{ display: 'grid', gap: 6 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
                  <span style={{ color: 'var(--text-dim)' }}>{label}</span>
                  <span style={{ fontFamily: 'var(--mono)', fontWeight: 600, color }}>{count} / {fleet.machines.length}</span>
                </div>
                <div style={{ height: 8, borderRadius: 4, background: '#162230', overflow: 'hidden' }}>
                  <div style={{ height: '100%', width: `${(count / fleet.machines.length) * 100}%`, background: color, borderRadius: 4 }} />
                </div>
                <p style={{ margin: 0, fontSize: 11, color: 'var(--muted)' }}>{desc}</p>
              </div>
            ))}
          </div>
        </Panel>
        <Panel title="Alert resolution" id="alertsummary">
          <div style={{ display: 'grid', gap: 14 }}>
            {[
              { label: 'Open alerts', value: String(openAlerts.length), color: 'var(--red)' },
              { label: 'Resolved alerts', value: String(resolvedAlerts.length), color: 'var(--teal)' },
              { label: 'Failures predicted = 24 h', value: String(imminentFailures), color: imminentFailures > 0 ? 'var(--red)' : 'var(--teal)' },
              { label: 'Avg. warning lead time', value: avgLeadH > 0 ? hours(avgLeadH) : '—', color: 'var(--accent)' },
            ].map(({ label, value, color }) => (
              <div key={label} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0', borderBottom: '1px solid rgba(30,40,55,.8)' }}>
                <span style={{ color: 'var(--muted)', fontSize: 12 }}>{label}</span>
                <strong style={{ fontFamily: 'var(--mono)', color, fontSize: 15 }}>{value}</strong>
              </div>
            ))}
          </div>
        </Panel>
      </div>

      <Panel title="Reactive vs predictive — simulated economics" subtitle={`Assumptions: $${HOURLY_PROD_LOSS.toLocaleString()}/hr production loss · $${UNPLANNED_PARTS.toLocaleString()} emergency parts · $${TECHNICIAN_CALLOUT.toLocaleString()} callout`} id="economics">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 16 }}>
          {([
            { title: 'Reactive (baseline)', color: 'rgba(184,72,64,.3)', items: [
              ['Detection', 'Fixed alarm limits'],
              ['Lead time', '0 h — discovered at failure'],
              ['Avg. downtime / event', `${AVG_UNPLANNED_DOWNTIME_H} h`],
              ['Emergency parts + callout', `$${(UNPLANNED_PARTS + TECHNICIAN_CALLOUT).toLocaleString()}`],
              ['MTTR', `${MTTR_UNPLANNED_H} h`],
              ['Production loss', `$${(AVG_UNPLANNED_DOWNTIME_H * HOURLY_PROD_LOSS).toLocaleString()}`],
            ]},
            { title: 'ForgeGuard AI — predictive', color: 'rgba(78,158,126,.3)', items: [
              ['Detection', 'ML + Isolation Forest'],
              ['Lead time', avgLeadH > 0 ? hours(avgLeadH) : '~6 h (simulation)'],
              ['Avg. downtime / event', `${AVG_PLANNED_DOWNTIME_H} h`],
              ['Pre-ordered parts', `$${PLANNED_PARTS.toLocaleString()}`],
              ['MTTR', `${MTTR_PLANNED_H} h`],
              ['Production loss', `$${(AVG_PLANNED_DOWNTIME_H * HOURLY_PROD_LOSS).toLocaleString()}`],
            ]},
            { title: 'Saving per prevented event', color: 'rgba(184,144,42,.3)', items: [
              ['Downtime saved', `${AVG_UNPLANNED_DOWNTIME_H - AVG_PLANNED_DOWNTIME_H} h`],
              ['Production recovery', `$${((AVG_UNPLANNED_DOWNTIME_H - AVG_PLANNED_DOWNTIME_H) * HOURLY_PROD_LOSS).toLocaleString()}`],
              ['Parts savings', `$${(UNPLANNED_PARTS - PLANNED_PARTS).toLocaleString()}`],
              ['Callout eliminated', `$${TECHNICIAN_CALLOUT.toLocaleString()}`],
              ['MTTR reduction', `${fmt(mttrImprovement, 0)}%`],
              ['Total / event', `$${Math.round((AVG_UNPLANNED_DOWNTIME_H - AVG_PLANNED_DOWNTIME_H) * HOURLY_PROD_LOSS + UNPLANNED_PARTS - PLANNED_PARTS + TECHNICIAN_CALLOUT).toLocaleString()}`],
            ]},
          ] as { title: string; color: string; items: [string,string][] }[]).map(({ title, color, items }) => (
            <div key={title} style={{ border: `1px solid ${color}`, borderRadius: 4, padding: '16px 18px' }}>
              <strong style={{ display: 'block', fontSize: 12, marginBottom: 14, color: 'var(--text-dim)' }}>{title}</strong>
              <dl style={{ margin: 0, display: 'grid', gap: 9 }}>
                {items.map(([label, value]) => (
                  <div key={label} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, gap: 8 }}>
                    <dt style={{ color: 'var(--muted)' }}>{label}</dt>
                    <dd style={{ margin: 0, fontFamily: 'var(--mono)', fontWeight: 600, textAlign: 'right' }}>{value}</dd>
                  </div>
                ))}
              </dl>
            </div>
          ))}
        </div>
      </Panel>

      {completed.length > 0 && (
        <div className="stat-grid">
          <Stat label="Est. downtime avoided" value={`${Math.round(downtimeSaved)} h`} sub="Based on completed work orders (simulation)" icon={<TrendingDown size={17} />} tone="teal" />
          <Stat label="Est. cost avoided" value={`$${Math.round(costSaved / 1000)}k`} sub="Simulation — see assumptions" icon={<Zap size={17} />} tone="teal" />
          <Stat label="MTTR improvement" value={`${fmt(mttrImprovement, 0)}%`} sub="Planned vs unplanned repair time" icon={<Timer size={17} />} tone="blue" />
          <Stat label="Planned interventions" value={interventions} sub="Detected and resolved pre-failure" icon={<CheckCircle2 size={17} />} tone="teal" />
        </div>
      )}

      <Panel title="Problem Statement 8 — capability coverage" id="coverage">
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          {CAPABILITIES.map(text => (
            <div key={text} style={{ display: 'flex', gap: 10, alignItems: 'flex-start', fontSize: 12, color: 'var(--text-dim)' }}>
              <CheckCircle2 size={14} style={{ color: 'var(--teal)', flexShrink: 0, marginTop: 2 }} />
              <span>{text}</span>
            </div>
          ))}
        </div>
      </Panel>

      <Panel title="Maintenance activity log" id="mactivity">
        {timeline.length > 0 ? (
          <ol className="timeline">
            {timeline.slice(0, 12).map(e => (
              <li key={e.id} className={`timeline-item ${e.kind}`}>
                <strong>{e.machineName} — {e.title}</strong>
                <span>{e.detail}</span>
                <time dateTime={e.createdAt}>{new Date(e.createdAt).toLocaleString()}</time>
              </li>
            ))}
          </ol>
        ) : (
          <Empty icon={<Activity size={20} />} title="No activity yet">
            Maintenance events will appear here as the simulation runs.
          </Empty>
        )}
      </Panel>

      <p className="fine">
        <TrendingUp size={11} />
        All economic figures use simulation assumptions. Real-world results depend on facility parameters. ForgeGuard is a simulation-based prototype; production deployment requires retraining on plant historian data and site validation.
      </p>
    </>
  );
}
