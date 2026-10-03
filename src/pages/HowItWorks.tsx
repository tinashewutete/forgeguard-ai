import { Activity, BellRing, BrainCircuit, CheckCircle2, Cpu, Database, Factory, Gauge, Lightbulb, Radio, Server, ShieldCheck, Sigma, Waves, Wrench } from 'lucide-react';
import { PageHeading, Panel } from '../components/ui';

const PIPELINE = [
  { icon: <Radio size={18} />, title: 'Telemetry', text: 'Temperature, vibration, motor current, RPM, workload and operating hours per machine, every simulated minute.' },
  { icon: <Waves size={18} />, title: 'Feature engineering', text: '21 features over rolling 30-min / 3-h windows: load-adjusted deviation, slope, rate of change, volatility, impulse rate, time above 3σ.' },
  { icon: <Activity size={18} />, title: 'Anomaly detection', text: 'Isolation forest trained on healthy windows flags unusual patterns, even for failure types never seen in training.' },
  { icon: <BrainCircuit size={18} />, title: 'Risk prediction', text: 'Random forest predicts Normal / Warning / Critical from the feature trajectory → a 0–100 risk index (severity-weighted class votes, not a probability of failure) and a heuristic model-agreement score.' },
  { icon: <Sigma size={18} />, title: 'Explainability', text: 'Every prediction is decomposed into exact per-sensor contributions so operators see why risk is high.' },
  { icon: <Gauge size={18} />, title: 'Diagnosis & horizon', text: 'Failure-mode classifier and time-to-failure regressor with an uncertainty range.' },
  { icon: <Lightbulb size={18} />, title: 'Recommendation', text: 'Mode- and urgency-specific maintenance playbook with a time window and the consequence of inaction.' },
  { icon: <BellRing size={18} />, title: 'Alert & work order', text: 'Debounced alerts, acknowledgement, scheduling, inspection, outcome recording and automatic recovery verification.' },
];

const DEPLOY = [
  { icon: <Factory size={18} />, title: 'Shop floor', text: 'Accelerometers, thermocouples, CT clamps; CNC controllers (MTConnect / OPC UA), PLCs (Modbus), 3D-printer APIs.' },
  { icon: <Cpu size={18} />, title: 'Edge gateway', text: 'Raspberry Pi / industrial PC buffers data, computes window features locally, works through network outages.' },
  { icon: <Server size={18} />, title: 'Ingestion', text: 'MQTT broker → time-series store. The browser simulator is replaced by this stream with the same sample schema.' },
  { icon: <BrainCircuit size={18} />, title: 'Model service', text: 'The same JSON model artifact runs in the browser, on the edge or as a Node service; retrained on plant data.' },
  { icon: <Database size={18} />, title: 'Records', text: 'Supabase/Postgres for alerts, work orders and maintenance history; CMMS integration via webhooks.' },
  { icon: <Wrench size={18} />, title: 'Action', text: 'Technician mobile view, shift-handover reports, and feedback labels from completed work orders to improve the model.' },
];

const CHECKLIST = [
  'Collects machine data (temperature, vibration, current, RPM, workload, hours)',
  'Simulates normal, gradually degrading and near-failure behaviour',
  'Analyses temporal degradation patterns — not single readings or fixed thresholds',
  'Detects abnormal patterns (isolation forest) before thresholds are crossed',
  'Scores risk on a 0–100 index with a heuristic agreement value and trend',
  'Classifies Normal / Warning / Critical (40 / 70 thresholds)',
  'Explains contributing factors per prediction (per-sensor additive attribution)',
  'Identifies likely failure mode and time-to-failure range',
  'Recommends maintenance actions and timing',
  'Generates debounced alerts and supports the full maintenance lifecycle',
  'Keeps persistent maintenance history (local + optional Supabase)',
  'Prioritises the fleet and compares machines side by side',
  'What-if simulation recalculates the whole pipeline',
  'Transparent model evaluation on synthetic held-out data',
  'Demonstrates advantage over fixed single-threshold alarm (Model & evaluation page)',
];

export function HowItWorks() {
  return (
    <>
      <PageHeading eyebrow="How ForgeGuard works" title={<>From raw signals to a <span>maintenance decision</span></>} copy="Everything below runs in the browser, offline, from a single trained model artifact." />
      <Panel title="AI pipeline" id="pipeline">
        <ol className="pipeline">
          {PIPELINE.map((s, i) => (
            <li key={s.title}>
              <span className="pipeline-step">{i + 1}</span>
              <div className="pipeline-icon">{s.icon}</div>
              <strong>{s.title}</strong>
              <p>{s.text}</p>
            </li>
          ))}
        </ol>
      </Panel>
      <div className="grid-2">
        <Panel title="Synthetic data generator" id="gen">
          <ul className="plain-list">
            <li>Hidden degradation level d = progress<sup>shape</sup> grows non-linearly toward failure.</li>
            <li>Each failure mode perturbs a different signal set: bearing wear → vibration + impulses + heat; overheating → load-dependent temperature; overload → current, heat and slip; electrical → current oscillation/spikes + RPM jitter; RPM instability → speed jitter, sag and vibration.</li>
            <li>Shift cycles and discrete jobs drive workload; temperature has thermal inertia; sensors drift and carry Gaussian noise; occasional benign vibration spikes.</li>
            <li>Seeded PRNG → the whole fleet and the judge demo are reproducible.</li>
          </ul>
        </Panel>
        <Panel title="Why trees, not deep learning?" id="why">
          <ul className="plain-list">
            <li>Tabular window features + small data → tree ensembles are accurate and robust.</li>
            <li>Exact, fast per-prediction explanations that maintenance engineers can audit.</li>
            <li>~1 MB JSON artifact: runs in the browser and on a Raspberry-class edge device without a GPU or Python runtime.</li>
            <li>Training the full ensemble takes ≈10 s (<code>npm run train</code>), so retraining on site data is cheap.</li>
          </ul>
        </Panel>
      </div>
      <Panel title="Real-world deployment architecture" subtitle="Future scope — the simulator is a drop-in stand-in for this stream" id="deploy">
        <ol className="pipeline deploy">
          {DEPLOY.map((s) => (
            <li key={s.title}>
              <div className="pipeline-icon">{s.icon}</div>
              <strong>{s.title}</strong>
              <p>{s.text}</p>
            </li>
          ))}
        </ol>
      </Panel>
      <Panel title="Problem statement 8 — requirement checklist" id="checklist">
        <ul className="checklist">
          {CHECKLIST.map((c) => <li key={c}><CheckCircle2 size={14} /> {c}</li>)}
        </ul>
        <p className="fine"><ShieldCheck size={11} /> Telemetry is simulated; model metrics are measured on synthetic held-out data.</p>
      </Panel>
    </>
  );
}
