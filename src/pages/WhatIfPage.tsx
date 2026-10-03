import { useMemo, useState } from 'react';
import { ArrowRight, RefreshCw, RotateCcw } from 'lucide-react';
import { MODE_LABEL } from '../ml/inference/knowledge';
import type { Prediction } from '../ml/inference/engine';
import { useApp } from '../state/AppContext';
import { CONDITION_COLOR, ConditionBadge, Empty, healthColor, PageHeading, Panel, riskColor, Tag } from '../components/ui';
import { RiskRing } from '../components/charts';
import { NO_CHANGE, runWhatIf } from '../sim/whatif';
import type { WhatIfAdjustments } from '../sim/whatif';
import { hours, pct, signed } from '../lib/format';
import { rankFleet } from '../lib/fleetView';
import { navigate } from '../lib/router';

const PRESETS: { label: string; adj: Partial<WhatIfAdjustments> }[] = [
  { label: 'Bearing defect developing', adj: { vibration: 85, temperature: 3, current: 3 } },
  { label: 'Cooling failure', adj: { temperature: 16, current: 2 } },
  { label: 'Overload shift (95% load)', adj: { workload: 95 } },
  { label: 'Overload + binding', adj: { workload: 92, current: 22, temperature: 8 } },
  { label: 'Loose phase connection', adj: { current: 6, rpmInstability: 0.6, temperature: 4 } },
  { label: 'Encoder / belt slip', adj: { rpmInstability: 2.2, vibration: 35 } },
];

function Result({ title, p, compare }: { title: string; p: Prediction | null; compare?: Prediction | null }) {
  if (!p) return <Empty title="Not enough telemetry">Need at least 30 minutes of data.</Empty>;
  const delta = compare ? p.risk - compare.risk : 0;
  return (
    <div className="whatif-result">
      <h3>{title}</h3>
      <RiskRing value={p.risk} color={riskColor(p.risk)} size={120} />
      <ConditionBadge condition={p.condition} />
      <dl className="kv">
        {compare && <div><dt>Risk change</dt><dd style={{ color: delta > 0.5 ? CONDITION_COLOR.critical : delta < -0.5 ? CONDITION_COLOR.normal : undefined }}>{signed(delta, 1)} pts</dd></div>}
        <div><dt>Health</dt><dd style={{ color: healthColor(p.health) }}>{Math.round(p.health)}/100</dd></div>
        <div><dt>Model agreement</dt><dd>{Math.round(p.confidence)}/100</dd></div>
        <div><dt>Failure mode</dt><dd>{p.failureMode ? MODE_LABEL[p.failureMode] : 'None'}</dd></div>
        <div><dt>Time to failure</dt><dd>{p.ttf ? hours(p.ttf.hours) : 'Not at risk'}</dd></div>
        <div><dt>Anomalous</dt><dd>{p.anomalous ? 'Yes' : 'No'}</dd></div>
      </dl>
      <p className="whatif-rec"><strong>{p.recommendation.headline}</strong><br /><span className="muted">{p.recommendation.window}</span></p>
    </div>
  );
}

