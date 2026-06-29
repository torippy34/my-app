import { useEffect, useMemo, useRef, useState } from 'react';
import type { ClientPlayer, ClientTile, ClientView, GameLog, GameSettings, JoinKind, ServerMessage } from './types';

const USER_ID_KEY = 'number-veil-user-id';
const workerBase = (import.meta.env.VITE_WORKER_URL?.replace(/\/$/, '') ?? (location.hostname === 'localhost' ? 'http://localhost:8787' : location.origin));
const wsBase = workerBase.replace(/^http/, 'ws');

const getUserId = () => {
  const stored = localStorage.getItem(USER_ID_KEY);
  if (stored) return stored;
  const next = crypto.randomUUID();
  localStorage.setItem(USER_ID_KEY, next);
  return next;
};

const formatTime = (at: number) =>
  new Intl.DateTimeFormat('ja-JP', { hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(new Date(at));

const logTone: Record<GameLog['type'], string> = {
  join: 'bg-sky-50 text-sky-700',
  leave: 'bg-slate-100 text-slate-500',
  settings: 'bg-indigo-50 text-indigo-700',
  start: 'bg-emerald-50 text-emerald-700',
  guess: 'bg-white text-slate-600',
  correct: 'bg-teal-50 text-teal-700',
  wrong: 'bg-rose-50 text-rose-700',
  finish: 'bg-amber-50 text-amber-700',
  'game-over': 'bg-slate-900 text-white',
  system: 'bg-slate-100 text-slate-600',
};

function App() {
  const [userId] = useState(getUserId);
  const [userName, setUserName] = useState('');
  const [roomId, setRoomId] = useState('');
  const [view, setView] = useState<ClientView | null>(null);
  const [error, setError] = useState('');
  const [connectionState, setConnectionState] = useState<'idle' | 'connecting' | 'connected' | 'disconnected'>('idle');
  const wsRef = useRef<WebSocket | null>(null);

  const send = (type: string, payload?: unknown) => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      setError('接続が切れています。入り直してください');
      return;
    }
    ws.send(JSON.stringify({ type, payload }));
  };

  const validateName = () => {
    if (!userName.trim()) {
      setError('ユーザーネームを入力してください');
      return false;
    }
    return true;
  };

  const validateRoomId = (id: string) => {
    if (!/^\d{3}$/.test(id)) {
      setError('ルームIDは3桁の数字で入力してください');
      return false;
    }
    return true;
  };

  const connect = (targetRoomId: string, kind: JoinKind) => {
    if (!validateName() || !validateRoomId(targetRoomId)) return;

    wsRef.current?.close();
    setError('');
    setConnectionState('connecting');

    const url = new URL(`${wsBase}/ws/${targetRoomId}`);
    url.searchParams.set('userId', userId);
    url.searchParams.set('name', userName.trim());
    url.searchParams.set('kind', kind);

    const ws = new WebSocket(url);
    wsRef.current = ws;

    ws.onopen = () => setConnectionState('connected');
    ws.onmessage = (event) => {
      const message = JSON.parse(event.data) as ServerMessage;
      if (message.type === 'view') {
        setView(message.view);
        setRoomId(message.view.roomId);
        setError('');
      }
      if (message.type === 'error') setError(message.message);
    };
    ws.onerror = () => setError('WebSocket接続でエラーが発生しました');
    ws.onclose = (event) => {
      setConnectionState('disconnected');
      if (event.reason) setError(event.reason);
    };
  };

  const createRoom = async () => {
    if (!validateName()) return;
    setError('');
    setConnectionState('connecting');
    try {
      const response = await fetch(`${workerBase}/api/rooms`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ userId, userName: userName.trim() }),
      });
      const body = (await response.json()) as { roomId?: string; error?: string };
      if (!response.ok || !body.roomId) throw new Error(body.error ?? 'ルーム作成に失敗しました');
      connect(body.roomId, 'player');
    } catch (caught) {
      setConnectionState('idle');
      setError(caught instanceof Error ? caught.message : 'ルーム作成に失敗しました');
    }
  };

  const leave = () => {
    send('leave');
    wsRef.current?.close(1000, 'leave');
    wsRef.current = null;
    setView(null);
    setConnectionState('idle');
  };

  useEffect(() => {
    return () => wsRef.current?.close();
  }, []);

  return (
    <main className="relative min-h-screen overflow-hidden bg-[radial-gradient(circle_at_top_left,_rgba(125,191,255,0.35),_transparent_34%),linear-gradient(135deg,_#edf5fb_0%,_#f8fafc_48%,_#e7edf5_100%)] px-4 py-5 text-slate-900 sm:px-6 lg:px-8">
      <div className="pointer-events-none absolute -right-24 top-12 h-72 w-72 rounded-full bg-sky-200/40 blur-3xl" />
      <div className="pointer-events-none absolute -left-28 bottom-0 h-80 w-80 rounded-full bg-indigo-100/70 blur-3xl" />
      <div className="pointer-events-none absolute left-1/2 top-8 hidden h-28 w-28 -translate-x-1/2 rounded-[2rem] border border-white/70 bg-white/30 backdrop-blur-md md:block" style={{ animation: 'float-soft 7s ease-in-out infinite' }} />

      <div className="relative mx-auto flex min-h-[calc(100vh-2.5rem)] w-full max-w-6xl flex-col gap-4">
        <Header view={view} connectionState={connectionState} leave={leave} />
        {error && <div className="glass-strong rounded-3xl px-4 py-3 text-sm font-semibold text-rose-600">{error}</div>}
        {!view && (
          <TopScreen
            roomId={roomId}
            userName={userName}
            setRoomId={setRoomId}
            setUserName={setUserName}
            createRoom={createRoom}
            connect={connect}
            connectionState={connectionState}
          />
        )}
        {view?.phase === 'lobby' && <LobbyScreen view={view} send={send} leave={leave} />}
        {view?.phase === 'playing' && <GameScreen view={view} send={send} />}
        {view?.phase === 'finished' && <ResultScreen view={view} send={send} />}
      </div>
    </main>
  );
}

