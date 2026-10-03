import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { DEFAULT_TRAIN_CONFIG, trainPipeline } from '../src/ml/training/train';

const out = resolve(process.argv[2] ?? 'public/models/forgeguard-model.json');
let last = '';
const bundle = trainPipeline(DEFAULT_TRAIN_CONFIG, (stage, f) => {
  if (stage !== last) {
    last = stage;
    console.log(`[train] ${stage}`);
  } else if (f > 0) process.stdout.write(`  ${(f * 100).toFixed(0)}%\r`);
});
writeFileSync(out, JSON.stringify(bundle));
const m = bundle.metrics;
console.log(JSON.stringify({ dataset: m.dataset, risk: { ...m.risk }, anomaly: m.anomaly, failureMode: { accuracy: m.failureMode.accuracy, macroF1: m.failureMode.macroF1, confusion: m.failureMode.confusion }, ttf: m.timeToFailure, lead: m.leadTime, topFeatures: m.permutationImportance.slice(0, 8), seconds: m.trainingSeconds }, null, 1));
console.log(`[train] wrote ${out}`);
