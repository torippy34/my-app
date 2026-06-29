import type {
  ClientMessage,
  ClientPlayer,
  ClientView,
  DealCheck,
  GameLog,
  GameSettings,
  JoinKind,
  Player,
  RankingEntry,
  RoomData,
  Spectator,
  Tile,
} from './types';

const ROOM_STORAGE_KEY = 'room';
const REGISTRY_STORAGE_KEY = 'activeRoomIds';
const EMPTY_ROOM_TTL_MS = 5 * 60 * 1000;
const DEFAULT_SETTINGS: GameSettings = {
  maxNumber: 10,
  maxPlayers: 6,
  handSize: 5,
  allowSpectators: true,
};

type Session = {
  userId: string;
};

const json = (value: unknown, init: ResponseInit = {}) =>
  new Response(JSON.stringify(value), {
    ...init,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      ...(init.headers ?? {}),
    },
  });

const now = () => Date.now();
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, Math.trunc(value)));
const roomIdPattern = /^\d{3}$/;

const safeName = (name: string | null) => {
  const trimmed = (name ?? '').trim();
  return trimmed.length > 0 ? trimmed.slice(0, 24) : '名無し';
};

const logEntry = (type: GameLog['type'], message: string): GameLog => ({
  id: crypto.randomUUID(),
  type,
  message,
  at: now(),
});

const totalTilesFor = (maxNumber: number) => (maxNumber * (maxNumber + 1)) / 2;

const dealCheckFor = (settings: GameSettings, playerCount: number): DealCheck => {
  const totalTiles = totalTilesFor(settings.maxNumber);
  const requiredTiles = playerCount * settings.handSize;
  if (playerCount < 2) {
    return {
      ok: false,
      totalTiles,
      requiredTiles,
      message: 'プレイヤーが2人以上必要です',
    };
  }
  if (playerCount > settings.maxPlayers) {
    return {
      ok: false,
      totalTiles,
      requiredTiles,
      message: `プレイヤー数が設定上限${settings.maxPlayers}人を超えています`,
    };
  }
  if (requiredTiles > totalTiles) {
    return {
      ok: false,
      totalTiles,
      requiredTiles,
      message: `タイルが足りません。現在${totalTiles}枚中${requiredTiles}枚必要です`,
    };
  }
  return {
    ok: true,
    totalTiles,
    requiredTiles,
    message: `配布可能です。${totalTiles}枚中${requiredTiles}枚を使用します`,
  };
};

