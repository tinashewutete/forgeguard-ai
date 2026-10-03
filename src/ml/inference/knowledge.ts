import type { Condition, FailureMode, ParameterGroup } from '../types';

export const MODE_LABEL: Record<FailureMode, string> = {
  bearing_wear: 'Bearing wear',
  overheating: 'Overheating / cooling fault',
  motor_overload: 'Motor overload',
  electrical_anomaly: 'Electrical anomaly',
  rpm_instability: 'RPM instability',
};

export const GROUP_LABEL: Record<ParameterGroup, string> = {
  vibration: 'Vibration',
  temperature: 'Temperature',
  current: 'Motor current',
  rpm: 'RPM stability',
  workload: 'Workload',
  service: 'Service age',
};

export interface Recommendation {
  headline: string;
  urgency: 'monitor' | 'plan' | 'urgent' | 'stop';
  window: string;
  actions: string[];
  checks: string[];
  ifIgnored: string;
  estimatedDowntimeHours: number;
}

const PLAYBOOK: Record<FailureMode, { actions: string[]; checks: string[]; ifIgnored: string; downtime: number }> = {
  bearing_wear: {
    actions: ['Inspect spindle/drive bearings and lubrication', 'Run vibration spectrum check at bearing defect frequencies', 'Replace bearing set if outer-race defect confirmed'],
    checks: ['Grease condition and contamination', 'Axial / radial play', 'Belt tension and alignment'],
    ifIgnored: 'Bearing seizure can damage the spindle shaft and housing, turning a 2–3 h bearing swap into a multi-day spindle rebuild.',
    downtime: 3,
  },
  overheating: {
    actions: ['Inspect cooling fan, coolant flow and heat-sink fins', 'Clean filters and verify thermal paste / thermistor seating', 'Reduce duty cycle until cooling is restored'],
    checks: ['Coolant level and pump pressure', 'Ambient temperature and enclosure airflow', 'Thermal sensor calibration'],
    ifIgnored: 'Sustained over-temperature degrades insulation and lubricants and can trigger thermal shutdown mid-job (scrapped parts).',
    downtime: 1.5,
  },
  motor_overload: {
    actions: ['Check mechanical load path for binding or excessive tool wear', 'Verify drive current limits and motor winding temperature', 'Rebalance job schedule to reduce sustained peak load'],
    checks: ['Tool condition / feed rates', 'Coupling and gearbox resistance', 'Supply voltage balance'],
    ifIgnored: 'Prolonged overload overheats windings and can burn out the motor or trip the drive repeatedly.',
    downtime: 2,
  },
  electrical_anomaly: {
    actions: ['Inspect power connections, contactors and cable insulation', 'Measure phase currents and voltage balance', 'Check drive/VFD fault log and earth continuity'],
    checks: ['Loose terminals / thermal discoloration', 'Harmonics or phase imbalance', 'Encoder and feedback cabling'],
    ifIgnored: 'Intermittent electrical faults escalate to drive trips, insulation breakdown, or an electrical safety hazard.',
    downtime: 2,
  },
  rpm_instability: {
    actions: ['Check encoder/feedback signal and speed-loop tuning', 'Inspect belts, couplings and spindle drive for slip', 'Verify drive parameters against commissioning baseline'],
    checks: ['Encoder cable shielding', 'Belt wear and tension', 'Drive gain settings'],
    ifIgnored: 'Speed instability causes poor surface finish and dimensional errors, and accelerates mechanical wear.',
    downtime: 1.5,
  },
};

export function recommend(condition: Condition, mode: FailureMode | null, ttcHours: number | null, anomalous: boolean): Recommendation {
  if (condition === 'normal' || !mode) {
    return {
      headline: anomalous ? 'Unusual pattern — keep monitoring' : 'Continue normal operation',
      urgency: 'monitor',
      window: anomalous ? 'Review at next shift handover' : 'Next routine service',
      actions: anomalous
        ? ['Watch the flagged signals over the next few hours', 'Confirm the pattern is not caused by a job or tooling change']
        : ['No action required', 'Keep routine preventive-maintenance schedule'],
      checks: [],
      ifIgnored: 'No elevated failure risk detected by the model at this time.',
      estimatedDowntimeHours: 0,
    };
  }
  const p = PLAYBOOK[mode];
  if (condition === 'warning') {
    return {
      headline: `Schedule ${MODE_LABEL[mode].toLowerCase()} inspection`,
      urgency: 'plan',
      window: ttcHours !== null ? `Within ~${Math.max(4, Math.round(ttcHours * 0.5))} h (before next production cycle)` : 'Within 24 h',
      actions: p.actions,
      checks: p.checks,
      ifIgnored: p.ifIgnored,
      estimatedDowntimeHours: p.downtime,
    };
  }
  const stop = ttcHours !== null && ttcHours < 3;
  return {
    headline: stop ? `Stop machine — ${MODE_LABEL[mode].toLowerCase()} imminent` : `Urgent: ${MODE_LABEL[mode].toLowerCase()} — intervene this shift`,
    urgency: stop ? 'stop' : 'urgent',
    window: stop ? 'Immediately' : 'This shift',
    actions: p.actions,
    checks: p.checks,
    ifIgnored: p.ifIgnored,
    estimatedDowntimeHours: p.downtime,
  };
}
