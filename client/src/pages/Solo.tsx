import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Logo } from "../components/Logo";
import { PlacementTimeline, Timeline } from "../components/Timeline";
import {
  beginSpotifyLogin,
  disconnectSpotify,
  phipsterSpotifyPlayer,
  getMySpotifyPlaylists,
  getSpotifyPlaylistTracks,
  spotifyConfigured,
  spotifyConnected,
  spotifyHasPlaylistAccess,
  type SpotifyPlaylistSummary,
} from "../lib/spotify";
import {
  calculateSoloScore,
  effectiveYear,
  isValidSoloPlacement,
  loadBestScore,
  loadCorrections,
  saveBestScore,
  saveCorrections,
  shuffleSoloTracks,
  soloArtistGuessMatches,
  soloGuessMatches,
  toTimelineCard,
  type SoloRoundScore,
  type SoloTrack,
  type YearCheckResult,
} from "../lib/solo";
import type { TimelineCard } from "../types";

type SoloStage = "setup" | "playing" | "reveal" | "finished";
type SessionLength = 10 | 20 | 30 | "all";

type SoloReveal = {
  track: SoloTrack;
  placementCorrect: boolean;
  titleCorrect: boolean;
  artistCorrect: boolean;
  selectedSlot: number;
  points: SoloRoundScore;
};

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : "Something went wrong";
}

function sessionKey(value: SessionLength) {
  return value === "all" ? "all" : String(value);
}

