import type { ReactNode } from 'react';
import { Cpu, FlaskConical } from 'lucide-react';
import type { Condition } from '../ml/types';
import { CONDITION_LABEL } from '../lib/format';

export const CONDITION_COLOR: Record<Condition, string> = { normal: '#6aa890', warning: '#c9a04a', critical: '#c75b50' };

export function riskColor(risk: number): string {
  if (risk >= 70) return CONDITION_COLOR.critical;
  if (risk >= 40) return CONDITION_COLOR.warning;
  return CONDITION_COLOR.normal;
}

export function healthColor(h: number): string {
  if (h < 40) return CONDITION_COLOR.critical;
  if (h < 70) return CONDITION_COLOR.warning;
  return CONDITION_COLOR.normal;
}

export function ConditionBadge({ condition, failed, label }: { condition: Condition; failed?: boolean; label?: string }) {
  return <span className={`badge ${failed ? 'failed' : condition}`}>{label ?? (failed ? 'Failed' : CONDITION_LABEL[condition])}</span>;
}

export function Panel({ title, subtitle, actions, children, className = '', id }: { title?: ReactNode; subtitle?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string; id?: string }) {
  return (
    <section className={`panel ${className}`} aria-labelledby={id && title ? `${id}-title` : undefined}>
      {(title || actions) && (
        <header className="panel-header">
          <div>
            {title && <h2 id={id ? `${id}-title` : undefined}>{title}</h2>}
            {subtitle && <p>{subtitle}</p>}
          </div>
          {actions && <div className="panel-actions">{actions}</div>}
        </header>
      )}
      {children}
    </section>
  );
}

export function Tag({ kind }: { kind: 'sim' | 'model' | 'rule' | 'estimate' }) {
  const map = {
    sim: { icon: <FlaskConical size={11} />, text: 'Simulated data' },
    model: { icon: <Cpu size={11} />, text: 'Model prediction' },
    rule: { icon: null, text: 'Rule-based index' },
    estimate: { icon: null, text: 'Simulated estimate' },
  } as const;
  const m = map[kind];
  return (
    <span className={`tag tag-${kind}`}>
      {m.icon}
      {m.text}
    </span>
  );
}

export function Stat({ label, value, sub, tone, icon }: { label: string; value: ReactNode; sub?: ReactNode; tone?: 'teal' | 'amber' | 'red' | 'blue'; icon?: ReactNode }) {
  return (
    <div className={`stat ${tone ?? ''}`}>
      {icon && <div className="stat-icon">{icon}</div>}
      <div>
        <span className="stat-label">{label}</span>
        <strong className="stat-value">{value}</strong>
        {sub && <span className="stat-sub">{sub}</span>}
      </div>
    </div>
  );
}

export function Empty({ icon, title, children }: { icon?: ReactNode; title: string; children?: ReactNode }) {
  return (
    <div className="empty">
      {icon}
      <strong>{title}</strong>
      {children && <span>{children}</span>}
    </div>
  );
}

export function PageHeading({ eyebrow, title, copy, actions }: { eyebrow: string; title: ReactNode; copy?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="page-heading">
      <div>
        <p className="eyebrow">
          <span className="eyebrow-line" />
          {eyebrow}
        </p>
        <h1>{title}</h1>
        {copy && <p className="heading-copy">{copy}</p>}
      </div>
      {actions && <div className="heading-actions">{actions}</div>}
    </div>
  );
}
