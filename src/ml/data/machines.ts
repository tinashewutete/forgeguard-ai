import type { FailureMode, MachineType, SensorBaseline } from '../types';

export interface MachineTypeProfile {
  type: MachineType;
  label: string;
  baseline: SensorBaseline;
  units: { temperature: string; vibration: string; current: string; rpm: string };
  /** Plausible failure modes for this machine class. */
  modes: FailureMode[];
}

export const MACHINE_TYPES: Record<MachineType, MachineTypeProfile> = {
  cnc: {
    type: 'cnc',
    label: 'CNC milling centre',
    baseline: { temperature: 48, vibration: 1.8, current: 12.4, rpm: 4200, workload: 66 },
    units: { temperature: '°C', vibration: 'mm/s', current: 'A', rpm: 'rpm' },
    modes: ['bearing_wear', 'overheating', 'motor_overload', 'electrical_anomaly', 'rpm_instability'],
  },
  lathe: {
    type: 'lathe',
    label: 'CNC turning centre',
    baseline: { temperature: 45, vibration: 1.5, current: 10.2, rpm: 3000, workload: 60 },
    units: { temperature: '°C', vibration: 'mm/s', current: 'A', rpm: 'rpm' },
    modes: ['bearing_wear', 'overheating', 'motor_overload', 'rpm_instability'],
  },
  printer: {
    type: 'printer',
    label: 'Industrial 3D printer',
    baseline: { temperature: 42, vibration: 0.9, current: 7.1, rpm: 2800, workload: 55 },
    units: { temperature: '°C', vibration: 'mm/s', current: 'A', rpm: 'rpm' },
    modes: ['overheating', 'bearing_wear', 'electrical_anomaly', 'rpm_instability'],
  },
  motor: {
    type: 'motor',
    label: 'Induction drive motor',
    baseline: { temperature: 51, vibration: 1.4, current: 16.8, rpm: 3600, workload: 74 },
    units: { temperature: '°C', vibration: 'mm/s', current: 'A', rpm: 'rpm' },
    modes: ['bearing_wear', 'motor_overload', 'electrical_anomaly', 'overheating'],
  },
};

export interface InitialDegradation {
  mode: FailureMode;
  /** Total simulated hours from degradation onset to functional failure. */
  hoursToFailure: number;
  /** Fraction of that degradation path already elapsed at app start (0..1). */
  progress: number;
}

export interface MachineDefinition {
  id: string;
  name: string;
  type: MachineType;
  model: string;
  location: string;
  installed: string;
  operatingHours: number;
  hoursSinceService: number;
  seed: number;
  initial: InitialDegradation | null;
}

/** Simulated university / industrial fabrication lab fleet. All telemetry is SIMULATED. */
export const FLEET: MachineDefinition[] = [
  { id: 'cnc-01', name: 'CNC Mill 01', type: 'cnc', model: 'Haas VF-2SS', location: 'Bay A · Fabrication', installed: '2021-03-14', operatingHours: 11842, hoursSinceService: 410, seed: 101, initial: null },
  { id: 'printer-02', name: '3D Printer 02', type: 'printer', model: 'Markforged X7', location: 'Bay B · Prototyping', installed: '2022-08-02', operatingHours: 6934, hoursSinceService: 220, seed: 202, initial: null },
  { id: 'motor-03', name: 'Drive Motor 03', type: 'motor', model: 'Siemens 1LE1', location: 'Bay C · Robotics', installed: '2019-11-21', operatingHours: 22630, hoursSinceService: 980, seed: 303, initial: null },
  { id: 'cnc-04', name: 'CNC Mill 04', type: 'cnc', model: 'DMG Mori CMX 600V', location: 'Bay A · Fabrication', installed: '2020-06-09', operatingHours: 15420, hoursSinceService: 1320, seed: 404, initial: { mode: 'bearing_wear', hoursToFailure: 110, progress: 0.74 } },
  { id: 'lathe-05', name: 'CNC Lathe 05', type: 'lathe', model: 'Haas ST-20', location: 'Bay A · Turning', installed: '2021-09-30', operatingHours: 9810, hoursSinceService: 300, seed: 505, initial: null },
  { id: 'printer-06', name: '3D Printer 06', type: 'printer', model: 'Ultimaker S5 Pro', location: 'Bay B · Prototyping', installed: '2023-01-17', operatingHours: 4410, hoursSinceService: 760, seed: 606, initial: { mode: 'overheating', hoursToFailure: 160, progress: 0.55 } },
  { id: 'motor-07', name: 'Conveyor Motor 07', type: 'motor', model: 'ABB M3BP 160', location: 'Bay C · Material handling', installed: '2018-04-05', operatingHours: 28115, hoursSinceService: 1510, seed: 707, initial: { mode: 'electrical_anomaly', hoursToFailure: 70, progress: 0.84 } },
  { id: 'lathe-08', name: 'CNC Lathe 08', type: 'lathe', model: 'Okuma LB3000 EX II', location: 'Bay A · Turning', installed: '2022-02-11', operatingHours: 7020, hoursSinceService: 150, seed: 808, initial: null },
  { id: 'printer-09', name: '3D Printer 09', type: 'printer', model: 'Prusa XL 5-head', location: 'Bay B · Prototyping', installed: '2024-05-23', operatingHours: 2310, hoursSinceService: 95, seed: 909, initial: null },
  { id: 'motor-10', name: 'Spindle Motor 10', type: 'motor', model: 'WEG W22 IE3', location: 'Bay C · Robotics', installed: '2020-10-12', operatingHours: 18400, hoursSinceService: 640, seed: 1010, initial: null },
];

export const DEMO_MACHINE_ID = 'cnc-01';
