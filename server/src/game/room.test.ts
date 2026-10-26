import test from "node:test";
import assert from "node:assert/strict";
import { GameRoom } from "./room.js";
import { findAutomaticSlot } from "./rules.js";
import type { Song, SongRepository } from "../db/songs.js";

class FakeSongs {
  rows: Song[];
  constructor() {
    this.rows = Array.from({ length: 40 }, (_, index) => ({
      id: `song-${index}`,
      title: `Song ${index}`,
      artist: `Artist ${index}`,
      year: 1960 + index,
      spotifyUri: `spotify:track:${index}`,
    }));
  }
  count() { return this.rows.length; }
  allIds() { return this.rows.map((song) => song.id); }
  getById(id: string) { return this.rows.find((song) => song.id === id) ?? null; }
}

function setupRoom() {
  const repo = new FakeSongs();
  const room = new GameRoom(repo as unknown as SongRepository, "TEST", "host-token");
  const anna = room.joinPlayer("Anna", "socket-anna");
  const bob = room.joinPlayer("Bob", "socket-bob");
  room.start("host-token", { winTarget: 10, tokensEnabled: true, gameMode: "individual" });
  const sockets = new Map([
    [anna.playerId, "socket-anna"],
    [bob.playerId, "socket-bob"],
  ]);
  return { room, repo, sockets };
}

function currentSong(room: GameRoom, repo: FakeSongs): Song {
  const song = repo.getById(room.currentSongId || "");
  if (!song) throw new Error("Expected current song to exist");
  return song;
}

test("game starts with two tokens each and the oldest starter player", () => {
  const { room } = setupRoom();
  const state = room.publicState();
  assert.equal(state.phase, "prelisten");
  assert.deepEqual(state.players.map((player) => player.tokens), [2, 2]);
  const oldestStarter = Math.min(...state.players.map((player) => player.timeline[0].year));
  const current = state.players.find((player) => player.id === state.currentPlayerId);
  assert.equal(current?.timeline[0].year, oldestStarter);
});

test("live preview is public before lock and a correct FIDSTER challenge steals an incorrect card", () => {
  const { room, repo, sockets } = setupRoom();
  let state = room.publicState();
  const activeId = state.currentPlayerId!;
  const activeSocket = sockets.get(activeId)!;
  const active = state.players.find((player) => player.id === activeId)!;
  const challenger = state.players.find((player) => player.id !== activeId)!;
  const challengerSocket = sockets.get(challenger.id)!;
  const song = currentSong(room, repo);
  const correctSlot = findAutomaticSlot(song.year, active.timeline);
  const wrongSlot = correctSlot === 0 ? 1 : 0;

  room.beginListening(activeId, activeSocket);
  room.previewPlacement(activeId, activeSocket, wrongSlot);
  state = room.publicState();
  assert.equal(state.currentPlacementSlot, wrongSlot);
  assert.equal(state.phase, "waiting");

  room.lockPlacement(activeId, activeSocket, wrongSlot);
  assert.equal(room.publicState().phase, "challenge");
  room.callHitster(challenger.id, challengerSocket, correctSlot);
  assert.equal(room.publicState().players.find((player) => player.id === challenger.id)?.tokens, 1);
  room.revealChallenges("host-token");

  state = room.publicState();
  assert.equal(state.phase, "reveal");
  assert.equal(state.reveal?.outcome, "stolen");
  assert.equal(state.reveal?.challengeWinnerId, challenger.id);
  assert.equal(state.players.find((player) => player.id === challenger.id)?.timeline.length, 2);
});

