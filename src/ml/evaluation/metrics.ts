import type { ClassReport } from '../models/bundle';

export function confusionMatrix(yTrue: ArrayLike<number>, yPred: ArrayLike<number>, k: number): number[][] {
  const m = Array.from({ length: k }, () => new Array<number>(k).fill(0));
  for (let i = 0; i < yTrue.length; i += 1) m[yTrue[i]][yPred[i]] += 1;
  return m;
}

export function classReports(confusion: number[][], labels: string[]): ClassReport[] {
  return labels.map((label, c) => {
    const tp = confusion[c][c];
    const support = confusion[c].reduce((a, b) => a + b, 0);
    const predicted = confusion.reduce((a, row) => a + row[c], 0);
    const precision = predicted ? tp / predicted : 0;
    const recall = support ? tp / support : 0;
    const f1 = precision + recall ? (2 * precision * recall) / (precision + recall) : 0;
    return { label, precision, recall, f1, support };
  });
}

export function accuracy(confusion: number[][]): number {
  let correct = 0;
  let total = 0;
  confusion.forEach((row, i) => row.forEach((v, j) => {
    total += v;
    if (i === j) correct += v;
  }));
  return total ? correct / total : 0;
}

export function macroF1(reports: ClassReport[]): number {
  return reports.reduce((a, r) => a + r.f1, 0) / reports.length;
}

/** ROC-AUC via the rank-sum (Mann–Whitney U) formulation with tie handling. */
export function rocAuc(labels: ArrayLike<number>, scores: ArrayLike<number>): number {
  const idx = Array.from({ length: labels.length }, (_, i) => i).sort((a, b) => scores[a] - scores[b]);
  const ranks = new Float64Array(labels.length);
  let i = 0;
  while (i < idx.length) {
    let j = i;
    while (j + 1 < idx.length && scores[idx[j + 1]] === scores[idx[i]]) j += 1;
    const r = (i + j) / 2 + 1;
    for (let k = i; k <= j; k += 1) ranks[idx[k]] = r;
    i = j + 1;
  }
  let pos = 0;
  let sumPos = 0;
  for (let k = 0; k < labels.length; k += 1) {
    if (labels[k] === 1) {
      pos += 1;
      sumPos += ranks[k];
    }
  }
  const neg = labels.length - pos;
  if (!pos || !neg) return NaN;
  return (sumPos - (pos * (pos + 1)) / 2) / (pos * neg);
}

export function quantile(values: number[], q: number): number {
  if (!values.length) return NaN;
  const s = [...values].sort((a, b) => a - b);
  const pos = (s.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return s[lo] + (s[hi] - s[lo]) * (pos - lo);
}