const makeDeck = (maxNumber: number): number[] => {
  const deck: number[] = [];
  for (let value = 1; value <= maxNumber; value += 1) {
    for (let count = 0; count < value; count += 1) deck.push(value);
  }
  for (let i = deck.length - 1; i > 0; i -= 1) {
    const rand = new Uint32Array(1);
    crypto.getRandomValues(rand);
    const j = rand[0] % (i + 1);
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
};

const randInt = (maxExclusive: number) => {
  const rand = new Uint32Array(1);
  crypto.getRandomValues(rand);
  return rand[0] % maxExclusive;
};

const createInitialRoom = (roomId: string, hostId: string, hostName: string): RoomData => ({
  roomId,
  initialized: true,
  hostId,
  phase: 'lobby',
  settings: { ...DEFAULT_SETTINGS },
  players: [
    {
      id: hostId,
      name: hostName,
      connected: false,
      joinedAt: now(),
      kind: 'player',
      isHost: true,
    },
  ],
  spectators: [],
  hands: {},
  deck: [],
  rankings: [],
  logs: [logEntry('system', `${hostName} がルームを作成しました`)],
  createdAt: now(),
  updatedAt: now(),
});

export class RoomRegistry {
  constructor(private state: DurableObjectState, private env: Env) {}

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname.endsWith('/create') && request.method === 'POST') {
      return this.createRoom(request);
    }

    if (url.pathname.endsWith('/release') && request.method === 'POST') {
      const body = (await request.json().catch(() => ({}))) as { roomId?: string };
      if (body.roomId && roomIdPattern.test(body.roomId)) {
        const active = await this.getActiveRooms();
        active.delete(body.roomId);
        await this.persist(active);
      }
      return json({ ok: true });
    }

    if (url.pathname.endsWith('/active')) {
      const active = await this.getActiveRooms();
      await this.prune(active);
      return json({ rooms: [...active] });
    }

    return json({ error: 'Not found' }, { status: 404 });
  }

  private async createRoom(request: Request): Promise<Response> {
    const body = (await request.json().catch(() => ({}))) as { userId?: string; userName?: string };
    const hostId = body.userId?.trim();
    const hostName = safeName(body.userName ?? null);

    if (!hostId) return json({ error: 'userId is required' }, { status: 400 });

    const active = await this.getActiveRooms();
    await this.prune(active);

    if (active.size >= 2) {
      return json({ error: '現在作成できるルームは2部屋までです' }, { status: 409 });
    }

    const roomId = this.generateUnusedRoomId(active);
    active.add(roomId);
    await this.persist(active);

    const room = this.env.GAME_ROOM.get(this.env.GAME_ROOM.idFromName(roomId));
    const initResponse = await room.fetch('https://room.local/init', {
      method: 'POST',
      body: JSON.stringify({ roomId, hostId, hostName }),
      headers: { 'content-type': 'application/json' },
    });

    if (!initResponse.ok) {
      active.delete(roomId);
      await this.persist(active);
      return json({ error: 'ルーム作成に失敗しました' }, { status: 500 });
    }

    return json({ roomId });
  }

  private async getActiveRooms(): Promise<Set<string>> {
    const stored = await this.state.storage.get<string[]>(REGISTRY_STORAGE_KEY);
    return new Set((stored ?? []).filter((id) => roomIdPattern.test(id)));
  }

  private async persist(active: Set<string>) {
    await this.state.storage.put(REGISTRY_STORAGE_KEY, [...active]);
  }

  private async prune(active: Set<string>) {
    const checks = [...active].map(async (roomId) => {
      const room = this.env.GAME_ROOM.get(this.env.GAME_ROOM.idFromName(roomId));
      const response = await room.fetch('https://room.local/status');
      const status = (await response.json().catch(() => null)) as { initialized?: boolean } | null;
      if (!status?.initialized) active.delete(roomId);
    });
    await Promise.all(checks);
    await this.persist(active);
  }

  private generateUnusedRoomId(active: Set<string>) {
    for (let attempt = 0; attempt < 1000; attempt += 1) {
      const id = String(100 + randInt(900));
      if (!active.has(id)) return id;
    }
    throw new Error('No room id available');
  }
}

export class GameRoom {
  private room?: RoomData;
  private sessions = new Map<WebSocket, Session>();

