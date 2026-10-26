import { FormEvent, useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Logo } from "../components/Logo";
import { LiveTimeline, PlacementTimeline, Timeline, TokenCount } from "../components/Timeline";
import { useRoomState } from "../hooks/useRoomState";
import { socket } from "../lib/socket";
import { keys } from "../lib/storage";
import type { Ack, RoomState } from "../types";

export function Join() {
  const params = useParams();
  const navigate = useNavigate();
  const code = (params.code || "").toUpperCase();
  const [name, setName] = useState(localStorage.getItem(keys.playerName) || "");
  const [playerId, setPlayerId] = useState<string | null>(
    localStorage.getItem(keys.playerCode) === code ? localStorage.getItem(keys.playerId) : null,
  );
  const [state, setState] = useRoomState();
  const [selectedSlot, setSelectedSlot] = useState<number | null>(null);
  const [challengeSlot, setChallengeSlot] = useState<number | null>(null);
  const [guessTitle, setGuessTitle] = useState("");
  const [guessArtist, setGuessArtist] = useState("");
  const [guessFeedback, setGuessFeedback] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const me = useMemo(() => state?.players.find((p) => p.id === playerId) || null, [state, playerId]);
  const current = state?.players.find((p) => p.id === state.currentPlayerId) || null;
  const isMyTurn = Boolean(me && state?.currentPlayerId === me.id && state.phase !== "lobby" && state.phase !== "gameover");
  const myChallenge = state?.challenges.find((challenge) => challenge.challengerId === me?.id) || null;
  const entityWord = state?.gameMode === "team" ? "team" : "player";

  function joinRoom(joinName: string, reconnect = false) {
    setBusy(true);
    setError("");
    const reconnectToken = reconnect && localStorage.getItem(keys.playerCode) === code
      ? localStorage.getItem(keys.playerReconnect) || undefined
      : undefined;
    socket.emit("player:join", { code, name: joinName, reconnectToken }, (ack: Ack<{ playerId: string; reconnectToken: string; state: RoomState }>) => {
      setBusy(false);
      if (!ack.ok) {
        setError(ack.error);
        if (reconnect) setPlayerId(null);
        return;
      }
      setPlayerId(ack.data.playerId);
      setState(ack.data.state);
      localStorage.setItem(keys.playerCode, code);
      localStorage.setItem(keys.playerId, ack.data.playerId);
      localStorage.setItem(keys.playerReconnect, ack.data.reconnectToken);
      localStorage.setItem(keys.playerName, joinName);
    });
  }

  useEffect(() => {
    const savedName = localStorage.getItem(keys.playerName);
    const savedId = localStorage.getItem(keys.playerId);
    if (savedName && savedId && localStorage.getItem(keys.playerCode) === code) {
      joinRoom(savedName, true);
    }
    const onConnect = () => {
      const reconnectName = localStorage.getItem(keys.playerName);
      if (reconnectName && localStorage.getItem(keys.playerCode) === code) joinRoom(reconnectName, true);
    };
    socket.on("connect", onConnect);
    return () => { socket.off("connect", onConnect); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code]);

  useEffect(() => {
    setSelectedSlot(null);
    setChallengeSlot(null);
    setGuessTitle("");
    setGuessArtist("");
    setGuessFeedback("");
  }, [state?.round]);

  useEffect(() => {
    if (isMyTurn && state?.currentPlacementSlot !== null && state?.currentPlacementSlot !== undefined) {
      setSelectedSlot(state.currentPlacementSlot);
    }
  }, [isMyTurn, state?.currentPlacementSlot]);

  useEffect(() => {
    if (challengeSlot === null || !state) return;
    const unavailable = state.currentPlacementSlot === challengeSlot || state.challenges.some((challenge) => challenge.slot === challengeSlot);
    if (unavailable) setChallengeSlot(null);
  }, [challengeSlot, state]);

  function submit(e: FormEvent) {
    e.preventDefault();
    if (name.trim()) joinRoom(name.trim());
  }

  function emitSimple(event: string, payload: object) {
    setBusy(true);
    setError("");
    socket.emit(event, payload, (ack: Ack) => {
      setBusy(false);
      if (!ack.ok) setError(ack.error);
    });
  }

  function startSong() {
    if (!me) return;
    emitSimple("player:start-song", { code, playerId: me.id });
  }

  function buyCard() {
    if (!me) return;
    if (!window.confirm("Exchange 3 tokens for this card without listening? You will skip your next turn.")) return;
    emitSimple("player:buy-card", { code, playerId: me.id });
  }

  function skipSong() {
    if (!me) return;
    if (!window.confirm("Spend 1 token to discard this song and draw a new one?")) return;
    emitSimple("player:skip", { code, playerId: me.id });
  }

  function preview(slot: number) {
    if (!me) return;
    setSelectedSlot(slot);
    setError("");
    socket.emit("player:preview", { code, playerId: me.id, slot }, (ack: Ack) => {
      if (!ack.ok) setError(ack.error);
    });
  }

  function lock() {
    if (!me || selectedSlot === null) return;
    emitSimple("player:lock", { code, playerId: me.id, slot: selectedSlot });
  }

  function submitGuess(e: FormEvent) {
    e.preventDefault();
    if (!me || !guessTitle.trim() || !guessArtist.trim()) return;
    setBusy(true);
    setError("");
    socket.emit(
      "player:guess",
      { code, playerId: me.id, title: guessTitle.trim(), artist: guessArtist.trim() },
      (ack: Ack<{ correct: boolean; awarded: boolean; tokens: number }>) => {
        setBusy(false);
        if (!ack.ok) {
          setError(ack.error);
          return;
        }
        if (ack.data.correct) {
          setGuessFeedback(ack.data.awarded ? "Correct — you earned 1 token!" : "Correct — you're already at the 5-token maximum.");
        } else {
          setGuessFeedback("That title + artist did not match the catalog entry.");
        }
      },
    );
  }

  function callHitster() {
    if (!me || challengeSlot === null) return;
    if (!window.confirm("Spend 1 token and lock this FIDSTER challenge? It cannot be moved afterwards.")) return;
    setBusy(true);
    setError("");
    socket.emit("player:hitster", { code, playerId: me.id, slot: challengeSlot }, (ack: Ack) => {
      setBusy(false);
      if (!ack.ok) setError(ack.error);
      else setChallengeSlot(null);
    });
  }

  if (!playerId || !me || !state) {
    return (
      <main className="phone-shell">
        <Logo />
        <section className="phone-card">
          <p className="eyebrow">ROOM {code}</p>
          <h1>Join Phipster</h1>
          <form onSubmit={submit} className="stack">
            <label>Your player / team name</label>
            <input autoFocus value={name} onChange={(e) => setName(e.target.value)} maxLength={30} placeholder="e.g. Anna or Team Disco" />
            <button className="button button--primary" disabled={busy || !name.trim()}>{busy ? "Joining…" : "Join game"}</button>
          </form>
          {error && <p className="error">{error}</p>}
          <button className="text-button" onClick={() => navigate("/")}>Back</button>
        </section>
      </main>
    );
  }

  const phoneHeader = (
    <div className="phone-header">
      <div><p className="eyebrow">ROUND {state.round} · {state.songSource.type === "spotify" ? state.songSource.name : "FIDSTER CATALOG"}</p><h1>{isMyTurn ? "Your turn" : `${current?.name || "Player"}'s turn`}</h1></div>
      <div className="phone-stats">
        {state.tokensEnabled && <TokenCount count={me.tokens} />}
        <div className="score-pill">{me.timeline.length}/{state.winTarget}</div>
      </div>
    </div>
  );

  const hasSubmittedGuess = state.guessSubmittedPlayerIds.includes(me.id);
  const guessPanel = state.tokensEnabled && (state.phase === "waiting" || state.phase === "challenge") ? (
    <form className="guess-form" onSubmit={submitGuess}>
      <p className="eyebrow">GUESS FOR A TOKEN</p>
      <p className="muted tiny">Everyone may guess on every turn. Close spelling counts, and the first artist is enough on collaborations. One guess per song, maximum 5 tokens.</p>
      <input disabled={hasSubmittedGuess || busy} value={guessTitle} onChange={(e) => setGuessTitle(e.target.value)} placeholder="Song title" maxLength={200} />
      <input disabled={hasSubmittedGuess || busy} value={guessArtist} onChange={(e) => setGuessArtist(e.target.value)} placeholder="Artist / band" maxLength={200} />
      <button className="button" disabled={hasSubmittedGuess || busy || !guessTitle.trim() || !guessArtist.trim()}>
        {hasSubmittedGuess ? "Guess submitted" : "Submit song + artist"}
      </button>
      {guessFeedback && <div className="guess-feedback">{guessFeedback}</div>}
    </form>
  ) : null;

  if (state.phase === "lobby") {
    return (
      <main className="phone-shell">
        <Logo />
        <section className="phone-card center-copy">
          <p className="eyebrow">ROOM {code}</p>
          <h1>You're in, {me.name}.</h1>
          <div className="pulse-disc">♪</div>
          <p>Waiting for the display host to start the game.</p>
          <p className="muted">{state.players.length} participant{state.players.length === 1 ? "" : "s"} connected</p>
          <p className="muted tiny">Song pool: {state.songSource.type === "spotify" ? `Spotify · ${state.songSource.name}` : "Phipster catalog"} · {state.songSource.trackCount} tracks</p>
        </section>
      </main>
    );
  }

  if (state.phase === "gameover") {
    const winner = state.players.find((p) => p.id === state.winnerId);
    return (
      <main className="phone-shell">
        <Logo />
        <section className="phone-card center-copy">
          <p className="eyebrow">GAME OVER</p>
          <h1>{winner?.id === me.id ? "You won!" : `${winner?.name || "Someone"} wins!`}</h1>
          {state.tokensEnabled && <div className="center-token"><TokenCount count={me.tokens} /></div>}
          <Timeline cards={me.timeline} />
          <p>{me.timeline.length} / {state.winTarget} songs</p>
        </section>
      </main>
    );
  }

  if (state.phase === "reveal" && state.reveal) {
    const reveal = state.reveal;
    const stolenByMe = reveal.challengeWinnerId === me.id;
    const wasMyTurn = reveal.playerId === me.id;
    const myGuess = reveal.guesses.find((guess) => guess.playerId === me.id) || null;
    let headline = reveal.correct ? "Correct" : "Not quite";
    let detail = reveal.correct ? `${reveal.playerName} keeps the card.` : "The card is discarded.";
    if (reveal.outcome === "stolen") {
      headline = stolenByMe ? "You stole it!" : "FIDSTER steal!";
      detail = `${reveal.challengeWinnerName} found the correct spot and steals the card.`;
    } else if (reveal.outcome === "purchased") {
      headline = wasMyTurn ? "Card added" : "3-token exchange";
      detail = `${reveal.playerName} bought the card and will skip their next turn.`;
    }

    return (
      <main className="phone-shell">
        <Logo />
        <section className="phone-card center-copy reveal-card">
          <div className="phone-header reveal-phone-header">
            <p className="eyebrow">REVEAL</p>
            {state.tokensEnabled && <TokenCount count={me.tokens} />}
          </div>
          <div className={`result-badge ${reveal.outcome === "discarded" ? "result-badge--no" : "result-badge--yes"}`}>
            {reveal.outcome === "discarded" ? "×" : reveal.outcome === "stolen" ? "P" : "✓"}
          </div>
          <h1>{headline}</h1>
          <div className="big-year">{reveal.song.year}</div>
          <h2>{reveal.song.title}</h2>
          <p>{reveal.song.artist}</p>
          <p className="muted">{detail}</p>
          {myGuess && (
            <div className={`guess-result ${myGuess.correct ? "guess-result--yes" : ""}`}>
              {myGuess.correct
                ? myGuess.awarded ? "Your song + artist guess was correct: +1 token" : "Your song + artist guess was correct; you were already at the token cap"
                : "Your song + artist guess was incorrect"}
            </div>
          )}
          {reveal.challenges.length > 0 && (
            <div className="challenge-summary">
              {reveal.challenges.map((challenge) => (
                <div key={challenge.challengerId} className={challenge.won ? "challenge-summary--winner" : ""}>
                  <span className="token-dot">F</span>
                  <span>{challenge.challengerName}</span>
                  <strong>{challenge.won ? "STEALS" : reveal.correct ? "token lost" : challenge.correct ? "valid spot" : "wrong spot"}</strong>
                </div>
              ))}
            </div>
          )}
          <Timeline cards={me.timeline} />
        </section>
      </main>
    );
  }

  if (state.phase === "prelisten") {
    return (
      <main className="phone-shell">
        <Logo />
        <section className="phone-card">
          {phoneHeader}
          {state.notice && <div className="notice-banner">{state.notice}</div>}
          {isMyTurn ? (
            <>
              <div className="decision-panel">
                <p className="eyebrow">BEFORE LISTENING</p>
                <h2>Choose before the music starts.</h2>
                <p className="muted">Start the song normally, or use the 3-token exchange before hearing any of it.</p>
                {state.tokensEnabled && (
                  <button className="button token-action" disabled={busy || me.tokens < 3} onClick={buyCard}>
                    <span className="token-dot">F</span>
                    Exchange 3 tokens for this card
                  </button>
                )}
                <button className="button button--primary button--lock" disabled={busy} onClick={startSong}>
                  {busy ? "Starting…" : "Start song"}
                </button>
              </div>
              <Timeline cards={me.timeline} />
            </>
          ) : (
            <div className="waiting-panel">
              <div className="pulse-disc pulse-disc--paused">♪</div>
              <p>{current?.name} is deciding whether to start the song or use 3 tokens.</p>
              <Timeline cards={me.timeline} />
            </div>
          )}
          {error && <p className="error">{error}</p>}
        </section>
      </main>
    );
  }

  if (state.phase === "challenge") {
    const lockedSlot = state.currentPlacementSlot;
    return (
      <main className="phone-shell">
        <Logo />
        <section className="phone-card">
          {phoneHeader}
          {state.notice && <div className="notice-banner notice-banner--hitster">{state.notice}</div>}
          {isMyTurn ? (
            <>
              <p className="eyebrow">PLACEMENT LOCKED</p>
              <h2>Opponents can call FIDSTER now.</h2>
              <p className="muted">Your placement cannot be moved. The Display Host reveals after everyone has had a chance to challenge.</p>
              <LiveTimeline cards={me.timeline} previewSlot={lockedSlot} locked challenges={state.challenges} />
              {state.challenges.length > 0 && <p className="muted">{state.challenges.length} FIDSTER token{state.challenges.length === 1 ? "" : "s"} placed.</p>}
            </>
          ) : current ? (
            <>
              <p className="eyebrow">CALL FIDSTER?</p>
              <h2>{current.name} locked this placement.</h2>
              <p className="muted">If you think it is wrong, choose the slot where you think the song really belongs. Each slot can be claimed only once.</p>
              <PlacementTimeline
                cards={current.timeline}
                selectedSlot={challengeSlot}
                onSelect={setChallengeSlot}
                disabled={busy || Boolean(myChallenge) || me.tokens < 1}
                lockedSlot={lockedSlot}
                challenges={state.challenges}
                challengeMode
              />
              {myChallenge ? (
                <div className="hitster-locked"><span className="token-dot">F</span><strong>Your FIDSTER token is locked in at slot {myChallenge.slot + 1}.</strong></div>
              ) : state.tokensEnabled && me.tokens > 0 ? (
                <button className="button button--hitster button--lock" disabled={challengeSlot === null || busy} onClick={callHitster}>
                  Call FIDSTER — spend 1 token
                </button>
              ) : (
                <p className="muted">You don't have a token available for a challenge.</p>
              )}
              <div className="your-timeline-small"><p className="eyebrow">YOUR TIMELINE</p><Timeline cards={me.timeline} /></div>
            </>
          ) : null}
          {guessPanel}
          {error && <p className="error">{error}</p>}
        </section>
      </main>
    );
  }

  // Song is playing / placement is still live and editable.
  return (
    <main className="phone-shell">
      <Logo />
      <section className="phone-card">
        {phoneHeader}
        {isMyTurn ? (
          <>
            <p className="muted">Tap a + position while you think. The big display sees your choice move live. Nothing is final until you lock it.</p>
            <PlacementTimeline cards={me.timeline} selectedSlot={selectedSlot} onSelect={preview} disabled={busy} />

            {state.tokensEnabled && (
              <div className="token-tools">
                <button className="button token-action token-action--small" disabled={busy || me.tokens < 1} onClick={skipSong}>
                  <span className="token-dot">F</span> Skip song — 1 token
                </button>
              </div>
            )}
            {guessPanel}

            <button className="button button--primary button--lock" disabled={selectedSlot === null || busy} onClick={lock}>
              {busy ? "Working…" : state.tokensEnabled && state.players.length > 1 ? "Lock placement" : "Lock in & reveal"}
            </button>
          </>
        ) : current ? (
          <div className="waiting-panel">
            <div className="pulse-disc">♪</div>
            <p>{current.name} is deciding where the song belongs.</p>
            <LiveTimeline cards={current.timeline} previewSlot={state.currentPlacementSlot} />
            {state.tokensEnabled && me.tokens > 0 && <p className="muted">Watch the placement. After it is locked, you can spend 1 token to call FIDSTER on a different slot.</p>}
            {guessPanel}
            <div className="your-timeline-small"><p className="eyebrow">YOUR TIMELINE</p><Timeline cards={me.timeline} /></div>
          </div>
        ) : null}
        {error && <p className="error">{error}</p>}
      </section>
    </main>
  );
}