function Header({ view, connectionState, leave }: { view: ClientView | null; connectionState: string; leave: () => void }) {
  return (
    <header className="glass flex items-center justify-between rounded-[2rem] px-4 py-3 sm:px-5">
      <div>
        <p className="label">Number Veil</p>
        <h1 className="text-xl font-black tracking-tight text-slate-950 sm:text-2xl">数字の影を読むゲーム</h1>
      </div>
      <div className="flex items-center gap-2">
        <span className="hidden rounded-full bg-white/70 px-3 py-2 text-xs font-bold text-slate-500 sm:inline-flex">{connectionState}</span>
        {view && <button className="btn-ghost" onClick={leave}>退出</button>}
      </div>
    </header>
  );
}

function TopScreen({
  roomId,
  userName,
  setRoomId,
  setUserName,
  createRoom,
  connect,
  connectionState,
}: {
  roomId: string;
  userName: string;
  setRoomId: (value: string) => void;
  setUserName: (value: string) => void;
  createRoom: () => void;
  connect: (roomId: string, kind: JoinKind) => void;
  connectionState: string;
}) {
  const busy = connectionState === 'connecting';
  return (
    <section className="grid flex-1 items-center gap-5 lg:grid-cols-[1.05fr_0.95fr]">
      <div className="glass rounded-[2.5rem] p-6 sm:p-8 lg:p-10">
        <div className="mb-10 max-w-xl">
          <p className="label mb-4">Browser / Realtime / Minimal</p>
          <h2 className="text-4xl font-black tracking-[-0.06em] text-slate-950 sm:text-6xl">Pomemo</h2>
          <p className="mt-5 text-base leading-8 text-slate-600 sm:text-lg">
            最大6人で遊べる、個人利用向けの数字推理ゲームです。インストール不要、スマホ縦画面でもそのまま遊べます。
          </p>
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          <InfoPill title="Room" text="3桁ID" />
          <InfoPill title="Players" text="2〜6人" />
          <InfoPill title="Tiles" text="1〜10" />
        </div>
      </div>

      <div className="glass-strong rounded-[2.5rem] p-5 sm:p-7">
        <div className="space-y-4">
          <label className="block space-y-2">
            <span className="label">User name</span>
            <input className="input" value={userName} onChange={(event) => setUserName(event.target.value)} placeholder="例：hato" maxLength={24} />
          </label>
          <button className="btn-primary w-full" disabled={busy} onClick={createRoom}>新規ルーム作成</button>
          <div className="relative py-2 text-center text-xs font-bold uppercase tracking-[0.22em] text-slate-400">or join</div>
          <label className="block space-y-2">
            <span className="label">Room ID</span>
            <input
              className="input text-center text-2xl tracking-[0.35em]"
              inputMode="numeric"
              pattern="[0-9]*"
              maxLength={3}
              value={roomId}
              onChange={(event) => setRoomId(event.target.value.replace(/\D/g, '').slice(0, 3))}
              placeholder="123"
            />
          </label>
          <div className="grid gap-3 sm:grid-cols-2">
            <button className="btn-secondary" disabled={busy} onClick={() => connect(roomId, 'player')}>プレイヤーとして入室</button>
            <button className="btn-secondary" disabled={busy} onClick={() => connect(roomId, 'spectator')}>観戦者として入室</button>
          </div>
        </div>
      </div>
    </section>
  );
}

