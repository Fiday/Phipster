import dotenv from "dotenv";
import express from "express";
import http from "node:http";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { Server } from "socket.io";
import { z } from "zod";
import { SongRepository } from "./db/songs.js";
import { RoomManager } from "./game/room.js";
import { checkReleaseYear } from "./services/musicbrainz.js";

const currentFile = fileURLToPath(import.meta.url);
const currentDir = path.dirname(currentFile);
// Works from both server/src (tsx dev) and server/dist (compiled production).
const projectRoot = path.resolve(currentDir, "../..");
dotenv.config({ path: path.join(projectRoot, ".env") });

const port = Number(process.env.PORT || 3000);
const host = process.env.HOST || "127.0.0.1";
const dbPath = process.env.DB_PATH
  ? path.resolve(projectRoot, process.env.DB_PATH)
  : path.join(projectRoot, "data", "bibster.sqlite");
const adminKey = process.env.ADMIN_KEY || "";
const ttlHours = Number(process.env.ROOM_TTL_HOURS || 6);
const metadataContact = process.env.FIDSTER_METADATA_CONTACT || process.env.PUBLIC_BASE_URL || "https://bibster.tallgin.com";
const musicBrainzUserAgent = `Phipster/1.4.0 ( ${metadataContact} )`;
const yearAuditUsage = new Map<string, { startedAt: number; count: number }>();

const songs = new SongRepository(dbPath);
songs.seedDemoIfEmpty();
const rooms = new RoomManager(songs);

const app = express();
app.disable("x-powered-by");
app.use(express.json({ limit: "2mb" }));

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, rooms: rooms.all().length, songs: songs.count() });
});

app.get("/api/config", (_req, res) => {
  res.json({
    spotifyConfigured: Boolean(process.env.VITE_SPOTIFY_CLIENT_ID),
    catalogSize: songs.count(),
  });
});

const yearCheckSchema = z.object({
  title: z.string().min(1).max(200),
  artist: z.string().min(1).max(200),
  isrc: z.string().max(32).nullable().optional(),
  spotifyYear: z.number().int().min(1800).max(2200),
});

app.post("/api/metadata/year-check", async (req, res) => {
  const parsed = yearCheckSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid track metadata" });
    return;
  }

  const identity = String(req.header("cf-connecting-ip") || req.ip || "unknown");
  const now = Date.now();
  const usage = yearAuditUsage.get(identity);
  if (!usage || now - usage.startedAt >= 60 * 60 * 1000) {
    yearAuditUsage.set(identity, { startedAt: now, count: 1 });
  } else {
    usage.count += 1;
    if (usage.count > 500) {
      res.status(429).json({ error: "Release-year audit limit reached. Try again later." });
      return;
    }
  }

  try {
    const result = await checkReleaseYear(parsed.data, { userAgent: musicBrainzUserAgent });
    res.json(result);
  } catch (error) {
    res.status(502).json({ error: error instanceof Error ? error.message : "Release-year lookup failed" });
  }
});

app.get("/api/admin/songs", (req, res) => {
  if (!adminKey || req.header("x-admin-key") !== adminKey) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  res.json({ songs: songs.list() });
});

const songSchema = z.object({
  id: z.string().min(1).optional(),
  title: z.string().min(1).max(200),
  artist: z.string().min(1).max(200),
  year: z.number().int().min(1800).max(2200),
  spotifyUri: z.string().max(200).nullable().optional(),
});

app.post("/api/admin/songs/import", (req, res) => {
  if (!adminKey || req.header("x-admin-key") !== adminKey) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const parsed = z.array(songSchema).min(1).max(5000).safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid song list", details: parsed.error.flatten() });
    return;
  }
  const result = songs.importMany(parsed.data);
  res.json({ ok: true, ...result, total: songs.count() });
});


const roomSpotifyTrackSchema = z.object({
  id: z.string().min(1).max(200),
  title: z.string().min(1).max(200),
  artist: z.string().min(1).max(300),
  primaryArtist: z.string().min(1).max(200).nullable().optional(),
  year: z.number().int().min(1800).max(2200),
  spotifyUri: z.string().regex(/^spotify:track:[A-Za-z0-9]+$/),
});

