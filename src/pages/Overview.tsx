import { Activity, AlertTriangle, Bell, CalendarClock, Download, Gauge, HeartPulse, ShieldAlert, ShieldCheck, TrendingUp, Wrench } from 'lucide-react';
import { MODE_LABEL } from '../ml/inference/knowledge';
import { useApp, useFleet, useRecords } from '../state/AppContext';
import { ConditionBadge, Empty, healthColor, PageHeading, Panel, riskColor, Stat, Tag } from '../components/ui';
import { Sparkline } from '../components/charts';
import { MachineIcon } from '../components/Layout';
import { rankFleet } from '../lib/fleetView';
import { href, navigate } from '../lib/router';
import { dateTime, hours, riskIdx, trendLabel } from '../lib/format';
import { alertsCsv, download } from '../lib/exports';
import type { MachineRuntime } from '../sim/fleet';
import { MACHINE_TYPES } from '../ml/data/machines';

function RiskMap({ machines }: { machines: MachineRuntime[] }) {
  return (
    <div className="risk-map" role="img" aria-label="Fleet risk versus health scatter plot">
      <div className="risk-map-zone critical">Critical risk</div>
      <div className="risk-map-zone warning">Warning</div>
      <div className="risk-map-zone normal">Normal</div>
      {machines.map((m) => {
        const p = m.prediction;
        if (!p) return null;
        return (
          <a
            key={m.def.id}
            href={href({ page: 'machine', id: m.def.id })}
            className="risk-dot"
            style={{
              left: `${Math.max(3, Math.min(97, p.health))}%`,
              bottom: `${Math.max(3, Math.min(97, p.risk))}%`,
              background: riskColor(p.risk),
            }}
            title={`${m.def.name}: risk ${Math.round(p.risk)}%, health ${Math.round(p.health)}`}
          >
            {p.risk >= 40 && <span>{m.def.name.replace(/^(CNC |3D |Drive |Conveyor |Spindle )/, '')}</span>}
          </a>
        );
      })}
      <span className="risk-map-axis x">Health index →</span>
      <span className="risk-map-axis y">Risk index →</span>
    </div>
  );
}

function HeroBanner({
  avgHealth,
  atRisk,
  failing24,
  totalMachines,
}: {
  avgHealth: number;
  atRisk: number;
  failing24: number;
  totalMachines: number;
}) {
  const { startDemo, demo } = useApp();
  return (
    <div className="hero">
      <div className="hero-kicker">
        <span className="hero-kicker-line" />
        University Fabrication Laboratory · Predictive Maintenance Platform
      </div>
      <h1>
        Detect machine degradation <em>before</em> it becomes a failure.
      </h1>
      <p className="hero-sub">
        ForgeGuard AI analyses simulated CNC machine, 3D printer, and motor telemetry — temperature, vibration,
        current, RPM and workload — to detect gradual degradation patterns, estimate failure risk, identify likely failure
        modes, and generate actionable maintenance recommendations. All telemetry is simulated; model metrics are from synthetic held-out data.
      </p>
      <div className="hero-metrics">
        <div className="hero-metric">
          <strong style={{ color: avgHealth >= 70 ? 'var(--teal)' : 'var(--amber)' }}>
            {Math.round(avgHealth)}
          </strong>
          <span>Fleet health avg</span>
        </div>
        <div className="hero-metric">
          <strong style={{ color: atRisk > 0 ? 'var(--amber)' : 'var(--teal)' }}>{atRisk}</strong>
          <span>Machines at risk</span>
        </div>
        <div className="hero-metric">
          <strong style={{ color: failing24 > 0 ? 'var(--red)' : 'var(--teal)' }}>{failing24}</strong>
          <span>Est. failures ≤ 24 h</span>
        </div>
        <div className="hero-metric">
          <strong>{totalMachines}</strong>
          <span>Machines monitored</span>
        </div>
      </div>
      {!demo.active && (
        <button
          className="button button-primary"
          style={{ marginTop: 24 }}
          onClick={startDemo}
          aria-label="Start judge demo"
        >
          <ShieldCheck size={14} /> Start Hackathon Demo
        </button>
      )}
    </div>
  );
}