test("a correct original placement beats all FIDSTER bets", () => {
  const { room, repo, sockets } = setupRoom();
  let state = room.publicState();
  const activeId = state.currentPlayerId!;
  const activeSocket = sockets.get(activeId)!;
  const active = state.players.find((player) => player.id === activeId)!;
  const challenger = state.players.find((player) => player.id !== activeId)!;
  const challengerSocket = sockets.get(challenger.id)!;
  const song = currentSong(room, repo);
  const correctSlot = findAutomaticSlot(song.year, active.timeline);

  room.beginListening(activeId, activeSocket);
  room.previewPlacement(activeId, activeSocket, correctSlot);
  room.lockPlacement(activeId, activeSocket, correctSlot);
  assert.equal(room.publicState().phase, "challenge");
  const alternate = correctSlot === 0 ? 1 : 0;
  room.callHitster(challenger.id, challengerSocket, alternate);
  room.revealChallenges("host-token");

  state = room.publicState();
  assert.equal(state.reveal?.outcome, "kept");
  assert.equal(state.reveal?.challengeWinnerId, null);
  assert.equal(state.players.find((player) => player.id === challenger.id)?.tokens, 1);
});

test("correct song and artist guess earns one token but never exceeds five", () => {
  const { room, repo, sockets } = setupRoom();
  const state = room.publicState();
  const activeId = state.currentPlayerId!;
  const activeSocket = sockets.get(activeId)!;
  const song = currentSong(room, repo);

  room.beginListening(activeId, activeSocket);
  const first = room.submitGuess(activeId, activeSocket, song.title, song.artist);
  assert.deepEqual(first, { correct: true, awarded: true, tokens: 3 });

  // New room for max-token behavior, with internal token count set up as if the
  // player had earned tokens in previous rounds.
  const setup = setupRoom();
  const maxState = setup.room.publicState();
  const maxActiveId = maxState.currentPlayerId!;
  const maxSocket = setup.sockets.get(maxActiveId)!;
  const maxSong = currentSong(setup.room, setup.repo);
  const internal = (setup.room as unknown as { players: Array<{ id: string; tokens: number }> }).players.find((p) => p.id === maxActiveId)!;
  internal.tokens = 5;
  setup.room.beginListening(maxActiveId, maxSocket);
  const capped = setup.room.submitGuess(maxActiveId, maxSocket, maxSong.title, maxSong.artist);
  assert.deepEqual(capped, { correct: true, awarded: false, tokens: 5 });
});


test("every player can guess song and artist on someone else's turn, including after placement lock", () => {
  const { room, repo, sockets } = setupRoom();
  let state = room.publicState();
  const activeId = state.currentPlayerId!;
  const activeSocket = sockets.get(activeId)!;
  const active = state.players.find((player) => player.id === activeId)!;
  const other = state.players.find((player) => player.id !== activeId)!;
  const otherSocket = sockets.get(other.id)!;
  const song = currentSong(room, repo);

  room.beginListening(activeId, activeSocket);

  // A non-active player may guess while somebody else is placing the song.
  const otherGuess = room.submitGuess(other.id, otherSocket, song.title, song.artist);
  assert.deepEqual(otherGuess, { correct: true, awarded: true, tokens: 3 });
  assert.deepEqual(room.publicState().guessSubmittedPlayerIds, [other.id]);
  assert.throws(
    () => room.submitGuess(other.id, otherSocket, song.title, song.artist),
    /already submitted/i,
  );

  // Locking the placement opens the challenge window. Anyone who has not yet
  // guessed may still submit before the host reveals the answer.
  const slot = findAutomaticSlot(song.year, active.timeline);
  room.lockPlacement(activeId, activeSocket, slot);
  assert.equal(room.publicState().phase, "challenge");
  const activeGuess = room.submitGuess(activeId, activeSocket, song.title, song.artist);
  assert.deepEqual(activeGuess, { correct: true, awarded: true, tokens: 3 });

  state = room.publicState();
  assert.deepEqual(new Set(state.guessSubmittedPlayerIds), new Set([other.id, activeId]));
  room.revealChallenges("host-token");
  const revealGuesses = room.publicState().reveal?.guesses ?? [];
  assert.equal(revealGuesses.length, 2);
  assert.equal(revealGuesses.every((guess) => guess.correct && guess.awarded), true);
});

