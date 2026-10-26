import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Logo } from "../components/Logo";

export function Home() {
  const navigate = useNavigate();
  const [code, setCode] = useState("");

  function join() {
    const clean = code.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6);
    if (clean) navigate(`/join/${clean}`);
  }

  return (
    <main className="home shell">
      <Logo large />
      <p className="tagline">Totally original idea. Dont @ me.</p>
      <section className="role-grid">
        <button className="role-card role-card--primary" onClick={() => navigate("/display")}>
          <span className="role-icon">▣</span>
          <strong>Display Host</strong>
          <small>Create a room on the TV or laptop.</small>
        </button>
        <button className="role-card role-card--solo" onClick={() => navigate("/solo")}>
          <span className="role-icon">♪</span>
          <strong>Single Player</strong>
          <small>Choose your Spotify playlist, check release years, and chase a high score.</small>
        </button>
        <div className="role-card">
          <span className="role-icon">◉</span>
          <strong>Client</strong>
          <small>Join the room from your phone.</small>
          <div className="join-inline">
            <input
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              onKeyDown={(e) => e.key === "Enter" && join()}
              placeholder="ROOM CODE"
              maxLength={6}
              aria-label="Room code"
            />
            <button onClick={join}>Join</button>
          </div>
        </div>
      </section>
      <p className="footnote">phipster is a very "original" digital timeline party game interface. Bring your own licensed music source tho...</p>
    </main>
  );
}
