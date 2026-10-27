import { randomBytes, randomUUID } from "node:crypto";
import type { Song, SongRepository } from "../db/songs.js";
import type {
  GameMode,
  PrivateTrack,
  PublicChallenge,
  PublicGuessResult,
  PublicReveal,
  RoomPublicState,
  SongSource,
  TimelineCard,
} from "../types/protocol.js";
import { findAutomaticSlot, isValidPlacement, songAndArtistGuessMatches } from "./rules.js";

const ROOM_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const STARTING_TOKENS = 2;
const MAX_TOKENS = 5;

function randomCode(length = 4): string {
  const bytes = randomBytes(length);
  return Array.from(bytes, (b: number) => ROOM_ALPHABET[b % ROOM_ALPHABET.length]).join("");
}

function randomToken(): string {
  return randomBytes(24).toString("base64url");
}

function shuffle<T>(items: T[]): T[] {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function toTimelineCard(song: Song): TimelineCard {
  return { songId: song.id, title: song.title, artist: song.artist, year: song.year };
}

type GuessResult = Pick<PublicGuessResult, "correct" | "awarded">;

type Player = {
  id: string;
  name: string;
  reconnectToken: string;
  socketId: string | null;
  timeline: TimelineCard[];
  tokens: number;
  skipTurns: number;
};

export class GameRoom {
  readonly code: string;
  readonly hostToken: string;
  hostSocketId: string | null = null;
  phase: RoomPublicState["phase"] = "lobby";
  round = 0;
  winTarget = 10;
  gameMode: GameMode = "individual";
  tokensEnabled = true;
  currentPlayerIndex = 0;
  winnerId: string | null = null;
  reveal: RoomPublicState["reveal"] = null;
  currentSongId: string | null = null;
  currentPlacementSlot: number | null = null;
  challenges: PublicChallenge[] = [];
  currentGuesses = new Map<string, GuessResult>();
  deck: string[] = [];
  private customSongs: Map<string, Song> | null = null;
  private sourceInfo: SongSource = { type: "catalog", name: "Built-in catalog", trackCount: 0 };
  players: Player[] = [];
  notice: string | null = null;
  updatedAt = Date.now();

  constructor(private songs: SongRepository, code: string, hostToken: string) {
    this.code = code;
    this.hostToken = hostToken;
    this.sourceInfo = { type: "catalog", name: "Built-in catalog", trackCount: this.songs.count() };
  }

  touch() {
    this.updatedAt = Date.now();
  }

  publicState(): RoomPublicState {
    const currentPlayer = this.players[this.currentPlayerIndex] ?? null;
    return {
      code: this.code,
      phase: this.phase,
      round: this.round,
      winTarget: this.winTarget,
      gameMode: this.gameMode,
      tokensEnabled: this.tokensEnabled,
      players: this.players.map((p) => ({
        id: p.id,
        name: p.name,
        connected: Boolean(p.socketId),
        timeline: p.timeline,
        tokens: p.tokens,
        skipTurns: p.skipTurns,
      })),
      currentPlayerId: this.phase === "lobby" ? null : currentPlayer?.id ?? null,
      currentPlacementSlot: this.currentPlacementSlot,
      challenges: this.challenges,
      guessSubmittedPlayerIds: [...this.currentGuesses.keys()],
      reveal: this.reveal,
      winnerId: this.winnerId,
      catalogSize: this.availableSongCount(),
      songSource: { ...this.sourceInfo, trackCount: this.availableSongCount() },
      notice: this.notice,
    };
  }

  private currentPlayer(): Player {
    const player = this.players[this.currentPlayerIndex];
    if (!player) throw new Error("No active player");
    return player;
  }

  private verifiedPlayer(playerId: string, socketId: string): Player {
    const player = this.players.find((candidate) => candidate.id === playerId);
    if (!player || player.socketId !== socketId) throw new Error("Player session does not match this device");
    return player;
  }

  private verifiedCurrentPlayer(playerId: string, socketId: string): Player {
    const player = this.verifiedPlayer(playerId, socketId);
    if (this.currentPlayer().id !== player.id) throw new Error("It is not your turn");
    return player;
  }

  private availableSongIds(): string[] {
    return this.customSongs ? [...this.customSongs.keys()] : this.songs.allIds();
  }

  private availableSongCount(): number {
    return this.customSongs?.size ?? this.songs.count();
  }

  private getSongById(id: string): Song | null {
    return this.customSongs ? (this.customSongs.get(id) ?? null) : this.songs.getById(id);
  }

  private currentSong(): Song {
    if (!this.currentSongId) throw new Error("No active song");
    const song = this.getSongById(this.currentSongId);
    if (!song) throw new Error("Active song no longer exists");
    return song;
  }

  private drawSong(): Song {
    const id = this.deck.at(-1);
    if (!id) throw new Error("The song deck is empty. Add more songs or choose a larger Spotify playlist before continuing.");
    const song = this.getSongById(id);
    if (!song) throw new Error("A song in the deck no longer exists");
    this.deck.pop();
    return song;
  }

  private startRound(notice: string | null = null): void {
    const song = this.drawSong();
    this.currentSongId = song.id;
    this.round += 1;
    this.reveal = null;
    this.currentPlacementSlot = null;
    this.challenges = [];
    this.currentGuesses.clear();
    this.notice = notice;
    // The active player gets a short before-listening decision window. This is
    // required for the official 3-token direct-card exchange rule.
    this.phase = "prelisten";
  }

  private revealGuesses(): PublicGuessResult[] {
    return [...this.currentGuesses.entries()].map(([playerId, guess]) => {
      const player = this.players.find((candidate) => candidate.id === playerId);
      return {
        playerId,
        playerName: player?.name ?? "Player",
        correct: guess.correct,
        awarded: guess.awarded,
      };
    });
  }

  private setWinnerIfNeeded(player: Player): void {
    if (player.timeline.length >= this.winTarget) this.winnerId = player.id;
  }

  private resolveNormalPlacement(): void {
    const player = this.currentPlayer();
    const song = this.currentSong();
    if (this.currentPlacementSlot === null) throw new Error("Choose a placement before locking in");

    const selectedSlot = this.currentPlacementSlot;
    const correct = isValidPlacement(song.year, player.timeline, selectedSlot);
    if (correct) {
      player.timeline.splice(selectedSlot, 0, toTimelineCard(song));
      this.setWinnerIfNeeded(player);
    }

    this.reveal = {
      song: toTimelineCard(song),
      playerId: player.id,
      playerName: player.name,
      selectedSlot,
      correct,
      outcome: correct ? "kept" : "discarded",
      challengeWinnerId: null,
      challengeWinnerName: null,
      challenges: [],
      guesses: this.revealGuesses(),
    };
    this.phase = "reveal";
    this.notice = correct ? `${player.name} keeps the card.` : "The card is discarded.";
  }

  private resolveHitsterChallenges(): void {
    const player = this.currentPlayer();
    const song = this.currentSong();
    if (this.currentPlacementSlot === null) throw new Error("The locked placement is missing");

    const selectedSlot = this.currentPlacementSlot;
    const activeCorrect = isValidPlacement(song.year, player.timeline, selectedSlot);
    const resolvedChallenges = this.challenges.map((challenge) => ({
      ...challenge,
      correct: isValidPlacement(song.year, player.timeline, challenge.slot),
      won: false,
    }));

    let winner: Player | null = null;
    if (activeCorrect) {
      player.timeline.splice(selectedSlot, 0, toTimelineCard(song));
      this.setWinnerIfNeeded(player);
    } else {
      const winningChallenge = resolvedChallenges.find((challenge) => challenge.correct);
      if (winningChallenge) {
        winningChallenge.won = true;
        winner = this.players.find((candidate) => candidate.id === winningChallenge.challengerId) ?? null;
        if (winner) {
          const winnerSlot = findAutomaticSlot(song.year, winner.timeline);
          winner.timeline.splice(winnerSlot, 0, toTimelineCard(song));
          this.setWinnerIfNeeded(winner);
        }
      }
    }

    this.reveal = {
      song: toTimelineCard(song),
      playerId: player.id,
      playerName: player.name,
      selectedSlot,
      correct: activeCorrect,
      outcome: activeCorrect ? "kept" : winner ? "stolen" : "discarded",
      challengeWinnerId: winner?.id ?? null,
      challengeWinnerName: winner?.name ?? null,
      challenges: resolvedChallenges,
      guesses: this.revealGuesses(),
    };
    this.phase = "reveal";
    this.notice = activeCorrect
      ? `${player.name} was right. All FIDSTER bets are lost.`
      : winner
        ? `${winner.name} called FIDSTER correctly and steals the card!`
        : "The placement was wrong, but no FIDSTER claim found the correct spot.";
  }

  private advanceToNextEligiblePlayer(): void {
    if (this.players.length === 0) throw new Error("No players remain");
    if (!this.players.some(player => player.socketId)) throw new Error("Wait for a player to reconnect; no players are connected.");
    const skippedNames: string[] = [];
    const maxChecks = this.players.length * 3 + 1;

    for (let checked = 0; checked < maxChecks; checked += 1) {
      this.currentPlayerIndex = (this.currentPlayerIndex + 1) % this.players.length;
      const candidate = this.currentPlayer();
      if (!candidate.socketId) continue;
      if (candidate.skipTurns > 0) {
        candidate.skipTurns -= 1;
        skippedNames.push(candidate.name);
        continue;
      }

      const notice = skippedNames.length > 0
        ? `${skippedNames.join(", ")} ${skippedNames.length === 1 ? "skips" : "skip"} this turn after a 3-token card exchange.`
        : null;
      this.startRound(notice);
      return;
    }

    throw new Error("Could not find an eligible next player");
  }

  attachHost(token: string, socketId: string): void {
    if (token !== this.hostToken) throw new Error("Invalid host token");
    this.hostSocketId = socketId;
    this.touch();
  }

  detachSocket(socketId: string): boolean {
    let changed = false;
    if (this.hostSocketId === socketId) {
      this.hostSocketId = null;
      changed = true;
    }
    for (const player of this.players) {
      if (player.socketId === socketId) {
        player.socketId = null;
        changed = true;
      }
    }
    if (changed) this.touch();
    return changed;
  }

  joinPlayer(name: string, socketId: string, reconnectToken?: string): { playerId: string; reconnectToken: string } {
    const trimmed = name.trim().slice(0, 30);
    if (!trimmed) throw new Error("Enter a player or team name");

    const attached = this.players.find(p => p.socketId === socketId);
    if (attached) return { playerId: attached.id, reconnectToken: attached.reconnectToken };

    if (reconnectToken) {
      const existing = this.players.find((p) => p.reconnectToken === reconnectToken);
      if (existing) {
        existing.socketId = socketId;
        if (trimmed) existing.name = trimmed;
        this.touch();
        return { playerId: existing.id, reconnectToken: existing.reconnectToken };
      }
    }

    if (this.phase !== "lobby") throw new Error("This game has already started");
    if (this.players.length >= 12) throw new Error("This room is full");
    if (this.players.some((p) => p.name.toLowerCase() === trimmed.toLowerCase())) {
      throw new Error("That player or team name is already in use");
    }

    const player: Player = {
      id: randomUUID(),
      name: trimmed,
      reconnectToken: randomToken(),
      socketId,
      timeline: [],
      tokens: 0,
      skipTurns: 0,
    };
    this.players.push(player);
    this.touch();
    return { playerId: player.id, reconnectToken: player.reconnectToken };
  }

  useCatalogSource(hostToken: string): void {
    if (hostToken !== this.hostToken) throw new Error("Invalid host token");
    if (this.phase !== "lobby") throw new Error("Song source can only be changed in the lobby");
    this.customSongs = null;
    this.sourceInfo = { type: "catalog", name: "Built-in catalog", trackCount: this.songs.count() };
    this.deck = [];
    this.notice = "Using the built-in song catalog.";
    this.touch();
  }

  useSpotifyPlaylistSource(
    hostToken: string,
    playlist: { id: string; name: string },
    tracks: Song[],
  ): void {
    if (hostToken !== this.hostToken) throw new Error("Invalid host token");
    if (this.phase !== "lobby") throw new Error("Song source can only be changed in the lobby");
    if (!playlist.id.trim() || !playlist.name.trim()) throw new Error("Invalid Spotify playlist");
    if (tracks.length < 3) throw new Error("The Spotify playlist needs at least 3 playable tracks");

    const next = new Map<string, Song>();
    for (const track of tracks) {
      if (next.has(track.id)) continue;
      next.set(track.id, { ...track });
    }
    if (next.size < 3) throw new Error("The Spotify playlist needs at least 3 unique playable tracks");

    this.customSongs = next;
    this.sourceInfo = {
      type: "spotify",
      name: playlist.name.trim().slice(0, 120),
      trackCount: next.size,
    };
    this.deck = [];
    this.notice = `Using Spotify playlist “${this.sourceInfo.name}” (${next.size} tracks).`;
    this.touch();
  }

  start(hostToken: string, options: { winTarget: number; tokensEnabled: boolean; gameMode: GameMode }): void {
    if (hostToken !== this.hostToken) throw new Error("Invalid host token");
    if (this.phase !== "lobby") throw new Error("The game has already started");
    if (this.players.length < 1) throw new Error("At least one player or team must join");
    if (!Number.isInteger(options.winTarget) || options.winTarget < 2 || options.winTarget > 30) {
      throw new Error("Win target must be between 2 and 30");
    }

    const ids = shuffle(this.availableSongIds());
    const minimum = this.players.length + Math.max(10, options.winTarget);
    if (ids.length < minimum) {
      const sourceLabel = this.sourceInfo.type === "spotify" ? `Spotify playlist “${this.sourceInfo.name}”` : "catalog";
      throw new Error(`Use at least ${minimum} songs. The ${sourceLabel} currently has ${ids.length}.`);
    }

    this.winTarget = options.winTarget;
    this.tokensEnabled = options.tokensEnabled;
    this.gameMode = options.gameMode;
    this.deck = ids;
    this.currentPlayerIndex = 0;
    this.winnerId = null;
    this.reveal = null;
    this.notice = null;

    for (const player of this.players) {
      const starter = this.drawSong();
      player.timeline = [toTimelineCard(starter)];
      player.tokens = this.tokensEnabled ? STARTING_TOKENS : 0;
      player.skipTurns = 0;
    }

    // The player/team with the oldest starter card starts. Rotate the existing
    // join order so clockwise order is otherwise preserved.
    let oldestIndex = 0;
    for (let i = 1; i < this.players.length; i += 1) {
      if (this.players[i].timeline[0].year < this.players[oldestIndex].timeline[0].year) oldestIndex = i;
    }
    if (oldestIndex > 0) {
      this.players = [...this.players.slice(oldestIndex), ...this.players.slice(0, oldestIndex)];
    }
    this.currentPlayerIndex = 0;
    const starter = this.currentPlayer();
    this.startRound(`${starter.name} starts with the oldest starter card (${starter.timeline[0].year}).`);
    this.touch();
  }

  beginListening(playerId: string, socketId: string): void {
    if (this.phase !== "prelisten") throw new Error("The song is not waiting to start");
    this.verifiedCurrentPlayer(playerId, socketId);
    this.phase = "waiting";
    this.notice = null;
    this.touch();
  }

  beginListeningAsHost(hostToken: string): void {
    if (hostToken !== this.hostToken) throw new Error("Invalid host token");
    if (this.phase !== "prelisten") throw new Error("The song is not waiting to start");
    this.phase = "waiting";
    this.notice = null;
    this.touch();
  }

  previewPlacement(playerId: string, socketId: string, slot: number): void {
    if (this.phase !== "waiting") throw new Error("The placement can no longer be changed");
    const player = this.verifiedCurrentPlayer(playerId, socketId);
    if (!Number.isInteger(slot) || slot < 0 || slot > player.timeline.length) throw new Error("Invalid placement slot");
    this.currentPlacementSlot = slot;
    this.touch();
  }

  submitGuess(
    playerId: string,
    socketId: string,
    titleGuess: string,
    artistGuess: string,
  ): { correct: boolean; awarded: boolean; tokens: number } {
    if (this.phase !== "waiting" && this.phase !== "challenge") {
      throw new Error("Song guesses are accepted only after the song starts and before the reveal");
    }
    if (!this.tokensEnabled) throw new Error("Tokens are disabled for this game");
    const player = this.verifiedPlayer(playerId, socketId);
    if (this.currentGuesses.has(player.id)) throw new Error("You already submitted a song-and-artist guess this round");
    if (!titleGuess.trim() || !artistGuess.trim()) throw new Error("Enter both the song title and artist");

    const song = this.currentSong();
    const correct = songAndArtistGuessMatches(titleGuess, artistGuess, song.title, song.artist, song.primaryArtist);
    const awarded = correct && player.tokens < MAX_TOKENS;
    if (awarded) player.tokens += 1;
    this.currentGuesses.set(player.id, { correct, awarded });
    this.touch();
    return { correct, awarded, tokens: player.tokens };
  }

  skipSong(playerId: string, socketId: string): void {
    if (this.phase !== "waiting") throw new Error("You can skip only after the current song has started");
    if (!this.tokensEnabled) throw new Error("Tokens are disabled for this game");
    const player = this.verifiedCurrentPlayer(playerId, socketId);
    if (player.tokens < 1) throw new Error("You need 1 FIDSTER token to skip the song");

    if (!this.deck.length) throw new Error("The song deck is empty. Finish this song before ending the game.");
    this.startRound(`${player.name} spent 1 token to skip the previous song.`);
    player.tokens -= 1;
    this.touch();
  }

  buyCurrentCard(playerId: string, socketId: string): void {
    if (this.phase !== "prelisten") throw new Error("The 3-token card exchange must happen before listening");
    if (!this.tokensEnabled) throw new Error("Tokens are disabled for this game");
    const player = this.verifiedCurrentPlayer(playerId, socketId);
    if (player.tokens < 3) throw new Error("You need 3 FIDSTER tokens to take a card directly");

    const song = this.currentSong();
    player.tokens -= 3;
    const slot = findAutomaticSlot(song.year, player.timeline);
    player.timeline.splice(slot, 0, toTimelineCard(song));
    player.skipTurns += 1;
    this.setWinnerIfNeeded(player);

    this.currentPlacementSlot = slot;
    this.reveal = {
      song: toTimelineCard(song),
      playerId: player.id,
      playerName: player.name,
      selectedSlot: slot,
      correct: true,
      outcome: "purchased",
      challengeWinnerId: null,
      challengeWinnerName: null,
      challenges: [],
      guesses: [],
    };
    this.phase = "reveal";
    this.notice = `${player.name} exchanged 3 tokens for the card and must skip their next turn.`;
    this.touch();
  }

  lockPlacement(playerId: string, socketId: string, slot: number): void {
    if (this.phase !== "waiting") throw new Error("The room is not accepting a placement");
    const player = this.verifiedCurrentPlayer(playerId, socketId);
    if (!Number.isInteger(slot) || slot < 0 || slot > player.timeline.length) throw new Error("Invalid placement slot");

    this.currentPlacementSlot = slot;
    const hasEligibleOpponent = this.tokensEnabled && this.players.some(
      (candidate) => candidate.id !== player.id && Boolean(candidate.socketId) && candidate.tokens > 0,
    );

    if (hasEligibleOpponent) {
      this.phase = "challenge";
      this.notice = "Placement locked. Opponents may now call FIDSTER on an unclaimed alternate slot.";
    } else {
      this.resolveNormalPlacement();
    }
    this.touch();
  }

  callHitster(playerId: string, socketId: string, slot: number): void {
    if (this.phase !== "challenge") throw new Error("There is no open FIDSTER challenge window");
    if (!this.tokensEnabled) throw new Error("Tokens are disabled for this game");
    const challenger = this.verifiedPlayer(playerId, socketId);
    const active = this.currentPlayer();
    if (challenger.id === active.id) throw new Error("You cannot challenge your own placement");
    if (challenger.tokens < 1) throw new Error("You need 1 FIDSTER token to challenge");
    if (this.challenges.some((challenge) => challenge.challengerId === challenger.id)) {
      throw new Error("You already placed a FIDSTER token this round");
    }
    if (!Number.isInteger(slot) || slot < 0 || slot > active.timeline.length) throw new Error("Invalid challenge slot");
    if (slot === this.currentPlacementSlot) throw new Error("Choose a different slot from the locked placement");
    if (this.challenges.some((challenge) => challenge.slot === slot)) throw new Error("Another FIDSTER token already claims that slot");

    challenger.tokens -= 1;
    this.challenges.push({
      challengerId: challenger.id,
      challengerName: challenger.name,
      slot,
      order: this.challenges.length + 1,
    });
    this.notice = `${challenger.name} called FIDSTER!`;
    this.touch();
  }

  revealChallenges(hostToken: string): void {
    if (hostToken !== this.hostToken) throw new Error("Invalid host token");
    if (this.phase !== "challenge") throw new Error("There is no locked placement to reveal");
    this.resolveHitsterChallenges();
    this.touch();
  }

  next(hostToken: string): void {
    if (hostToken !== this.hostToken) throw new Error("Invalid host token");
    if (this.phase !== "reveal") throw new Error("There is no completed round to advance");

    if (this.winnerId || this.deck.length === 0) {
      this.phase = "gameover";
      this.currentSongId = null;
      this.currentPlacementSlot = null;
      this.challenges = [];
      this.notice = this.winnerId ? null : "Song deck exhausted. No player reached the target; start a new game with a larger song pool.";
      this.touch();
      return;
    }

    this.advanceToNextEligiblePlayer();
    this.touch();
  }

  skipDisconnectedPlayer(hostToken: string): void {
    if (hostToken !== this.hostToken) throw new Error("Invalid host token");
    if (this.phase !== "prelisten" && this.phase !== "waiting") throw new Error("This turn cannot be skipped now");
    const player = this.currentPlayer();
    if (player.socketId) throw new Error("The active player is still connected");
    const song = this.currentSong();
    this.reveal = {
      song: toTimelineCard(song), playerId: player.id, playerName: player.name,
      selectedSlot: null, correct: false, outcome: "discarded",
      challengeWinnerId: null, challengeWinnerName: null, challenges: [], guesses: this.revealGuesses(),
    };
    this.phase = "reveal";
    this.notice = `${player.name} is offline. The host skipped this turn without charging tokens.`;
    this.touch();
  }

  restart(hostToken: string): void {
    if (hostToken !== this.hostToken) throw new Error("Invalid host token");
    this.phase = "lobby";
    this.round = 0;
    this.currentPlayerIndex = 0;
    this.winnerId = null;
    this.reveal = null;
    this.currentSongId = null;
    this.currentPlacementSlot = null;
    this.challenges = [];
    this.currentGuesses.clear();
    this.deck = [];
    this.notice = null;
    for (const p of this.players) {
      p.timeline = [];
      p.tokens = 0;
      p.skipTurns = 0;
    }
    this.touch();
  }

  privateTrack(): PrivateTrack | null {
    if (this.phase !== "waiting" || !this.currentSongId) return null;
    const song = this.currentSong();
    return {
      round: this.round,
      spotifyUri: song.spotifyUri,
      hasSpotifyAudio: Boolean(song.spotifyUri),
    };
  }
}

export class RoomManager {
  private rooms = new Map<string, GameRoom>();

  constructor(private songs: SongRepository) {}

  create(): GameRoom {
    let code = randomCode();
    while (this.rooms.has(code)) code = randomCode();
    const room = new GameRoom(this.songs, code, randomToken());
    this.rooms.set(code, room);
    return room;
  }

  get(code: string): GameRoom | null {
    return this.rooms.get(code.trim().toUpperCase()) ?? null;
  }

  all(): GameRoom[] {
    return [...this.rooms.values()];
  }

  cleanup(maxAgeMs: number): number {
    const cutoff = Date.now() - maxAgeMs;
    let removed = 0;
    for (const [code, room] of this.rooms) {
      if (room.updatedAt < cutoff) {
        this.rooms.delete(code);
        removed += 1;
      }
    }
    return removed;
  }
}
