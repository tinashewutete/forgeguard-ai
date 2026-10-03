import { Rng } from '../rng';

/** Isolation Forest (Liu et al., 2008) for unsupervised anomaly detection on feature windows. */
export interface SerializedIsolationForest {
  sampleSize: number;
  trees: { f: number[]; t: number[]; l: number[]; r: number[]; s: number[] }[];
  /** Score above which a window is flagged anomalous (calibrated on healthy validation data). */
  threshold: number;
}

function cFactor(n: number): number {
  if (n <= 1) return 0;
  if (n === 2) return 1;
  return 2 * (Math.log(n - 1) + 0.5772156649) - (2 * (n - 1)) / n;
}

export function trainIsolationForest(X: Float64Array[], nTrees: number, sampleSize: number, seed: number): SerializedIsolationForest {
  const rng = new Rng(seed);
  const nFeatures = X[0].length;
  const heightLimit = Math.ceil(Math.log2(sampleSize));
  const trees: SerializedIsolationForest['trees'] = [];
  for (let t = 0; t < nTrees; t += 1) {
    const sample: Float64Array[] = [];
    for (let i = 0; i < sampleSize; i += 1) sample.push(X[Math.floor(rng.next() * X.length)]);
    const tree = { f: [] as number[], t: [] as number[], l: [] as number[], r: [] as number[], s: [] as number[] };
    const build = (rows: Float64Array[], depth: number): number => {
      const id = tree.f.length;
      tree.f.push(-1);
      tree.t.push(0);
      tree.l.push(-1);
      tree.r.push(-1);
      tree.s.push(rows.length);
      if (depth >= heightLimit || rows.length <= 1) return id;
      for (let attempt = 0; attempt < 6; attempt += 1) {
        const f = Math.floor(rng.next() * nFeatures);
        let lo = Infinity;
        let hi = -Infinity;
        for (const r of rows) {
          if (r[f] < lo) lo = r[f];
          if (r[f] > hi) hi = r[f];
        }
        if (hi - lo < 1e-12) continue;
        const thr = lo + rng.next() * (hi - lo);
        const left = rows.filter((r) => r[f] <= thr);
        const right = rows.filter((r) => r[f] > thr);
        tree.f[id] = f;
        tree.t[id] = Math.round(thr * 1e6) / 1e6;
        tree.l[id] = build(left, depth + 1);
        tree.r[id] = build(right, depth + 1);
        return id;
      }
      return id;
    };
    build(sample, 0);
    trees.push(tree);
  }
  return { sampleSize, trees, threshold: 0.6 };
}

/** Anomaly score in (0, 1); ~0.5 is typical, values approaching 1 are increasingly anomalous. */
export function anomalyScore(model: SerializedIsolationForest, x: ArrayLike<number>): number {
  let total = 0;
  for (const tree of model.trees) {
    let node = 0;
    let depth = 0;
    while (tree.f[node] !== -1) {
      node = x[tree.f[node]] <= tree.t[node] ? tree.l[node] : tree.r[node];
      depth += 1;
    }
    total += depth + cFactor(tree.s[node]);
  }
  return 2 ** (-(total / model.trees.length) / cFactor(model.sampleSize));
}