export function Overview() {
  const fleet = useFleet();
  const { schedule } = useApp();
  const { alerts, timeline, workOrders } = useRecords();
  const ranked = rankFleet(fleet);
  const preds = fleet.machines.map((m) => m.prediction).filter((p): p is NonNullable<typeof p> => !!p);
  const avgHealth = preds.length ? preds.reduce((a, p) => a + p.health, 0) / preds.length : 0;
  const atRisk = fleet.machines.filter((m) => m.prediction && m.prediction.condition !== 'normal').length;
  const failing24 = fleet.machines.filter(
    (m) => m.status === 'failed' || (m.prediction?.ttf && m.prediction.ttf.hours <= 24)
  ).length;
  const running = fleet.machines.filter((m) => m.status === 'running').length;
  const openAlerts = alerts.filter((a) => a.status === 'open');
  const critical = ranked.filter((m) => m.status === 'failed' || m.prediction?.condition === 'critical');
  const openOrder = (id: string) => workOrders.find((w) => w.machineId === id && w.status !== 'completed');

  return (
    <>
      <HeroBanner
        avgHealth={avgHealth}
        atRisk={atRisk}
        failing24={failing24}
        totalMachines={fleet.machines.length}
      />

      {critical.length > 0 && (
        <div className="critical-banner" role="alert">
          <div className="critical-banner-icon">
            <ShieldAlert size={18} />
          </div>
          <div className="critical-banner-copy">
            <strong>
              {critical.length} machine{critical.length > 1 ? 's' : ''} require immediate attention
            </strong>
            <span>
              {critical
                .map(
                  (m) =>
                    `${m.def.name} (${m.status === 'failed' ? 'failed' : `risk index ${Math.round(m.prediction?.risk ?? 0)}/100`})`
                )
                .join(' · ')}
            </span>
          </div>
          <button
            className="critical-banner-action"
            onClick={() => navigate({ page: 'machine', id: critical[0].def.id })}
          >
            Investigate
          </button>
        </div>
      )}

      <div className="stat-grid">
        <Stat
          label="Fleet health index"
          value={Math.round(avgHealth)}
          sub="Average condition score (0–100)"
          icon={<HeartPulse size={17} />}
          tone={avgHealth >= 70 ? 'teal' : 'amber'}
        />
        <Stat
          label="Machines at risk"
          value={`${atRisk}/${fleet.machines.length}`}
          sub="Warning or critical condition"
          icon={<AlertTriangle size={17} />}
          tone={atRisk ? 'amber' : 'teal'}
        />
        <Stat
          label="Predicted failures ≤ 24 h"
          value={failing24}
          sub="Model time-to-failure estimate"
          icon={<CalendarClock size={17} />}
          tone={failing24 ? 'red' : 'teal'}
        />
        <Stat
          label="Open alerts"
          value={openAlerts.length}
          sub={`${running}/${fleet.machines.length} machines producing`}
          icon={<Bell size={17} />}
          tone={openAlerts.length ? 'red' : 'teal'}
        />
      </div>

      <div className="grid-2-1">
        <Panel
          title="Maintenance priority queue"
          subtitle="Ranked by risk, time-to-failure, trend and anomaly score"
          id="priority"
          actions={
            <a className="text-button" href={href({ page: 'maintenance' })}>
              <TrendingUp size={12} /> Full queue
            </a>
          }
        >
          <ol className="priority-list">
            {ranked.slice(0, 7).map((m, i) => {
              const p = m.prediction;
              const tr = trendLabel(fleet.trend(m));
              const wo = openOrder(m.def.id);
              const needs = m.status === 'failed' || (p && p.condition !== 'normal');
              return (
                <li key={m.def.id} className="priority-row">
                  <span className="priority-rank">{i + 1}</span>
                  <a className="priority-main" href={href({ page: 'machine', id: m.def.id })}>
                    <strong>
                      <MachineIcon type={m.def.type} size={13} /> {m.def.name}
                    </strong>
                    <span>
                      {m.status === 'failed'
                        ? 'Unplanned failure — production stopped'
                        : m.status === 'maintenance'
                          ? 'Under maintenance'
                          : p?.failureMode
                            ? `${MODE_LABEL[p.failureMode]} · ${p.ttf ? `~${hours(p.ttf.hours)} to failure` : ''}`
                            : p
                              ? 'Operating within learned baseline'
                              : 'Recommissioning — collecting data'}
                    </span>
                  </a>
                  <span className={`trend ${tr.tone}`}>{tr.label}</span>
                  <span className="priority-risk" style={{ color: riskColor(p?.risk ?? 0) }}>
                    {p ? riskIdx(p.risk) : '—'}
                  </span>
                  {needs && !wo && m.status !== 'maintenance' ? (
                    <button className="button button-small button-dark" onClick={() => schedule(m.def.id)}>
                      <Wrench size={12} /> Schedule
                    </button>
                  ) : (
                    <span className="priority-state">
                      {wo
                        ? `${wo.priority} ${wo.status.replace('_', ' ')}`
                        : m.status === 'maintenance'
                          ? 'In service'
                          : 'OK'}
                    </span>
                  )}
                </li>
              );
            })}
          </ol>
        </Panel>
        <Panel
          title="Fleet risk map"
          subtitle="Each dot represents one machine — click to open"
          id="riskmap"
        >
          <RiskMap machines={fleet.machines} />
          <div className="legend" style={{ marginTop: 10 }}>
            <span>
              <i style={{ background: 'var(--red)' }} />
              Critical (≥70%)
            </span>
            <span>
              <i style={{ background: 'var(--amber)' }} />
              Warning (40–70%)
            </span>
            <span>
              <i style={{ background: 'var(--teal)' }} />
              Normal (&lt;40%)
            </span>
          </div>
        </Panel>
      </div>

      <Panel
        title="Fleet overview"
        subtitle="Risk index is a 0–100 model score (not a probability of failure); health is a rule-based condition index. All data is simulated."
        id="machines"
        actions={
          <button
            className="button button-ghost button-small"
            onClick={() => download('forgeguard-alerts.csv', alertsCsv(alerts), 'text/csv')}
          >
            <Download size={13} /> Export alerts
          </button>
        }
      >
        <div className="machine-grid">
          {fleet.machines.map((m) => {
            const p = m.prediction;
            const risk = p?.risk ?? 0;
            const recommissioning = fleet.recommissioning(m);
            return (
              <a
                key={m.def.id}
                className={`machine-card ${m.status === 'failed' ? 'failed' : (p?.condition ?? '')}`}
                href={href({ page: 'machine', id: m.def.id })}
              >
                <div className="machine-card-top">
                  <span className="machine-icon">
                    <MachineIcon type={m.def.type} />
                  </span>
                  <div>
                    <strong>{m.def.name}</strong>
                    <small>
                      {m.def.model} · {MACHINE_TYPES[m.def.type].label}
                    </small>
                  </div>
                  {p ? (
                    <ConditionBadge condition={p.condition} failed={m.status === 'failed'} />
                  ) : (
                    <span className="badge muted">{m.status === 'maintenance' ? 'Service' : 'Starting'}</span>
                  )}
                </div>
                <div className="machine-card-metrics">
                  <div>
                    <span>Risk</span>
                    <strong style={{ color: riskColor(risk) }}>{p ? riskIdx(risk) : '—'}</strong>
                  </div>
                  <div>
                    <span>Health</span>
                    <strong style={{ color: healthColor(p?.health ?? 100) }}>
                      {p ? Math.round(p.health) : '—'}
                    </strong>
                  </div>
                  <div>
                    <span title="Heuristic agreement of the forest's class votes; not a calibrated probability">Model agreement</span>
                    <strong>{p ? riskIdx(p.confidence) : '—'}</strong>
                  </div>
                </div>
                <Sparkline
                  values={m.riskHistory.slice(-72).map((r) => r.risk)}
                  color={riskColor(risk)}
                />
                <small className="machine-card-foot">
                  {m.status === 'failed'
                    ? 'Machine down — unplanned failure'
                    : m.status === 'maintenance'
                      ? 'Locked out for maintenance'
                      : recommissioning !== null
                        ? `Recommissioning · ${Math.min(30, recommissioning)}/30 min data`
                        : p?.failureMode
                          ? MODE_LABEL[p.failureMode]
                          : 'Operating within learned baseline'}
                </small>
              </a>
            );
          })}
        </div>
      </Panel>

      <Panel
        title="Recent activity"
        subtitle="Alerts, maintenance actions and verifications"
        id="activity"
        actions={
          <a className="text-button" href={href({ page: 'maintenance' })}>
            Full history
          </a>
        }
      >
        {timeline.length ? (
          <ul className="activity-list">
            {timeline.slice(0, 8).map((e) => (
              <li key={e.id} className="activity-row">
                <span className={`activity-icon ${e.kind}`}>
                  {e.kind === 'alert' || e.kind === 'failure' ? (
                    <AlertTriangle size={13} />
                  ) : e.kind === 'verified' ? (
                    <Gauge size={13} />
                  ) : e.kind === 'note' ? (
                    <Activity size={13} />
                  ) : (
                    <Wrench size={13} />
                  )}
                </span>
                <div className="activity-copy">
                  <strong>
                    {e.machineName} — {e.title}
                  </strong>
                  <span>{e.detail}</span>
                </div>
                <time dateTime={e.createdAt}>{dateTime(e.createdAt)}</time>
              </li>
            ))}
          </ul>
        ) : (
          <Empty icon={<Activity size={20} />} title="No activity yet">
            Alerts and maintenance actions will appear here as the simulation runs.
          </Empty>
        )}
      </Panel>
    </>
  );
}