const server = http.createServer(app);
const io = new Server(server, {
  maxHttpBufferSize: 5 * 1024 * 1024,
  cors: process.env.NODE_ENV === "production" ? undefined : { origin: true, credentials: true },
});

const roomChannel = (code: string) => `room:${code}`;

function broadcastRoom(code: string) {
  const room = rooms.get(code);
  if (!room) return;
  io.to(roomChannel(code)).emit("room:state", room.publicState());
}

function emitPrivateTrack(code: string) {
  const room = rooms.get(code);
  if (!room?.hostSocketId) return;
  const track = room.privateTrack();
  if (track) io.to(room.hostSocketId).emit("host:track", track);
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

io.on("connection", (socket) => {
  // A malformed client must not crash every room by omitting its callback.
  const handle = (event: string, handler: (payload: unknown, ack: (response: unknown) => void) => void) => {
    socket.on(event, (payload, reply) => handler(payload, typeof reply === "function" ? reply : () => undefined));
  };
  const selectRoom = (code: string) => {
    for (const room of rooms.all()) {
      if (room.code === code) continue;
      socket.leave(roomChannel(room.code));
      if (room.detachSocket(socket.id)) broadcastRoom(room.code);
    }
    socket.join(roomChannel(code));
  };
  handle("room:create", (_payload, ack) => {
    try {
      const room = rooms.create();
      room.attachHost(room.hostToken, socket.id);
      selectRoom(room.code);
      ack({ ok: true, data: { code: room.code, hostToken: room.hostToken, state: room.publicState() } });
      broadcastRoom(room.code);
    } catch (error) {
      ack({ ok: false, error: errorMessage(error, "Could not create room") });
    }
  });

  handle("host:attach", (payload, ack) => {
    try {
      const parsed = z.object({ code: z.string(), hostToken: z.string() }).parse(payload);
      const room = rooms.get(parsed.code);
      if (!room) throw new Error("Room not found");
      room.attachHost(parsed.hostToken, socket.id);
      selectRoom(room.code);
      ack({ ok: true, data: { state: room.publicState() } });
      broadcastRoom(room.code);
      emitPrivateTrack(room.code);
    } catch (error) {
      ack({ ok: false, error: errorMessage(error, "Could not attach host") });
    }
  });


  handle("host:set-song-source", (payload, ack) => {
    try {
      const parsed = z.discriminatedUnion("source", [
        z.object({
          source: z.literal("catalog"),
          code: z.string(),
          hostToken: z.string(),
        }),
        z.object({
          source: z.literal("spotify"),
          code: z.string(),
          hostToken: z.string(),
          playlist: z.object({ id: z.string().min(1).max(200), name: z.string().min(1).max(120) }),
          tracks: z.array(roomSpotifyTrackSchema).min(3).max(10000),
        }),
      ]).parse(payload);
      const room = rooms.get(parsed.code);
      if (!room) throw new Error("Room not found");
      if (parsed.source === "catalog") {
        room.useCatalogSource(parsed.hostToken);
      } else {
        room.useSpotifyPlaylistSource(parsed.hostToken, parsed.playlist, parsed.tracks);
      }
      ack({ ok: true, data: { state: room.publicState() } });
      broadcastRoom(room.code);
    } catch (error) {
      ack({ ok: false, error: errorMessage(error, "Could not change song source") });
    }
  });

  handle("player:join", (payload, ack) => {
    try {
      const parsed = z.object({
        code: z.string(),
        name: z.string(),
        reconnectToken: z.string().optional(),
      }).parse(payload);
      const room = rooms.get(parsed.code);
      if (!room) throw new Error("Room not found");
      const identity = room.joinPlayer(parsed.name, socket.id, parsed.reconnectToken);
      selectRoom(room.code);
      ack({ ok: true, data: { ...identity, state: room.publicState() } });
      broadcastRoom(room.code);
    } catch (error) {
      ack({ ok: false, error: errorMessage(error, "Could not join room") });
    }
  });

  handle("game:start", (payload, ack) => {
    try {
      const parsed = z.object({
        code: z.string(),
        hostToken: z.string(),
        winTarget: z.number().int().min(2).max(30).default(10),
        tokensEnabled: z.boolean().default(true),
        gameMode: z.enum(["individual", "team"]).default("individual"),
      }).parse(payload);
      const room = rooms.get(parsed.code);
      if (!room) throw new Error("Room not found");
      room.start(parsed.hostToken, {
        winTarget: parsed.winTarget,
        tokensEnabled: parsed.tokensEnabled,
        gameMode: parsed.gameMode,
      });
      ack({ ok: true });
      broadcastRoom(room.code);
    } catch (error) {
      ack({ ok: false, error: errorMessage(error, "Could not start game") });
    }
  });

  handle("player:start-song", (payload, ack) => {
    try {
      const parsed = z.object({ code: z.string(), playerId: z.string() }).parse(payload);
      const room = rooms.get(parsed.code);
      if (!room) throw new Error("Room not found");
      room.beginListening(parsed.playerId, socket.id);
      ack({ ok: true });
      broadcastRoom(room.code);
      emitPrivateTrack(room.code);
    } catch (error) {
      ack({ ok: false, error: errorMessage(error, "Could not start song") });
    }
  });

  handle("host:start-song", (payload, ack) => {
    try {
      const parsed = z.object({ code: z.string(), hostToken: z.string() }).parse(payload);
      const room = rooms.get(parsed.code);
      if (!room) throw new Error("Room not found");
      room.beginListeningAsHost(parsed.hostToken);
      ack({ ok: true });
      broadcastRoom(room.code);
      emitPrivateTrack(room.code);
    } catch (error) {
      ack({ ok: false, error: errorMessage(error, "Could not start song") });
    }
  });

  handle("player:preview", (payload, ack) => {
    try {
      const parsed = z.object({ code: z.string(), playerId: z.string(), slot: z.number().int() }).parse(payload);
      const room = rooms.get(parsed.code);
      if (!room) throw new Error("Room not found");
      room.previewPlacement(parsed.playerId, socket.id, parsed.slot);
      ack({ ok: true });
      broadcastRoom(room.code);
    } catch (error) {
      ack({ ok: false, error: errorMessage(error, "Could not preview placement") });
    }
  });

  handle("player:guess", (payload, ack) => {
    try {
      const parsed = z.object({
        code: z.string(),
        playerId: z.string(),
        title: z.string().max(200),
        artist: z.string().max(200),
      }).parse(payload);
      const room = rooms.get(parsed.code);
      if (!room) throw new Error("Room not found");
      const result = room.submitGuess(parsed.playerId, socket.id, parsed.title, parsed.artist);
      ack({ ok: true, data: result });
      broadcastRoom(room.code);
    } catch (error) {
      ack({ ok: false, error: errorMessage(error, "Could not submit guess") });
    }
  });

  handle("player:skip", (payload, ack) => {
    try {
      const parsed = z.object({ code: z.string(), playerId: z.string() }).parse(payload);
      const room = rooms.get(parsed.code);
      if (!room) throw new Error("Room not found");
      room.skipSong(parsed.playerId, socket.id);
      ack({ ok: true });
      broadcastRoom(room.code);
    } catch (error) {
      ack({ ok: false, error: errorMessage(error, "Could not skip song") });
    }
  });

  handle("player:buy-card", (payload, ack) => {
    try {
      const parsed = z.object({ code: z.string(), playerId: z.string() }).parse(payload);
      const room = rooms.get(parsed.code);
      if (!room) throw new Error("Room not found");
      room.buyCurrentCard(parsed.playerId, socket.id);
      ack({ ok: true });
      broadcastRoom(room.code);
    } catch (error) {
      ack({ ok: false, error: errorMessage(error, "Could not exchange tokens for card") });
    }
  });

  handle("player:lock", (payload, ack) => {
    try {
      const parsed = z.object({ code: z.string(), playerId: z.string(), slot: z.number().int() }).parse(payload);
      const room = rooms.get(parsed.code);
      if (!room) throw new Error("Room not found");
      room.lockPlacement(parsed.playerId, socket.id, parsed.slot);
      ack({ ok: true });
      broadcastRoom(room.code);
    } catch (error) {
      ack({ ok: false, error: errorMessage(error, "Could not lock answer") });
    }
  });

  handle("player:hitster", (payload, ack) => {
    try {
      const parsed = z.object({ code: z.string(), playerId: z.string(), slot: z.number().int() }).parse(payload);
      const room = rooms.get(parsed.code);
      if (!room) throw new Error("Room not found");
      room.callHitster(parsed.playerId, socket.id, parsed.slot);
      ack({ ok: true });
      broadcastRoom(room.code);
    } catch (error) {
      ack({ ok: false, error: errorMessage(error, "Could not place FIDSTER token") });
    }
  });

  handle("game:reveal", (payload, ack) => {
    try {
      const parsed = z.object({ code: z.string(), hostToken: z.string() }).parse(payload);
      const room = rooms.get(parsed.code);
      if (!room) throw new Error("Room not found");
      room.revealChallenges(parsed.hostToken);
      ack({ ok: true });
      broadcastRoom(room.code);
    } catch (error) {
      ack({ ok: false, error: errorMessage(error, "Could not reveal placement") });
    }
  });

  handle("game:next", (payload, ack) => {
    try {
      const parsed = z.object({ code: z.string(), hostToken: z.string() }).parse(payload);
      const room = rooms.get(parsed.code);
      if (!room) throw new Error("Room not found");
      room.next(parsed.hostToken);
      ack({ ok: true });
      broadcastRoom(room.code);
    } catch (error) {
      ack({ ok: false, error: errorMessage(error, "Could not advance game") });
    }
  });

  handle("game:skip-disconnected", (payload, ack) => {
    try {
      const parsed = z.object({ code: z.string(), hostToken: z.string() }).parse(payload);
      const room = rooms.get(parsed.code);
      if (!room) throw new Error("Room not found");
      room.skipDisconnectedPlayer(parsed.hostToken);
      ack({ ok: true });
      broadcastRoom(room.code);
    } catch (error) {
      ack({ ok: false, error: errorMessage(error, "Could not skip disconnected player") });
    }
  });

  handle("game:restart", (payload, ack) => {
    try {
      const parsed = z.object({ code: z.string(), hostToken: z.string() }).parse(payload);
      const room = rooms.get(parsed.code);
      if (!room) throw new Error("Room not found");
      room.restart(parsed.hostToken);
      ack({ ok: true });
      broadcastRoom(room.code);
    } catch (error) {
      ack({ ok: false, error: errorMessage(error, "Could not restart game") });
    }
  });

  handle("host:request-track", (payload, ack) => {
    try {
      const parsed = z.object({ code: z.string(), hostToken: z.string() }).parse(payload);
      const room = rooms.get(parsed.code);
      if (!room) throw new Error("Room not found");
      room.attachHost(parsed.hostToken, socket.id);
      emitPrivateTrack(room.code);
      ack({ ok: true });
    } catch (error) {
      ack({ ok: false, error: errorMessage(error, "Could not retrieve track") });
    }
  });

  socket.on("disconnect", () => {
    for (const room of rooms.all()) {
      if (room.detachSocket(socket.id)) broadcastRoom(room.code);
    }
  });
});

const clientDist = process.env.CLIENT_DIST
  ? path.resolve(projectRoot, process.env.CLIENT_DIST)
  : path.join(projectRoot, "client", "dist");
if (fs.existsSync(clientDist)) {
  app.use(express.static(clientDist, { index: false, maxAge: "1h" }));
  app.get(/.*/, (_req, res) => res.sendFile(path.join(clientDist, "index.html")));
}

setInterval(() => {
  rooms.cleanup(Math.max(1, ttlHours) * 60 * 60 * 1000);
}, 30 * 60 * 1000).unref();

server.listen(port, host, () => {
  const address = server.address();
  console.log(`Phipster server listening on http://${host}:${typeof address === "object" && address ? address.port : port}`);
  console.log(`Song catalog: ${songs.count()} tracks`);
});
