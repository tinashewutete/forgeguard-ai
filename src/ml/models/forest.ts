import { Rng } from '../rng';
import type { BinnedData, SerializedTree, TreeParams } from './tree';
import { predictTree, trainClassificationTree, trainRegressionTree, treeContributions } from './tree';

export interface SerializedForest {
  kind: 'classifier' | 'regressor';
  classes?: string[];
  params: TreeParams & { nTrees: number; sampleRate: number };
  trees: SerializedTree[];
}

export interface ForestParams extends TreeParams {
  nTrees: number;
  sampleRate: number;
}

function bootstrap(rows: Uint32Array, rate: number, rng: Rng): Uint32Array {
  const m = Math.max(1, Math.floor(rows.length * rate));
  const out = new Uint32Array(m);
  for (let i = 0; i < m; i += 1) out[i] = rows[Math.floor(rng.next() * rows.length)];
  return out;
}

export function trainForestClassifier(data: BinnedData, y: Int32Array, classes: string[], rows: Uint32Array, params: ForestParams, seed: number): SerializedForest {
  const rng = new Rng(seed);
  const trees: SerializedTree[] = [];
  for (let t = 0; t < params.nTrees; t += 1) trees.push(trainClassificationTree(data, y, classes.length, bootstrap(rows, params.sampleRate, rng), params, rng));
  return { kind: 'classifier', classes, params, trees };
}

export function trainForestRegressor(data: BinnedData, y: Float64Array, rows: Uint32Array, params: ForestParams, seed: number): SerializedForest {
  const rng = new Rng(seed);
  const trees: SerializedTree[] = [];
  for (let t = 0; t < params.nTrees; t += 1) trees.push(trainRegressionTree(data, y, bootstrap(rows, params.sampleRate, rng), params, rng));
  return { kind: 'regressor', params, trees };
}

export function predictProba(forest: SerializedForest, x: ArrayLike<number>): number[] {
  const K = forest.classes?.length ?? 1;
  const acc = new Array<number>(K).fill(0);
  for (const tree of forest.trees) {
    const v = predictTree(tree, x);
    for (let k = 0; k < K; k += 1) acc[k] += v[k];
  }
  return acc.map((s) => s / forest.trees.length);
}

/** Per-tree regression outputs; the spread gives an uncertainty interval. */
export function predictRegressionTrees(forest: SerializedForest, x: ArrayLike<number>): number[] {
  return forest.trees.map((tree) => predictTree(tree, x)[0]);
}

export function forestContributions(forest: SerializedForest, x: ArrayLike<number>, nFeatures: number, score: (v: number[]) => number): { bias: number; contributions: Float64Array } {
  const contributions = new Float64Array(nFeatures);
  let bias = 0;
  for (const tree of forest.trees) bias += treeContributions(tree, x, score, contributions);
  const n = forest.trees.length;
  for (let f = 0; f < nFeatures; f += 1) contributions[f] /= n;
  return { bias: bias / n, contributions };
}
