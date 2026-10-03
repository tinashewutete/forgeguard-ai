import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import {
  Bell, BrainCircuit, Clock, Cloud, CloudOff, Cog, Columns3, Disc,
  LayoutDashboard, Menu, MessageSquareText, Pause, Play, Presentation,
  Printer, RotateCcw, ShieldCheck, SlidersHorizontal, Workflow, Wrench, X, Zap,
} from 'lucide-react';
import type { MachineType } from '../ml/types';
import { useApp, useFleet, useRecords } from '../state/AppContext';
import { href } from '../lib/router';
import type { Route } from '../lib/router';
import { dateTime } from '../lib/format';

export function MachineIcon({ type, size = 16 }: { type: MachineType; size?: number }) {
  if (type === 'printer') return <Printer size={size} aria-hidden="true" />;
  if (type === 'motor')   return <Zap size={size} aria-hidden="true" />;
  if (type === 'lathe')   return <Disc size={size} aria-hidden="true" />;
  return <Cog size={size} aria-hidden="true" />;
}

const NAV: { route: Route; label: string; icon: ReactNode }[] = [
  { route: { page: 'overview' },     label: 'Fleet overview',       icon: <LayoutDashboard size={15} /> },
  { route: { page: 'alerts' },       label: 'Alert center',         icon: <Bell size={15} /> },
  { route: { page: 'maintenance' },  label: 'Maintenance',          icon: <Wrench size={15} /> },
  { route: { page: 'whatif' },       label: 'What-if simulator',    icon: <SlidersHorizontal size={15} /> },
  { route: { page: 'compare' },      label: 'Compare machines',     icon: <Columns3 size={15} /> },
  { route: { page: 'model' },        label: 'Model & evaluation',   icon: <BrainCircuit size={15} /> },
  { route: { page: 'how' },          label: 'How it works',         icon: <Workflow size={15} /> },
];

function Sidebar({ route, open, onClose }: { route: Route; open: boolean; onClose: () => void }) {
  const { model, modelStatus } = useApp();
  const { alerts, sync, syncError } = useRecords();
  const openAlerts = alerts.filter((a) => a.status === 'open').length;
  const active = (r: Route) =>
    r.page === route.page || (r.page === 'overview' && route.page === 'machine');

  return (
    <aside className={`sidebar ${open ? 'open' : ''}`} aria-label="Primary navigation">
      <div className="brand">
        <div className="brand-mark" aria-hidden="true">
          <ShieldCheck size={17} />
        </div>
        <div>
          <strong>ForgeGuard AI</strong>
          <span>MACHINE HEALTH INTELLIGENCE</span>
        </div>
        <button className="mobile-close" onClick={onClose} aria-label="Close navigation">
          <X size={18} />
        </button>
      </div>

      <nav className="primary-nav" aria-label="Main">
        <p className="nav-label">Operations</p>
        {NAV.map((n) => (
          <a
            key={n.label}
            href={href(n.route)}
            className={`nav-item ${active(n.route) ? 'active' : ''}`}
            aria-current={active(n.route) ? 'page' : undefined}
            onClick={onClose}
          >
            {n.icon}
            <span>{n.label}</span>
            {n.route.page === 'alerts' && openAlerts > 0 && (
              <span className="nav-count" aria-label={`${openAlerts} open alerts`}>
                {openAlerts}
              </span>
            )}
          </a>
        ))}
      </nav>

      <div className="sidebar-bottom">
        <div className="side-status">
          <span
            className={`status-dot ${modelStatus === 'ready' ? '' : 'amber'}`}
            aria-hidden="true"
          />
          <div>
            <strong>
              {modelStatus === 'ready'
                ? `${model?.name ?? 'Model'} v${model?.version}`
                : 'Rule-based fallback'}
            </strong>
            <span>
              {modelStatus === 'ready'
                ? 'Random forest + isolation forest'
                : 'Model artifact unavailable'}
            </span>
          </div>
        </div>
        <div className="side-status" title={syncError ?? undefined}>
          {sync === 'offline' ? (
            <CloudOff size={14} />
          ) : (
            <Cloud size={14} className={sync === 'error' ? 'text-amber' : 'text-teal'} />
          )}
          <div>
            <strong>
              {sync === 'offline'
                ? 'Offline mode'
                : sync === 'synced'
                  ? 'Supabase synced'
                  : sync === 'error'
                    ? 'Cloud sync failed'
                    : 'Connecting…'}
            </strong>
            <span>{sync === 'error' ? 'History kept locally' : 'History saved locally'}</span>
          </div>
        </div>
        <p className="side-note">
          All telemetry is simulated. Model metrics are from synthetic held-out data.
        </p>
      </div>
    </aside>
  );
}