export function Solo() {
  const [stage, setStage] = useState<SoloStage>("setup");
  const [error, setError] = useState("");
  const [spotifyStatus, setSpotifyStatus] = useState("");
  const [playlists, setPlaylists] = useState<SpotifyPlaylistSummary[]>([]);
  const [playlistsLoading, setPlaylistsLoading] = useState(false);
  const [selectedPlaylist, setSelectedPlaylist] = useState<SpotifyPlaylistSummary | null>(null);
  const [tracks, setTracks] = useState<SoloTrack[]>([]);
  const [tracksLoading, setTracksLoading] = useState(false);
  const [audits, setAudits] = useState<Record<string, YearCheckResult>>({});
  const [checkingIds, setCheckingIds] = useState<Set<string>>(new Set());
  const [auditProgress, setAuditProgress] = useState<{ done: number; total: number } | null>(null);
  const [sessionLength, setSessionLength] = useState<SessionLength>(10);

  const [timeline, setTimeline] = useState<TimelineCard[]>([]);
  const [remainingDeck, setRemainingDeck] = useState<SoloTrack[]>([]);
  const [currentTrack, setCurrentTrack] = useState<SoloTrack | null>(null);
  const [selectedSlot, setSelectedSlot] = useState<number | null>(null);
  const [titleGuess, setTitleGuess] = useState("");
  const [artistGuess, setArtistGuess] = useState("");
  const [score, setScore] = useState(0);
  const [bestScore, setBestScore] = useState(0);
  const [placementStreak, setPlacementStreak] = useState(0);
  const [round, setRound] = useState(0);
  const [totalRounds, setTotalRounds] = useState(0);
  const [reveal, setReveal] = useState<SoloReveal | null>(null);
  const playerRef = useRef<phipsterSpotifyPlayer | null>(null);

  const correctedCount = useMemo(
    () => tracks.filter((track) => track.correctedYear && track.correctedYear !== track.year).length,
    [tracks],
  );
  const mismatchCount = useMemo(
    () => Object.values(audits).filter((audit) => audit.status === "mismatch").length,
    [audits],
  );

  useEffect(() => () => playerRef.current?.destroy(), []);

  useEffect(() => {
    if (stage === "setup" && spotifyConnected() && spotifyHasPlaylistAccess() && playlists.length === 0 && !playlistsLoading) {
      void loadPlaylists();
    }
  }, [stage]); // eslint-disable-line react-hooks/exhaustive-deps

  async function reconnectSpotify() {
    disconnectSpotify();
    await beginSpotifyLogin("/solo");
  }

  async function loadPlaylists() {
    setPlaylistsLoading(true);
    setError("");
    try {
      const next = await getMySpotifyPlaylists();
      setPlaylists(next);
      if (next.length === 0) setSpotifyStatus("No owned or collaborative Spotify playlists were found.");
    } catch (error) {
      setError(errorText(error));
    } finally {
      setPlaylistsLoading(false);
    }
  }

  async function selectPlaylist(playlist: SpotifyPlaylistSummary) {
    setSelectedPlaylist(playlist);
    setTracksLoading(true);
    setError("");
    setAudits({});
    setAuditProgress(null);
    try {
      const spotifyTracks = await getSpotifyPlaylistTracks(playlist.id);
      const corrections = loadCorrections(playlist.id);
      const loaded: SoloTrack[] = spotifyTracks.map((track) => ({
        ...track,
        correctedYear: corrections[track.id] && corrections[track.id] !== track.year ? corrections[track.id] : undefined,
      }));
      setTracks(loaded);
      setBestScore(loadBestScore(playlist.id, sessionKey(sessionLength)));
      if (loaded.length < 3) setError("This playlist needs at least 3 playable Spotify tracks with release years.");
    } catch (error) {
      setTracks([]);
      setError(errorText(error));
    } finally {
      setTracksLoading(false);
    }
  }

  function updateTrackYear(trackId: string, value: number) {
    if (!selectedPlaylist || !Number.isInteger(value) || value < 1800 || value > 2200) return;
    setTracks((current) => {
      const next = current.map((track) => track.id === trackId
        ? { ...track, correctedYear: value === track.year ? undefined : value }
        : track);
      saveCorrections(selectedPlaylist.id, next);
      return next;
    });
  }

  async function requestYearCheck(track: SoloTrack): Promise<YearCheckResult> {
    const response = await fetch("/api/metadata/year-check", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: track.title,
        artist: track.artist,
        isrc: track.isrc,
        spotifyYear: track.year,
      }),
    });
    const body = await response.json().catch(() => ({})) as YearCheckResult & { error?: string };
    if (!response.ok) throw new Error(body.error || `Release-year check failed (${response.status})`);
    return body;
  }

  async function checkOneTrack(track: SoloTrack) {
    setError("");
    setCheckingIds((current) => new Set(current).add(track.id));
    try {
      const result = await requestYearCheck(track);
      setAudits((current) => ({ ...current, [track.id]: result }));
      return result;
    } catch (error) {
      setError(errorText(error));
      return null;
    } finally {
      setCheckingIds((current) => {
        const next = new Set(current);
        next.delete(track.id);
        return next;
      });
    }
  }

  async function auditAll() {
    if (auditProgress) return;
    setError("");
    setAuditProgress({ done: 0, total: tracks.length });
    let done = 0;
    for (const track of tracks) {
      if (!audits[track.id]) await checkOneTrack(track);
      done += 1;
      setAuditProgress({ done, total: tracks.length });
    }
    setAuditProgress(null);
  }

  function applyHighConfidenceFixes() {
    if (!selectedPlaylist) return;
    setTracks((current) => {
      const next = current.map((track) => {
        const audit = audits[track.id];
        if (audit?.status === "mismatch" && audit.confidence === "high" && audit.suggestedYear) {
          return { ...track, correctedYear: audit.suggestedYear === track.year ? undefined : audit.suggestedYear };
        }
        return track;
      });
      saveCorrections(selectedPlaylist.id, next);
      return next;
    });
  }

  async function ensurePlayer() {
    if (!playerRef.current) {
      const player = new phipsterSpotifyPlayer("phipster Solo");
      playerRef.current = player;
      await player.init(setSpotifyStatus);
    }
    return playerRef.current;
  }

  async function play(track: SoloTrack) {
    try {
      const player = await ensurePlayer();
      await player.playUri(track.spotifyUri);
      setSpotifyStatus("Playing on phipster");
    } catch (error) {
      setError(errorText(error));
    }
  }

  async function startGame() {
    if (!selectedPlaylist || tracks.length < 3) return;
    setError("");
    try {
      await ensurePlayer();
      const shuffled = shuffleSoloTracks(tracks);
      const starter = shuffled.shift();
      if (!starter) throw new Error("The playlist is empty");
      const roundTracks = sessionLength === "all" ? shuffled : shuffled.slice(0, sessionLength);
      if (roundTracks.length < 1) throw new Error("The playlist needs at least two playable songs");
      const first = roundTracks[0];
      setTimeline([toTimelineCard(starter)]);
      setRemainingDeck(roundTracks.slice(1));
      setCurrentTrack(first);
      setSelectedSlot(null);
      setTitleGuess("");
      setArtistGuess("");
      setScore(0);
      setPlacementStreak(0);
      setRound(1);
      setTotalRounds(roundTracks.length);
      setReveal(null);
      setBestScore(loadBestScore(selectedPlaylist.id, sessionKey(sessionLength)));
      setStage("playing");
      await play(first);
    } catch (error) {
      setError(errorText(error));
    }
  }

  async function replayCurrent() {
    if (currentTrack) await play(currentTrack);
  }

  async function lockPlacement() {
    if (!currentTrack || selectedSlot === null) return;
    const year = effectiveYear(currentTrack);
    const placementCorrect = isValidSoloPlacement(year, timeline, selectedSlot);
    const titleCorrect = soloGuessMatches(titleGuess, currentTrack.title);
    const artistCorrect = soloArtistGuessMatches(artistGuess, currentTrack.artist, currentTrack.artists);
    const calculated = calculateSoloScore({
      placementCorrect,
      titleCorrect,
      artistCorrect,
      previousPlacementStreak: placementStreak,
    });

    if (placementCorrect) {
      const nextTimeline = [...timeline];
      nextTimeline.splice(selectedSlot, 0, toTimelineCard(currentTrack));
      setTimeline(nextTimeline);
    }
    setPlacementStreak(calculated.nextPlacementStreak);
    setScore((current) => current + calculated.score.total);
    setReveal({
      track: currentTrack,
      placementCorrect,
      titleCorrect,
      artistCorrect,
      selectedSlot,
      points: calculated.score,
    });
    setStage("reveal");
    try {
      await playerRef.current?.pause();
    } catch {
      // A failed pause should never block scoring or reveal.
    }
  }

  async function nextRound() {
    if (remainingDeck.length === 0) {
      if (selectedPlaylist) {
        const best = saveBestScore(selectedPlaylist.id, sessionKey(sessionLength), score);
        setBestScore(best);
      }
      setStage("finished");
      return;
    }
    const next = remainingDeck[0];
    setRemainingDeck((current) => current.slice(1));
    setCurrentTrack(next);
    setSelectedSlot(null);
    setTitleGuess("");
    setArtistGuess("");
    setReveal(null);
    setRound((current) => current + 1);
    setStage("playing");
    await play(next);
  }

  async function returnToSetup() {
    try { await playerRef.current?.pause(); } catch { /* ignore */ }
    setStage("setup");
    setCurrentTrack(null);
    setReveal(null);
  }

  const configured = spotifyConfigured();
  const connected = spotifyConnected();
  const playlistAccess = spotifyHasPlaylistAccess();

  if (stage === "playing" && currentTrack) {
    return (
      <main className="solo-shell solo-game-shell">
        <header className="solo-header">
          <Logo />
          <div className="solo-score-strip">
            <span>Round <strong>{round}/{totalRounds}</strong></span>
            <span>Score <strong>{score}</strong></span>
            <span>Streak <strong>{placementStreak}</strong></span>
          </div>
        </header>

        <section className="solo-now-playing">
          <div className="vinyl"><span>F</span></div>
          <div>
            <p className="eyebrow">SOLO · LISTENING</p>
            <h1>Where does it belong?</h1>
            <p className="muted">The song details stay hidden until you lock your placement.</p>
            <div className="button-row">
              <button className="button" onClick={() => void replayCurrent()}>↻ Play from start</button>
              <button className="button" onClick={() => void playerRef.current?.toggle()}>Play / pause</button>
            </div>
          </div>
        </section>

        <section className="solo-game-panel">
          <p className="eyebrow">YOUR TIMELINE</p>
          <PlacementTimeline cards={timeline} selectedSlot={selectedSlot} onSelect={setSelectedSlot} />
          <div className="solo-guess-grid">
            <label>
              <span>Song title <small>+25 · close spelling counts</small></span>
              <input value={titleGuess} onChange={(e: { target: { value: string } }) => setTitleGuess(e.target.value)} placeholder="Optional guess" autoComplete="off" />
            </label>
            <label>
              <span>Artist / band <small>+25 · first artist is enough</small></span>
              <input value={artistGuess} onChange={(e: { target: { value: string } }) => setArtistGuess(e.target.value)} placeholder="Optional guess" autoComplete="off" />
            </label>
          </div>
          <button className="button button--primary button--huge solo-lock" disabled={selectedSlot === null} onClick={() => void lockPlacement()}>
            Lock placement
          </button>
          {spotifyStatus && <p className="muted tiny">Spotify: {spotifyStatus}</p>}
          {error && <p className="error">{error}</p>}
        </section>
      </main>
    );
  }

  if (stage === "reveal" && reveal) {
    return (
      <main className="solo-shell solo-game-shell">
        <header className="solo-header">
          <Logo />
          <div className="solo-score-strip"><span>Score <strong>{score}</strong></span></div>
        </header>
        <section className={`solo-reveal ${reveal.placementCorrect ? "solo-reveal--correct" : "solo-reveal--wrong"}`}>
          <div className={`result-badge ${reveal.placementCorrect ? "result-badge--yes" : "result-badge--no"}`}>
            {reveal.placementCorrect ? "✓" : "×"}
          </div>
          <div className="solo-reveal-copy">
            <p className="eyebrow">{reveal.placementCorrect ? "CORRECT PLACEMENT" : "WRONG PLACEMENT"}</p>
            <div className="solo-reveal-year">{effectiveYear(reveal.track)}</div>
            <h1>{reveal.track.title}</h1>
            <h2>{reveal.track.artist}</h2>
            <p className="muted">{reveal.track.albumName}</p>
            <a href={reveal.track.spotifyUrl} target="_blank" rel="noreferrer" className="spotify-link">Open track in Spotify ↗</a>
          </div>
          <div className="solo-points-card">
            <h3>+{reveal.points.total}</h3>
            <div><span>Placement</span><strong>+{reveal.points.placement}</strong></div>
            <div><span>Title {reveal.titleCorrect ? "✓" : "×"}</span><strong>+{reveal.points.title}</strong></div>
            <div><span>Artist {reveal.artistCorrect ? "✓" : "×"}</span><strong>+{reveal.points.artist}</strong></div>
            <div><span>Streak bonus</span><strong>+{reveal.points.streak}</strong></div>
          </div>
        </section>
        <section className="solo-game-panel">
          <Timeline cards={timeline} />
          <button className="button button--primary button--huge solo-next" onClick={() => void nextRound()}>
            {remainingDeck.length === 0 ? "See final score" : "Next song"}
          </button>
        </section>
      </main>
    );
  }

  if (stage === "finished") {
    return (
      <main className="solo-shell solo-finished">
        <Logo large />
        <p className="eyebrow">SOLO SESSION COMPLETE</p>
        <div className="solo-final-score">{score}</div>
        <h1>points</h1>
        <p>Best for this playlist and session length: <strong>{bestScore}</strong></p>
        <div className="button-row">
          <button className="button button--primary button--huge" onClick={() => void startGame()}>Play again</button>
          <button className="button button--huge" onClick={() => void returnToSetup()}>Playlist setup</button>
          <Link className="button button--huge" to="/">Home</Link>
        </div>
      </main>
    );
  }

  return (
    <main className="solo-shell">
      <header className="solo-header">
        <div>
          <Logo />
          <p className="eyebrow solo-mode-label">SINGLE PLAYER</p>
        </div>
        <Link to="/" className="button">← Home</Link>
      </header>

      {!configured ? (
        <section className="solo-empty-card">
          <h1>Spotify isn't configured</h1>
          <p>Add <code>VITE_SPOTIFY_CLIENT_ID</code> to your phipster <code>.env</code>, rebuild, and restart the server.</p>
        </section>
      ) : !connected ? (
        <section className="solo-empty-card">
          <p className="eyebrow">STEP 1</p>
          <h1>Connect Spotify</h1>
          <p>Solo mode reads playlists from your Spotify account and uses the same browser as the playback device.</p>
          <button className="button button--primary button--huge" onClick={() => void beginSpotifyLogin("/solo")}>Connect Spotify</button>
        </section>
      ) : !playlistAccess ? (
        <section className="solo-empty-card">
          <p className="eyebrow">ONE-TIME PERMISSION UPDATE</p>
          <h1>Reconnect for playlist access</h1>
          <p>Your existing phipster Spotify login predates Solo mode. Reconnect once to grant read access to your private/collaborative playlists.</p>
          <button className="button button--primary button--huge" onClick={() => void reconnectSpotify()}>Reconnect Spotify</button>
        </section>
      ) : (
        <div className="solo-setup-grid">
          <section className="solo-panel solo-playlists-panel">
            <div className="solo-panel-heading">
              <div>
                <p className="eyebrow">STEP 1</p>
                <h1>Choose a playlist</h1>
              </div>
              <button className="button" onClick={() => void loadPlaylists()} disabled={playlistsLoading}>{playlistsLoading ? "Loading…" : "Refresh"}</button>
            </div>
            <p className="muted tiny">Spotify currently allows playlist-item reads for playlists you own or collaborate on, so phipster lists those here.</p>
            <div className="solo-playlist-list">
              {playlists.map((playlist) => (
                <button
                  key={playlist.id}
                  className={`solo-playlist ${selectedPlaylist?.id === playlist.id ? "solo-playlist--selected" : ""}`}
                  onClick={() => void selectPlaylist(playlist)}
                >
                  <strong>{playlist.name}</strong>
                  <span>{playlist.itemCount} items · {playlist.ownerName}</span>
                </button>
              ))}
              {!playlistsLoading && playlists.length === 0 && <p className="muted">No loadable playlists yet.</p>}
            </div>
          </section>

          <section className="solo-panel solo-audit-panel">
            {!selectedPlaylist ? (
              <div className="solo-placeholder">
                <p className="eyebrow">STEP 2</p>
                <h1>Review the years</h1>
                <p>Choose a playlist first. phipster will use Spotify's album release year by default.</p>
              </div>
            ) : tracksLoading ? (
              <div className="solo-placeholder"><h1>Loading {selectedPlaylist.name}…</h1></div>
            ) : (
              <>
                <div className="solo-panel-heading">
                  <div>
                    <p className="eyebrow">STEP 2 · RELEASE-YEAR CHECK</p>
                    <h1>{selectedPlaylist.name}</h1>
                    <p className="muted">{tracks.length} playable tracks · {correctedCount} corrected · {mismatchCount} flagged</p>
                  </div>
                  <a className="button" href={selectedPlaylist.spotifyUrl} target="_blank" rel="noreferrer">Spotify ↗</a>
                </div>

                <div className="audit-toolbar">
                  <button className="button" onClick={() => void auditAll()} disabled={Boolean(auditProgress) || tracks.length === 0}>
                    {auditProgress ? `Checking ${auditProgress.done}/${auditProgress.total}…` : "Check all with MusicBrainz"}
                  </button>
                  <button className="button" onClick={applyHighConfidenceFixes} disabled={!Object.values(audits).some((a) => a.status === "mismatch" && a.confidence === "high")}>Apply high-confidence fixes</button>
                </div>
                <p className="muted tiny">MusicBrainz asks API clients to stay at roughly one request per second. ISRC matches are treated as high confidence; text-only matches are never bulk-applied automatically.</p>

                <div className="audit-table-wrap">
                  <table className="audit-table">
                    <thead><tr><th>Track</th><th>Spotify</th><th>Game year</th><th>Check</th></tr></thead>
                    <tbody>
                      {tracks.map((track) => {
                        const audit = audits[track.id];
                        const checking = checkingIds.has(track.id);
                        return (
                          <tr key={track.id} className={audit?.status === "mismatch" ? "audit-row--mismatch" : ""}>
                            <td>
                              <strong>{track.title}</strong>
                              <small>{track.artist}</small>
                              {track.isrc && <small>ISRC {track.isrc}</small>}
                            </td>
                            <td><strong>{track.year}</strong></td>
                            <td>
                              <input
                                className="year-input"
                                type="number"
                                min={1800}
                                max={2200}
                                value={effectiveYear(track)}
                                onChange={(e: { target: { value: string } }) => updateTrackYear(track.id, Number(e.target.value))}
                                aria-label={`Game year for ${track.title}`}
                              />
                            </td>
                            <td>
                              {!audit ? (
                                <button className="text-button" disabled={checking} onClick={() => void checkOneTrack(track)}>{checking ? "Checking…" : "Check"}</button>
                              ) : (
                                <div className={`audit-result audit-result--${audit.status}`}>
                                  <strong>{audit.status === "match" ? "✓ Confirmed" : audit.status === "mismatch" ? `Suggest ${audit.suggestedYear}` : "? Uncertain"}</strong>
                                  <small>{audit.confidence} confidence</small>
                                  {audit.status === "mismatch" && audit.suggestedYear && (
                                    <button className="text-button" onClick={() => updateTrackYear(track.id, audit.suggestedYear!)}>Use {audit.suggestedYear}</button>
                                  )}
                                  {audit.musicBrainzId && <a href={`https://musicbrainz.org/recording/${audit.musicBrainzId}`} target="_blank" rel="noreferrer">MusicBrainz ↗</a>}
                                </div>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                <div className="solo-start-card">
                  <div>
                    <p className="eyebrow">STEP 3</p>
                    <h2>Start a scored run</h2>
                    <p className="muted">100 placement · 25 title · 25 artist · up to 100 streak bonus per round.</p>
                  </div>
                  <label>
                    <span>Rounds</span>
                    <select value={String(sessionLength)} onChange={(e: { target: { value: string } }) => {
                      const raw = e.target.value;
                      const next: SessionLength = raw === "all" ? "all" : Number(raw) as 10 | 20 | 30;
                      setSessionLength(next);
                      if (selectedPlaylist) setBestScore(loadBestScore(selectedPlaylist.id, sessionKey(next)));
                    }}>
                      <option value="10">10</option>
                      <option value="20">20</option>
                      <option value="30">30</option>
                      <option value="all">All available</option>
                    </select>
                  </label>
                  <div className="solo-best">Best <strong>{bestScore}</strong></div>
                  <button className="button button--primary button--huge" disabled={tracks.length < 3} onClick={() => void startGame()}>Start solo</button>
                </div>
              </>
            )}
          </section>
        </div>
      )}

      {spotifyStatus && <p className="muted tiny">{spotifyStatus}</p>}
      {error && <div className="toast-error">{error}</div>}
    </main>
  );
}
