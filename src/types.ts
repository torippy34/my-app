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
  | 'finish'
  | 'game-over'
  | 'system';

export interface GameSettings {
  maxNumber: number;
  maxPlayers: number;
  handSize: number;
  allowSpectators: boolean;
}

export interface DealCheck {
  ok: boolean;
  totalTiles: number;
  requiredTiles: number;
  message: string;
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

export interface ClientView {
  roomId: string;
  phase: RoomPhase;
  settings: GameSettings;
  self: {
    id: string;
    name: string;
    kind: JoinKind;
    isHost: boolean;
    isFinished: boolean;
    canAct: boolean;
    canSeeAll: boolean;
  };
  players: ClientPlayer[];
  spectators: ClientSpectator[];
  currentPlayerId?: string;
  currentPlayerName?: string;
  rankings: RankingEntry[];
  logs: GameLog[];
  dealCheck: DealCheck;
  canStartGame: boolean;
}

export type ServerMessage =
  | { type: 'view'; view: ClientView }
  | { type: 'error'; message: string };
