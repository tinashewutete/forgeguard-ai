import { useState } from 'react';
import { AlertTriangle, ArrowLeft, CheckCircle2, ClipboardList, Download, Eye, EyeOff, FileText, FlaskConical, Play, SlidersHorizontal, Wrench } from 'lucide-react';
import { MACHINE_TYPES } from '../ml/data/machines';
import { MODE_LABEL } from '../ml/inference/knowledge';
import { FAILURE_MODES } from '../ml/types';
import type { FailureMode } from '../ml/types';
import { useApp, useFleet, useRecords } from '../state/AppContext';
import { CONDITION_COLOR, ConditionBadge, Empty, healthColor, Panel, riskColor, Tag } from '../components/ui';
import { LineChart, Meter, RiskRing } from '../components/charts';
import { MachineIcon } from '../components/Layout';
import { CompleteDialog } from '../components/WorkOrderDialog';
import { baselineBand, downsample, SENSOR_META, tail, xLabels } from '../lib/fleetView';
import type { TelemetryKey } from '../lib/fleetView';
import { dateTime, fmt, hours, pct, signed, trendLabel } from '../lib/format';
import { download, incidentReport, incidentReportHtml, printHtml, telemetryCsv } from '../lib/exports';
import { href, navigate } from '../lib/router';

const WINDOWS = [
  { minutes: 15, label: '15 min' },
  { minutes: 60, label: '1 h' },
  { minutes: 360, label: '6 h' },
  { minutes: 1440, label: '24 h' },
] as const;


