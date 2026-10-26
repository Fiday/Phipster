import { useEffect, useMemo, useRef, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { Logo } from "../components/Logo";
import { LiveTimeline, Timeline, TokenCount } from "../components/Timeline";
import { MultiplayerPlaylistSetup } from "../components/MultiplayerPlaylistSetup";
import { useRoomState } from "../hooks/useRoomState";
import { socket } from "../lib/socket";
import { keys } from "../lib/storage";
import {
  beginSpotifyLogin,
  phipsterSpotifyPlayer,
  disconnectSpotify,
  spotifyConfigured,
  spotifyConnected,
} from "../lib/spotify";
import type { Ack, GameMode, PrivateTrack, RoomState } from "../types";

export function Display() {
  const [state, setState] = useRoomState();
  const [hostToken, setHostToken] = useState(localStorage.getItem(keys.hostToken) || "");
  const [error, setError] = useState("");
  const [winTarget, setWinTarget] = useState(10);
  const [tokensEnabled, setTokensEnabled] = useState(true);
  const [gameMode, setGameMode] = useState<GameMode>("individual");
  const [track, setTrack] = useState<PrivateTrack | null>(null);
  const [spotifyReady, setSpotifyReady] = useState(false);
  const [spotifyStatus, setSpotifyStatus] = useState(spotifyConnected() ? "Connected; enable player" : "Not connected");
  const playerRef = useRef<phipsterSpotifyPlayer | null>(null);
  const lastPlayedRound = useRef<number | null>(null);

  const joinUrl = useMemo(() => state ? `${window.location.origin}/join/${state.code}` : "", [state]);
  const current = state?.players.find((p) => p.id === state.currentPlayerId) || null;
  const winner = state?.players.find((p) => p.id === state.winnerId) || null;
  const minimumTracks = state ? state.players.length + Math.max(10, winTarget) : Math.max(10, winTarget);

  function createRoom() {
    setError("");
    socket.emit("room:create", {}, (ack: Ack<{ code: string; hostToken: string; state: RoomState }>) => {
      if (!ack.ok) return setError(ack.error);
      setHostToken(ack.data.hostToken);
      setState(ack.data.state);
      localStorage.setItem(keys.hostRoom, ack.data.code);
      localStorage.setItem(keys.hostToken, ack.data.hostToken);
      history.replaceState(null, "", `/display?room=${ack.data.code}`);
    });
  }

  function attachSavedRoom() {
    const code = new URLSearchParams(window.location.search).get("room") || localStorage.getItem(keys.hostRoom);
    const token = localStorage.getItem(keys.hostToken);
    if (!code || !token) return createRoom();
    socket.emit("host:attach", { code, hostToken: token }, (ack: Ack<{ state: RoomState }>) => {
      if (!ack.ok) {
        localStorage.removeItem(keys.hostRoom);
        localStorage.removeItem(keys.hostToken);
        return createRoom();
      }
      setHostToken(token);
      setState(ack.data.state);
      history.replaceState(null, "", `/display?room=${code}`);
    });
  }

  useEffect(() => {
    attachSavedRoom();
    const onConnect = () => {
      const code = localStorage.getItem(keys.hostRoom);
      const token = localStorage.getItem(keys.hostToken);
      if (code && token) socket.emit("host:attach", { code, hostToken: token }, () => undefined);
    };
    socket.on("connect", onConnect);
    return () => { socket.off("connect", onConnect); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const handler = (next: PrivateTrack) => setTrack(next);
    socket.on("host:track", handler);
    return () => { socket.off("host:track", handler); };
  }, []);

  useEffect(() => {
    if (!state || !hostToken) return;
    if (state.phase === "waiting") {
      socket.emit("host:request-track", { code: state.code, hostToken }, () => undefined);
    }
  }, [state?.round, state?.phase, state?.code, hostToken]);

  useEffect(() => {
    if (!spotifyReady || !track?.spotifyUri || lastPlayedRound.current === track.round || state?.phase !== "waiting") return;
    playerRef.current?.playUri(track.spotifyUri)
      .then(() => {
        lastPlayedRound.current = track.round;
        setSpotifyStatus(`Playing round ${track.round}`);
      })
      .catch((e) => setSpotifyStatus(e instanceof Error ? e.message : "Could not start Spotify playback"));
  }, [track, spotifyReady, state?.phase]);

  useEffect(() => {
    if (state?.phase && state.phase !== "waiting") {
      playerRef.current?.pause().catch(() => undefined);
    }
  }, [state?.phase]);

  async function enableSpotify() {
    try {
      setSpotifyStatus("Starting Spotify player…");
      const player = new phipsterSpotifyPlayer();
      playerRef.current?.destroy();
      playerRef.current = player;
      await player.init(setSpotifyStatus);
      setSpotifyReady(true);
      setSpotifyStatus("Spotify player ready");
    } catch (e) {
      setSpotifyStatus(e instanceof Error ? e.message : "Spotify failed to start");
    }
  }

  function startGame() {
    if (!state) return;
    setError("");
    socket.emit("game:start", { code: state.code, hostToken, winTarget, tokensEnabled, gameMode }, (ack: Ack) => {
      if (!ack.ok) setError(ack.error);
    });
  }

  function hostStartSong() {
    if (!state) return;
    setError("");
    socket.emit("host:start-song", { code: state.code, hostToken }, (ack: Ack) => {
      if (!ack.ok) setError(ack.error);
    });
  }

  function revealPlacement() {
    if (!state) return;
    setError("");
    socket.emit("game:reveal", { code: state.code, hostToken }, (ack: Ack) => {
      if (!ack.ok) setError(ack.error);
    });
  }

  function nextRound() {
    if (!state) return;
    socket.emit("game:next", { code: state.code, hostToken }, (ack: Ack) => {
      if (!ack.ok) setError(ack.error);
    });
  }

  function restart() {
    if (!state) return;
    socket.emit("game:restart", { code: state.code, hostToken }, (ack: Ack) => {
      if (!ack.ok) setError(ack.error);
      else {
        lastPlayedRound.current = null;
        setTrack(null);
      }
    });
  }

  if (!state) {
    return <main className="center-screen"><Logo large /><p>Creating room…</p>{error && <p className="error">{error}</p>}</main>;
  }

  if (state.phase === "lobby") {
    return (
      <main className="display-shell">
        <header className="display-header"><Logo /><div className="room-chip">ROOM <strong>{state.code}</strong></div></header>
        <section className="lobby-grid">
          <div className="qr-panel">
            <h1>Scan to join</h1>
            <div className="qr-wrap"><QRCodeSVG value={joinUrl} size={260} bgColor="#fff8e8" fgColor="#17120d" /></div>
            <code>{joinUrl}</code>
          </div>
          <div className="lobby-controls">
            <div>
              <p className="eyebrow">PLAYERS / TEAMS</p>
              <div className="player-list">
                {state.players.length === 0 && <p className="muted">Waiting for participants…</p>}
                {state.players.map((p, i) => <div className="player-row" key={p.id}><span>{i + 1}</span><strong>{p.name}</strong><i className={p.connected ? "online" : "offline"} /></div>)}
              </div>
            </div>
            <div className="host-settings">
              <label>Cards to win <input type="number" min={2} max={30} value={winTarget} onChange={(e) => setWinTarget(Number(e.target.value))} /></label>
              <label>Play as
                <select value={gameMode} onChange={(e) => setGameMode(e.target.value as GameMode)}>
                  <option value="individual">Individuals</option>
                  <option value="team">Teams (one phone per team)</option>
                </select>
              </label>
              <label className="toggle-row">
                <span><strong>FIDSTER tokens</strong><small>2 starting; max 5 · everyone can guess every song</small></span>
                <input type="checkbox" checked={tokensEnabled} onChange={(e) => setTokensEnabled(e.target.checked)} />
              </label>
              <div className="spotify-box">
                <strong>Spotify</strong>
                {!spotifyConfigured() ? (
                  <p className="muted">Not configured. Add VITE_SPOTIFY_CLIENT_ID to enable audio.</p>
                ) : spotifyConnected() ? (
                  <div className="button-row"><button className="button" onClick={enableSpotify}>{spotifyReady ? "Player ready" : "Enable player"}</button><button className="text-button" onClick={() => { disconnectSpotify(); setSpotifyReady(false); setSpotifyStatus("Not connected"); }}>Disconnect</button></div>
                ) : (
                  <button className="button" onClick={() => beginSpotifyLogin(`/display?room=${state.code}`)}>Connect Spotify</button>
                )}
                <small>{spotifyStatus}</small>
              </div>
              <button className="button button--primary button--huge" disabled={state.players.length < 1 || state.songSource.trackCount < minimumTracks} onClick={startGame}>Start game</button>
              <p className="muted tiny">The oldest randomly dealt starter card determines who starts. In Team mode, each connected phone represents one team.</p>
              <p className="muted tiny">Song pool: {state.songSource.trackCount} tracks · {state.songSource.type === "spotify" ? `Spotify · ${state.songSource.name}` : "built-in catalog"}.</p>
              {error && <p className="error">{error}</p>}
            </div>
          </div>
        </section>
        <MultiplayerPlaylistSetup state={state} hostToken={hostToken} minimumTracks={minimumTracks} onError={setError} />
      </main>
    );
  }

  if (state.phase === "gameover") {
    return (
      <main className="display-shell celebration">
        <header className="display-header"><Logo /><div className="room-chip">ROOM <strong>{state.code}</strong></div></header>
        <section className="winner-panel">
          <p className="eyebrow">WINNER</p>
          <div className="trophy">★</div>
          <h1>{winner?.name || "Winner"}</h1>
          <p>{winner?.timeline.length} songs in the timeline</p>
          {state.tokensEnabled && winner && <TokenCount count={winner.tokens} />}
          {winner && <Timeline cards={winner.timeline} />}
          <button className="button button--primary" onClick={restart}>Play again</button>
        </section>
      </main>
    );
  }

  const reveal = state.reveal;
  const phaseLabel = state.phase === "prelisten" ? "BEFORE LISTENING" : state.phase === "challenge" ? "FIDSTER WINDOW" : state.phase === "reveal" ? "REVEAL" : "NOW PLAYING";

  return (
    <main className="display-shell">
      <header className="display-header">
        <Logo />
        <div className="round-title">ROUND {state.round} · {state.gameMode === "team" ? "TEAMS" : "INDIVIDUAL"}{state.tokensEnabled ? " · TOKENS ON" : " · SIMPLE MODE"} · {state.songSource.type === "spotify" ? state.songSource.name : "CATALOG"}</div>
        <div className="room-chip">ROOM <strong>{state.code}</strong></div>
      </header>

      <section className={`now-playing ${state.phase === "challenge" ? "now-playing--challenge" : ""}`}>
        {state.phase === "prelisten" ? (
          <>
            <div className="vinyl vinyl--paused"><span>♪</span></div>
            <div className="reveal-copy">
              <p className="eyebrow">{phaseLabel}</p>
              <h1>{current?.name}'s turn</h1>
              <p>{state.tokensEnabled && current && current.tokens >= 3 ? "They may exchange 3 tokens for the card before hearing it, or start the song." : "Waiting for the active player to start the song."}</p>
              {state.notice && <p className="host-notice">{state.notice}</p>}
            </div>
            <button className="button button--primary next-button" onClick={hostStartSong}>Start song</button>
          </>
        ) : state.phase === "waiting" ? (
          <>
            <div className="vinyl"><span>♪</span></div>
            <div className="reveal-copy"><p className="eyebrow">{phaseLabel}</p><h1>{current?.name}'s turn</h1><p>{track?.hasSpotifyAudio ? (spotifyReady ? spotifyStatus : "Enable Spotify player in this browser session") : "No Spotify URI for this catalog entry"}</p>{state.tokensEnabled && <p className="guess-progress">{state.guessSubmittedPlayerIds.length}/{state.players.length} song + artist guesses submitted</p>}</div>
            {state.tokensEnabled && current && <TokenCount count={current.tokens} />}
          </>
        ) : state.phase === "challenge" ? (
          <>
            <div className="result-badge result-badge--display result-badge--hitster">F</div>
            <div className="reveal-copy">
              <p className="eyebrow">{phaseLabel}</p>
              <h1>{current?.name} locked it.</h1>
              <p>{state.challenges.length === 0 ? "Opponents can now call FIDSTER on an alternate slot." : `${state.challenges.length} FIDSTER token${state.challenges.length === 1 ? "" : "s"} placed. No two claims can use the same slot.`}</p>
              {state.tokensEnabled && <p className="guess-progress">{state.guessSubmittedPlayerIds.length}/{state.players.length} song + artist guesses submitted</p>}
              {state.notice && <p className="host-notice">{state.notice}</p>}
            </div>
            <button className="button button--primary next-button" onClick={revealPlacement}>Reveal placement</button>
          </>
        ) : reveal ? (
          <>
            <div className={`result-badge result-badge--display ${reveal.outcome === "discarded" ? "result-badge--no" : "result-badge--yes"}`}>
              {reveal.outcome === "discarded" ? "×" : reveal.outcome === "stolen" ? "P" : "✓"}
            </div>
            <div className="reveal-copy">
              <p className="eyebrow">
                {reveal.outcome === "stolen" ? "FIDSTER STEAL" : reveal.outcome === "purchased" ? "3-TOKEN EXCHANGE" : reveal.correct ? "CORRECT" : "INCORRECT"}
              </p>
              <h1>{reveal.song.title}</h1>
              <p>{reveal.song.artist}</p>
              {state.notice && <p className="host-notice">{state.notice}</p>}
              {reveal.guesses.length > 0 && (
                <div className="display-guess-results">
                  {reveal.guesses.map((guess) => (
                    <span className="guess-reveal-line" key={guess.playerId}>
                      {guess.playerName}: {guess.correct ? guess.awarded ? "correct, +1 token" : "correct, already at max" : "incorrect"}
                    </span>
                  ))}
                </div>
              )}
            </div>
            <div className="reveal-year">{reveal.song.year}</div>
            <button className="button button--primary next-button" onClick={nextRound}>{winner ? "Finish" : "Next turn"}</button>
          </>
        ) : null}
      </section>

      {(state.phase === "waiting" || state.phase === "challenge") && current && (
        <section className="live-placement-panel">
          <div className="live-placement-heading">
            <div>
              <p className="eyebrow">{state.phase === "challenge" ? "LOCKED PLACEMENT" : "LIVE PLACEMENT"}</p>
              <h2>{state.phase === "challenge" ? "FIDSTER claims appear on the timeline" : `Watch ${current.name}'s choice move before lock-in`}</h2>
            </div>
            {state.phase === "waiting" && <span className="live-indicator"><i /> LIVE</span>}
          </div>
          <LiveTimeline
            cards={current.timeline}
            previewSlot={state.currentPlacementSlot}
            locked={state.phase === "challenge"}
            challenges={state.challenges}
          />
        </section>
      )}

      {state.phase === "reveal" && reveal?.challenges && reveal.challenges.length > 0 && (
        <section className="display-challenge-results">
          {reveal.challenges.map((challenge) => (
            <div key={challenge.challengerId} className={challenge.won ? "display-challenge-result display-challenge-result--winner" : "display-challenge-result"}>
              <span className="token-dot">F</span>
              <strong>#{challenge.order} {challenge.challengerName}</strong>
              <span>slot {challenge.slot + 1}</span>
              <b>{challenge.won ? "STEALS THE CARD" : reveal.correct ? "token lost — original placement was valid" : challenge.correct ? "valid slot, but an earlier valid claim wins" : "wrong slot"}</b>
            </div>
          ))}
        </section>
      )}

      <section className="scoreboard">
        {state.players.map((p) => (
          <div className={`score-row ${p.id === state.currentPlayerId ? "score-row--active" : ""}`} key={p.id}>
            <div className="score-name">
              <span className={p.connected ? "connection-dot" : "connection-dot connection-dot--off"} />
              <strong>{p.name}</strong>
              <small>{p.timeline.length}/{state.winTarget}</small>
            </div>
            <div className="score-meta">
              {state.tokensEnabled && <TokenCount count={p.tokens} compact />}
              {p.skipTurns > 0 && <span className="skip-badge">SKIP NEXT</span>}
            </div>
            <Timeline cards={p.timeline} compact />
          </div>
        ))}
      </section>
      {error && <div className="toast-error">{error}</div>}
    </main>
  );
}
