import { useEffect, useMemo, useRef, useState } from "react";
import {
  beginSpotifyLogin,
  getMySpotifyPlaylists,
  getSpotifyPlaylistTracks,
  spotifyConfigured,
  spotifyConnected,
  spotifyHasPlaylistAccess,
  type SpotifyPlaylistSummary,
} from "../lib/spotify";
import {
  effectiveYear,
  loadCorrections,
  saveCorrections,
  type SoloTrack,
  type YearCheckResult,
} from "../lib/solo";
import { emitRequest } from "../lib/socket";
import type { Ack, RoomState } from "../types";

type Props = {
  state: RoomState;
  hostToken: string;
  minimumTracks: number;
  onError: (message: string) => void;
};

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : "Something went wrong";
}

export function MultiplayerPlaylistSetup({ state, hostToken, minimumTracks, onError }: Props) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const [playlists, setPlaylists] = useState<SpotifyPlaylistSummary[]>([]);
  const [playlistsLoading, setPlaylistsLoading] = useState(false);
  const [selectedPlaylist, setSelectedPlaylist] = useState<SpotifyPlaylistSummary | null>(null);
  const playlistRequest = useRef(0);
  useEffect(() => () => { playlistRequest.current += 1; }, []);
  const [tracks, setTracks] = useState<SoloTrack[]>([]);
  const [tracksLoading, setTracksLoading] = useState(false);
  const [audits, setAudits] = useState<Record<string, YearCheckResult>>({});
  const [checkingIds, setCheckingIds] = useState<Set<string>>(new Set());
  const [auditProgress, setAuditProgress] = useState<{ done: number; total: number } | null>(null);
  const [applying, setApplying] = useState(false);

  const correctedCount = useMemo(
    () => tracks.filter((track) => track.correctedYear && track.correctedYear !== track.year).length,
    [tracks],
  );
  const mismatchCount = useMemo(
    () => Object.values(audits).filter((audit) => audit.status === "mismatch").length,
    [audits],
  );
  const selectedIsActive = Boolean(
    selectedPlaylist
    && state.songSource.type === "spotify"
    && state.songSource.name === selectedPlaylist.name
    && state.songSource.trackCount === tracks.length,
  );

  useEffect(() => {
    if (pickerOpen && spotifyConnected() && spotifyHasPlaylistAccess() && playlists.length === 0 && !playlistsLoading) {
      void loadPlaylists();
    }
  }, [pickerOpen]); // eslint-disable-line react-hooks/exhaustive-deps

  async function loadPlaylists() {
    setPlaylistsLoading(true);
    onError("");
    try {
      setPlaylists(await getMySpotifyPlaylists());
    } catch (error) {
      onError(errorText(error));
    } finally {
      setPlaylistsLoading(false);
    }
  }

  async function selectPlaylist(playlist: SpotifyPlaylistSummary) {
    const request = ++playlistRequest.current;
    setTracks([]);
    setCheckingIds(new Set());
    setSelectedPlaylist(playlist);
    setTracksLoading(true);
    setAudits({});
    setAuditProgress(null);
    onError("");
    try {
      const spotifyTracks = await getSpotifyPlaylistTracks(playlist.id);
      if (request !== playlistRequest.current) return;
      const corrections = loadCorrections(playlist.id);
      setTracks(spotifyTracks.map((track) => ({
        ...track,
        correctedYear: corrections[track.id] && corrections[track.id] !== track.year
          ? corrections[track.id]
          : undefined,
      })));
    } catch (error) {
      if (request !== playlistRequest.current) return;
      setTracks([]);
      onError(errorText(error));
    } finally {
      if (request === playlistRequest.current) setTracksLoading(false);
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
    const request = playlistRequest.current;
    onError("");
    setCheckingIds((current) => new Set(current).add(track.id));
    try {
      const result = await requestYearCheck(track);
      if (request !== playlistRequest.current) return null;
      setAudits((current) => ({ ...current, [track.id]: result }));
      return result;
    } catch (error) {
      if (request !== playlistRequest.current) return null;
      onError(errorText(error));
      return null;
    } finally {
      if (request === playlistRequest.current) setCheckingIds((current) => {
        const next = new Set(current);
        next.delete(track.id);
        return next;
      });
    }
  }

  async function auditAll() {
    if (auditProgress) return;
    const request = playlistRequest.current;
    setAuditProgress({ done: 0, total: tracks.length });
    let done = 0;
    for (const track of tracks) {
      if (!audits[track.id]) await checkOneTrack(track);
      if (request !== playlistRequest.current) return;
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

  function useCatalog() {
    onError("");
    setApplying(true);
    emitRequest("host:set-song-source", {
      source: "catalog",
      code: state.code,
      hostToken,
    }, (ack: Ack<{ state: RoomState }>) => {
      setApplying(false);
      if (!ack.ok) onError(ack.error);
      else setPickerOpen(false);
    });
  }

  function usePlaylist() {
    if (!selectedPlaylist || tracks.length < 3) return;
    onError("");
    setApplying(true);
    emitRequest("host:set-song-source", {
      source: "spotify",
      code: state.code,
      hostToken,
      playlist: { id: selectedPlaylist.id, name: selectedPlaylist.name },
      tracks: tracks.map((track) => ({
        id: `spotify:${track.id}`,
        title: track.title,
        artist: track.artist,
        primaryArtist: track.artists[0] || null,
        year: effectiveYear(track),
        spotifyUri: track.spotifyUri,
      })),
    }, (ack: Ack<{ state: RoomState }>) => {
      setApplying(false);
      if (!ack.ok) onError(ack.error);
    });
  }

  return (
    <section className="multiplayer-source-panel">
      <div className="source-heading">
        <div>
          <p className="eyebrow">SONG SOURCE</p>
          <h2>{state.songSource.type === "spotify" ? state.songSource.name : "Built-in catalog"}</h2>
          <p className="muted">
            {state.songSource.trackCount} tracks ready
            {state.songSource.type === "spotify" ? " · Spotify playlist" : " · server catalog"}
          </p>
        </div>
        <div className="button-row">
          {state.songSource.type === "spotify" && <button className="button" disabled={applying} onClick={useCatalog}>Use catalog</button>}
          <button className="button button--primary" onClick={() => setPickerOpen((open) => !open)}>
            {pickerOpen ? "Close playlist picker" : state.songSource.type === "spotify" ? "Change playlist" : "Choose Spotify playlist"}
          </button>
        </div>
      </div>

      {state.songSource.trackCount < minimumTracks && (
        <p className="source-warning">This setup needs at least {minimumTracks} tracks before Phipster can start with the current players and win target.</p>
      )}

      {pickerOpen && (
        <div className="multiplayer-playlist-grid">
          <div className="multiplayer-playlist-list-panel">
            {!spotifyConfigured() ? (
              <p className="muted">Spotify is not configured on this Phipster installation.</p>
            ) : !spotifyConnected() ? (
              <div className="source-connect-card">
                <strong>Connect Spotify first</strong>
                <p className="muted tiny">Only the Display Host account needs Spotify.</p>
                <button className="button button--primary" onClick={() => void beginSpotifyLogin(`/display?room=${state.code}`)}>Connect Spotify</button>
              </div>
            ) : !spotifyHasPlaylistAccess() ? (
              <div className="source-connect-card">
                <strong>Playlist permission needed</strong>
                <p className="muted tiny">Reconnect Spotify once to grant playlist-read access.</p>
                <button className="button button--primary" onClick={() => void beginSpotifyLogin(`/display?room=${state.code}`)}>Reconnect Spotify</button>
              </div>
            ) : (
              <>
                <div className="source-subheading"><strong>Your playlists</strong><button className="text-button" disabled={playlistsLoading} onClick={() => void loadPlaylists()}>{playlistsLoading ? "Loading…" : "Refresh"}</button></div>
                <p className="muted tiny">Phipster can load playlists you own or collaborate on.</p>
                <div className="solo-playlist-list multiplayer-playlist-list">
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
                  {!playlistsLoading && playlists.length === 0 && <p className="muted">No loadable playlists found.</p>}
                </div>
              </>
            )}
          </div>

          <div className="multiplayer-playlist-audit">
            {!selectedPlaylist ? (
              <div className="source-placeholder"><strong>Select a playlist</strong><p className="muted tiny">You can review/correct release years before making it the room's deck.</p></div>
            ) : tracksLoading ? (
              <div className="source-placeholder"><strong>Loading {selectedPlaylist.name}…</strong></div>
            ) : (
              <>
                <div className="source-subheading">
                  <div><strong>{selectedPlaylist.name}</strong><small>{tracks.length} playable · {correctedCount} corrected · {mismatchCount} flagged</small></div>
                  <a className="text-button" href={selectedPlaylist.spotifyUrl} target="_blank" rel="noreferrer">Spotify ↗</a>
                </div>
                <div className="audit-toolbar">
                  <button className="button" disabled={Boolean(auditProgress) || tracks.length === 0} onClick={() => void auditAll()}>
                    {auditProgress ? `Checking ${auditProgress.done}/${auditProgress.total}…` : "Check years"}
                  </button>
                  <button className="button" disabled={!Object.values(audits).some((audit) => audit.status === "mismatch" && audit.confidence === "high")} onClick={applyHighConfidenceFixes}>Apply safe fixes</button>
                </div>
                <div className="audit-table-wrap multiplayer-audit-table-wrap">
                  <table className="audit-table">
                    <thead><tr><th>Track</th><th>Spotify</th><th>Game year</th><th>Check</th></tr></thead>
                    <tbody>
                      {tracks.map((track) => {
                        const audit = audits[track.id];
                        const checking = checkingIds.has(track.id);
                        return (
                          <tr key={track.id} className={audit?.status === "mismatch" ? "audit-row--mismatch" : ""}>
                            <td><strong>{track.title}</strong><small>{track.artist}</small></td>
                            <td><strong>{track.year}</strong></td>
                            <td><input className="year-input" type="number" min={1800} max={2200} value={effectiveYear(track)} onChange={(event: { target: { value: string } }) => updateTrackYear(track.id, Number(event.target.value))} /></td>
                            <td>
                              {!audit ? (
                                <button className="text-button" disabled={checking} onClick={() => void checkOneTrack(track)}>{checking ? "Checking…" : "Check"}</button>
                              ) : (
                                <div className={`audit-result audit-result--${audit.status}`}>
                                  <strong>{audit.status === "match" ? "✓ Confirmed" : audit.status === "mismatch" ? `Suggest ${audit.suggestedYear}` : "? Uncertain"}</strong>
                                  <small>{audit.confidence} confidence</small>
                                  {audit.status === "mismatch" && audit.suggestedYear && <button className="text-button" onClick={() => updateTrackYear(track.id, audit.suggestedYear!)}>Use {audit.suggestedYear}</button>}
                                </div>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                <div className="source-apply-row">
                  <div>
                    <strong>{tracks.length >= minimumTracks ? "Ready for this room" : `Need at least ${minimumTracks} tracks`}</strong>
                    <small>Changes are copied to the server only when you apply the playlist.</small>
                  </div>
                  <button className="button button--primary" disabled={applying || tracks.length < minimumTracks} onClick={usePlaylist}>
                    {applying ? "Applying…" : selectedIsActive ? "Re-apply corrections" : "Use this playlist"}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
