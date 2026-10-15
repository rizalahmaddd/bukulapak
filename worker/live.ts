import { DurableObject } from 'cloudflare:workers';
import type { Env } from './env';

// One instance per tenant. It holds the open sockets of that tenant's devices and tells them to pull
// when another device pushes. It never carries records, so a missed message only delays a sync.
const MAX_SOCKETS = 50;

export class TenantLive extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    // Answered by the runtime without waking the object, so idle keepalives cost nothing.
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'));
  }

  async fetch(req: Request): Promise<Response> {
    const device = req.headers.get('x-device');
    if (req.headers.get('upgrade') !== 'websocket' || !device) return new Response('expected websocket', { status: 426 });
    const open = this.ctx.getWebSockets();
    if (open.length >= MAX_SOCKETS) open[0].close(1013, 'too many connections');
    const { 0: client, 1: server } = new WebSocketPair();
    this.ctx.acceptWebSocket(server, [device]);
    // Browsers drop the connection unless the server selects one of the offered subprotocols.
    return new Response(null, { status: 101, webSocket: client, headers: { 'sec-websocket-protocol': 'bukulapak' } });
  }

  /** Tells every device except the sender that new records are on the server. */
  async notify(fromDevice: string): Promise<void> {
    for (const ws of this.ctx.getWebSockets()) {
      if (this.ctx.getTags(ws).includes(fromDevice)) continue;
      try {
        ws.send('sync');
      } catch {
        /* socket already closing */
      }
    }
  }

  async webSocketMessage(): Promise<void> {
    /* clients only send keepalive pings, which the auto-response handles */
  }

  async webSocketClose(ws: WebSocket, code: number): Promise<void> {
    try {
      ws.close(code === 1005 || code === 1006 ? 1000 : code, 'closed');
    } catch {
      /* already closed */
    }
  }
}
