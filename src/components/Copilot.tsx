import { useEffect, useRef, useState } from 'react';
import { Bot, Send, X } from 'lucide-react';
import { MODE_LABEL } from '../ml/inference/knowledge';
import type { ModelBundle } from '../ml/models/bundle';
import type { FleetEngine, MachineRuntime } from '../sim/fleet';
import type { RecordsState } from '../state/records';
import { useApp } from '../state/AppContext';
import { rankFleet } from '../lib/fleetView';
import { fmt, hours, pct, riskIdx, trendLabel } from '../lib/format';

interface Msg {
  role: 'user' | 'bot';
  text: string;
}

const SUGGESTIONS = ['Which machine needs attention first?', 'Why is CNC Mill 04 at risk?', 'Fleet summary', 'What should I do about Drive Motor 07?', 'How accurate is the model?'];

function findMachine(fleet: FleetEngine, q: string): MachineRuntime | undefined {
  const lower = q.toLowerCase();
  const byName = fleet.machines.find((m) => lower.includes(m.def.name.toLowerCase()));
  if (byName) return byName;
  const num = lower.match(/\b(\d{1,2})\b/);
  if (num) return fleet.machines.find((m) => m.def.id.endsWith(`-${num[1].padStart(2, '0')}`));
  return fleet.machines.find((m) => lower.includes(m.def.type));
}

function describe(fleet: FleetEngine, m: MachineRuntime): string {
  const p = m.prediction;
  if (m.status === 'failed') return `${m.def.name} has FAILED and production is stopped. Schedule a repair work order immediately.`;
  if (m.status === 'maintenance') return `${m.def.name} is locked out for maintenance; no live telemetry until it is recommissioned.`;
  if (!p) return `${m.def.name} was just recommissioned — I'm collecting fresh telemetry before predicting.`;
  return `${m.def.name}: ${p.condition.toUpperCase()} — risk index ${riskIdx(p.risk)} (model agreement ${fmt(p.confidence)}/100, uncalibrated), health ${Math.round(p.health)}/100, trend ${trendLabel(fleet.trend(m)).label.toLowerCase()}.${p.failureMode ? ` Likely ${MODE_LABEL[p.failureMode].toLowerCase()}${p.ttf ? `, estimated ${hours(p.ttf.hours)} to failure (range ${hours(p.ttf.low)}–${hours(p.ttf.high)})` : ''}.` : ' No failure pattern detected.'}`;
}

function explain(m: MachineRuntime): string {
  const p = m.prediction;
  if (!p) return describe({ trend: () => 0 } as unknown as FleetEngine, m);
  const top = p.factors.filter((f) => f.points > 0.5).slice(0, 3);
  if (!top.length) return `${m.def.name} is at ${pct(p.risk)} risk — no sensor group is pushing risk meaningfully above the fleet base rate of ${fmt(p.baseRisk, 1)}%.`;
  return `${m.def.name} is at ${pct(p.risk)} risk. Main drivers (risk points above the ${fmt(p.baseRisk, 1)}% base rate):\n${top.map((f) => `• ${f.label} +${fmt(f.points, 1)} — ${f.evidence}`).join('\n')}${p.anomalous ? `\nThe anomaly detector also flags the recent window as abnormal (score ${fmt(p.anomalyScore, 3)}).` : ''}`;
}

function advise(m: MachineRuntime): string {
  const p = m.prediction;
  if (!p) return describe({ trend: () => 0 } as unknown as FleetEngine, m);
  const r = p.recommendation;
  return `${r.headline} (${r.window}).\n${r.actions.map((a, i) => `${i + 1}. ${a}`).join('\n')}\nIf ignored: ${r.ifIgnored}`;
}