function InfoPill({ title, text }: { title: string; text: string }) {
  return (
    <div className="rounded-3xl border border-white/70 bg-white/55 p-4">
      <p className="text-xs font-bold uppercase tracking-[0.2em] text-slate-400">{title}</p>
      <p className="mt-1 text-lg font-black text-slate-800">{text}</p>
    </div>
  );
}

function LobbyScreen({ view, send, leave }: { view: ClientView; send: (type: string, payload?: unknown) => void; leave: () => void }) {
  const updateSetting = <K extends keyof GameSettings>(key: K, value: GameSettings[K]) => {
    send('updateSettings', { [key]: value });
  };

  return (
    <section className="grid gap-4 lg:grid-cols-[0.95fr_1.05fr]">
      <div className="glass-strong rounded-[2.5rem] p-5 sm:p-7">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="label">Lobby</p>
            <h2 className="text-3xl font-black tracking-tight">Room {view.roomId}</h2>
          </div>
          <button className="btn-ghost" onClick={leave}>退出</button>
        </div>
        <div className="mt-6 grid gap-4 sm:grid-cols-2">
          <Roster title="Players" people={view.players} hostId={view.players.find((player) => player.isHost)?.id} />
          <Roster title="Spectators" people={view.spectators} />
        </div>
      </div>

      <div className="glass rounded-[2.5rem] p-5 sm:p-7">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="label">Settings</p>
            <h3 className="text-2xl font-black">ゲーム設定</h3>
          </div>
          {view.self.isHost ? <span className="rounded-full bg-slate-900 px-3 py-2 text-xs font-bold text-white">Host</span> : <span className="rounded-full bg-white/70 px-3 py-2 text-xs font-bold text-slate-500">Host only</span>}
        </div>

        <div className="mt-6 grid gap-4 sm:grid-cols-2">
          <RangeSetting label="最大数字" value={view.settings.maxNumber} min={1} max={10} disabled={!view.self.isHost} onChange={(value) => updateSetting('maxNumber', value)} />
          <RangeSetting label="最大プレイヤー数" value={view.settings.maxPlayers} min={2} max={6} disabled={!view.self.isHost} onChange={(value) => updateSetting('maxPlayers', value)} />
          <RangeSetting label="手札枚数" value={view.settings.handSize} min={3} max={8} disabled={!view.self.isHost} onChange={(value) => updateSetting('handSize', value)} />
          <label className="rounded-3xl border border-white/70 bg-white/55 p-4">
            <span className="label">観戦許可</span>
            <button
              className={`mt-3 w-full rounded-2xl px-4 py-3 text-sm font-black transition ${view.settings.allowSpectators ? 'bg-slate-900 text-white' : 'bg-white text-slate-500'}`}
              disabled={!view.self.isHost}
              onClick={() => updateSetting('allowSpectators', !view.settings.allowSpectators)}
            >
              {view.settings.allowSpectators ? 'ON' : 'OFF'}
            </button>
          </label>
        </div>

        <div className={`mt-5 rounded-3xl border px-4 py-3 text-sm font-bold ${view.dealCheck.ok ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-rose-200 bg-rose-50 text-rose-700'}`}>
          {view.dealCheck.message}
        </div>
        <button className="btn-primary mt-5 w-full" disabled={!view.self.isHost || !view.canStartGame} onClick={() => send('startGame')}>ゲーム開始</button>
      </div>
    </section>
  );
}

