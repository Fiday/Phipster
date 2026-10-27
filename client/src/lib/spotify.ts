import { keys } from "./storage";

const clientId = import.meta.env.VITE_SPOTIFY_CLIENT_ID as string | undefined;
const configuredRedirect = import.meta.env.VITE_SPOTIFY_REDIRECT_URI as string | undefined;
const redirectUri = configuredRedirect || `${window.location.origin}/spotify/callback`;

const scopes = [
  "streaming",
  "user-read-email",
  "user-read-private",
  "user-read-playback-state",
  "user-modify-playback-state",
  "playlist-read-private",
  "playlist-read-collaborative",
].join(" ");

type SpotifyTokens = {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  scope?: string;
};

export type SpotifyPlaylistSummary = {
  id: string;
  name: string;
  ownerName: string;
  ownerId: string;
  collaborative: boolean;
  itemCount: number;
  spotifyUrl: string;
  canLoad: boolean;
};

export type SpotifyPlaylistTrack = {
  id: string;
  title: string;
  artist: string;
  artists: string[];
  year: number;
  spotifyUri: string;
  spotifyUrl: string;
  albumName: string;
  albumUrl: string;
  isrc: string | null;
};

function randomString(length: number) {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~";
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  return Array.from(bytes, (b) => chars[b % chars.length]).join("");
}

