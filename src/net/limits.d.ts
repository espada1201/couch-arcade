export interface Rate {
  rate: number;
  burst: number;
}
export declare const PHONE_MESSAGE_BYTES: number;
export declare const PHONE_BUDGET: Rate;
export declare const PHONE_LIMIT: Rate;
export interface TokenBucket {
  take(now: number, reserve?: number): boolean;
  wait(now: number, reserve?: number): number;
}
export declare function tokenBucket(rate: Rate, now: number): TokenBucket;