export function MachinePage({ id }: { id: string }) {
  const fleet = useFleet();
  const { model, schedule, startWork } = useApp();
  const { alerts, workOrders, timeline } = useRecords();
  const [showTruth, setShowTruth] = useState(false);
  const [completing, setCompleting] = useState<string | null>(null);
  const [mode, setMode] = useState<FailureMode>('bearing_wear');
  const [windowMin, setWindowMin] = useState<number>(360);
  const m = fleet.get(id);
  if (!m) {
    return (
      <Empty icon={<AlertTriangle size={22} />} title="Machine not found">
        <a href={href({ page: 'overview' })}>Back to fleet overview</a>
      </Empty>
    );
  }
  const p = m.prediction;
  const type = MACHINE_TYPES[m.def.type];
  const risk = p?.risk ?? 0;
  const tr = trendLabel(fleet.trend(m));
  const order = workOrders.find((w) => w.machineId === id && w.status !== 'completed');
  const lastDone = workOrders.find((w) => w.machineId === id && w.status === 'completed');
  const myAlerts = alerts.filter((a) => a.machineId === id).slice(0, 6);
  const myEvents = timeline.filter((e) => e.machineId === id).slice(0, 10);
  const truth = fleet.truth(id);
  const recommissioning = fleet.recommissioning(m);
  const available = m.series.minute.length;
  const span = Math.max(2, Math.min(windowMin, available));
  const windowLabel = WINDOWS.find((w) => w.minutes === windowMin)?.label ?? `${windowMin} min`;
  const labels = xLabels(fleet, span);
  const riskHist = m.riskHistory.slice(-144);
  const maxPoints = Math.max(...(p?.factors.map((f) => Math.abs(f.points)) ?? [1]), 1);
  const availableModes = type.modes;

  return (
    <>
      <a className="back-link" href={href({ page: 'overview' })}><ArrowLeft size={13} /> Fleet overview</a>
      <div className="machine-header">
        <span className="machine-icon large"><MachineIcon type={m.def.type} size={22} /></span>
        <div className="machine-title">
          <h1>{m.def.name} {p ? <ConditionBadge condition={p.condition} failed={m.status === 'failed'} /> : <span className="badge muted">{m.status === 'maintenance' ? 'Maintenance' : 'Recommissioning'}</span>}</h1>
          <p>{m.def.model} · {type.label} · {m.def.location} · {Math.round(m.operatingHours).toLocaleString()} operating h · {Math.round(m.sim.hoursSinceService)} h since service</p>
        </div>
        <div className="heading-actions wrap">
          {!order && m.status !== 'maintenance' && (
            <button className="button button-primary" onClick={() => schedule(id)}><Wrench size={14} /> Schedule maintenance</button>
          )}
          {order?.status === 'scheduled' && <button className="button button-primary" onClick={() => startWork(order.id)}><Play size={14} /> Start inspection</button>}
          {order && order.status !== 'completed' && <button className="button button-dark" onClick={() => setCompleting(order.id)}><CheckCircle2 size={14} /> Record outcome</button>}
          <button className="button button-ghost" onClick={() => navigate({ page: 'whatif', id })}><SlidersHorizontal size={14} /> What-if</button>
          <button className="button button-ghost" onClick={() => printHtml(incidentReportHtml(fleet, m, alerts, workOrders, timeline))}><FileText size={14} /> Incident report (PDF)</button>
          <button className="button button-ghost" onClick={() => download(`incident-${id}.md`, incidentReport(fleet, m, alerts, workOrders, timeline), 'text/markdown')}><Download size={14} /> Markdown</button>
          <button className="button button-ghost" onClick={() => download(`telemetry-${id}.csv`, telemetryCsv(fleet, m), 'text/csv')} aria-label="Download telemetry CSV"><Download size={14} /> CSV</button>
        </div>
      </div>

      {m.status === 'failed' && (
        <div className="critical-banner" role="alert">
          <div className="critical-banner-icon"><AlertTriangle size={18} /></div>
          <div className="critical-banner-copy">
            <strong>Unplanned failure — production stopped</strong>
            <span>This is what happens when degradation goes unaddressed. Schedule a repair to restore the machine.</span>
          </div>
        </div>
      )}
      {m.status === 'maintenance' && <div className="info-banner" role="status"><Wrench size={15} /> Machine locked out for maintenance by {order?.technician ?? 'technician'} — no telemetry while offline.</div>}
      {recommissioning !== null && <div className="info-banner" role="status"><FlaskConical size={15} /> Recommissioned after service — collecting fresh telemetry for verification ({Math.min(30, recommissioning)}/30 min).</div>}
      {order && m.status === 'running' && <div className="info-banner" role="status"><ClipboardList size={15} /> {order.priority} work order "{order.title}" scheduled for {dateTime(order.scheduledFor)} · {order.technician}</div>}
      {lastDone?.verifiedAt && lastDone.riskAfter !== undefined && (
        <div className="info-banner success" role="status"><CheckCircle2 size={15} /> Last repair verified: risk index {Math.round(lastDone.riskBefore)} → {Math.round(lastDone.riskAfter)} (of 100), health {Math.round(lastDone.healthBefore)} → {Math.round(lastDone.healthAfter ?? 0)}.</div>
      )}

      <div className="assessment-grid">
        <Panel title="Risk index" subtitle={<Tag kind="model" />} className="assessment">
          <div className="assessment-body">
            <RiskRing value={risk} color={riskColor(risk)} />
            <dl className="kv">
              <div><dt>Condition</dt><dd style={{ color: p ? CONDITION_COLOR[p.condition] : undefined }}>{p ? (m.status === 'failed' ? 'Failed' : p.condition.toUpperCase()) : '—'}</dd></div>
              <div><dt title="Heuristic: 60% top class vote share + 40% (1 − vote entropy). Not calibrated against observed outcomes.">Model agreement</dt><dd>{p ? `${Math.round(p.confidence)}/100` : '—'}</dd></div>
              <div><dt>Risk trend (1 h)</dt><dd className={`trend ${tr.tone}`}>{tr.label}</dd></div>
              <div><dt>Class vote shares</dt><dd className="mono small">{p ? `N ${pct(p.probabilities.normal * 100)} · W ${pct(p.probabilities.warning * 100)} · C ${pct(p.probabilities.critical * 100)}` : '—'}</dd></div>
            </dl>
          </div>
        </Panel>
        <Panel title="Machine health" subtitle={<Tag kind="rule" />} className="assessment">
          <div className="health-score">
            <strong style={{ color: healthColor(p?.health ?? 100) }}>{p ? Math.round(p.health) : '—'}</strong>
            <span>/100 current condition</span>
          </div>
          {p && (
            <ul className="subsystems">
              {([['Vibration', p.subsystems.vibration], ['Thermal', p.subsystems.thermal], ['Electrical', p.subsystems.electrical], ['Rotational', p.subsystems.rotational], ['Load / service', p.subsystems.load]] as [string, number][]).map(([label, v]) => (
                <li key={label}><span>{label}</span><Meter value={v} color={healthColor(v)} label={`${label} health`} /><em>{Math.round(v)}</em></li>
              ))}
            </ul>
          )}
        </Panel>
        <Panel title="Diagnosis" subtitle={<Tag kind="model" />} className="assessment">
          <dl className="kv stacked">
            <div><dt>Likely failure mode</dt><dd>{p?.failureMode ? MODE_LABEL[p.failureMode] : 'None detected'}</dd></div>
            <div>
              <dt>Est. time to failure</dt>
              <dd>{m.status === 'failed' ? 'Failed' : p?.ttf ? <>{hours(p.ttf.hours)} <small className="muted">(range {hours(p.ttf.low)}–{hours(p.ttf.high)})</small></> : 'Not at risk'}</dd>
            </div>
            <div><dt>Anomaly score</dt><dd>{p ? <>{fmt(p.anomalyScore, 3)} {p.anomalous ? <span className="badge warning">Abnormal pattern</span> : <span className="muted small">within healthy envelope</span>}</> : '—'}</dd></div>
          </dl>
          {p && p.failureMode && (
            <ul className="mode-bars" aria-label="Failure mode shares">
              {p.modeProbabilities.slice(0, 3).map((mp) => (
                <li key={mp.mode}><span>{MODE_LABEL[mp.mode]}</span><Meter value={mp.p * 100} color="#7f9fc7" label={`${MODE_LABEL[mp.mode]} share`} /><em>{pct(mp.p * 100)}</em></li>
              ))}
            </ul>
          )}
          <p className="fine">Time to failure is the median of per-tree regression outputs; the range is the 10th–90th percentile of those outputs, widened by fixed factors (×0.8 / ×1.25). It is a spread of model estimates on simulated data, not a validated confidence interval or remaining useful life. Mode shares are forest vote shares, not calibrated probabilities.</p>
        </Panel>
      </div>

      <div className="grid-2-1">
        <Panel title="Why this prediction?" subtitle="Per-machine contributions to risk, decomposed along every tree's decision path (exact additive attribution)" id="explain">
          {p ? (
            <>
              <p className="explain-base">Fleet base rate {fmt(p.baseRisk, 1)}% {p.factors.map((f) => (f.points >= 0 ? ' + ' : ' − ') + Math.abs(f.points).toFixed(1)).join('')} = <strong>{fmt(p.risk, 1)}%</strong></p>
              <ul className="factor-list">
                {p.factors.map((f) => (
                  <li key={f.group}>
                    <div className="factor-head">
                      <strong>{f.label}</strong>
                      <span className={f.points > 0.5 ? 'up' : f.points < -0.5 ? 'down' : 'flat'}>{signed(f.points, 1)} pts</span>
                    </div>
                    <div className="factor-bar"><div style={{ width: `${(Math.abs(f.points) / maxPoints) * 100}%`, background: f.points >= 0 ? riskColor(Math.min(100, 40 + f.points * 2)) : '#5d7488' }} /></div>
                    <small>{f.evidence}</small>
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <Empty title="No prediction yet">Waiting for 30 minutes of fresh telemetry.</Empty>
          )}
        </Panel>
        <Panel title="Recommended action" subtitle="Generated from predicted failure mode, risk and time-to-failure" id="rec">
          {p ? (
            <div className={`recommendation ${p.recommendation.urgency}`}>
              <strong>{p.recommendation.headline}</strong>
              <span className="rec-window">Window: {p.recommendation.window}</span>
              <ol>{p.recommendation.actions.map((a) => <li key={a}>{a}</li>)}</ol>
              {p.recommendation.checks.length > 0 && <><h3>Also check</h3><ul>{p.recommendation.checks.map((c) => <li key={c}>{c}</li>)}</ul></>}
              <p className="if-ignored"><AlertTriangle size={13} /> {p.recommendation.ifIgnored}</p>
              {p.recommendation.estimatedDowntimeHours > 0 && <p className="fine">Planned intervention ≈ {p.recommendation.estimatedDowntimeHours} h downtime (estimate).</p>}
            </div>
          ) : (
            <Empty title="No recommendation yet" />
          )}
        </Panel>
      </div>

      <Panel
        title={`Live telemetry — last ${windowLabel}`}
        subtitle={<>Shaded band = expected healthy range for the current workload (±3σ) <Tag kind="sim" /></>}
        id="telemetry"
        actions={(
          <div className="speed-control" role="group" aria-label="Telemetry time window">
            {WINDOWS.map((w) => (
              <button key={w.minutes} type="button" className={`speed-btn ${windowMin === w.minutes ? 'active' : ''}`} aria-pressed={windowMin === w.minutes} onClick={() => setWindowMin(w.minutes)}>{w.label}</button>
            ))}
          </div>
        )}
      >
        <div className="telemetry-grid">
          {(['vibration', 'temperature', 'current', 'rpm'] as TelemetryKey[]).map((k) => {
            const meta = SENSOR_META[k];
            const latest = m.latest ? m.latest[k] : NaN;
            const band = baselineBand(m, k, span, model?.baseline);
            return (
              <div key={k} className="telemetry-card">
                <div className="telemetry-head">
                  <span>{meta.label}</span>
                  <strong className="mono">{m.status === 'maintenance' ? 'offline' : `${fmt(latest, meta.digits)} ${meta.unit}`}</strong>
                </div>
                <LineChart ariaLabel={`${meta.label} trend`} series={[{ values: tail(m, k, span, 160), color: meta.color, label: meta.label }]} band={{ ...band, label: 'Healthy band' }} height={110} xLabels={labels} format={(v) => fmt(v, k === 'rpm' ? 0 : 1)} />
              </div>
            );
          })}
        </div>
        <div className="workload-strip">
          <span>Workload {m.latest ? pct(m.latest.workload) : ''}</span>
          <LineChart ariaLabel="Workload trend" series={[{ values: tail(m, 'workload', span, 160), color: SENSOR_META.workload.color, label: 'Workload', fill: true }]} min={0} max={100} height={46} format={(v) => `${v.toFixed(0)}%`} />
        </div>
      </Panel>

      <div className="grid-2-1">
        <Panel title="Risk & health history — last 12 h" subtitle="Model risk (solid) and health index (dashed)" id="riskhist">
          <LineChart
            ariaLabel="Risk history"
            series={[
              { values: downsample(riskHist.map((r) => r.risk), 144), color: riskColor(risk), label: 'Risk', fill: true },
              { values: downsample(riskHist.map((r) => r.health), 144), color: '#7f9fc7', label: 'Health', dashed: true, width: 1.2 },
            ]}
            min={0}
            max={100}
            thresholds={[{ value: 70, color: CONDITION_COLOR.critical, label: 'Critical 70' }, { value: 40, color: CONDITION_COLOR.warning, label: 'Warning 40' }]}
            height={180}
            xLabels={xLabels(fleet, riskHist.length * 5)}
          />
        </Panel>
        <Panel
          title="Simulator controls"
          subtitle="Change what the simulator does — the model only sees the resulting telemetry"
          id="sim"
          actions={<button className="text-button" onClick={() => setShowTruth((s) => !s)} aria-pressed={showTruth}>{showTruth ? <EyeOff size={12} /> : <Eye size={12} />} Ground truth</button>}
        >
          <div className="sim-controls">
            <div className="segmented" role="group" aria-label="Scenario preset">
              {(['normal', 'warning', 'critical'] as const).map((s) => (
                <button key={s} className={`seg ${s}`} onClick={() => fleet.setScenario(id, s, s === 'normal' ? undefined : availableModes.includes(mode) ? mode : availableModes[0])} disabled={m.status === 'maintenance'}>
                  {s === 'normal' ? 'Healthy (reset)' : s === 'warning' ? 'Degrading' : 'Near failure'}
                </button>
              ))}
            </div>
            <label className="field">
              Failure mode to inject
              <select value={availableModes.includes(mode) ? mode : availableModes[0]} onChange={(e) => setMode(e.target.value as FailureMode)}>
                {FAILURE_MODES.filter((fm) => availableModes.includes(fm)).map((fm) => <option key={fm} value={fm}>{MODE_LABEL[fm]}</option>)}
              </select>
            </label>
            <button className="button button-dark" disabled={m.status !== 'running'} onClick={() => fleet.injectFault(id, availableModes.includes(mode) ? mode : availableModes[0], 36)}>Start gradual degradation (36 h to failure)</button>
            <label className="field">
              Workload override: {m.controls.workloadOverride === null ? 'auto (shift pattern)' : `${m.controls.workloadOverride}%`}
              <input type="range" min={0} max={100} step={5} value={m.controls.workloadOverride ?? 0} onChange={(e) => fleet.setControls(id, { workloadOverride: Number(e.target.value) === 0 ? null : Number(e.target.value) })} aria-label="Workload override" />
            </label>
            <label className="field">
              Sensor noise ×{m.controls.noise.toFixed(1)}
              <input type="range" min={0.5} max={3} step={0.1} value={m.controls.noise} onChange={(e) => fleet.setControls(id, { noise: Number(e.target.value) })} aria-label="Sensor noise multiplier" />
            </label>
            <label className="field">
              Degradation speed ×{m.controls.degradationSpeed.toFixed(1)}
              <input type="range" min={0.5} max={5} step={0.5} value={m.controls.degradationSpeed} onChange={(e) => fleet.setControls(id, { degradationSpeed: Number(e.target.value) })} aria-label="Degradation speed multiplier" />
            </label>
            {showTruth && truth && (
              <div className="truth-box" role="note">
                <strong>Hidden simulator state</strong>
                <span>Degradation: {pct(truth.degradation * 100)} · Mode: {truth.mode ? MODE_LABEL[truth.mode] : 'none'} · True time to failure: {Number.isFinite(truth.ttfMinutes) ? hours(truth.ttfMinutes / 60) : '∞'}</span>
              </div>
            )}
          </div>
        </Panel>
      </div>

      <div className="grid-2">
        <Panel title="Alerts for this machine" id="malerts" actions={<a className="text-button" href={href({ page: 'alerts' })}>Alert center</a>}>
          {myAlerts.length ? (
            <ul className="activity-list">
              {myAlerts.map((a) => (
                <li key={a.id} className="activity-row">
                  <span className={`activity-icon ${a.severity === 'warning' ? 'warning' : 'critical'}`}><AlertTriangle size={13} /></span>
                  <div className="activity-copy"><strong>{a.message}</strong><span>{a.status} · model agreement {Math.round(a.confidence)}/100</span></div>
                  <time dateTime={a.createdAt}>{dateTime(a.createdAt)}</time>
                </li>
              ))}
            </ul>
          ) : <Empty title="No alerts" />}
        </Panel>
        <Panel title="Maintenance history" id="mhistory">
          {myEvents.length ? (
            <ol className="timeline">
              {myEvents.map((e) => (
                <li key={e.id} className={`timeline-item ${e.kind}`}>
                  <strong>{e.title}</strong>
                  <span>{e.detail}</span>
                  <time dateTime={e.createdAt}>{dateTime(e.createdAt)}</time>
                </li>
              ))}
            </ol>
          ) : <Empty title="No history yet" />}
        </Panel>
      </div>
      {completing && (() => {
        const wo = workOrders.find((w) => w.id === completing);
        return wo ? <CompleteDialog order={wo} onClose={() => setCompleting(null)} /> : null;
      })()}
    </>
  );
}
