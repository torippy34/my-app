export type RoomPhase = 'lobby' | 'playing' | 'finished';
export type JoinKind = 'player' | 'spectator';
export type LogType =
  | 'join'
  | 'leave'
  | 'settings'
  | 'start'
  | 'guess'
  | 'correct'
  | 'wrong'
  | 'timeout'
  | 'finish'
  | 'game-over'
  | 'system';

export interface GameSettings {
  maxNumber: number;
  maxPlayers: number;
  handSize: number;
  allowSpectators: boolean;
  turnTimeLimitSeconds: number;
}

export interface PersonBase {
  id: string;
  name: string;
  connected: boolean;
  joinedAt: number;
}

export interface Player extends PersonBase {
  kind: 'player';
  isHost: boolean;
  finishedAt?: number;
}

export interface Spectator extends PersonBase {
  kind: 'spectator';
}

export interface Tile {
  id: string;
  value: number;
  solved: boolean;
}

export interface RankingEntry {
  playerId: string;
  name: string;
  rank: number;
  finishedAt?: number;
}

export interface GameLog {
  id: string;
  type: LogType;
  message: string;
  at: number;
}

export interface DealCheck {
  ok: boolean;
  totalTiles: number;
  requiredTiles: number;
  message: string;
}

export interface LastGuessResult {
  id: string;
  playerId: string;
  playerName: string;
  value: number;
  correct: boolean;
  at: number;
}

export interface RoomData {
  roomId: string;
  initialized: boolean;
  hostId: string;
  phase: RoomPhase;
  settings: GameSettings;
  players: Player[];
  spectators: Spectator[];
  hands: Record<string, Tile[]>;
  deck: number[];
  currentPlayerId?: string;
  turnEndsAt?: number;
  emptyRoomCleanupAt?: number;
  lastGuessResult?: LastGuessResult;
  rankings: RankingEntry[];
  logs: GameLog[];
  createdAt: number;
  updatedAt: number;
}

export interface ClientTile {
  id: string;
  value?: number;
  visible: boolean;
  solved: boolean;
}

export interface ClientPlayer {
  id: string;
  name: string;
  connected: boolean;
  isHost: boolean;
  isCurrent: boolean;
  isFinished: boolean;
  rank?: number;
  hand: ClientTile[];
}

export interface ClientSpectator {
  id: string;
  name: string;
  connected: boolean;
}

export interface ClientSelf {
  id: string;
  name: string;
  kind: JoinKind;
  isHost: boolean;
  isFinished: boolean;
  canAct: boolean;
  canSeeAll: boolean;
}

export interface ClientView {
  roomId: string;
  phase: RoomPhase;
  settings: GameSettings;
  self: ClientSelf;
  players: ClientPlayer[];
  spectators: ClientSpectator[];
  currentPlayerId?: string;
  currentPlayerName?: string;
  turnEndsAt?: number;
  lastGuessResult?: LastGuessResult;
  rankings: RankingEntry[];
  logs: GameLog[];
  dealCheck: DealCheck;
  canStartGame: boolean;
}

export interface ClientMessage {
  type: 'updateSettings' | 'startGame' | 'guess' | 'rematch' | 'backToLobby' | 'leave';
  payload?: unknown;
}
