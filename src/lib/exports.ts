import { MACHINE_TYPES } from '../ml/data/machines';
import { MODE_LABEL } from '../ml/inference/knowledge';
import type { FleetEngine, MachineRuntime } from '../sim/fleet';
import type { AlertRecord, TimelineEvent, WorkOrder } from '../state/records';
import { dateTime, hours } from './format';

export function download(filename: string, content: string, type = 'text/plain') {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const csvCell = (v: unknown) => {
  const s = String(v ?? '');
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export function toCsv(rows: Record<string, unknown>[]): string {
  if (!rows.length) return '';
  const keys = Object.keys(rows[0]);
  return [keys.join(','), ...rows.map((r) => keys.map((k) => csvCell(r[k])).join(','))].join('\n');
}

export function telemetryCsv(fleet: FleetEngine, m: MachineRuntime): string {
  const s = m.series;
  return toCsv(s.minute.map((minute, i) => ({
    timestamp: fleet.timeAt(minute).toISOString(),
    machine_id: m.def.id,
    temperature_c: s.temperature[i].toFixed(2),
    vibration_mm_s: s.vibration[i].toFixed(3),
    current_a: s.current[i].toFixed(2),
    rpm: s.rpm[i].toFixed(0),
    workload_pct: s.workload[i].toFixed(1),
    data_source: 'SIMULATED',
  })));
}

export function alertsCsv(alerts: AlertRecord[]): string {
  return toCsv(alerts.map((a) => ({
    created_at: a.createdAt,
    machine: a.machineName,
    severity: a.severity,
    risk_pct: Math.round(a.risk),
    model_agreement_0_100: Math.round(a.confidence),
    failure_mode: a.failureMode ? MODE_LABEL[a.failureMode] : '',
    status: a.status,
    recommendation: a.recommendation,
    factors: a.factors.join(' | '),
  })));
}

/** Markdown incident report built from live model output and recorded history. */
export function incidentReport(fleet: FleetEngine, m: MachineRuntime, alerts: AlertRecord[], orders: WorkOrder[], events: TimelineEvent[]): string {
  const p = m.prediction;
  const type = MACHINE_TYPES[m.def.type];
  const lines = [
    `# ForgeGuard AI — Incident Report: ${m.def.name}`,
    '',
    `Generated: ${dateTime(fleet.now)} (simulation clock)  `,
    `Machine: ${m.def.name} · ${m.def.model} · ${type.label} · ${m.def.location}  `,
    `Data source: SIMULATED telemetry · Predictions: ForgeGuard model output`,
    '',
    '## Current assessment',
  ];
  if (p) {
    lines.push(
      `- Risk index: **${Math.round(p.risk)}/100** (${p.condition.toUpperCase()}), model agreement ${Math.round(p.confidence)}/100 (heuristic, uncalibrated; simulated data)`,
      `- Machine health index: ${Math.round(p.health)}/100`,
      `- Likely failure mode: ${p.failureMode ? MODE_LABEL[p.failureMode] : 'None identified'}`,
      `- Estimated time to failure: ${p.ttf ? `${hours(p.ttf.hours)} (range ${hours(p.ttf.low)} – ${hours(p.ttf.high)})` : 'n/a (risk below warning threshold)'}`,
      `- Anomaly score: ${p.anomalyScore.toFixed(3)} ${p.anomalous ? '(ANOMALOUS)' : '(within healthy envelope)'}`,
      '',
      '## Contributing factors (risk points vs fleet base rate)',
      ...p.factors.map((f) => `- ${f.label}: ${f.points >= 0 ? '+' : ''}${f.points.toFixed(1)} pts — ${f.evidence}`),
      '',
      '## Recommendation',
      `**${p.recommendation.headline}** — ${p.recommendation.window}`,
      ...p.recommendation.actions.map((a) => `1. ${a}`),
      '',
      `If ignored: ${p.recommendation.ifIgnored}`,
    );
  } else {
    lines.push('- Collecting fresh telemetry after recommissioning — no prediction yet.');
  }
  const mine = alerts.filter((a) => a.machineId === m.def.id);
  lines.push('', '## Alerts', ...(mine.length ? mine.map((a) => `- ${dateTime(a.createdAt)} · ${a.severity.toUpperCase()} · ${Math.round(a.risk)}% · ${a.message} · status: ${a.status}`) : ['- None']));
  const wos = orders.filter((w) => w.machineId === m.def.id);
  lines.push('', '## Work orders', ...(wos.length ? wos.map((w) => `- ${w.priority} ${w.title} · ${w.technician} · ${w.status}${w.findings ? ` · findings: ${w.findings}` : ''}${w.actionTaken ? ` · action: ${w.actionTaken}` : ''}${w.riskAfter !== undefined ? ` · risk ${Math.round(w.riskBefore)}% → ${Math.round(w.riskAfter)}%` : ''}`) : ['- None']));
  const ev = events.filter((e) => e.machineId === m.def.id).slice(0, 20);
  lines.push('', '## Timeline', ...(ev.length ? ev.map((e) => `- ${dateTime(e.createdAt)} · ${e.title} — ${e.detail}`) : ['- No events']));
  lines.push('', '---', 'Telemetry is simulated for demonstration. Model metrics are measured on synthetic held-out data and are not industrial validation.');
  return lines.join('\n');
}

const HTML_ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const esc = (v: unknown) => String(v ?? '').replace(/[&<>"']/g, (c) => HTML_ESCAPES[c] ?? c);

/** Formal, print-ready incident report (opened through the browser print dialog → "Save as PDF"). */
export function incidentReportHtml(fleet: FleetEngine, m: MachineRuntime, alerts: AlertRecord[], orders: WorkOrder[], events: TimelineEvent[]): string {
  const p = m.prediction;
  const type = MACHINE_TYPES[m.def.type];
  const mine = alerts.filter((a) => a.machineId === m.def.id);
  const wos = orders.filter((w) => w.machineId === m.def.id);
  const ev = events.filter((e) => e.machineId === m.def.id).slice(0, 20);
  const row = (k: string, v: string) => `<tr><th scope="row">${esc(k)}</th><td>${esc(v)}</td></tr>`;
  const ref = `FG-${m.def.id.toUpperCase()}-${fleet.timeAt(fleet.minute).toISOString().slice(0, 16).replace(/[-:T]/g, '')}`;
  const assessment = p
    ? [
        row('Risk index (0–100, not a probability)', `${Math.round(p.risk)} — ${p.condition.toUpperCase()}`),
        row('Model agreement (heuristic, uncalibrated)', `${Math.round(p.confidence)}/100`),
        row('Machine health index', `${Math.round(p.health)} / 100`),
        row('Likely failure mode', p.failureMode ? MODE_LABEL[p.failureMode] : 'None identified'),
        row('Estimated time to failure', p.ttf ? `${hours(p.ttf.hours)} (range ${hours(p.ttf.low)} – ${hours(p.ttf.high)})` : 'Not applicable — risk below warning threshold'),
        row('Anomaly detector', `${p.anomalyScore.toFixed(3)} — ${p.anomalous ? 'anomalous' : 'within healthy envelope'}`),
      ].join('')
    : row('Status', 'Collecting fresh telemetry after recommissioning; no prediction available yet.');
  const factors = p
    ? `<h2>Contributing factors</h2><table class="grid"><thead><tr><th>Factor</th><th class="num">Risk points</th><th>Evidence</th></tr></thead><tbody>${p.factors.map((f) => `<tr><td>${esc(f.label)}</td><td class="num">${f.points >= 0 ? '+' : ''}${f.points.toFixed(1)}</td><td>${esc(f.evidence)}</td></tr>`).join('')}</tbody></table>
       <p class="note">Points are additive attributions from the random-forest decision paths relative to the fleet base rate. They describe patterns associated with elevated risk and do not establish causation.</p>
       <h2>Recommended action</h2><p><strong>${esc(p.recommendation.headline)}</strong> — ${esc(p.recommendation.window)}</p><ol>${p.recommendation.actions.map((a) => `<li>${esc(a)}</li>`).join('')}</ol><p><em>If no action is taken:</em> ${esc(p.recommendation.ifIgnored)}</p>`
    : '';
  const table = (head: string[], rows: string[][]) => rows.length
    ? `<table class="grid"><thead><tr>${head.map((h) => `<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${rows.map((r) => `<tr>${r.map((c) => `<td>${esc(c)}</td>`).join('')}</tr>`).join('')}</tbody></table>`
    : '<p class="note">None recorded.</p>';
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Incident Report ${esc(ref)}</title><style>
    @page { size: A4; margin: 18mm 16mm; }
    body { font: 11pt/1.5 Georgia, 'Times New Roman', serif; color: #14181d; margin: 0; }
    header { border-bottom: 2px solid #1d2f48; padding-bottom: 10px; margin-bottom: 18px; display: flex; justify-content: space-between; align-items: flex-end; }
    header h1 { font-size: 20pt; font-weight: 400; margin: 0; letter-spacing: .01em; }
    header small { font: 8.5pt 'Segoe UI', Arial, sans-serif; color: #55606e; text-transform: uppercase; letter-spacing: .12em; display: block; margin-bottom: 4px; }
    header .ref { font: 9pt 'Segoe UI', Arial, sans-serif; text-align: right; color: #55606e; }
    h2 { font: 600 9pt 'Segoe UI', Arial, sans-serif; text-transform: uppercase; letter-spacing: .12em; color: #1d2f48; border-bottom: 1px solid #c5ccd6; padding-bottom: 3px; margin: 22px 0 8px; }
    table { width: 100%; border-collapse: collapse; font: 9.5pt 'Segoe UI', Arial, sans-serif; }
    table.kv th { width: 34%; text-align: left; font-weight: 600; color: #38424f; padding: 4px 8px 4px 0; vertical-align: top; }
    table.kv td { padding: 4px 0; }
    table.grid th { text-align: left; background: #eef1f5; border: 1px solid #c5ccd6; padding: 4px 7px; font-weight: 600; }
    table.grid td { border: 1px solid #d5dbe3; padding: 4px 7px; vertical-align: top; }
    .num { text-align: right; white-space: nowrap; }
    .note { font: 8.5pt 'Segoe UI', Arial, sans-serif; color: #55606e; margin: 6px 0 0; }
    footer { margin-top: 28px; border-top: 1px solid #c5ccd6; padding-top: 8px; font: 8pt 'Segoe UI', Arial, sans-serif; color: #55606e; }
    ol { margin: 6px 0 6px 18px; padding: 0; } tr { page-break-inside: avoid; }
  </style></head><body>
  <header><div><small>ForgeGuard AI · Machine Health Intelligence</small><h1>Incident report — ${esc(m.def.name)}</h1></div><div class="ref">Ref ${esc(ref)}<br>Issued ${esc(dateTime(fleet.now))}<br>Simulation clock</div></header>
  <h2>Asset</h2><table class="kv"><tbody>${row('Machine', `${m.def.name} (${m.def.id})`)}${row('Model / class', `${m.def.model} · ${type.label}`)}${row('Location', m.def.location)}${row('Operating hours', Math.round(m.operatingHours).toLocaleString())}${row('Hours since service', `${Math.round(m.sim.hoursSinceService)} h`)}${row('Data source', 'Simulated telemetry')}</tbody></table>
  <h2>Current assessment</h2><table class="kv"><tbody>${assessment}</tbody></table>
  ${factors}
  <h2>Alerts</h2>${table(['Time', 'Severity', 'Risk', 'Message', 'Status'], mine.map((a) => [dateTime(a.createdAt), a.severity, `${Math.round(a.risk)}%`, a.message, a.status]))}
  <h2>Work orders</h2>${table(['Priority', 'Title', 'Technician', 'Status', 'Outcome'], wos.map((w) => [w.priority, w.title, w.technician, w.status, [w.findings && `Findings: ${w.findings}`, w.actionTaken && `Action: ${w.actionTaken}`, w.riskAfter !== undefined && `Risk ${Math.round(w.riskBefore)}% → ${Math.round(w.riskAfter)}%`].filter(Boolean).join(' · ') || '—']))}
  <h2>Timeline</h2>${table(['Time', 'Event', 'Detail'], ev.map((e) => [dateTime(e.createdAt), e.title, e.detail]))}
  <footer>Telemetry in this document is simulated for demonstration. Model metrics are measured on synthetic held-out data and do not constitute industrial validation. Failure-time figures are model estimates with uncertainty ranges, not guarantees.</footer>
  </body></html>`;
}

/** Print an HTML document through a hidden iframe (avoids pop-up blockers). */
export function printHtml(html: string) {
  const frame = document.createElement('iframe');
  frame.setAttribute('aria-hidden', 'true');
  frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;';
  document.body.appendChild(frame);
  const doc = frame.contentDocument;
  if (!doc || !frame.contentWindow) { frame.remove(); return; }
  doc.open();
  doc.write(html);
  doc.close();
  const win = frame.contentWindow;
  window.setTimeout(() => {
    win.focus();
    win.print();
    window.setTimeout(() => frame.remove(), 2000);
  }, 150);
}