function Roster({ title, people, hostId }: { title: string; people: Array<{ id: string; name: string; connected: boolean }>; hostId?: string }) {
  return (
    <div className="rounded-3xl border border-white/70 bg-white/55 p-4">
      <p className="label mb-3">{title}</p>
      <div className="space-y-2">
        {people.length === 0 && <p className="text-sm font-semibold text-slate-400">まだいません</p>}
        {people.map((person) => (
          <div key={person.id} className="flex items-center justify-between gap-2 rounded-2xl bg-white/70 px-3 py-2">
            <span className="truncate text-sm font-bold text-slate-700">{person.name}{hostId === person.id ? ' / host' : ''}</span>
            <span className={`h-2.5 w-2.5 rounded-full ${person.connected ? 'bg-emerald-400' : 'bg-slate-300'}`} />
          </div>
        ))}
      </div>
    </div>
  );
}

function RangeSetting({ label, value, min, max, disabled, onChange }: { label: string; value: number; min: number; max: number; disabled: boolean; onChange: (value: number) => void }) {
  return (
    <label className="rounded-3xl border border-white/70 bg-white/55 p-4">
      <span className="label">{label}</span>
      <div className="mt-3 flex items-center gap-3">
        <input className="w-full accent-slate-900" type="range" min={min} max={max} value={value} disabled={disabled} onChange={(event) => onChange(Number(event.target.value))} />
        <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-white text-lg font-black text-slate-900">{value}</span>
      </div>
    </label>
  );
}

function GameScreen({ view, send }: { view: ClientView; send: (type: string, payload?: unknown) => void }) {
  const selfPlayer = view.players.find((player) => player.id === view.self.id);
  const otherPlayers = view.players.filter((player) => player.id !== view.self.id);

  return (
    <section className="grid gap-4 lg:grid-cols-[1fr_360px]">
      <div className="space-y-4">
        <div className="glass-strong rounded-[2.2rem] p-4 sm:p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="label">Room {view.roomId}</p>
              <h2 className="text-2xl font-black">手番：{view.currentPlayerName ?? '-'}</h2>
            </div>
            <div className="rounded-full bg-white/75 px-4 py-2 text-sm font-bold text-slate-600">{view.self.canSeeAll ? '全手札表示' : '自分の当てていない札は非表示'}</div>
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          {otherPlayers.map((player) => <PlayerBoard key={player.id} player={player} />)}
        </div>

        {selfPlayer && (
          <div className="glass-strong rounded-[2.2rem] p-4 sm:p-5">
            <div className="mb-3 flex items-center justify-between">
              <p className="label">Your hand</p>
              <span className="text-sm font-bold text-slate-500">{view.self.isFinished ? '上がり / 観戦中' : view.self.canAct ? 'あんたの番です' : '待機中'}</span>
            </div>
            <TileRow tiles={selfPlayer.hand} large />
          </div>
        )}
      </div>

      <aside className="space-y-4">
        <div className="glass rounded-[2.2rem] p-4 sm:p-5">
          <p className="label mb-3">Declare</p>
          {view.self.kind === 'spectator' || view.self.isFinished ? (
            <div className="rounded-3xl bg-white/65 p-4 text-sm font-semibold leading-7 text-slate-500">観戦中です。全員の手札を見ながら、にやにやできます。合法です。</div>
          ) : (
            <div className="grid grid-cols-5 gap-2">
              {Array.from({ length: view.settings.maxNumber }, (_, index) => index + 1).map((value) => (
                <button
                  key={value}
                  className="min-h-14 rounded-2xl bg-slate-900 text-lg font-black text-white shadow-glow transition active:scale-95 disabled:bg-slate-300 disabled:shadow-none"
                  disabled={!view.self.canAct}
                  onClick={() => send('guess', { value })}
                >
                  {value}
                </button>
              ))}
            </div>
          )}
        </div>
        <LogPanel logs={view.logs} />
      </aside>
    </section>
  );
}

