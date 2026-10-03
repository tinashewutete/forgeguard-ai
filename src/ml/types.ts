export type MachineType = 'cnc' | 'lathe' | 'printer' | 'motor';

export type FailureMode = 'bearing_wear' | 'overheating' | 'motor_overload' | 'electrical_anomaly' | 'rpm_instability';

export const FAILURE_MODES: FailureMode[] = ['bearing_wear', 'overheating', 'motor_overload', 'electrical_anomaly', 'rpm_instability'];

export type Condition = 'normal' | 'warning' | 'critical';

export const CONDITIONS: Condition[] = ['normal', 'warning', 'critical'];

export type SensorKey = 'temperature' | 'vibration' | 'current' | 'rpm' | 'workload';

export interface SensorBaseline {
  temperature: number;
  vibration: number;
  current: number;
  rpm: number;
  workload: number;
}

/** One telemetry observation; sample interval is one simulated minute. */
export interface Sample {
  temperature: number;
  vibration: number;
  current: number;
  rpm: number;
  workload: number;
  hoursSinceService: number;
}

export type ParameterGroup = 'vibration' | 'temperature' | 'current' | 'rpm' | 'workload' | 'service';
