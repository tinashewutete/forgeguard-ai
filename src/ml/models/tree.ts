import type { Rng } from '../rng';

/** Compact array-encoded CART tree. Leaf nodes have f = -1. v holds the node value at every node. */
export interface SerializedTree {
  f: number[];
  t: number[];
  l: number[];
  r: number[];
  v: number[][];
}

export interface BinnedData {
  /** Row-major bins: bins[row * nFeatures + feature]. */
  bins: Uint8Array;
  nRows: number;
  nFeatures: number;
  /** thresholds[feature][k] = upper edge of bin k (go left if x <= threshold). */
  thresholds: Float64Array[];
}

const MAX_BINS = 48;

export function binFeatures(X: Float64Array[], nFeatures: number): BinnedData {
  const nRows = X.length;
  const thresholds: Float64Array[] = [];
  for (let f = 0; f < nFeatures; f += 1) {
    const col = new Float64Array(nRows);
    for (let i = 0; i < nRows; i += 1) col[i] = X[i][f];
    col.sort();
    const edges: number[] = [];
    for (let k = 1; k < MAX_BINS; k += 1) {
      const q = col[Math.min(nRows - 1, Math.floor((k / MAX_BINS) * nRows))];
      if (!edges.length || q > edges[edges.length - 1]) edges.push(q);
    }
    thresholds.push(Float64Array.from(edges));
  }
  const bins = new Uint8Array(nRows * nFeatures);
  for (let i = 0; i < nRows; i += 1) {
    for (let f = 0; f < nFeatures; f += 1) {
      const edges = thresholds[f];
      const x = X[i][f];
      let lo = 0;
      let hi = edges.length;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (x <= edges[mid]) hi = mid;
        else lo = mid + 1;
      }
      bins[i * nFeatures + f] = lo;
    }
  }
  return { bins, nRows, nFeatures, thresholds };
}

export interface TreeParams {
  maxDepth: number;
  minLeaf: number;
  mtry: number;
}

const round = (x: number, digits: number) => {
  const p = 10 ** digits;
  return Math.round(x * p) / p;
};

class TreeBuilder {
  f: number[] = [];
  t: number[] = [];
  l: number[] = [];
  r: number[] = [];
  v: number[][] = [];

  constructor(
    private data: BinnedData,
    private params: TreeParams,
    private rng: Rng,
    private task: { kind: 'class'; y: Int32Array; nClasses: number } | { kind: 'reg'; y: Float64Array },
  ) {}

  private nodeValue(idx: Uint32Array): number[] {
    if (this.task.kind === 'class') {
      const counts = new Array<number>(this.task.nClasses).fill(0);
      for (let i = 0; i < idx.length; i += 1) counts[this.task.y[idx[i]]] += 1;
      return counts.map((c) => round(c / idx.length, 4));
    }
    let s = 0;
    for (let i = 0; i < idx.length; i += 1) s += this.task.y[idx[i]];
    return [round(s / idx.length, 4)];
  }

  build(idx: Uint32Array, depth: number): number {
    const id = this.f.length;
    this.f.push(-1);
    this.t.push(0);
    this.l.push(-1);
    this.r.push(-1);
    const value = this.nodeValue(idx);
    this.v.push(value);
    if (depth >= this.params.maxDepth || idx.length < 2 * this.params.minLeaf) return id;
    if (this.task.kind === 'class' && value.some((p) => p >= 0.999)) return id;

    const split = this.bestSplit(idx);
    if (!split) return id;
    const { feature, bin } = split;
    const nF = this.data.nFeatures;
    const left: number[] = [];
    const right: number[] = [];
    for (let i = 0; i < idx.length; i += 1) {
      const row = idx[i];
      if (this.data.bins[row * nF + feature] <= bin) left.push(row);
      else right.push(row);
    }
    this.f[id] = feature;
    this.t[id] = round(this.data.thresholds[feature][bin], 6);
    this.l[id] = this.build(Uint32Array.from(left), depth + 1);
    this.r[id] = this.build(Uint32Array.from(right), depth + 1);
    return id;
  }

