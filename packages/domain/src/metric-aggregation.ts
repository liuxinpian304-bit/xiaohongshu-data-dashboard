export function aggregateCumulative(values: readonly number[]): number {
  if (values.length < 2) return 0;
  return values.at(-1)! - values[0]!;
}