export function WhatIfPage({ id }: { id?: string }) {
  const { fleet, inference } = useApp();
  const machineId = id && fleet.get(id) ? id : rankFleet(fleet)[0].def.id;
  const m = fleet.get(machineId)!;
  const [snapshotAt, setSnapshotAt] = useState(fleet.minute);
  const snapshot = useMemo(() => fleet.window(m), [fleet, m, snapshotAt]); // eslint-disable-line react-hooks/exhaustive-deps
  const [adj, setAdj] = useState<WhatIfAdjustments>(() => NO_CHANGE(Math.round(m.sim.hoursSinceService)));
  const [prevId, setPrevId] = useState(machineId);
  if (prevId !== machineId) {
    setPrevId(machineId);
    setAdj(NO_CHANGE(Math.round(m.sim.hoursSinceService)));
    setSnapshotAt(fleet.minute);
  }
  const base = useMemo(() => runWhatIf(inference, snapshot, m.def.type, NO_CHANGE(snapshot.hoursSinceService)), [inference, snapshot, m.def.type]);
  const result = useMemo(() => runWhatIf(inference, snapshot, m.def.type, adj), [inference, snapshot, m.def.type, adj]);
  const set = (patch: Partial<WhatIfAdjustments>) => setAdj((a) => ({ ...a, ...patch }));
  const factorDiff = result && base ? result.factors.map((f) => ({ ...f, delta: f.points - (base.factors.find((b) => b.group === f.group)?.points ?? 0) })).sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta)) : [];
  const offline = m.status !== 'running';

  return (
    <>
      <PageHeading
        eyebrow="What-if analysis"
        title="Explore operating scenarios"
        copy={<>Changes are applied to the machine's latest 3-hour telemetry window (ramping in over the chosen duration) and re-scored by the full pipeline: features → anomaly detector → risk model → explanation → recommendation. <Tag kind="model" /></>}
        actions={
          <>
            <label className="field inline">
              <span className="sr-only">Machine</span>
              <select value={machineId} onChange={(e) => navigate({ page: 'whatif', id: e.target.value })} aria-label="Machine">
                {fleet.machines.map((x) => <option key={x.def.id} value={x.def.id}>{x.def.name}</option>)}
              </select>
            </label>
            <button className="button button-ghost" onClick={() => setSnapshotAt(fleet.minute)}><RefreshCw size={14} /> Latest data</button>
          </>
        }
      />
      {offline && <div className="info-banner">This machine is {m.status === 'failed' ? 'failed' : 'under maintenance'}; the analysis uses its last recorded telemetry.</div>}
      <div className="whatif-layout">
        <Panel title="Adjust parameters" id="adjust" actions={<button className="text-button" onClick={() => setAdj(NO_CHANGE(Math.round(m.sim.hoursSinceService)))}><RotateCcw size={12} /> Reset</button>}>
          <div className="preset-row">
            {PRESETS.map((p) => <button key={p.label} className="chip" onClick={() => setAdj({ ...NO_CHANGE(adj.hoursSinceService), ...p.adj })}>{p.label}</button>)}
          </div>
          <div className="sliders">
            <label className="field">Temperature <strong>{signed(adj.temperature)} °C</strong><input type="range" min={-5} max={30} step={1} value={adj.temperature} onChange={(e) => set({ temperature: Number(e.target.value) })} /></label>
            <label className="field">Vibration <strong>{signed(adj.vibration)}%</strong><input type="range" min={-20} max={200} step={5} value={adj.vibration} onChange={(e) => set({ vibration: Number(e.target.value) })} /></label>
            <label className="field">Motor current <strong>{signed(adj.current)}%</strong><input type="range" min={-15} max={50} step={1} value={adj.current} onChange={(e) => set({ current: Number(e.target.value) })} /></label>
            <label className="field">RPM instability <strong>±{adj.rpmInstability.toFixed(1)}%</strong><input type="range" min={0} max={4} step={0.1} value={adj.rpmInstability} onChange={(e) => set({ rpmInstability: Number(e.target.value) })} /></label>
            <label className="field">Workload <strong>{adj.workload === null ? 'as recorded' : `${adj.workload}%`}</strong><input type="range" min={0} max={100} step={5} value={adj.workload ?? 0} onChange={(e) => set({ workload: Number(e.target.value) === 0 ? null : Number(e.target.value) })} /></label>
            <label className="field">Hours since service <strong>{adj.hoursSinceService} h</strong><input type="range" min={0} max={3000} step={50} value={adj.hoursSinceService} onChange={(e) => set({ hoursSinceService: Number(e.target.value) })} /></label>
            <label className="field">Change develops over <strong>{adj.rampMinutes} min</strong><input type="range" min={10} max={180} step={10} value={adj.rampMinutes} onChange={(e) => set({ rampMinutes: Number(e.target.value) })} /></label>
          </div>
          <p className="fine">Workload changes propagate physically (load raises temperature, current and vibration), so the model's load-adjusted baseline is tested honestly — a heavier job alone should not look like a fault.</p>
        </Panel>
        <Panel title={`${m.def.name}: current vs scenario`} id="results">
          <div className="whatif-compare">
            <Result title="Current" p={base} />
            <ArrowRight className="whatif-arrow" size={22} aria-hidden="true" />
            <Result title="Scenario" p={result} compare={base} />
          </div>
          {factorDiff.length > 0 && (
            <div className="factor-diff">
              <h3>What changed in the explanation</h3>
              <ul>
                {factorDiff.map((f) => (
                  <li key={f.group}>
                    <span>{f.label}</span>
                    <span className="mono">{signed(f.points, 1)} pts</span>
                    <span className={`mono ${f.delta > 0.5 ? 'up' : f.delta < -0.5 ? 'down' : 'flat'}`}>({signed(f.delta, 1)})</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </Panel>
      </div>
    </>
  );
}