test("three-token exchange happens before listening, adds the card, and marks the next turn to skip", () => {
  const { room, repo, sockets } = setupRoom();
  const before = room.publicState();
  const activeId = before.currentPlayerId!;
  const activeSocket = sockets.get(activeId)!;
  const internal = (room as unknown as { players: Array<{ id: string; tokens: number; skipTurns: number }> }).players.find((p) => p.id === activeId)!;
  internal.tokens = 3;
  const song = currentSong(room, repo);

  room.buyCurrentCard(activeId, activeSocket);
  const state = room.publicState();
  const player = state.players.find((candidate) => candidate.id === activeId)!;
  assert.equal(state.phase, "reveal");
  assert.equal(state.reveal?.outcome, "purchased");
  assert.equal(state.reveal?.song.songId, song.id);
  assert.equal(player.tokens, 0);
  assert.equal(player.skipTurns, 1);
  assert.equal(player.timeline.length, 2);
});

test("one-token skip discards the current song, keeps the same player, and returns to prelisten", () => {
  const { room, repo, sockets } = setupRoom();
  const state = room.publicState();
  const activeId = state.currentPlayerId!;
  const activeSocket = sockets.get(activeId)!;
  const oldSong = currentSong(room, repo).id;
  room.beginListening(activeId, activeSocket);
  room.skipSong(activeId, activeSocket);
  const after = room.publicState();
  assert.equal(after.currentPlayerId, activeId);
  assert.equal(after.phase, "prelisten");
  assert.equal(after.players.find((player) => player.id === activeId)?.tokens, 1);
  assert.notEqual(room.currentSongId, oldSong);
});

test("display host can use an audited Spotify playlist as the multiplayer song pool", () => {
  const repo = new FakeSongs();
  const room = new GameRoom(repo as unknown as SongRepository, "PLST", "host-token");
  const player = room.joinPlayer("Anna", "socket-anna");
  const playlistSongs: Song[] = Array.from({ length: 16 }, (_, index) => ({
    id: `spotify:track${index}`,
    title: `Playlist Song ${index}`,
    artist: index === 0 ? "Earth, Wind & Fire, Guest Artist" : `Playlist Artist ${index}, Guest ${index}`,
    primaryArtist: index === 0 ? "Earth, Wind & Fire" : `Playlist Artist ${index}`,
    year: 1980 + index,
    spotifyUri: `spotify:track:track${index}`,
  }));

  room.useSpotifyPlaylistSource("host-token", { id: "playlist-123", name: "Party Mix" }, playlistSongs);
  let state = room.publicState();
  assert.deepEqual(state.songSource, {
    type: "spotify",
    name: "Party Mix",
    trackCount: 16,
  });
  assert.equal(state.catalogSize, 16);

  room.start("host-token", { winTarget: 10, tokensEnabled: true, gameMode: "individual" });
  state = room.publicState();
  assert.equal(state.phase, "prelisten");
  assert.match(state.players[0].timeline[0].songId, /^spotify:/);
  assert.match(room.currentSongId || "", /^spotify:/);

  room.beginListening(player.playerId, "socket-anna");
  const privateTrack = room.privateTrack();
  assert.equal(privateTrack?.hasSpotifyAudio, true);
  assert.match(privateTrack?.spotifyUri || "", /^spotify:track:/);

  const activeSong = playlistSongs.find((song) => song.id === room.currentSongId)!;
  const artistGuess = activeSong.primaryArtist || activeSong.artist;
  const guess = room.submitGuess(player.playerId, "socket-anna", activeSong.title, artistGuess);
  assert.equal(guess.correct, true);
});

test("playlist source can be switched back to the built-in catalog in the lobby", () => {
  const repo = new FakeSongs();
  const room = new GameRoom(repo as unknown as SongRepository, "BACK", "host-token");
  room.useSpotifyPlaylistSource("host-token", { id: "p", name: "Temporary" }, Array.from({ length: 12 }, (_, index) => ({
    id: `spotify:x${index}`,
    title: `X ${index}`,
    artist: "Artist",
    year: 1990 + index,
    spotifyUri: `spotify:track:x${index}`,
  })));
  room.useCatalogSource("host-token");
  assert.deepEqual(room.publicState().songSource, {
    type: "catalog",
    name: "Built-in catalog",
    trackCount: repo.count(),
  });
});
