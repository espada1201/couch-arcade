export declare function deviceKey(addr: string | undefined): string;
export interface DeviceLedger {
  crowded(addr: string | undefined, role: 'host' | 'phone'): boolean;
  track(ws: { on(event: 'close', cb: () => void): unknown }, addr: string | undefined, role: 'host' | 'phone'): void;
}
export declare function deviceLedger(limit: number): DeviceLedger;
