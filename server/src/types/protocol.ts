export type GamePhase = "lobby" | "prelisten" | "waiting" | "challenge" | "reveal" | "gameover";
export type GameMode = "individual" | "team";

export type TimelineCard = {
  songId: string;
  title: string;
  artist: string;
  year: number;
};

export type PublicPlayer = {
  id: string;
  name: string;
  connected: boolean;
  timeline: TimelineCard[];
  tokens: number;
  skipTurns: number;
};

export type PublicChallenge = {
  challengerId: string;
  challengerName: string;
  slot: number;
  order: number;
};

export type ResolvedChallenge = PublicChallenge & {
  correct: boolean;
  won: boolean;
};

export type PublicGuessResult = {
  playerId: string;
  playerName: string;
  correct: boolean;
  awarded: boolean;
};

export type RevealOutcome = "kept" | "discarded" | "stolen" | "purchased";

export type PublicReveal = {
  song: TimelineCard;
  playerId: string;
  playerName: string;
  selectedSlot: number | null;
  correct: boolean;
  outcome: RevealOutcome;
  challengeWinnerId: string | null;
  challengeWinnerName: string | null;
  challenges: ResolvedChallenge[];
  guesses: PublicGuessResult[];
};

export type RoomPublicState = {
  code: string;
  phase: GamePhase;
  round: number;
  winTarget: number;
  gameMode: GameMode;
  tokensEnabled: boolean;
  players: PublicPlayer[];
  currentPlayerId: string | null;
  currentPlacementSlot: number | null;
  challenges: PublicChallenge[];
  guessSubmittedPlayerIds: string[];
  reveal: PublicReveal | null;
  winnerId: string | null;
  catalogSize: number;
  songSource: SongSource;
  notice: string | null;
};


export type SongSource = {
  type: "catalog" | "spotify";
  name: string;
  trackCount: number;
};

export type PrivateTrack = {
  round: number;
  spotifyUri: string | null;
  hasSpotifyAudio: boolean;
};

export type Ack<T = undefined> =
  | ({ ok: true } & (T extends undefined ? object : { data: T }))
  | { ok: false; error: string };
