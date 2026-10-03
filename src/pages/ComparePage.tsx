import { useState } from 'react';
import type { ReactNode } from 'react';
import { MODE_LABEL } from '../ml/inference/knowledge';
import { MACHINE_TYPES } from '../ml/data/machines';
import { useFleet } from '../state/AppContext';
import { CONDITION_COLOR, ConditionBadge, healthColor, PageHeading, Panel, riskColor } from '../components/ui';
import { LineChart } from '../components/charts';
import { downsample, rankFleet, xLabels } from '../lib/fleetView';
import { fmt, hours, pct, trendLabel } from '../lib/format';
import { href } from '../lib/router';

const PALETTE = ['#6aa890', '#c9a04a', '#7f9fc7', '#c75b50', '#9a8fb8'];

export function ComparePage() {
  const fleet = useFleet();
  const [ids, setIds] = useState<string[]>(() => rankFleet(fleet).slice(0, 3).map((m) => m.def.id));
  const toggle = (id: string) => setIds((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : cur.length >= 5 ? cur : [...cur, id]));
  const selected = ids.map((id) => fleet.get(id)).filter((m): m is NonNullable<typeof m> => !!m);
  const rows: { label: string; render: (m: (typeof selected)[number]) => ReactNode }[] = [
    { label: 'Type', render: (m) => MACHINE_TYPES[m.def.type].label },
    { label: 'Condition', render: (m) => (m.prediction ? <ConditionBadge condition={m.prediction.condition} failed={m.status === 'failed'} /> : '—') },
    { label: 'Risk index (0–100)', render: (m) => <span style={{ color: riskColor(m.prediction?.risk ?? 0) }}>{m.prediction ? Math.round(m.prediction.risk) : '—'}</span> },
    { label: 'Health index', render: (m) => <span style={{ color: healthColor(m.prediction?.health ?? 100) }}>{m.prediction ? Math.round(m.prediction.health) : '—'}</span> },
    { label: 'Model agreement (0–100)', render: (m) => (m.prediction ? Math.round(m.prediction.confidence) : '—') },
    { label: 'Risk trend', render: (m) => trendLabel(fleet.trend(m)).label },
    { label: 'Failure mode', render: (m) => (m.prediction?.failureMode ? MODE_LABEL[m.prediction.failureMode] : '—') },
    { label: 'Time to failure', render: (m) => (m.status === 'failed' ? 'Failed' : m.prediction?.ttf ? hours(m.prediction.ttf.hours) : '—') },
    { label: 'Anomaly score', render: (m) => (m.prediction ? fmt(m.prediction.anomalyScore, 3) : '—') },
    { label: 'Top driver', render: (m) => m.prediction?.factors[0]?.label ?? '—' },
    { label: 'Temperature', render: (m) => (m.latest ? `${fmt(m.latest.temperature, 1)} °C` : '—') },
    { label: 'Vibration', render: (m) => (m.latest ? `${fmt(m.latest.vibration, 2)} mm/s` : '—') },
    { label: 'Current', render: (m) => (m.latest ? `${fmt(m.latest.current, 1)} A` : '—') },
    { label: 'Hours since service', render: (m) => `${Math.round(m.sim.hoursSinceService)} h` },
  ];
  const hist = 144;
  return (
    <>
      <PageHeading eyebrow="Machine comparison" title="Compare machines side by side" copy="Select up to five machines." />
      <div className="chip-row" role="group" aria-label="Machines to compare">
        {fleet.machines.map((m) => (
          <button key={m.def.id} className={`chip ${ids.includes(m.def.id) ? 'active' : ''}`} aria-pressed={ids.includes(m.def.id)} onClick={() => toggle(m.def.id)}>{m.def.name}</button>
        ))}
      </div>
      <Panel title="Risk over the last 12 h" id="cmpchart">
        <LineChart
          ariaLabel="Risk comparison"
          series={selected.map((m, i) => ({ values: downsample(m.riskHistory.slice(-hist).map((r) => r.risk), hist), color: PALETTE[i % PALETTE.length], label: m.def.name }))}
          min={0}
          max={100}
          height={200}
          thresholds={[{ value: 70, color: CONDITION_COLOR.critical, label: 'Critical 70' }, { value: 40, color: CONDITION_COLOR.warning, label: 'Warning 40' }]}
          xLabels={xLabels(fleet, hist * 5)}
        />
        <div className="legend">{selected.map((m, i) => <span key={m.def.id}><i style={{ background: PALETTE[i % PALETTE.length] }} />{m.def.name}</span>)}</div>
      </Panel>
      <Panel id="cmptable">
        <div className="table-wrap">
          <table className="compare-table">
            <thead>
              <tr><th scope="col">Metric</th>{selected.map((m) => <th key={m.def.id} scope="col"><a href={href({ page: 'machine', id: m.def.id })}>{m.def.name}</a></th>)}</tr>
            </thead>
            <tbody>
              {rows.map((r) => <tr key={r.label}><th scope="row">{r.label}</th>{selected.map((m) => <td key={m.def.id}>{r.render(m)}</td>)}</tr>)}
            </tbody>
          </table>
        </div>
      </Panel>
    </>
  );
}
