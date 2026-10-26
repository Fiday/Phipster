import { FormEvent, useState } from "react";
import { Logo } from "../components/Logo";

type Song = { id: string; title: string; artist: string; year: number; spotifyUri: string | null };

const starterJson = `[
  {
    "title": "Song title",
    "artist": "Artist",
    "year": 1999,
    "spotifyUri": "spotify:track:TRACK_ID"
  }
]`;

export function Admin() {
  const [key, setKey] = useState(sessionStorage.getItem("phipster.admin.key") || "");
  const [json, setJson] = useState(starterJson);
  const [songs, setSongs] = useState<Song[]>([]);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  async function loadSongs() {
    setBusy(true); setMessage("");
    try {
      sessionStorage.setItem("phipster.admin.key", key);
      const response = await fetch("/api/admin/songs", { headers: { "x-admin-key": key } });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Could not load catalog");
      setSongs(body.songs);
      setMessage(`Loaded ${body.songs.length} songs.`);
    } catch (e) { setMessage(e instanceof Error ? e.message : "Request failed"); }
    finally { setBusy(false); }
  }

  async function importSongs(e: FormEvent) {
    e.preventDefault(); setBusy(true); setMessage("");
    try {
      const body = JSON.parse(json);
      sessionStorage.setItem("phipster.admin.key", key);
      const response = await fetch("/api/admin/songs/import", {
        method: "POST",
        headers: { "content-type": "application/json", "x-admin-key": key },
        body: JSON.stringify(body),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Import failed");
      setMessage(`Imported ${result.inserted}; updated ${result.updated}. Catalog now has ${result.total} songs.`);
      await loadSongs();
    } catch (e) { setMessage(e instanceof Error ? e.message : "Import failed"); setBusy(false); }
  }

  return (
    <main className="admin-shell">
      <header className="admin-header"><Logo /><a href="/">Back to game</a></header>
      <section className="admin-grid">
        <form className="admin-panel stack" onSubmit={importSongs}>
          <p className="eyebrow">CATALOG ADMIN</p>
          <h1>Import songs</h1>
          <label>Admin key</label>
          <input type="password" value={key} onChange={(e) => setKey(e.target.value)} placeholder="ADMIN_KEY" />
          <label>Song JSON</label>
          <textarea value={json} onChange={(e) => setJson(e.target.value)} spellCheck={false} />
          <div className="button-row">
            <button className="button button--primary" disabled={busy || !key}>Import JSON</button>
            <button className="button" type="button" disabled={busy || !key} onClick={loadSongs}>Refresh catalog</button>
          </div>
          {message && <p className={message.toLowerCase().includes("fail") || message.toLowerCase().includes("unauthorized") ? "error" : "muted"}>{message}</p>}
        </form>
        <section className="admin-panel">
          <p className="eyebrow">CURRENT SONGS</p>
          <div className="catalog-table-wrap">
            <table className="catalog-table">
              <thead><tr><th>Year</th><th>Artist</th><th>Title</th><th>Spotify</th></tr></thead>
              <tbody>
                {songs.map((song) => <tr key={song.id}><td>{song.year}</td><td>{song.artist}</td><td>{song.title}</td><td>{song.spotifyUri ? "✓" : "—"}</td></tr>)}
              </tbody>
            </table>
          </div>
        </section>
      </section>
    </main>
  );
}
