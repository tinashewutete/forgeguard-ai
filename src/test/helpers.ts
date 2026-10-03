import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { InferenceEngine } from '../ml/inference/engine';
import type { ModelBundle } from '../ml/models/bundle';

let cached: ModelBundle | null = null;

export function loadBundle(): ModelBundle {
  cached ??= JSON.parse(readFileSync(resolve(__dirname, '../../public/models/forgeguard-model.json'), 'utf8')) as ModelBundle;
  return cached;
}

export const engine = () => new InferenceEngine(loadBundle());
