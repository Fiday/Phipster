import Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export type Song = {
  id: string;
  title: string;
  artist: string;
  year: number;
  spotifyUri: string | null;
  primaryArtist?: string | null;
};

export type ImportSong = {
  id?: string;
  title: string;
  artist: string;
  year: number;
  spotifyUri?: string | null;
  primaryArtist?: string | null;
};

export class SongRepository {
  private db: Database.Database;

  constructor(dbPath: string) {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    this.db = new Database(dbPath);
    this.db.pragma("journal_mode = WAL");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS songs (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        artist TEXT NOT NULL,
        year INTEGER NOT NULL CHECK(year >= 1800 AND year <= 2200),
        spotify_uri TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS idx_songs_year ON songs(year);
    `);
  }

  count(): number {
    return (this.db.prepare("SELECT COUNT(*) AS count FROM songs").get() as { count: number }).count;
  }

  allIds(): string[] {
    return (this.db.prepare("SELECT id FROM songs").all() as Array<{ id: string }>).map((r) => r.id);
  }

  getById(id: string): Song | null {
    const row = this.db.prepare(`
      SELECT id, title, artist, year, spotify_uri AS spotifyUri
      FROM songs WHERE id = ?
    `).get(id) as Song | undefined;
    return row ?? null;
  }

  list(limit = 500): Song[] {
    return this.db.prepare(`
      SELECT id, title, artist, year, spotify_uri AS spotifyUri
      FROM songs ORDER BY year, artist, title LIMIT ?
    `).all(limit) as Song[];
  }

  importMany(songs: ImportSong[]): { inserted: number; updated: number } {
    const existing = this.db.prepare("SELECT 1 FROM songs WHERE id = ?");
    const upsert = this.db.prepare(`
      INSERT INTO songs (id, title, artist, year, spotify_uri)
      VALUES (@id, @title, @artist, @year, @spotifyUri)
      ON CONFLICT(id) DO UPDATE SET
        title = excluded.title,
        artist = excluded.artist,
        year = excluded.year,
        spotify_uri = excluded.spotify_uri
    `);

    let inserted = 0;
    let updated = 0;
    const transaction = this.db.transaction((items: ImportSong[]) => {
      for (const item of items) {
        const id = item.id?.trim() || randomUUID();
        const wasExisting = Boolean(existing.get(id));
        upsert.run({
          id,
          title: item.title.trim(),
          artist: item.artist.trim(),
          year: item.year,
          spotifyUri: item.spotifyUri?.trim() || null,
        });
        if (wasExisting) updated += 1;
        else inserted += 1;
      }
    });

    transaction(songs);
    return { inserted, updated };
  }

  seedDemoIfEmpty(): void {
    if (this.count() > 0) return;
    const demoYears = [1964, 1969, 1973, 1977, 1981, 1985, 1989, 1992, 1997, 2001, 2004, 2008, 2011, 2014, 2017, 2019, 2021, 2022, 2023, 2024, 2025];
    this.importMany(
      demoYears.map((year, i) => ({
        id: `demo-${year}-${i}`,
        title: `Demo Track ${i + 1}`,
        artist: "Phipster Demo",
        year,
        spotifyUri: null,
      })),
    );
  }
}
