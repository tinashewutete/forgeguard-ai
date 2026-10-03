import type { FleetEngine } from '../sim/fleet';
import { DEMO_MACHINE_ID } from '../ml/data/machines';

export type DemoStepId = 'baseline' | 'degrade' | 'anomaly' | 'warning' | 'critical' | 'schedule' | 'repair' | 'recovery' | 'impact';

export interface DemoStep {
  id: DemoStepId;
  title: string;
  narration: string;
  /** Simulation speed (sim-minutes per second) while this step is active. */
  speed: number;
  /** Returns true when the step's goal is reached and the demo may advance. */
  done: (fleet: FleetEngine, ctx: DemoContext) => boolean;
  /** Steps that need an operator decision show an action button instead of auto-advancing. */
  action?: string;
}

export interface DemoContext {
  stepStartedMinute: number;
  scheduled: boolean;
  repaired: boolean;
  verified: boolean;
}

const demoMachine = (f: FleetEngine) => f.get(DEMO_MACHINE_ID)!;

export const DEMO_STEPS: DemoStep[] = [
  {
    id: 'baseline',
    title: 'Healthy baseline',
    narration: 'CNC Mill 01 is running normally. The model sees load-adjusted signals inside the learned healthy envelope: low risk index, high health.',
    speed: 6,
    done: (f, c) => f.minute - c.stepStartedMinute >= 45,
  },
  {
    id: 'degrade',
    title: 'Hidden bearing wear begins',
    narration: 'We silently start a bearing-wear degradation inside the simulator. Nothing tells the model — it must discover the change from vibration, temperature and current trends alone.',
    speed: 15,
    done: (f) => {
      const p = demoMachine(f).prediction;
      return !!p && (p.anomalous || p.risk >= 22);
    },
  },
  {
    id: 'anomaly',
    title: 'Abnormal pattern detected',
    narration: 'The Isolation Forest flags the vibration window as unusual and the risk trend starts climbing — while the raw readings still look acceptable to a human operator.',
    speed: 12,
    done: (f) => (demoMachine(f).prediction?.risk ?? 0) >= 40,
  },
  {
    id: 'warning',
    title: 'Warning: degradation confirmed',
    narration: 'The risk index crossed the warning threshold (40/100). A debounced warning alert is raised with the likely failure mode, contributing factors and a time-to-failure estimate.',
    speed: 12,
    done: (f) => (demoMachine(f).prediction?.risk ?? 0) >= 70,
  },
  {
    id: 'critical',
    title: 'Critical alert — act now',
    narration: 'The risk index is above the critical threshold (70/100). The explanation shows vibration as the dominant driver, and the recommendation engine converts that into a concrete bearing-inspection work order.',
    speed: 0,
    done: (_f, c) => c.scheduled,
    action: 'Schedule maintenance',
  },
  {
    id: 'schedule',
    title: 'Maintenance scheduled',
    narration: 'A P1 work order is created from the alert and assigned to a technician. The machine is taken offline for inspection.',
    speed: 0,
    done: (_f, c) => c.repaired,
    action: 'Complete inspection & repair',
  },
  {
    id: 'repair',
    title: 'Repair recorded',
    narration: 'Findings and the action taken are logged to the maintenance history. The machine is recommissioned and ForgeGuard collects fresh telemetry to verify the fix.',
    speed: 10,
    done: (_f, c) => c.verified,
  },
  {
    id: 'recovery',
    title: 'Recovery verified',
    narration: 'Post-repair risk index is back in the normal band and health has recovered. The full alert → work order → repair → verification loop is closed and auditable.',
    speed: 4,
    done: (f, c) => f.minute - c.stepStartedMinute >= 20,
  },
  {
    id: 'impact',
    title: 'Impact',
    narration: 'The failure was caught hours before breakdown and fixed as planned maintenance instead of an unplanned spindle failure. Figures below are simulated estimates.',
    speed: 2,
    done: () => false,
  },
];
