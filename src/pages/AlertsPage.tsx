import { useState } from 'react';
import { AlertTriangle, BellOff, Check, Download, Wrench } from 'lucide-react';
import { MODE_LABEL } from '../ml/inference/knowledge';
import { useApp, useRecords } from '../state/AppContext';
import type { AlertRecord } from '../state/records';
import { Empty, PageHeading, Panel, riskColor, Tag } from '../components/ui';
import { dateTime, pct, signed } from '../lib/format';
import { alertsCsv, download } from '../lib/exports';
import { href } from '../lib/router';

type Filter = 'active' | 'scheduled' | 'resolved' | 'history';

const FILTERS: { id: Filter; label: string; match: (a: AlertRecord) => boolean }[] = [
  { id: 'active', label: 'Active', match: (a) => a.status === 'open' || a.status === 'acknowledged' },
  { id: 'scheduled', label: 'Scheduled', match: (a) => a.status === 'scheduled' },
  { id: 'resolved', label: 'Resolved', match: (a) => a.status === 'resolved' },
  { id: 'history', label: 'All / cloud history', match: () => true },
];

export function AlertsPage() {
  const { acknowledge, schedule } = useApp();
  const { alerts } = useRecords();
  const [filter, setFilter] = useState<Filter>('active');
  const f = FILTERS.find((x) => x.id === filter)!;
  const list = alerts.filter(f.match);
  return (
    <>
      <PageHeading
        eyebrow="Alert intelligence"
        title="Alert center"
        copy="Alerts are raised automatically when the model's condition escalates and stays escalated for 3 consecutive predictions (debounced to avoid alarm fatigue)."
        actions={<button className="button button-ghost" onClick={() => download('forgeguard-alerts.csv', alertsCsv(alerts), 'text/csv')}><Download size={14} /> Export CSV</button>}
      />
      <div className="tabs" role="tablist" aria-label="Alert filter">
        {FILTERS.map((x) => (
          <button key={x.id} role="tab" aria-selected={filter === x.id} className={`tab ${filter === x.id ? 'active' : ''}`} onClick={() => setFilter(x.id)}>
            {x.label} <span className="tab-count">{alerts.filter(x.match).length}</span>
          </button>
        ))}
      </div>
      <Panel>
        {list.length ? (
          <ul className="alert-list">
            {list.map((a) => (
              <li key={a.id} className={`alert-card ${a.severity}`}>
                <div className="alert-sev"><AlertTriangle size={16} /><span>{a.severity === 'failure' ? 'FAILURE' : a.severity.toUpperCase()}</span></div>
                <div className="alert-body">
                  <div className="alert-title">
                    <a href={href({ page: 'machine', id: a.machineId })}><strong>{a.machineName}</strong></a>
                    <span className="muted">{dateTime(a.createdAt)}</span>
                    <span className={`badge status-${a.status}`}>{a.status}</span>
                    {a.source === 'cloud' ? <span className="tag">Cloud history</span> : <Tag kind="model" />}
                  </div>
                  <p>{a.message}</p>
                  <dl className="alert-meta">
                    <div><dt>Risk</dt><dd style={{ color: riskColor(a.risk) }}>{pct(a.risk)}</dd></div>
                    {a.confidence > 0 && <div><dt>Model agreement</dt><dd>{Math.round(a.confidence)}/100</dd></div>}
                    {a.failureMode && <div><dt>Failure mode</dt><dd>{MODE_LABEL[a.failureMode]}</dd></div>}
                    {a.source !== 'cloud' && <div><dt>Trend</dt><dd>{signed(a.trendPerHour, 1)} pts/h</dd></div>}
                  </dl>
                  {a.factors.length > 0 && <ul className="alert-factors">{a.factors.map((x) => <li key={x}>{x}</li>)}</ul>}
                  {a.recommendation && <p className="alert-rec"><Wrench size={12} /> {a.recommendation}</p>}
                </div>
                <div className="alert-actions">
                  {a.status === 'open' && <button className="button button-small button-ghost" onClick={() => acknowledge(a.id)}><Check size={12} /> Acknowledge</button>}
                  {(a.status === 'open' || a.status === 'acknowledged') && <button className="button button-small button-dark" onClick={() => schedule(a.machineId, { alertId: a.id })}><Wrench size={12} /> Schedule</button>}
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <Empty icon={<BellOff size={22} />} title={filter === 'active' ? 'No active alerts' : 'Nothing here'}>
            {filter === 'active' ? 'All machines are operating within learned baselines or already have maintenance scheduled.' : 'Alerts will appear here as the fleet runs.'}
          </Empty>
        )}
      </Panel>
    </>
  );
}
