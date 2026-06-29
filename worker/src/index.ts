export { GameRoom, RoomRegistry } from './game';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  'Access-Control-Allow-Headers': 'content-type',
};

const withCors = (response: Response) => {
  const headers = new Headers(response.headers);
  for (const [key, value] of Object.entries(corsHeaders)) headers.set(key, value);
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
};

const json = (value: unknown, init: ResponseInit = {}) =>
  withCors(
    new Response(JSON.stringify(value), {
      ...init,
      headers: {
        'content-type': 'application/json; charset=utf-8',
        ...(init.headers ?? {}),
      },
    }),
  );

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders });

    if (url.pathname === '/api/health') return json({ ok: true, service: 'number-veil-api' });

    if (url.pathname === '/api/rooms' && request.method === 'POST') {
      const registry = env.ROOM_REGISTRY.get(env.ROOM_REGISTRY.idFromName('global'));
      return withCors(await registry.fetch('https://registry.local/create', request));
    }

    if (url.pathname === '/api/rooms' && request.method === 'GET') {
      const registry = env.ROOM_REGISTRY.get(env.ROOM_REGISTRY.idFromName('global'));
      return withCors(await registry.fetch('https://registry.local/active'));
    }

    if (url.pathname.startsWith('/ws/')) {
      const upgrade = request.headers.get('Upgrade');
      if (upgrade?.toLowerCase() !== 'websocket') return new Response('Expected WebSocket', { status: 426 });

      const roomId = url.pathname.split('/').at(-1) ?? '';
      if (!/^\d{3}$/.test(roomId)) return new Response('Invalid room id', { status: 400 });

      const room = env.GAME_ROOM.get(env.GAME_ROOM.idFromName(roomId));
      return room.fetch(request);
    }

    return json({ error: 'Not found' }, { status: 404 });
  },
};
