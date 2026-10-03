import { useState } from 'react';
import { CheckCircle2, ClipboardList, Hourglass, Play, Wrench } from 'lucide-react';
import { useApp, useRecords } from '../state/AppContext';
import type { WorkOrder, WorkOrderStatus } from '../state/records';
import { Empty, PageHeading, Panel, Stat } from '../components/ui';
import { CompleteDialog } from '../components/WorkOrderDialog';
import { dateTime, fmt } from '../lib/format';
import { href } from '../lib/router';

const COLUMNS: { id: WorkOrderStatus; label: string }[] = [
  { id: 'scheduled', label: 'Scheduled' },
  { id: 'in_progress', label: 'In progress' },
  { id: 'completed', label: 'Completed' },
];

function OrderCard({ wo, onComplete }: { wo: WorkOrder; onComplete: () => void }) {
  const { startWork } = useApp();
  return (
    <article className={`wo-card ${wo.priority}`}>
      <header>
        <span className={`priority-tag ${wo.priority}`}>{wo.priority}</span>
        <a href={href({ page: 'machine', id: wo.machineId })}><strong>{wo.machineName}</strong></a>
      </header>
      <p>{wo.title}</p>
      <dl>
        <div><dt>Technician</dt><dd>{wo.technician}</dd></div>
        <div><dt>{wo.status === 'completed' ? 'Completed' : 'Scheduled'}</dt><dd>{dateTime(wo.completedAt ?? wo.scheduledFor)}</dd></div>
        <div><dt>Risk at creation</dt><dd>{Math.round(wo.riskBefore)}%</dd></div>
        {wo.riskAfter !== undefined && <div><dt>Risk after repair</dt><dd className="text-teal">{Math.round(wo.riskAfter)}%</dd></div>}
      </dl>
      {wo.findings && <p className="small"><strong>Findings:</strong> {wo.findings}</p>}
      {wo.actionTaken && <p className="small"><strong>Action:</strong> {wo.actionTaken}</p>}
      <footer>
        {wo.status === 'scheduled' && <button className="button button-small button-dark" onClick={() => startWork(wo.id)}><Play size={12} /> Start inspection</button>}
        {wo.status !== 'completed' && <button className="button button-small button-primary" onClick={onComplete}><CheckCircle2 size={12} /> Record outcome</button>}
        {wo.status === 'completed' && (wo.verifiedAt ? <span className="verified"><CheckCircle2 size={12} /> Recovery verified</span> : <span className="muted small"><Hourglass size={12} /> Verifying recovery…</span>)}
      </footer>
    </article>
  );
}

export function MaintenancePage() {
  const { workOrders, timeline } = useRecords();
  const [completing, setCompleting] = useState<string | null>(null);
  const done = workOrders.filter((w) => w.verifiedAt && w.riskAfter !== undefined);
  const avgReduction = done.length ? done.reduce((a, w) => a + (w.riskBefore - (w.riskAfter ?? 0)), 0) / done.length : NaN;
  const open = workOrders.filter((w) => w.status !== 'completed').length;
  const wo = completing ? workOrders.find((w) => w.id === completing) : undefined;
  return (
    <>
      <PageHeading eyebrow="Maintenance lifecycle" title="Work orders & history" copy="Alert → acknowledge → schedule → inspect → record outcome → automatic recovery verification." />
      <div className="stat-grid three">
        <Stat label="Open work orders" value={open} icon={<ClipboardList size={17} />} tone={open ? 'amber' : 'teal'} />
        <Stat label="Repairs verified" value={done.length} icon={<CheckCircle2 size={17} />} tone="teal" />
        <Stat label="Avg. risk reduction" value={Number.isFinite(avgReduction) ? `${fmt(avgReduction)} pts` : '—'} sub="Model risk before vs after repair" icon={<Wrench size={17} />} tone="blue" />
      </div>
      <div className="kanban">
        {COLUMNS.map((c) => {
          const items = workOrders.filter((w) => w.status === c.id);
          return (
            <section key={c.id} className="kanban-col" aria-label={c.label}>
              <h2>{c.label} <span>{items.length}</span></h2>
              {items.length ? items.map((w) => <OrderCard key={w.id} wo={w} onComplete={() => setCompleting(w.id)} />) : <p className="kanban-empty">No work orders</p>}
            </section>
          );
        })}
      </div>
      <Panel title="Maintenance timeline" subtitle="Saved locally and mirrored to Supabase when configured" id="timeline">
        {timeline.length ? (
          <ol className="timeline">
            {timeline.slice(0, 60).map((e) => (
              <li key={e.id} className={`timeline-item ${e.kind}`}>
                <strong>{e.machineName} — {e.title}{e.source === 'cloud' && <span className="tag">cloud</span>}</strong>
                <span>{e.detail}</span>
                <time dateTime={e.createdAt}>{dateTime(e.createdAt)}</time>
              </li>
            ))}
          </ol>
        ) : <Empty icon={<ClipboardList size={20} />} title="No maintenance history yet">Schedule maintenance from an alert or machine page.</Empty>}
      </Panel>
      {wo && <CompleteDialog order={wo} onClose={() => setCompleting(null)} />}
    </>
  );
}