  private bestSplit(idx: Uint32Array): { feature: number; bin: number } | null {
    const { nFeatures, bins } = this.data;
    const features = Array.from({ length: nFeatures }, (_, i) => i);
    for (let i = features.length - 1; i > 0; i -= 1) {
      const j = Math.floor(this.rng.next() * (i + 1));
      [features[i], features[j]] = [features[j], features[i]];
    }
    const chosen = features.slice(0, this.params.mtry);
    const n = idx.length;
    const minLeaf = this.params.minLeaf;
    let bestGain = 1e-9;
    let best: { feature: number; bin: number } | null = null;

    if (this.task.kind === 'class') {
      const K = this.task.nClasses;
      const y = this.task.y;
      const total = new Float64Array(K);
      for (let i = 0; i < n; i += 1) total[y[idx[i]]] += 1;
      const giniOf = (c: Float64Array | number[], m: number) => {
        if (m === 0) return 0;
        let s = 0;
        for (let k = 0; k < K; k += 1) s += (c[k] / m) ** 2;
        return 1 - s;
      };
      const parent = giniOf(total, n);
      for (const f of chosen) {
        const nb = this.data.thresholds[f].length + 1;
        const hist = new Float64Array(nb * K);
        for (let i = 0; i < n; i += 1) {
          const row = idx[i];
          hist[bins[row * nFeatures + f] * K + y[row]] += 1;
        }
        const leftC = new Float64Array(K);
        let nl = 0;
        for (let b = 0; b < nb - 1; b += 1) {
          for (let k = 0; k < K; k += 1) {
            leftC[k] += hist[b * K + k];
            nl += hist[b * K + k];
          }
          const nr = n - nl;
          if (nl < minLeaf || nr < minLeaf) continue;
          const rightC = new Float64Array(K);
          for (let k = 0; k < K; k += 1) rightC[k] = total[k] - leftC[k];
          const gain = parent - (nl / n) * giniOf(leftC, nl) - (nr / n) * giniOf(rightC, nr);
          if (gain > bestGain) {
            bestGain = gain;
            best = { feature: f, bin: b };
          }
        }
      }
    } else {
      const y = this.task.y;
      let sum = 0;
      let sq = 0;
      for (let i = 0; i < n; i += 1) {
        sum += y[idx[i]];
        sq += y[idx[i]] ** 2;
      }
      const parentSse = sq - (sum * sum) / n;
      for (const f of chosen) {
        const nb = this.data.thresholds[f].length + 1;
        const hs = new Float64Array(nb);
        const hq = new Float64Array(nb);
        const hc = new Float64Array(nb);
        for (let i = 0; i < n; i += 1) {
          const row = idx[i];
          const b = bins[row * nFeatures + f];
          hs[b] += y[row];
          hq[b] += y[row] ** 2;
          hc[b] += 1;
        }
        let ls = 0;
        let lq = 0;
        let lc = 0;
        for (let b = 0; b < nb - 1; b += 1) {
          ls += hs[b];
          lq += hq[b];
          lc += hc[b];
          const rc = n - lc;
          if (lc < minLeaf || rc < minLeaf) continue;
          const rs = sum - ls;
          const rq = sq - lq;
          const sse = lq - (ls * ls) / lc + (rq - (rs * rs) / rc);
          const gain = (parentSse - sse) / n;
          if (gain > bestGain) {
            bestGain = gain;
            best = { feature: f, bin: b };
          }
        }
      }
    }
    return best;
  }
}

export function trainClassificationTree(data: BinnedData, y: Int32Array, nClasses: number, idx: Uint32Array, params: TreeParams, rng: Rng): SerializedTree {
  const b = new TreeBuilder(data, params, rng, { kind: 'class', y, nClasses });
  b.build(idx, 0);
  return { f: b.f, t: b.t, l: b.l, r: b.r, v: b.v };
}

export function trainRegressionTree(data: BinnedData, y: Float64Array, idx: Uint32Array, params: TreeParams, rng: Rng): SerializedTree {
  const b = new TreeBuilder(data, params, rng, { kind: 'reg', y });
  b.build(idx, 0);
  return { f: b.f, t: b.t, l: b.l, r: b.r, v: b.v };
}

export function predictTree(tree: SerializedTree, x: ArrayLike<number>): number[] {
  let node = 0;
  while (tree.f[node] !== -1) node = x[tree.f[node]] <= tree.t[node] ? tree.l[node] : tree.r[node];
  return tree.v[node];
}

/**
 * Exact additive decomposition of a tree's output along the decision path (Saabas method):
 * output = value(root) + Σ_features contribution. `score` projects a node value to a scalar.
 */
export function treeContributions(tree: SerializedTree, x: ArrayLike<number>, score: (v: number[]) => number, out: Float64Array): number {
  let node = 0;
  let prev = score(tree.v[0]);
  const bias = prev;
  while (tree.f[node] !== -1) {
    const f = tree.f[node];
    node = x[f] <= tree.t[node] ? tree.l[node] : tree.r[node];
    const cur = score(tree.v[node]);
    out[f] += cur - prev;
    prev = cur;
  }
  return bias;
}
