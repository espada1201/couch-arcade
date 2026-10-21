import { LocalTransport } from './local';
import { PeerTransport } from './peer';
import { RelayTransport, relayInfo, type RelayInfo } from './relay';
import type { Transport } from './transport';

export interface Picked {
  transport: Transport;
  relay: RelayInfo | null;
}

/** `?transport=local|lan|internet` forces one; otherwise LAN relay when served by `npm start`, else internet. */
export async function pickTransport(params: URLSearchParams): Promise<Picked> {
  const forced = params.get('transport');
  if (forced === 'local') return { transport: new LocalTransport(), relay: null };
  if (forced === 'internet') return { transport: new PeerTransport(), relay: null };
  const relay = await relayInfo();
  if (relay || forced === 'lan') return { transport: new RelayTransport(), relay };
  return { transport: new PeerTransport(), relay: null };
}
