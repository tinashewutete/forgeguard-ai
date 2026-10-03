import { useEffect, useRef, useState } from 'react';
import type { FailureMode } from '../ml/types';
import type { WorkOrder } from '../state/records';
import { useApp } from '../state/AppContext';

const SUGGESTED: Record<FailureMode | 'none', { findings: string; action: string }> = {
  bearing_wear: { findings: 'Outer-race spalling on front spindle bearing; grease discoloured', action: 'Replaced spindle bearing set, re-greased, verified run-out' },
  overheating: { findings: 'Cooling fan clogged with dust; coolant flow 40% below spec', action: 'Cleaned fan & heat-sink, flushed coolant loop, replaced filter' },
  motor_overload: { findings: 'Worn tooling and binding in ball-screw causing excess load', action: 'Replaced tooling, lubricated ball-screw, re-tuned feed rates' },
  electrical_anomaly: { findings: 'Loose phase terminal with thermal discoloration at contactor', action: 'Re-terminated and torqued connections, replaced contactor' },
  rpm_instability: { findings: 'Drive belt glazed and slipping; encoder cable shield damaged', action: 'Replaced drive belt, re-routed and replaced encoder cable' },
  none: { findings: 'No defects found during inspection', action: 'Routine lubrication and inspection completed' },
};

export function CompleteDialog({ order, onClose }: { order: WorkOrder; onClose: () => void }) {
  const { completeWork } = useApp();
  const s = SUGGESTED[order.failureMode ?? 'none'];
  const [findings, setFindings] = useState(s.findings);
  const [action, setAction] = useState(s.action);
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) d.showModal();
  }, []);
  return (
    <dialog ref={ref} className="dialog" aria-labelledby="complete-title" onClose={onClose} onCancel={onClose}>
      <form
        method="dialog"
        onSubmit={(e) => {
          e.preventDefault();
          completeWork(order.id, findings.trim() || 'Not recorded', action.trim() || 'Not recorded');
          onClose();
        }}
      >
        <h2 id="complete-title">Record inspection outcome</h2>
        <p className="muted">{order.machineName} · {order.title}</p>
        <label>
          Findings
          <textarea value={findings} onChange={(e) => setFindings(e.target.value)} rows={3} required />
        </label>
        <label>
          Action taken
          <textarea value={action} onChange={(e) => setAction(e.target.value)} rows={3} required />
        </label>
        <p className="muted small">Completing returns the machine to service. ForgeGuard then collects fresh telemetry and verifies recovery automatically.</p>
        <div className="dialog-actions">
          <button type="button" className="button button-ghost" onClick={onClose}>Cancel</button>
          <button type="submit" className="button button-primary">Complete & recommission</button>
        </div>
      </form>
    </dialog>
  );
}