  constructor(private state: DurableObjectState, private env: Env) {}

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname.endsWith('/init') && request.method === 'POST') {
      const body = (await request.json().catch(() => ({}))) as { roomId?: string; hostId?: string; hostName?: string };
      if (!body.roomId || !body.hostId || !roomIdPattern.test(body.roomId)) {
        return json({ error: 'Invalid init payload' }, { status: 400 });
      }
      this.room = createInitialRoom(body.roomId, body.hostId, safeName(body.hostName ?? null));
      await this.save();
      return json({ ok: true });
    }

    await this.load();

    if (url.pathname.endsWith('/status')) {
      return json({
        initialized: Boolean(this.room?.initialized),
        connections: this.sessions.size,
        phase: this.room?.phase ?? null,
      });
    }

    if (!this.room?.initialized) return json({ error: 'Room not found' }, { status: 404 });

    const upgrade = request.headers.get('Upgrade');
    if (upgrade?.toLowerCase() === 'websocket') return this.acceptWebSocket(request);

    return json({ error: 'Not found' }, { status: 404 });
  }

  async alarm() {
    await this.load();
    if (this.sessions.size > 0 || !this.room?.initialized) return;

    const roomId = this.room.roomId;
    this.room = undefined;
    await this.state.storage.deleteAll();

    const registry = this.env.ROOM_REGISTRY.get(this.env.ROOM_REGISTRY.idFromName('global'));
    await registry.fetch('https://registry.local/release', {
      method: 'POST',
      body: JSON.stringify({ roomId }),
      headers: { 'content-type': 'application/json' },
    });
  }

  private async load() {
    if (!this.room) this.room = await this.state.storage.get<RoomData>(ROOM_STORAGE_KEY);
  }

  private async save() {
    if (!this.room) return;
    this.room.updatedAt = now();
    this.room.logs = this.room.logs.slice(-80);
    await this.state.storage.put(ROOM_STORAGE_KEY, this.room);
  }

  private acceptWebSocket(request: Request): Response {
    const url = new URL(request.url);
    const userId = url.searchParams.get('userId')?.trim();
    const name = safeName(url.searchParams.get('name'));
    const requestedKind = url.searchParams.get('kind') === 'spectator' ? 'spectator' : 'player';

    if (!userId) return new Response('userId is required', { status: 400 });

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair) as [WebSocket, WebSocket];
    server.accept();

    const joinResult = this.join(userId, name, requestedKind);
    if (!joinResult.ok) {
      server.send(JSON.stringify({ type: 'error', message: joinResult.message }));
      server.close(1008, joinResult.message);
      return new Response(null, { status: 101, webSocket: client });
    }

    this.sessions.set(server, { userId });
    server.addEventListener('message', (event) => {
      void this.handleMessage(server, event.data);
    });
    server.addEventListener('close', () => {
      void this.handleClose(server);
    });
    server.addEventListener('error', () => {
      void this.handleClose(server);
    });

    void this.save().then(() => this.broadcast());
    return new Response(null, { status: 101, webSocket: client });
  }

  private join(userId: string, name: string, requestedKind: JoinKind): { ok: true } | { ok: false; message: string } {
    if (!this.room) return { ok: false, message: 'ルームが見つかりません' };

    const existingPlayer = this.room.players.find((player) => player.id === userId);
    const existingSpectator = this.room.spectators.find((spectator) => spectator.id === userId);

    if (existingPlayer) {
      existingPlayer.connected = true;
      existingPlayer.name = name;
      this.room.logs.push(logEntry('join', `${name} が復帰しました`));
      return { ok: true };
    }

    if (existingSpectator) {
      existingSpectator.connected = true;
      existingSpectator.name = name;
      this.room.logs.push(logEntry('join', `${name} が観戦に復帰しました`));
      return { ok: true };
    }

    if (requestedKind === 'spectator') {
      if (!this.room.settings.allowSpectators) return { ok: false, message: 'このルームは観戦が許可されていません' };
      this.room.spectators.push({ id: userId, name, connected: true, joinedAt: now(), kind: 'spectator' });
      this.room.logs.push(logEntry('join', `${name} が観戦者として入室しました`));
      return { ok: true };
    }

    if (this.room.phase !== 'lobby') {
      return { ok: false, message: 'ゲーム開始後はプレイヤー参加できません。観戦者として入室してください' };
    }

    if (this.room.players.length >= this.room.settings.maxPlayers) {
      return { ok: false, message: `プレイヤー上限は${this.room.settings.maxPlayers}人です` };
    }

    this.room.players.push({ id: userId, name, connected: true, joinedAt: now(), kind: 'player', isHost: false });
    this.room.logs.push(logEntry('join', `${name} がプレイヤーとして入室しました`));
    return { ok: true };
  }

  private async handleMessage(ws: WebSocket, raw: string | ArrayBuffer) {
    await this.load();
    const session = this.sessions.get(ws);
    if (!session || !this.room) return;

    let message: ClientMessage;
    try {
      message = JSON.parse(typeof raw === 'string' ? raw : new TextDecoder().decode(raw)) as ClientMessage;
    } catch {
      this.sendError(ws, 'メッセージ形式が不正です');
      return;
    }

    switch (message.type) {
      case 'updateSettings':
        this.updateSettings(session.userId, message.payload);
        break;
      case 'startGame':
        this.startGame(session.userId);
        break;
      case 'guess':
        this.guess(session.userId, message.payload);
        break;
      case 'rematch':
      case 'backToLobby':
        this.returnToLobby(session.userId);
        break;
      case 'leave':
        ws.close(1000, 'leave');
        break;
      default:
        this.sendError(ws, '未対応の操作です');
        return;
    }

    await this.save();
    this.broadcast();
  }

  private async handleClose(ws: WebSocket) {
    await this.load();
    const session = this.sessions.get(ws);
    this.sessions.delete(ws);

    if (session && this.room) {
      const stillConnected = [...this.sessions.values()].some((value) => value.userId === session.userId);
      if (!stillConnected) {
        const player = this.room.players.find((item) => item.id === session.userId);
        const spectator = this.room.spectators.find((item) => item.id === session.userId);
        if (player) {
          player.connected = false;
          this.room.logs.push(logEntry('leave', `${player.name} が切断しました`));
        }
        if (spectator) {
          spectator.connected = false;
          this.room.logs.push(logEntry('leave', `${spectator.name} が退出しました`));
        }
      }
      await this.save();
      this.broadcast();
    }

    if (this.sessions.size === 0) await this.state.storage.setAlarm(Date.now() + EMPTY_ROOM_TTL_MS);
  }

  private updateSettings(userId: string, payload: unknown) {
    if (!this.room) return;
    if (this.room.hostId !== userId) return this.pushSystemError('ホストのみ設定を変更できます');
    if (this.room.phase !== 'lobby') return this.pushSystemError('設定変更はロビーでのみ可能です');

    const input = (payload ?? {}) as Partial<GameSettings>;
    const next: GameSettings = { ...this.room.settings };

    if (typeof input.maxNumber === 'number') next.maxNumber = clamp(input.maxNumber, 1, 10);
    if (typeof input.handSize === 'number') next.handSize = clamp(input.handSize, 3, 8);
    if (typeof input.maxPlayers === 'number') next.maxPlayers = clamp(input.maxPlayers, Math.max(2, this.room.players.length), 6);
    if (typeof input.allowSpectators === 'boolean') next.allowSpectators = input.allowSpectators;

    this.room.settings = next;
    this.room.logs.push(logEntry('settings', 'ホストがゲーム設定を更新しました'));
  }

  private startGame(userId: string) {
    if (!this.room) return;
    if (this.room.hostId !== userId) return this.pushSystemError('ホストのみゲーム開始できます');
    if (this.room.phase !== 'lobby') return this.pushSystemError('ゲームはすでに開始されています');

    const check = dealCheckFor(this.room.settings, this.room.players.length);
    if (!check.ok) return this.pushSystemError(check.message);

    const deck = makeDeck(this.room.settings.maxNumber);
    const hands: Record<string, Tile[]> = {};
    for (const player of this.room.players) {
      hands[player.id] = [];
      player.finishedAt = undefined;
      for (let i = 0; i < this.room.settings.handSize; i += 1) {
        const value = deck.shift();
        if (!value) throw new Error('Deck unexpectedly empty');
        hands[player.id].push({ id: crypto.randomUUID(), value, solved: false });
      }
    }

    const first = this.room.players[randInt(this.room.players.length)];
    this.room.hands = hands;
    this.room.deck = deck;
    this.room.phase = 'playing';
    this.room.rankings = [];
    this.room.currentPlayerId = first.id;
    this.room.logs.push(logEntry('start', `ゲーム開始。最初の手番は ${first.name} です`));
  }

  private guess(userId: string, payload: unknown) {
    if (!this.room) return;
    const value = Number((payload as { value?: unknown })?.value);
    const player = this.room.players.find((item) => item.id === userId);

    if (this.room.phase !== 'playing') return this.pushSystemError('現在は宣言できません');
    if (!player) return this.pushSystemError('観戦者は宣言できません');
    if (player.finishedAt) return this.pushSystemError('上がったプレイヤーは宣言できません');
    if (this.room.currentPlayerId !== userId) return this.pushSystemError('手番外の宣言はできません');
    if (!Number.isInteger(value) || value < 1 || value > this.room.settings.maxNumber) {
      return this.pushSystemError('宣言できない数字です');
    }

    const hand = this.room.hands[userId] ?? [];
    const target = hand.find((tile) => !tile.solved && tile.value === value);
    this.room.logs.push(logEntry('guess', `${player.name} が ${value} を宣言しました`));

    if (target) {
      target.solved = true;
      this.room.logs.push(logEntry('correct', `正解。${player.name} は ${value} を1枚あてました`));

      if (hand.every((tile) => tile.solved)) {
        player.finishedAt = now();
        this.room.rankings.push({ playerId: player.id, name: player.name, rank: this.room.rankings.length + 1, finishedAt: player.finishedAt });
        this.room.logs.push(logEntry('finish', `${player.name} が上がりました`));

        if (this.finishIfNeeded()) return;
        this.advanceTurnFrom(userId);
      }
      return;
    }

    this.room.logs.push(logEntry('wrong', `不正解。${player.name} の手番は終了です`));
    this.advanceTurnFrom(userId);
  }

  private finishIfNeeded() {
    if (!this.room) return false;
    const remaining = this.room.players.filter((player) => !player.finishedAt);
    if (remaining.length === 1 && this.room.players.length > 1) {
      const last = remaining[0];
      this.room.rankings.push({ playerId: last.id, name: last.name, rank: this.room.players.length });
      this.room.phase = 'finished';
      this.room.currentPlayerId = undefined;
      this.room.logs.push(logEntry('game-over', `ゲーム終了。最後に残ったのは ${last.name} です`));
      return true;
    }
    return false;
  }

  private advanceTurnFrom(userId: string) {
    if (!this.room) return;
    const players = this.room.players;
    const startIndex = players.findIndex((player) => player.id === userId);
    for (let offset = 1; offset <= players.length; offset += 1) {
      const candidate = players[(startIndex + offset + players.length) % players.length];
      if (!candidate.finishedAt) {
        this.room.currentPlayerId = candidate.id;
        return;
      }
    }
    this.room.currentPlayerId = undefined;
  }

  private returnToLobby(userId: string) {
    if (!this.room) return;
    if (this.room.hostId !== userId) return this.pushSystemError('ホストのみロビーに戻せます');

    this.room.phase = 'lobby';
    this.room.hands = {};
    this.room.deck = [];
    this.room.currentPlayerId = undefined;
    this.room.rankings = [];
    this.room.players = this.room.players.map((player) => ({ ...player, finishedAt: undefined }));
    this.room.logs.push(logEntry('system', 'ロビーに戻りました。同じ設定で再戦できます'));
  }

  private broadcast() {
    if (!this.room) return;
    for (const [ws, session] of this.sessions) {
      const view = this.createClientView(session.userId);
      if (!view) continue;
      try {
        ws.send(JSON.stringify({ type: 'view', view }));
      } catch {
        this.sessions.delete(ws);
      }
    }
  }

  private createClientView(userId: string): ClientView | null {
    if (!this.room) return null;
    const player = this.room.players.find((item) => item.id === userId);
    const spectator = this.room.spectators.find((item) => item.id === userId);
    if (!player && !spectator) return null;

    const isFinished = Boolean(player?.finishedAt);
    const canSeeAll = Boolean(spectator || isFinished || this.room.phase === 'finished');
    const selfKind: JoinKind = spectator ? 'spectator' : 'player';
    const currentPlayer = this.room.players.find((item) => item.id === this.room?.currentPlayerId);
    const dealCheck = dealCheckFor(this.room.settings, this.room.players.length);
    const canAct = Boolean(
      player &&
        !player.finishedAt &&
        this.room.phase === 'playing' &&
        this.room.currentPlayerId === player.id,
    );

    const players: ClientPlayer[] = this.room.players.map((target) => {
      const targetHand = this.room?.hands[target.id] ?? [];
      const hand = targetHand.map((tile) => {
        const visible = canSeeAll || target.id !== userId || tile.solved;
        return {
          id: tile.id,
          value: visible ? tile.value : undefined,
          visible,
          solved: tile.solved,
        };
      });
      const rank = this.room?.rankings.find((entry) => entry.playerId === target.id)?.rank;
      return {
        id: target.id,
        name: target.name,
        connected: target.connected,
        isHost: target.isHost,
        isCurrent: this.room?.currentPlayerId === target.id,
        isFinished: Boolean(target.finishedAt),
        rank,
        hand,
      };
    });

    return {
      roomId: this.room.roomId,
      phase: this.room.phase,
      settings: this.room.settings,
      self: {
        id: userId,
        name: player?.name ?? spectator?.name ?? '名無し',
        kind: selfKind,
        isHost: this.room.hostId === userId,
        isFinished,
        canAct,
        canSeeAll,
      },
      players,
      spectators: this.room.spectators.map((item) => ({ id: item.id, name: item.name, connected: item.connected })),
      currentPlayerId: this.room.currentPlayerId,
      currentPlayerName: currentPlayer?.name,
      rankings: [...this.room.rankings].sort((a: RankingEntry, b: RankingEntry) => a.rank - b.rank),
      logs: this.room.logs.slice(-50),
      dealCheck,
      canStartGame: this.room.phase === 'lobby' && dealCheck.ok,
    };
  }

  private pushSystemError(message: string) {
    this.room?.logs.push(logEntry('system', message));
  }

  private sendError(ws: WebSocket, message: string) {
    ws.send(JSON.stringify({ type: 'error', message }));
  }
}
