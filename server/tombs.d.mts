export interface Tombstones {
  readonly size: number;
  hold(room: string, key: string, life: { born: number; hadPhone: boolean }): void;
  heldFor(room: string): string | undefined;
  release(room: string): boolean;
  sweep(): void;
}
export declare function tombstones(options: { max: number; holdMs: number; minLifeMs: number; now?: () => number }): Tombstones;
