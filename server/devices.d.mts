export declare function deviceKey(addr: string): string;
export interface DeviceLedger {
  crowded(addr: string, role: 'host' | 'phone'): boolean;
  track(ws: { on(event: 'close', cb: () => void): unknown }, addr: string, role: 'host' | 'phone'): void;
}
export declare function deviceLedger(limit: number): DeviceLedger;
