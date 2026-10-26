import type { SpotifyPlaylistTrack } from "./spotify";
import type { TimelineCard } from "../types";

export type SoloTrack = SpotifyPlaylistTrack & {
  correctedYear?: number;
};

export type SoloRoundScore = {
  placement: number;
  title: number;
  artist: number;
  streak: number;
  total: number;
};

export type YearCheckResult = {
  spotifyYear: number;
  suggestedYear: number | null;
  status: "match" | "mismatch" | "not-found" | "uncertain";
  confidence: "high" | "medium" | "low";
  source: "musicbrainz";
  musicBrainzId: string | null;
  firstReleaseDate: string | null;
  matchedTitle: string | null;
  matchedArtist: string | null;
  score: number | null;
  note: string;
};

export function effectiveYear(track: SoloTrack): number {
  return track.correctedYear ?? track.year;
}

export function toTimelineCard(track: SoloTrack): TimelineCard {
  return {
    songId: track.id,
    title: track.title,
    artist: track.artist,
    year: effectiveYear(track),
  };
}

export function isValidSoloPlacement(year: number, timeline: TimelineCard[], slot: number): boolean {
  if (!Number.isInteger(slot) || slot < 0 || slot > timeline.length) return false;
  const left = slot > 0 ? timeline[slot - 1]?.year : undefined;
  const right = slot < timeline.length ? timeline[slot]?.year : undefined;
  return (left === undefined || year >= left) && (right === undefined || year <= right);
}

function normalize(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/\b(feat|ft|featuring)\.?\b.*$/i, "")
    .replace(/[()[\]{}]/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/^the\s+/, "")
    .replace(/\s+/g, " ")
    .trim();
}

function stripVersionSuffix(value: string): string {
  return value
    .replace(/\s*[\[(].*?[\])]\s*/g, " ")
    .replace(/\s+-\s+(radio edit|(?:\d{4}\s+)?remaster(?:ed)?(?:\s+\d{4})?|single version|album version|live|edit|mix).*$/i, "")
    .trim();
}

function normalizedVariants(value: string): Set<string> {
  return new Set([normalize(value), normalize(stripVersionSuffix(value))].filter(Boolean));
}

function compact(value: string): string {
  return value.replace(/\s+/g, "");
}

function editDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  const previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  const current = new Array<number>(b.length + 1);
  for (let i = 1; i <= a.length; i += 1) {
    current[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      current[j] = Math.min(
        current[j - 1] + 1,
        previous[j] + 1,
        previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
    for (let j = 0; j <= b.length; j += 1) previous[j] = current[j];
  }
  return previous[b.length];
}

function allowedDistance(length: number): number {
  if (length < 4) return 0;
  if (length <= 7) return 1;
  if (length <= 13) return 2;
  return Math.min(4, Math.max(2, Math.floor(length * 0.16)));
}

const glueWords = new Set(["a", "an", "the", "of", "and", "to", "in", "on", "for"]);

function significantWords(value: string): string {
  const words = value.split(" ").filter(Boolean);
  const significant = words.filter((word) => !glueWords.has(word));
  return significant.length >= 2 ? significant.join(" ") : value;
}

function fuzzyNormalizedMatch(guess: string, answer: string): boolean {
  if (!guess || !answer) return false;
  if (guess === answer) return true;
  const guessCompact = compact(guess);
  const answerCompact = compact(answer);
  if (guessCompact === answerCompact) return true;
  const maxLength = Math.max(guessCompact.length, answerCompact.length);
  const minLength = Math.min(guessCompact.length, answerCompact.length);
  if (minLength < 3) return false;
  if (editDistance(guessCompact, answerCompact) <= allowedDistance(maxLength)) return true;

  const significantGuess = compact(significantWords(guess));
  const significantAnswer = compact(significantWords(answer));
  if (significantGuess === significantAnswer) return true;
  const significantMax = Math.max(significantGuess.length, significantAnswer.length);
  const significantMin = Math.min(significantGuess.length, significantAnswer.length);
  return significantMin >= 4
    && editDistance(significantGuess, significantAnswer) <= allowedDistance(significantMax);
}

export function soloGuessMatches(guess: string, answer: string): boolean {
  if (!guess.trim()) return false;
  const guessed = normalizedVariants(guess);
  const answers = normalizedVariants(answer);
  for (const guessedValue of guessed) {
    for (const answerValue of answers) {
      if (fuzzyNormalizedMatch(guessedValue, answerValue)) return true;
    }
  }
  return false;
}

export function soloArtistGuessMatches(guess: string, artist: string, artists?: string[]): boolean {
  const candidates = new Set<string>([artist]);
  if (artists?.[0]) candidates.add(artists[0]);
  return [...candidates].some((candidate) => soloGuessMatches(guess, candidate));
}

export function calculateSoloScore(options: {
  placementCorrect: boolean;
  titleCorrect: boolean;
  artistCorrect: boolean;
  previousPlacementStreak: number;
}): { score: SoloRoundScore; nextPlacementStreak: number } {
  const nextPlacementStreak = options.placementCorrect ? options.previousPlacementStreak + 1 : 0;
  const placement = options.placementCorrect ? 100 : 0;
  const title = options.titleCorrect ? 25 : 0;
  const artist = options.artistCorrect ? 25 : 0;
  const streak = options.placementCorrect ? Math.min(100, Math.max(0, nextPlacementStreak - 1) * 25) : 0;
  return {
    score: { placement, title, artist, streak, total: placement + title + artist + streak },
    nextPlacementStreak,
  };
}

export function shuffleSoloTracks<T>(tracks: T[]): T[] {
  const result = [...tracks];
  for (let i = result.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

export function correctionsStorageKey(playlistId: string): string {
  return `phipster.solo.corrections.${playlistId}`;
}

export function bestScoreStorageKey(playlistId: string, sessionKey: string): string {
  return `phipster.solo.best.${playlistId}.${sessionKey}`;
}

export function loadCorrections(playlistId: string): Record<string, number> {
  try {
    const raw = localStorage.getItem(correctionsStorageKey(playlistId));
    return raw ? JSON.parse(raw) as Record<string, number> : {};
  } catch {
    return {};
  }
}

export function saveCorrections(playlistId: string, tracks: SoloTrack[]): void {
  const corrections: Record<string, number> = {};
  for (const track of tracks) {
    if (track.correctedYear && track.correctedYear !== track.year) corrections[track.id] = track.correctedYear;
  }
  localStorage.setItem(correctionsStorageKey(playlistId), JSON.stringify(corrections));
}

export function loadBestScore(playlistId: string, sessionKey: string): number {
  const value = Number(localStorage.getItem(bestScoreStorageKey(playlistId, sessionKey)) || 0);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

export function saveBestScore(playlistId: string, sessionKey: string, score: number): number {
  const best = Math.max(loadBestScore(playlistId, sessionKey), Math.floor(score));
  localStorage.setItem(bestScoreStorageKey(playlistId, sessionKey), String(best));
  return best;
}
