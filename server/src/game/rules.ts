import type { TimelineCard } from "../types/protocol.js";

export function isValidPlacement(year: number, timeline: TimelineCard[], slot: number): boolean {
  if (!Number.isInteger(slot) || slot < 0 || slot > timeline.length) return false;
  const left = slot > 0 ? timeline[slot - 1]?.year : undefined;
  const right = slot < timeline.length ? timeline[slot]?.year : undefined;
  if (left !== undefined && year < left) return false;
  if (right !== undefined && year > right) return false;
  return true;
}

/**
 * Returns a deterministic valid insertion point for a revealed/directly-awarded card.
 * Equal-year cards are inserted after the existing equal-year run; placing before or
 * after an equal year is valid under the game rules.
 */
export function findAutomaticSlot(year: number, timeline: TimelineCard[]): number {
  const firstGreater = timeline.findIndex((card) => card.year > year);
  return firstGreater === -1 ? timeline.length : firstGreater;
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

export function guessMatches(guess: string, answer: string): boolean {
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

function artistCandidates(answer: string): string[] {
  const candidates = new Set<string>([answer]);
  const explicitPrimary = answer.split(/\s+(?:feat(?:uring)?|ft\.?|with)\s+/i)[0]?.trim();
  if (explicitPrimary) candidates.add(explicitPrimary);

  // Catalog imports often store multiple Spotify artists as "Artist A, Artist B".
  // Avoid splitting well-known comma-style single names such as "Earth, Wind & Fire"
  // or "Tyler, The Creator" when the text strongly looks like one artist name.
  if (answer.includes(",") && !answer.includes("&") && !/,\s*the\b/i.test(answer)) {
    const first = answer.split(",")[0]?.trim();
    if (first && first.length >= 3) candidates.add(first);
  }
  return [...candidates];
}

export function artistGuessMatches(guess: string, answer: string): boolean {
  return artistCandidates(answer).some((candidate) => guessMatches(guess, candidate));
}

export function songAndArtistGuessMatches(
  titleGuess: string,
  artistGuess: string,
  title: string,
  artist: string,
  primaryArtist?: string | null,
): boolean {
  const artistCorrect = artistGuessMatches(artistGuess, artist)
    || Boolean(primaryArtist && guessMatches(artistGuess, primaryArtist));
  return guessMatches(titleGuess, title) && artistCorrect;
}
