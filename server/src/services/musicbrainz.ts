export type ReleaseYearCheckInput = {
  title: string;
  artist: string;
  isrc?: string | null;
  spotifyYear: number;
};

export type ReleaseYearCheckResult = {
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

type MusicBrainzRecording = {
  id: string;
  score?: number | string;
  title?: string;
  "first-release-date"?: string;
  "artist-credit"?: Array<{ name?: string; artist?: { name?: string }; joinphrase?: string }>;
};

type MusicBrainzSearchResponse = {
  recordings?: MusicBrainzRecording[];
};

const cache = new Map<string, ReleaseYearCheckResult>();
let requestChain: Promise<void> = Promise.resolve();
let lastRequestAt = 0;

function delay(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

function normalize(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/^the\s+/, "")
    .replace(/\s+/g, " ")
    .trim();
}

function luceneQuote(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

function artistCredit(recording: MusicBrainzRecording): string {
  return (recording["artist-credit"] || [])
    .map((part) => `${part.name || part.artist?.name || ""}${part.joinphrase || ""}`)
    .join("")
    .trim();
}

function parseYear(date: string | undefined): number | null {
  if (!date) return null;
  const match = /^(\d{4})/.exec(date);
  const year = match ? Number(match[1]) : NaN;
  return Number.isInteger(year) && year >= 1800 && year <= 2200 ? year : null;
}

async function rateLimitedFetch(url: string, userAgent: string): Promise<Response> {
  let resolveResult!: (response: Response) => void;
  let rejectResult!: (error: unknown) => void;
  const result = new Promise<Response>((resolve, reject) => {
    resolveResult = resolve;
    rejectResult = reject;
  });

  requestChain = requestChain.then(async () => {
    const wait = Math.max(0, 1100 - (Date.now() - lastRequestAt));
    if (wait > 0) await delay(wait);
    try {
      const response = await fetch(url, {
        headers: {
          Accept: "application/json",
          "User-Agent": userAgent,
        },
        signal: AbortSignal.timeout(12_000),
      });
      lastRequestAt = Date.now();
      resolveResult(response);
    } catch (error) {
      lastRequestAt = Date.now();
      rejectResult(error);
    }
  });

  return result;
}

function chooseRecording(input: ReleaseYearCheckInput, recordings: MusicBrainzRecording[]): MusicBrainzRecording | null {
  if (recordings.length === 0) return null;
  if (input.isrc) return recordings[0] ?? null;

  const title = normalize(input.title);
  const artist = normalize(input.artist);
  const exact = recordings.find((recording) => {
    const candidateTitle = normalize(recording.title || "");
    const candidateArtist = normalize(artistCredit(recording));
    return candidateTitle === title && (candidateArtist === artist || candidateArtist.includes(artist) || artist.includes(candidateArtist));
  });
  return exact || recordings[0] || null;
}

export async function checkReleaseYear(
  input: ReleaseYearCheckInput,
  options: { userAgent: string },
): Promise<ReleaseYearCheckResult> {
  const cleanIsrc = input.isrc?.replace(/[^A-Za-z0-9]/g, "").toUpperCase() || null;
  const cacheKey = cleanIsrc
    ? `isrc:${cleanIsrc}:${input.spotifyYear}`
    : `text:${normalize(input.title)}:${normalize(input.artist)}:${input.spotifyYear}`;
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  const query = cleanIsrc
    ? `isrc:${cleanIsrc}`
    : `recording:${luceneQuote(input.title)} AND artist:${luceneQuote(input.artist)}`;
  const params = new URLSearchParams({ query, fmt: "json", limit: cleanIsrc ? "5" : "8" });
  const response = await rateLimitedFetch(`https://musicbrainz.org/ws/2/recording/?${params}`, options.userAgent);

  if (!response.ok) {
    throw new Error(`MusicBrainz returned ${response.status}`);
  }

  const data = await response.json() as MusicBrainzSearchResponse;
  const recording = chooseRecording(input, data.recordings || []);
  if (!recording) {
    const result: ReleaseYearCheckResult = {
      spotifyYear: input.spotifyYear,
      suggestedYear: null,
      status: "not-found",
      confidence: "low",
      source: "musicbrainz",
      musicBrainzId: null,
      firstReleaseDate: null,
      matchedTitle: null,
      matchedArtist: null,
      score: null,
      note: "No suitable MusicBrainz recording match was found. Keep the Spotify year or edit it manually.",
    };
    cache.set(cacheKey, result);
    return result;
  }

  const score = Number(recording.score ?? 0);
  const firstReleaseDate = recording["first-release-date"] || null;
  const suggestedYear = parseYear(firstReleaseDate || undefined);
  const matchedTitle = recording.title || null;
  const matchedArtist = artistCredit(recording) || null;
  const titleExact = normalize(matchedTitle || "") === normalize(input.title);
  const artistNormalized = normalize(matchedArtist || "");
  const requestedArtist = normalize(input.artist);
  const artistClose = Boolean(artistNormalized && requestedArtist && (
    artistNormalized === requestedArtist || artistNormalized.includes(requestedArtist) || requestedArtist.includes(artistNormalized)
  ));

  let confidence: ReleaseYearCheckResult["confidence"] = "low";
  if (cleanIsrc && score >= 90 && suggestedYear) confidence = "high";
  else if (!cleanIsrc && score >= 95 && titleExact && artistClose && suggestedYear) confidence = "medium";

  let status: ReleaseYearCheckResult["status"];
  if (!suggestedYear) status = "uncertain";
  else status = suggestedYear === input.spotifyYear ? "match" : "mismatch";

  const note = !suggestedYear
    ? "MusicBrainz matched the recording but does not have a usable first-release date."
    : status === "match"
      ? `MusicBrainz agrees with the Spotify year (${suggestedYear}).`
      : confidence === "high"
        ? `The ISRC match indicates an earliest release in ${suggestedYear}; Spotify reports ${input.spotifyYear}. This is often caused by a remaster or reissue, but review before applying.`
        : `MusicBrainz suggests ${suggestedYear} while Spotify reports ${input.spotifyYear}. Review this text-based match before applying.`;

  const result: ReleaseYearCheckResult = {
    spotifyYear: input.spotifyYear,
    suggestedYear,
    status,
    confidence,
    source: "musicbrainz",
    musicBrainzId: recording.id || null,
    firstReleaseDate,
    matchedTitle,
    matchedArtist,
    score: Number.isFinite(score) ? score : null,
    note,
  };
  cache.set(cacheKey, result);
  return result;
}