const SPEEDS = [1, 5, 15, 60];

function Topbar({ onMenu, onCopilot }: { onMenu: () => void; onCopilot: () => void }) {
  const fleet = useFleet();
  const { resetSimulation, startDemo, demo } = useApp();
  const [, force] = useState(0);

  const toggle = () => {
    fleet.running = !fleet.running;
    force((x) => x + 1);
  };
  const setSpeed = (s: number) => {
    fleet.speed = s;
    fleet.running = true;
    force((x) => x + 1);
  };

  return (
    <header className="topbar">
      <button className="mobile-menu" onClick={onMenu} aria-label="Open navigation">
        <Menu size={20} />
      </button>

      <div className="sim-clock" aria-live="off">
        <Clock size={14} aria-hidden="true" />
        <span className="mono">{dateTime(fleet.now)}</span>
        <span className="sim-pill">SIM</span>
      </div>

      <div className="topbar-actions">
        <div className="speed-control" role="group" aria-label="Simulation speed">
          <button
            className="icon-btn"
            onClick={toggle}
            aria-label={fleet.running && fleet.speed > 0 ? 'Pause simulation' : 'Resume simulation'}
          >
            {fleet.running && fleet.speed > 0 ? <Pause size={14} /> : <Play size={14} />}
          </button>
          {SPEEDS.map((s) => (
            <button
              key={s}
              className={`speed-btn ${fleet.speed === s && fleet.running ? 'active' : ''}`}
              onClick={() => setSpeed(s)}
              aria-pressed={fleet.speed === s && fleet.running}
              title={`${s} simulated minute${s > 1 ? 's' : ''} per second`}
            >
              {s === 1 ? '1×' : `${s}×`}
            </button>
          ))}
        </div>

        <button
          className="icon-btn"
          onClick={resetSimulation}
          aria-label="Reset simulation"
          title="Reset simulation to initial state"
        >
          <RotateCcw size={15} />
        </button>

        <button className="button button-ghost hide-sm" onClick={onCopilot}>
          <MessageSquareText size={14} /> Copilot
        </button>
        <button className="icon-btn show-sm" onClick={onCopilot} aria-label="Open maintenance copilot">
          <MessageSquareText size={16} />
        </button>

        {!demo.active && (
          <button className="button button-primary" onClick={startDemo} aria-label="Start judge demo">
            <Presentation size={14} /> <span className="hide-xs">Judge Demo</span>
          </button>
        )}
      </div>
    </header>
  );
}

export function Layout({
  route,
  children,
  onCopilot,
  banner,
}: {
  route: Route;
  children: ReactNode;
  onCopilot: () => void;
  banner?: ReactNode;
}) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <Sidebar route={route} open={open} onClose={() => setOpen(false)} />
      {open && (
        <div className="scrim" onClick={() => setOpen(false)} aria-hidden="true" />
      )}
      <div className="main-content">
        <Topbar onMenu={() => setOpen(true)} onCopilot={onCopilot} />
        {banner}
        <main id="main" className="page-content" tabIndex={-1}>
          {children}
        </main>
      </div>
    </div>
  );
}
