import { BrainCircuit, Database, FlaskConical, Info, Ruler, Timer } from 'lucide-react';
import { FEATURES } from '../ml/features';
import { MODE_LABEL } from '../ml/inference/knowledge';
import { CONDITIONS } from '../ml/types';
import type { FailureMode } from '../ml/types';
import { useApp } from '../state/AppContext';
import { Empty, PageHeading, Panel, Stat } from '../components/ui';
import { fmt, pct } from '../lib/format';

function Confusion({ matrix, labels, title }: { matrix: number[][]; labels: string[]; title: string }) {
  const max = Math.max(...matrix.flat(), 1);
  return (
    <div className="table-wrap">
      <table className="confusion" aria-label={title}>
        <thead>
          <tr><th scope="col">Actual ↓ / Predicted →</th>{labels.map((l) => <th key={l} scope="col">{l}</th>)}</tr>
        </thead>
        <tbody>
          {matrix.map((row, i) => {
            const total = row.reduce((a, b) => a + b, 0) || 1;
            return (
              <tr key={labels[i]}>
                <th scope="row">{labels[i]}</th>
                {row.map((v, j) => (
                  <td key={j} style={{ background: `rgba(${i === j ? '91,214,190' : '240,109,101'}, ${(v / max) * 0.55 + (v ? 0.05 : 0)})` }}>
                    <strong>{v}</strong>
                    <small>{pct((v / total) * 100)}</small>
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export function ModelPage() {
  const { model, modelStatus } = useApp();
  if (!model) {
    return (
      <>
        <PageHeading eyebrow="Model transparency" title="Model & evaluation" />
        <Empty icon={<Info size={22} />} title={modelStatus === 'loading' ? 'Loading model…' : 'Model artifact unavailable'}>
          ForgeGuard is running on its rule-based fallback (baseline-deviation thresholds). Run <code>npm run train</code> to regenerate the model artifact.
        </Empty>
      </>
    );
  }
  const m = model.metrics;
  const featureLabel = (key: string) => FEATURES.find((f) => f.key === key)?.label ?? key;
  const maxImp = Math.max(...m.permutationImportance.map((x) => x.importance), 1e-6);
  const totalTrees = model.riskForest.trees.length + model.modeForest.trees.length + model.ttfForest.trees.length + model.isolation.trees.length;
  return (
    <>
      <PageHeading
        eyebrow="Model transparency"
        title={<>{model.name} <span>v{model.version}</span></>}
        copy={<>Trained {new Date(model.createdAt).toLocaleString()} · seed {model.seed} · {totalTrees} trees · trained in {fmt(m.trainingSeconds, 1)} s. All metrics below are measured on <strong>synthetic</strong> held-out machines — they show the pipeline works, not industrial validation.</>}
      />
      <div className="stat-grid">
        <Stat label="Risk class accuracy" value={pct(m.risk.accuracy * 100, 1)} sub={`Macro F1 ${fmt(m.risk.macroF1, 3)}`} icon={<BrainCircuit size={17} />} tone="teal" />
        <Stat label="ROC-AUC (at risk vs normal)" value={fmt(m.risk.rocAucAtRisk, 3)} sub={`Critical vs rest ${fmt(m.risk.rocAucCritical, 3)}`} icon={<BrainCircuit size={17} />} tone="blue" />
        <Stat label="Failures caught in advance" value={`${m.leadTime.failuresDetected}/${m.leadTime.failuresTotal}`} sub={`Median warning ${fmt(m.leadTime.medianWarningLeadHours, 1)} h before failure`} icon={<Timer size={17} />} tone="teal" />
        <Stat label="False alarms" value={`${fmt(m.leadTime.falseAlarmsPer1000h, 1)}`} sub="Debounced warnings per 1,000 healthy hours" icon={<FlaskConical size={17} />} tone="amber" />
      </div>

      <div className="grid-2">
        <Panel title="Dataset" subtitle="Synthetic run-to-failure trajectories from the physics-inspired simulator" id="dataset">
          <dl className="kv two-col">
            <div><dt>Trajectories</dt><dd>{m.dataset.trajectories.train + m.dataset.trajectories.validation + m.dataset.trajectories.test} ({m.dataset.failingTrajectories} run-to-failure, {m.dataset.healthyTrajectories} healthy)</dd></div>
            <div><dt>Simulated machine-hours</dt><dd>{m.dataset.simulatedHours.toLocaleString()}</dd></div>
            <div><dt>Split (by machine, no leakage)</dt><dd>{m.dataset.trajectories.train} / {m.dataset.trajectories.validation} / {m.dataset.trajectories.test} trajectories</dd></div>
            <div><dt>Feature windows</dt><dd>{m.dataset.windows.train.toLocaleString()} / {m.dataset.windows.validation.toLocaleString()} / {m.dataset.windows.test.toLocaleString()}</dd></div>
            <div><dt>Train class balance</dt><dd>{CONDITIONS.map((c) => `${c} ${m.dataset.classBalance[c]?.toLocaleString()}`).join(' · ')}</dd></div>
            <div><dt>Labels</dt><dd>Critical ≤ {model.horizons.criticalHours} h to failure · Warning ≤ {model.horizons.warningHours} h · otherwise Normal</dd></div>
          </dl>
          <p className="fine"><Database size={11} /> Machine types: CNC mills, CNC lathes, 3D printers, induction motors. Includes stressed-but-healthy runs (high load, extra noise) as hard negatives.</p>
        </Panel>
        <Panel title="Models in the ensemble" id="models">
          <ul className="model-list">
            <li><strong>Risk classifier</strong> — Random forest, {model.riskForest.trees.length} trees, max depth {model.riskForest.params.maxDepth} (selected on validation: {Object.entries(m.risk.validationMacroF1).map(([d, f]) => `depth ${d} F1 ${fmt(f, 3)}`).join(', ')}). Risk = P(warning)·{model.riskWeights[1]} + P(critical)·{model.riskWeights[2]}.</li>
            <li><strong>Anomaly detector</strong> — Isolation forest, {model.isolation.trees.length} trees trained only on healthy windows; threshold = 99th percentile of healthy validation scores ({fmt(m.anomaly.threshold, 3)}).</li>
            <li><strong>Failure-mode classifier</strong> — Random forest, {model.modeForest.trees.length} trees over 5 failure modes.</li>
            <li><strong>Time-to-failure regressor</strong> — Random forest on log-hours, {model.ttfForest.trees.length} trees; the 10th–90th percentile of tree outputs gives the uncertainty range.</li>
            <li><strong>Explainability</strong> — exact additive decomposition of each tree's prediction along its decision path (Saabas / TreeInterpreter), aggregated by sensor group; global importance by permutation on the test split.</li>
          </ul>
        </Panel>
      </div>

      <div className="grid-2">
        <Panel title="Risk condition — test set" subtitle={`Accuracy ${pct(m.risk.accuracy * 100, 1)} · macro F1 ${fmt(m.risk.macroF1, 3)}`} id="cm">
          <Confusion matrix={m.risk.confusion} labels={CONDITIONS} title="Risk confusion matrix" />
          <div className="table-wrap">
            <table className="metric-table">
              <thead><tr><th scope="col">Class</th><th scope="col">Precision</th><th scope="col">Recall</th><th scope="col">F1</th><th scope="col">Support</th></tr></thead>
              <tbody>{m.risk.perClass.map((c) => <tr key={c.label}><th scope="row">{c.label}</th><td>{fmt(c.precision, 3)}</td><td>{fmt(c.recall, 3)}</td><td>{fmt(c.f1, 3)}</td><td>{c.support}</td></tr>)}</tbody>
            </table>
          </div>
          <p className="fine">Most errors are early-warning windows predicted as normal: at 24–36 h before failure the degradation signal is often still within sensor noise. Critical windows are rarely missed.</p>
        </Panel>
        <Panel title="Global feature importance" subtitle="Drop in macro-F1 when each feature is shuffled (permutation importance, test set)" id="imp">
          <ul className="importance-list">
            {m.permutationImportance.slice(0, 12).map((f) => (
              <li key={f.key}>
                <span>{featureLabel(f.key)}</span>
                <div className="factor-bar"><div style={{ width: `${(f.importance / maxImp) * 100}%` }} /></div>
                <em>{fmt(f.importance, 3)}</em>
              </li>
            ))}
          </ul>
        </Panel>
      </div>

      <div className="grid-3">
        <Panel title="Anomaly detection" id="anom">
          <dl className="kv stacked">
            <div><dt>False-positive rate (healthy windows)</dt><dd>{pct(m.anomaly.falsePositiveRateHealthy * 100, 1)}</dd></div>
            <div><dt>Detection rate — critical windows</dt><dd>{pct(m.anomaly.detectionRateCritical * 100, 1)}</dd></div>
            <div><dt>Detection rate — warning windows</dt><dd>{pct(m.anomaly.detectionRateWarning * 100, 1)}</dd></div>
          </dl>
        </Panel>
        <Panel title="Failure-mode identification" id="modeacc">
          <dl className="kv stacked">
            <div><dt>Accuracy (degradation ≥ 12%)</dt><dd>{pct(m.failureMode.accuracy * 100, 1)}</dd></div>
            <div><dt>Macro F1</dt><dd>{fmt(m.failureMode.macroF1, 3)}</dd></div>
          </dl>
        </Panel>
        <Panel title="Time-to-failure estimate" id="ttf">
          <dl className="kv stacked">
            <div><dt>Mean absolute error (≤ 72 h windows)</dt><dd>{fmt(m.timeToFailure.maeHours, 1)} h</dd></div>
            <div><dt>Median absolute error</dt><dd>{fmt(m.timeToFailure.medianAbsErrorHours, 1)} h</dd></div>
            <div><dt>Interval coverage</dt><dd>{pct(m.timeToFailure.intervalCoverage * 100, 0)}</dd></div>
          </dl>
        </Panel>
      </div>

      <Panel title="Failure-mode confusion — test set" id="modecm">
        <Confusion matrix={m.failureMode.confusion} labels={m.failureMode.labels.map((l) => MODE_LABEL[l as FailureMode])} title="Failure mode confusion matrix" />
      </Panel>

      <Panel title={`Engineered features (${FEATURES.length})`} subtitle="Computed from a rolling 3-hour window; deviations are relative to a load-adjusted healthy baseline" id="features">
        <div className="table-wrap">
          <table className="metric-table">
            <thead><tr><th scope="col">Feature</th><th scope="col">Group</th><th scope="col">Definition</th></tr></thead>
            <tbody>{FEATURES.map((f) => <tr key={f.key}><th scope="row">{f.label}</th><td>{f.group}</td><td>{f.description}</td></tr>)}</tbody>
          </table>
        </div>
      </Panel>

      <Panel title="Limitations" id="limits">
        <ul className="plain-list">
          <li>Training and evaluation data are synthetic. Real deployment requires retraining on plant data (historian exports, maintenance logs) and site-specific validation.</li>
          <li>Time-to-failure is an estimate with an uncertainty range, not certified remaining useful life.</li>
          <li>Failure modes are limited to five simulated mechanisms; unseen mechanisms will surface through the anomaly detector rather than a named diagnosis.</li>
          <li>The healthy baseline is fit per machine class; production use would learn a baseline per individual asset.</li>
        </ul>
      </Panel>

      <Panel
        title="Why temporal analysis matters — fixed-threshold comparison"
        subtitle={<>Deterministic simulated bearing-wear scenario · <span className="tag tag-sim"><FlaskConical size={11} /> Simulated data — not measured on real machines</span></>}
        id="threshold"
      >
        <p style={{ margin: '0 0 16px', color: 'var(--muted)', fontSize: 12, maxWidth: 820, lineHeight: 1.6 }}>
          The scenario below uses the same seeded degradation trajectory as the judge demo (bearing wear, 36 simulated hours to failure). It shows the decision points for a simple fixed-threshold alarm (vibration &gt; 3 mm/s) versus ForgeGuard's temporal risk index. All timings are derived from the simulator, not from physical machines.
        </p>
        <div style={{ overflowX: 'auto' }}>
          <table className="metric-table" style={{ marginTop: 0 }} aria-label="Fixed-threshold vs temporal analysis comparison">
            <thead>
              <tr>
                <th scope="col">Property</th>
                <th scope="col"><span style={{ color: 'var(--muted)' }}><Ruler size={12} style={{ verticalAlign: 'middle' }} /> Fixed single-threshold alarm</span></th>
                <th scope="col"><span style={{ color: 'var(--accent)' }}><BrainCircuit size={12} style={{ verticalAlign: 'middle' }} /> ForgeGuard temporal analysis</span></th>
              </tr>
            </thead>
            <tbody>
              <tr><th scope="row">Detection trigger</th><td>Vibration exceeds fixed limit (e.g., 3 mm/s) in a single reading</td><td>Risk index crosses 40/100 threshold sustained for 3 consecutive predictions (debounced)</td></tr>
              <tr><th scope="row">Warning raised at (sim hours before failure)</th><td>~4 h — only once vibration reaches limit late in degradation</td><td style={{ color: 'var(--teal)' }}>~{`${m.leadTime.medianWarningLeadHours.toFixed(1)} h`} median on held-out synthetic trajectories</td></tr>
              <tr><th scope="row">False alarms on healthy machines</th><td>High — transient spikes and high-workload periods regularly cross the fixed limit</td><td style={{ color: 'var(--teal)' }}>{`${m.leadTime.falseAlarmsPer1000h.toFixed(1)} per 1,000 operating hours (debounced)`}</td></tr>
              <tr><th scope="row">Failure mode identified</th><td>No — only raw sensor breach; operator must diagnose</td><td style={{ color: 'var(--teal)' }}>Yes — failure-mode classifier names the likely mechanism</td></tr>
              <tr><th scope="row">Time-to-failure estimate</th><td>None — alarm fires with no forward projection</td><td style={{ color: 'var(--teal)' }}>Yes — regression with uncertainty range</td></tr>
              <tr><th scope="row">Explanation</th><td>No — "vibration high" only</td><td style={{ color: 'var(--teal)' }}>Additive per-sensor contribution breakdown</td></tr>
              <tr><th scope="row">Early anomaly detection (before threshold crossed)</th><td>No</td><td style={{ color: 'var(--teal)' }}>Yes — isolation forest flags unusual windows before risk crosses 40</td></tr>
              <tr><th scope="row">Load-context awareness</th><td>No — same limit regardless of workload</td><td style={{ color: 'var(--teal)' }}>Yes — deviation measured relative to load-adjusted healthy baseline</td></tr>
            </tbody>
          </table>
        </div>
        <p className="fine" style={{ marginTop: 14 }}>
          <FlaskConical size={11} /> Timings above are from the seeded synthetic simulator. The fixed-threshold alarm uses a static vibration limit calibrated to the healthy fleet mean + 2σ — a common industry starting point.
          Whether ForgeGuard outperforms this baseline in a specific real deployment depends on the actual noise profile and failure modes encountered.
          The comparison is illustrative, not a controlled trial.
        </p>
      </Panel>
    </>
  );
}