function PlayerBoard({ player }: { player: ClientPlayer }) {
  return (
    <div className={`rounded-[2rem] border p-4 transition ${player.isCurrent ? 'border-sky-300 bg-white/80 shadow-glow' : 'border-white/70 bg-white/55 shadow-soft backdrop-blur-xl'}`}>
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-lg font-black text-slate-900">{player.name}</p>
          <p className="text-xs font-bold text-slate-400">{player.isHost ? 'Host' : 'Player'}{player.rank ? ` / ${player.rank}位` : ''}</p>
        </div>
        <div className="flex items-center gap-2">
          {player.isFinished && <span className="rounded-full bg-amber-100 px-3 py-1 text-xs font-bold text-amber-700">上がり</span>}
          <span className={`h-2.5 w-2.5 rounded-full ${player.connected ? 'bg-emerald-400' : 'bg-slate-300'}`} />
        </div>
      </div>
      <TileRow tiles={player.hand} />
    </div>
  );
}

function TileRow({ tiles, large = false }: { tiles: ClientTile[]; large?: boolean }) {
  return (
    <div className="flex flex-wrap gap-2">
      {tiles.map((tile) => (
        <div
          key={tile.id}
          className={`tile ${large ? 'h-16 w-14 sm:h-20 sm:w-16' : ''} ${tile.solved ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : tile.visible ? 'border-white bg-white text-slate-900' : 'border-slate-200 bg-slate-900 text-white'}`}
        >
          {tile.visible ? tile.value : '?'}
        </div>
      ))}
    </div>
  );
}

function LogPanel({ logs }: { logs: GameLog[] }) {
  return (
    <div className="glass rounded-[2.2rem] p-4 sm:p-5">
      <p className="label mb-3">Game log</p>
      <div className="max-h-[420px] space-y-2 overflow-y-auto pr-1">
        {[...logs].reverse().map((log) => (
          <div key={log.id} className={`rounded-2xl px-3 py-2 text-sm font-semibold ${logTone[log.type]}`}>
            <span className="mr-2 text-xs opacity-60">{formatTime(log.at)}</span>
            {log.message}
          </div>
        ))}
      </div>
    </div>
  );
}

function ResultScreen({ view, send }: { view: ClientView; send: (type: string, payload?: unknown) => void }) {
  return (
    <section className="grid gap-4 lg:grid-cols-[0.9fr_1.1fr]">
      <div className="glass-strong rounded-[2.5rem] p-6 sm:p-8">
        <p className="label">Result</p>
        <h2 className="mt-2 text-4xl font-black tracking-tight">順位</h2>
        <div className="mt-6 space-y-3">
          {view.rankings.map((entry) => (
            <div key={entry.playerId} className="flex items-center justify-between rounded-3xl bg-white/75 px-4 py-3">
              <span className="text-2xl font-black text-slate-900">{entry.rank}位</span>
              <span className="font-bold text-slate-700">{entry.name}</span>
            </div>
          ))}
        </div>
        <div className="mt-6 grid gap-3 sm:grid-cols-2">
          <button className="btn-primary" disabled={!view.self.isHost} onClick={() => send('rematch')}>同じ設定で再戦</button>
          <button className="btn-secondary" disabled={!view.self.isHost} onClick={() => send('backToLobby')}>ロビーに戻る</button>
        </div>
      </div>
      <div className="space-y-4">
        {view.players.map((player) => <PlayerBoard key={player.id} player={player} />)}
        <LogPanel logs={view.logs} />
      </div>
    </section>
  );
}

export default App;