export function answer(q: string, fleet: FleetEngine, records: RecordsState, model: ModelBundle | null): string {
  const lower = q.toLowerCase();
  const m = findMachine(fleet, q);
  if (/accura|metric|model|precision|recall|f1|trained|evaluat/.test(lower) && !m) {
    if (!model) return 'The trained model artifact is not loaded, so I am using the rule-based fallback (baseline-deviation thresholds).';
    const x = model.metrics;
    return `${model.name} v${model.version} — on ${x.dataset.trajectories.test} held-out synthetic machines: risk accuracy ${pct(x.risk.accuracy * 100, 1)}, macro F1 ${fmt(x.risk.macroF1, 3)}, ROC-AUC ${fmt(x.risk.rocAucAtRisk, 3)}. It warned before ${x.leadTime.failuresDetected}/${x.leadTime.failuresTotal} failures with a median lead time of ${fmt(x.leadTime.medianWarningLeadHours, 1)} h. These are synthetic results, not plant validation.`;
  }
  if (m && /why|explain|cause|driver|reason/.test(lower)) return explain(m);
  if (m && /do|recommend|action|fix|should|repair|maint/.test(lower)) return advise(m);
  if (m) return describe(fleet, m);
  if (/first|priorit|attention|worst|highest|urgent|risk/.test(lower)) {
    const ranked = rankFleet(fleet).filter((x) => x.status === 'failed' || (x.prediction && x.prediction.condition !== 'normal'));
    if (!ranked.length) return 'All machines are in the Normal band right now. Nothing needs attention.';
    return `Priority order:\n${ranked.slice(0, 4).map((x, i) => `${i + 1}. ${describe(fleet, x)}`).join('\n')}`;
  }
  if (/alert/.test(lower)) {
    const open = records.alerts.filter((a) => a.status === 'open' || a.status === 'acknowledged');
    return open.length ? `${open.length} active alert(s):\n${open.slice(0, 5).map((a) => `• ${a.machineName}: ${a.message} [${a.status}]`).join('\n')}` : 'There are no active alerts.';
  }
  if (/summar|fleet|overview|status|how are/.test(lower)) {
    const preds = fleet.machines.filter((x) => x.prediction);
    const c = (cond: string) => preds.filter((x) => x.prediction!.condition === cond && x.status !== 'failed').length;
    const failed = fleet.machines.filter((x) => x.status === 'failed').length;
    const wos = records.workOrders.filter((w) => w.status !== 'completed').length;
    return `Fleet of ${fleet.machines.length}: ${c('normal')} normal, ${c('warning')} warning, ${c('critical')} critical${failed ? `, ${failed} failed` : ''}. ${wos} open work order(s). Highest risk: ${describe(fleet, rankFleet(fleet)[0])}`;
  }
  return 'I answer from live ForgeGuard data. Try: "which machine needs attention first", "why is CNC Mill 04 at risk", "what should I do about Motor 07", "alerts", "fleet summary" or "model accuracy".';
}

export function Copilot({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { fleet, records, model } = useApp();
  const [msgs, setMsgs] = useState<Msg[]>([{ role: 'bot', text: 'Hi — I\'m the ForgeGuard maintenance copilot. My answers are generated from the live model predictions and maintenance records in this app (no external AI service).' }]);
  const [q, setQ] = useState('');
  const endRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => endRef.current?.scrollIntoView({ block: 'end' }), [msgs]);
  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  const ask = (text: string) => {
    if (!text.trim()) return;
    setMsgs((m) => [...m, { role: 'user', text }, { role: 'bot', text: answer(text, fleet, records.state, model) }]);
    setQ('');
  };
  if (!open) return null;
  return (
    <aside className="copilot" role="dialog" aria-label="Maintenance copilot" aria-modal="false">
      <header>
        <Bot size={16} /> <strong>Maintenance copilot</strong>
        <button className="icon-btn" onClick={onClose} aria-label="Close copilot"><X size={15} /></button>
      </header>
      <div className="copilot-msgs" aria-live="polite">
        {msgs.map((m, i) => <p key={i} className={`msg ${m.role}`}>{m.text}</p>)}
        <div ref={endRef} />
      </div>
      <div className="copilot-suggest">
        {SUGGESTIONS.map((s) => <button key={s} className="chip" onClick={() => ask(s)}>{s}</button>)}
      </div>
      <form onSubmit={(e) => { e.preventDefault(); ask(q); }}>
        <input ref={inputRef} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Ask about a machine, alert or the model…" aria-label="Ask the copilot" />
        <button className="icon-btn primary" type="submit" aria-label="Send"><Send size={15} /></button>
      </form>
    </aside>
  );
}