function base64Url(bytes: ArrayBuffer) {
  return btoa(String.fromCharCode(...new Uint8Array(bytes)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

async function challenge(verifier: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return base64Url(digest);
}

function loadTokens(): SpotifyTokens | null {
  try {
    const raw = localStorage.getItem(keys.spotifyTokens);
    return raw ? (JSON.parse(raw) as SpotifyTokens) : null;
  } catch {
    return null;
  }
}

function saveTokens(tokens: SpotifyTokens) {
  localStorage.setItem(keys.spotifyTokens, JSON.stringify(tokens));
}

export function spotifyConfigured() {
  return Boolean(clientId);
}

export function spotifyConnected() {
  return Boolean(loadTokens());
}

export function spotifyHasPlaylistAccess() {
  const granted = new Set((loadTokens()?.scope || "").split(/\s+/).filter(Boolean));
  return granted.has("playlist-read-private");
}

export function disconnectSpotify() {
  localStorage.removeItem(keys.spotifyTokens);
}

export async function beginSpotifyLogin(returnTo = "/display") {
  if (!clientId) throw new Error("VITE_SPOTIFY_CLIENT_ID is not configured");
  const verifier = randomString(64);
  const state = randomString(24);
  localStorage.setItem(keys.spotifyVerifier, verifier);
  localStorage.setItem(keys.spotifyState, state);
  localStorage.setItem(keys.spotifyReturn, returnTo);

  const params = new URLSearchParams({
    client_id: clientId,
    response_type: "code",
    redirect_uri: redirectUri,
    scope: scopes,
    code_challenge_method: "S256",
    code_challenge: await challenge(verifier),
    state,
  });
  window.location.assign(`https://accounts.spotify.com/authorize?${params}`);
}

export async function finishSpotifyLogin(search: string): Promise<string> {
  if (!clientId) throw new Error("Spotify is not configured");
  const params = new URLSearchParams(search);
  const error = params.get("error");
  if (error) throw new Error(`Spotify authorization failed: ${error}`);
  const code = params.get("code");
  const state = params.get("state");
  const expectedState = localStorage.getItem(keys.spotifyState);
  const verifier = localStorage.getItem(keys.spotifyVerifier);
  if (!code || !state || state !== expectedState || !verifier) throw new Error("Invalid Spotify callback state");

  const body = new URLSearchParams({
    client_id: clientId,
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri,
    code_verifier: verifier,
  });
  const response = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    signal: AbortSignal.timeout(15_000),
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!response.ok) throw new Error(`Spotify token exchange failed (${response.status})`);
  const token = await response.json() as { access_token: string; refresh_token: string; expires_in: number; scope?: string };
  saveTokens({
    accessToken: token.access_token,
    refreshToken: token.refresh_token,
    expiresAt: Date.now() + token.expires_in * 1000 - 30_000,
    scope: token.scope,
  });
  localStorage.removeItem(keys.spotifyVerifier);
  localStorage.removeItem(keys.spotifyState);
  const returnTo = localStorage.getItem(keys.spotifyReturn) || "/display";
  localStorage.removeItem(keys.spotifyReturn);
  return returnTo;
}

let refreshPending: Promise<string> | null = null;

export async function getSpotifyAccessToken(): Promise<string> {
  if (!clientId) throw new Error("Spotify is not configured");
  const tokens = loadTokens();
  if (!tokens) throw new Error("Spotify is not connected");
  if (Date.now() < tokens.expiresAt) return tokens.accessToken;

  if (!refreshPending) {
    refreshPending = refreshSpotifyTokens(tokens).finally(() => { refreshPending = null; });
  }
  return refreshPending;
}

async function refreshSpotifyTokens(tokens: SpotifyTokens): Promise<string> {
  const body = new URLSearchParams({
    client_id: clientId!,
    grant_type: "refresh_token",
    refresh_token: tokens.refreshToken,
  });
  const response = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    signal: AbortSignal.timeout(15_000),
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!response.ok) {
    if (response.status === 400 || response.status === 401) {
      disconnectSpotify();
      throw new Error("Spotify session expired. Connect Spotify again.");
    }
    throw new Error(`Spotify token refresh failed (${response.status}). Try again shortly.`);
  }
  const refreshed = await response.json() as { access_token: string; refresh_token?: string; expires_in: number; scope?: string };
  const next = {
    accessToken: refreshed.access_token,
    refreshToken: refreshed.refresh_token || tokens.refreshToken,
    expiresAt: Date.now() + refreshed.expires_in * 1000 - 30_000,
    scope: refreshed.scope || tokens.scope,
  };
  saveTokens(next);
  return next.accessToken;
}

async function spotifyFetch(urlOrPath: string, init: RequestInit = {}): Promise<Response> {
  const token = await getSpotifyAccessToken();
  const url = urlOrPath.startsWith("http") ? urlOrPath : `https://api.spotify.com/v1${urlOrPath}`;
  const response = await fetch(url, {
    ...init,
    signal: init.signal ?? AbortSignal.timeout(15_000),
    headers: {
      Authorization: `Bearer ${token}`,
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...(init.headers || {}),
    },
  });
  if (!response.ok && response.status !== 204) {
    const text = await response.text();
    if (response.status === 403 && url.includes("/playlists/")) {
      throw new Error("Spotify refused playlist access. Reconnect Spotify to grant playlist access, and choose a playlist you own or collaborate on.");
    }
    throw new Error(`Spotify API ${response.status}: ${text || response.statusText}`);
  }
  return response;
}

async function spotifyJson<T>(urlOrPath: string): Promise<T> {
  const response = await spotifyFetch(urlOrPath);
  return response.json() as Promise<T>;
}

export async function getMySpotifyPlaylists(): Promise<SpotifyPlaylistSummary[]> {
  const me = await spotifyJson<{ id: string }>("/me");
  const result: SpotifyPlaylistSummary[] = [];
  let next: string | null = "https://api.spotify.com/v1/me/playlists?limit=50";

  while (next) {
    const page: {
      items: Array<{
        id: string;
        name: string;
        collaborative: boolean;
        owner: { id: string; display_name?: string | null };
        items?: { total: number };
        tracks?: { total: number };
        external_urls?: { spotify?: string };
      }>;
      next: string | null;
    } = await spotifyJson(next);

    for (const playlist of page.items) {
      const canLoad = playlist.owner.id === me.id || playlist.collaborative;
      if (!canLoad) continue;
      result.push({
        id: playlist.id,
        name: playlist.name,
        ownerName: playlist.owner.display_name || playlist.owner.id,
        ownerId: playlist.owner.id,
        collaborative: playlist.collaborative,
        itemCount: playlist.items?.total ?? playlist.tracks?.total ?? 0,
        spotifyUrl: playlist.external_urls?.spotify || `https://open.spotify.com/playlist/${playlist.id}`,
        canLoad,
      });
    }
    next = page.next;
  }

  return result;
}

function yearFromReleaseDate(value: string | undefined): number | null {
  if (!value) return null;
  const match = /^(\d{4})/.exec(value);
  const year = match ? Number(match[1]) : NaN;
  return Number.isInteger(year) && year >= 1800 && year <= 2200 ? year : null;
}

export async function getSpotifyPlaylistTracks(playlistId: string): Promise<SpotifyPlaylistTrack[]> {
  const tracks: SpotifyPlaylistTrack[] = [];
  const seen = new Set<string>();
  let next: string | null = `https://api.spotify.com/v1/playlists/${encodeURIComponent(playlistId)}/items?limit=50&additional_types=track`;

  while (next) {
    const page: {
      items: Array<{
        is_local?: boolean;
        item?: SpotifyTrackObject | null;
        track?: SpotifyTrackObject | null;
      }>;
      next: string | null;
    } = await spotifyJson(next);

    for (const row of page.items) {
      const track = row.item ?? row.track;
      if (!track || track.type !== "track" || row.is_local || track.is_local || track.is_playable === false || !track.id || !track.uri || seen.has(track.id)) continue;
      const year = yearFromReleaseDate(track.album?.release_date);
      if (!year) continue;
      seen.add(track.id);
      tracks.push({
        id: track.id,
        title: track.name,
        artist: track.artists?.map((artist) => artist.name).join(", ") || "Unknown artist",
        artists: track.artists?.map((artist) => artist.name).filter(Boolean) || [],
        year,
        spotifyUri: track.uri,
        spotifyUrl: track.external_urls?.spotify || `https://open.spotify.com/track/${track.id}`,
        albumName: track.album?.name || "Unknown album",
        albumUrl: track.album?.external_urls?.spotify || "",
        isrc: track.external_ids?.isrc || null,
      });
    }
    next = page.next;
  }

  return tracks;
}

type SpotifyTrackObject = {
  id: string;
  name: string;
  type: string;
  uri: string;
  is_local?: boolean;
  is_playable?: boolean;
  artists?: Array<{ name: string }>;
  external_ids?: { isrc?: string };
  external_urls?: { spotify?: string };
  album?: {
    name: string;
    release_date?: string;
    external_urls?: { spotify?: string };
  };
};

declare global {
  interface Window {
    Spotify?: {
      Player: new (config: {
        name: string;
        getOAuthToken: (callback: (token: string) => void) => void;
        volume?: number;
      }) => SpotifyPlayerInstance;
    };
    onSpotifyWebPlaybackSDKReady?: () => void;
  }
}

type SpotifyPlayerInstance = {
  connect(): Promise<boolean>;
  disconnect(): void;
  addListener(event: string, cb: (data: any) => void): boolean;
  togglePlay(): Promise<void>;
  activateElement(): Promise<void>;
  setVolume(volume: number): Promise<void>;
};

let sdkLoading: Promise<void> | null = null;
function loadSpotifySdk(): Promise<void> {
  if (window.Spotify) return Promise.resolve();
  if (sdkLoading) return sdkLoading;
  sdkLoading = new Promise<void>((resolve, reject) => {
    const script = document.createElement("script");
    const fail = () => {
      window.clearTimeout(timeout);
      script.remove();
      reject(new Error("Spotify SDK did not load. Check your connection and try again."));
    };
    const timeout = window.setTimeout(fail, 15_000);
    window.onSpotifyWebPlaybackSDKReady = () => {
      window.clearTimeout(timeout);
      resolve();
    };
    script.src = "https://sdk.scdn.co/spotify-player.js";
    script.async = true;
    script.onerror = fail;
    document.body.appendChild(script);
  }).catch(error => { sdkLoading = null; throw error; });
  return sdkLoading;
}

export class phipsterSpotifyPlayer {
  constructor(private deviceName = "phipster Display") {}

  private player: SpotifyPlayerInstance | null = null;
  private deviceId: string | null = null;
  private destroyed = false;
  private cancelInit: (() => void) | null = null;
  private commands: Promise<void> = Promise.resolve();

  async init(onStatus: (message: string) => void): Promise<void> {
    try {
      await getSpotifyAccessToken();
      await loadSpotifySdk();
      if (this.destroyed) throw new Error("Spotify player was closed");
      await new Promise<void>((resolve, reject) => {
        let settled = false;
        const finish = (error?: Error) => {
          if (settled) return;
          settled = true;
          window.clearTimeout(timeout);
          this.cancelInit = null;
          if (error) reject(error); else resolve();
        };
        const fail = (message: string) => { onStatus(message); finish(new Error(message)); };
        const timeout = window.setTimeout(() => fail("Spotify player did not become ready. Try enabling it again."), 15_000);
        this.cancelInit = () => finish(new Error("Spotify player was closed"));
        this.player = new window.Spotify!.Player({
          name: this.deviceName, volume: 0.8,
          getOAuthToken: cb => { getSpotifyAccessToken().then(cb).catch(e => fail(String(e))); },
        });
        this.player.addListener("ready", ({ device_id }: { device_id: string }) => {
          if (this.destroyed) return;
          this.deviceId = device_id;
          onStatus("Spotify player ready");
          finish();
        });
        this.player.addListener("not_ready", () => {
          this.deviceId = null;
          onStatus("Spotify player went offline. Reconnect the player to resume audio.");
        });
        for (const event of ["initialization_error", "authentication_error", "account_error"]) {
          this.player.addListener(event, ({ message }: { message: string }) => {
            this.deviceId = null;
            fail(message);
          });
        }
        this.player.addListener("playback_error", ({ message }: { message: string }) => onStatus(message));
        this.player.addListener("autoplay_failed", () => onStatus("Audio was blocked by the browser. Click Play song / retry."));
        this.player.connect().then(connected => {
          if (!connected) fail("Spotify could not connect. Try enabling the player again.");
        }).catch(e => fail(String(e)));
      });
      await this.transferHere(false);
    } catch (error) {
      this.destroy();
      throw error;
    }
  }

  activate(): Promise<void> {
    if (!this.player) return Promise.reject(new Error("Enable the Spotify player first"));
    return this.player.activateElement();
  }

  private enqueue(command: () => Promise<void>): Promise<void> {
    const pending = this.commands.then(() => {
      if (!this.destroyed) return command();
    });
    this.commands = pending.catch(() => undefined);
    return pending;
  }

  private async api(path: string, init: RequestInit) {
    await spotifyFetch(path, init);
  }

  async transferHere(play = false) {
    if (!this.deviceId) throw new Error("Spotify player is not ready");
    await this.api("/me/player", {
      method: "PUT",
      body: JSON.stringify({ device_ids: [this.deviceId], play }),
    });
  }

  async playUri(uri: string) {
    if (!this.deviceId) throw new Error("Spotify player is not ready");
    const deviceId = this.deviceId;
    await this.enqueue(() => this.api(`/me/player/play?device_id=${encodeURIComponent(deviceId)}`, {
      method: "PUT",
      body: JSON.stringify({ uris: [uri], position_ms: 0 }),
    }));
  }

  async pause() {
    if (!this.deviceId) return;
    const deviceId = this.deviceId;
    await this.enqueue(() => this.api(`/me/player/pause?device_id=${encodeURIComponent(deviceId)}`, { method: "PUT" }));
  }

  async toggle() {
    await this.player?.togglePlay();
  }

  destroy() {
    this.destroyed = true;
    this.cancelInit?.();
    this.player?.disconnect();
    this.player = null;
    this.deviceId = null;
  }
}
