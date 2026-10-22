// A stand-in for the public PeerJS broker (0.peerjs.com), so Internet mode runs over real WebRTC
// data channels between Chromium tabs with no internet. Only signalling is faked, at the browser's
// network boundary: ids from GET /peerjs/id, then OPEN, ID-TAKEN and OFFER/ANSWER/CANDIDATE relayed
// by `dst`, as the PeerServer protocol does. The data itself flows tab to tab over SCTP.

/** One broker shared by every context it is installed on (host and phones may be separate browsers). */
export function peerBroker() {
  const peers = new Map();
  let ids = 0;
  return {
    async install(context) {
      await context.route(/^https:\/\/0\.peerjs\.com(:443)?\/peerjs\/id/, (route) =>
        route.fulfill({ status: 200, contentType: 'text/plain', headers: { 'access-control-allow-origin': '*' }, body: `drive-${++ids}-${Date.now().toString(36)}` }),
      );
      await context.routeWebSocket(/^wss:\/\/0\.peerjs\.com(:443)?\/peerjs/, (ws) => {
        const id = new URL(ws.url()).searchParams.get('id');
        if (peers.has(id)) {
          ws.send(JSON.stringify({ type: 'ID-TAKEN', payload: { msg: 'ID is taken' } }));
          return ws.close();
        }
        peers.set(id, ws);
        ws.send(JSON.stringify({ type: 'OPEN' }));
        ws.onMessage((raw) => {
          const m = JSON.parse(String(raw));
          if (m.type === 'HEARTBEAT' || !m.dst) return;
          const to = peers.get(m.dst);
          if (to) to.send(JSON.stringify({ ...m, src: id }));
          else if (m.type === 'OFFER') ws.send(JSON.stringify({ type: 'EXPIRE', src: m.dst, dst: id }));
        });
        ws.onClose(() => peers.get(id) === ws && peers.delete(id));
      });
    },
  };
}

/** Chromium flags for WebRTC between tabs with no internet: plain host candidates, no mDNS names. */
export const WEBRTC_ARGS = ['--disable-features=WebRtcHideLocalIpsWithMdns', '--allow-loopback-in-peer-connection'];
