// Detection rate by time-to-failure band on the held-out TEST machines (same split as training; synthetic data).
// Usage: npm run analyze   (reads public/models/forgeguard-model.json)
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { DEFAULT_TRAIN_CONFIG } from '../src/ml/training/train';
import { generateSpecs, simulateTrajectory, extractRows, fitBaseline } from '../src/ml/training/dataset';
import { predictProba } from '../src/ml/models/forest';
import { riskFromProba, conditionIndex } from '../src/ml/training/train';
const b = JSON.parse(readFileSync(resolve(process.argv[2] ?? 'public/models/forgeguard-model.json'), 'utf8'));
const c = DEFAULT_TRAIN_CONFIG;
const traj = generateSpecs(c.trajectories, c.seed).map(simulateTrajectory);
const test = traj.filter((_, i) => i % 10 >= 8.5);
const rows = extractRows(test, b.baseline, ['bearing_wear'] as any);
const bands: [string, number, number][] = [['healthy (no failure)', Infinity, Infinity], ['36-24 h before failure', 24, 36], ['24-16 h', 16, 24], ['16-8 h', 8, 16], ['<=8 h (critical zone)', 0, 8]];
for (const [name, lo, hi] of bands) {
  const rs = rows.filter((r: any) => hi === Infinity ? !isFinite(r.ttfHours) || r.ttfHours > 1e6 : r.ttfHours > lo && r.ttfHours <= hi || (lo === 0 && r.ttfHours <= 8));
  if (!rs.length) continue;
  const pred = rs.map((r: any) => conditionIndex(riskFromProba(predictProba(b.riskForest, r.x))));
  const flagged = pred.filter((p: number) => p >= 1).length / rs.length;
  const crit = pred.filter((p: number) => p === 2).length / rs.length;
  console.log(name.padEnd(26), 'n=' + String(rs.length).padEnd(5), 'flagged Warning-or-worse:', (flagged * 100).toFixed(0) + '%', ' flagged Critical:', (crit * 100).toFixed(0) + '%');
}
