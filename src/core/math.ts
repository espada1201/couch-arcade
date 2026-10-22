export const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

export function median(values: ArrayLike<number>): number {
  const v = Array.from(values).sort((a, b) => a - b);
  const m = v.length >> 1;
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
}
