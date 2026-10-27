# Phipster v1.4.0 — Multiplayer + Solo Spotify playlists · Windows + Cloudflare Tunnel

Phipster is a browser-based music timeline game with both **multiplayer** and **single-player** modes. Multiplayer uses a Display Host (TV/laptop) plus player phones and can now use either the shared server catalog or a Spotify playlist selected by the Display Host. Solo mode runs entirely in one browser, lets you choose one of your own Spotify playlists, audits release years, and keeps a local high score. The multiplayer game server remains authoritative: player clients never receive hidden song metadata or Spotify URIs before reveal.

This edition is designed to run **directly on a Windows server with Node.js**. It does **not** use Docker or Caddy. Your existing **Cloudflare Tunnel (`cloudflared`)** publishes the local Phipster service as `https://bibster.tallgin.com`.

The public game name is now **Phipster**. The existing hostname `bibster.tallgin.com`, default `bibster.sqlite` database filename, and `bibster.*` browser storage keys are intentionally retained so this update can replace your current installation without migrating data or Cloudflare settings.
Existing `Bibster Server` scheduled tasks still launch Phipster after the files are updated. Running `npm run win:startup` again migrates that legacy task to the new `Phipster Server` label.

## Included

- React + TypeScript responsive UI
- Display Host, Client, and Single Player roles on one origin
- Solo scored chronology runs with 10/20/30/all-track session lengths and local best scores
- Spotify playlist selection in both Solo and multiplayer Display Host setup for playlists you own or collaborate on
- Multiplayer playlist release-year review uses the same saved corrections and MusicBrainz checker as Solo
- Selected multiplayer playlists are copied into the active room as a private in-memory song pool; client phones never receive the unrevealed deck
- MusicBrainz-assisted release-year audit with ISRC-first matching, manual corrections, and persistent per-playlist fixes
- Socket.IO real-time rooms, reconnects, turn rotation, reveal and win state
- Live placement preview on the Display Host and all listening clients before lock-in
- FIDSTER-style chronological placement, including equal-year placement
- Individual or team mode (one connected phone represents one player/team)
- Optional full FIDSTER token rules: 2 starting tokens, 5-token cap, skip, FIDSTER challenges/steals, and 3-token direct cards
- Song + artist token earning for every player/team on every turn, with forgiving fuzzy matching
- Oldest randomly dealt starter card determines the first player while preserving join order as clockwise order
- SQLite song catalog
- Spotify Web Playback SDK on the Display Host using Authorization Code + PKCE
- QR room joining
- Admin JSON song importer at `/admin`
- Demo catalog auto-seeding
- Native Windows install/start PowerShell scripts
- Optional Windows Task Scheduler autostart registration
- Cloudflare Tunnel example configuration

## Production architecture

```text
Internet / player phones
          │
          │ https://bibster.tallgin.com
          ▼
     Cloudflare Edge
          │
     Cloudflare Tunnel
          │
          ▼
 cloudflared on Windows
          │
          │ http://127.0.0.1:3000
          ▼
      Phipster Node.js
       │          │
     SQLite    Socket.IO
                  │
                  ├── Display Host browser
                  └── Player browsers
```

Phipster intentionally binds to `127.0.0.1` by default. The game is therefore not directly exposed on the Windows network interface. `cloudflared` reaches it locally.

You do **not** need Caddy, IIS, an HTTPS certificate on Windows, NAT port forwarding, or inbound firewall rules for Phipster when the tunnel runs on the same machine.

---

# 1. Requirements on Windows

Install:

- Windows 10/11 or Windows Server
- Node.js 20 or newer, including npm
- Your existing `cloudflared` tunnel

For a new installation, a simple project location is recommended:

```text
C:\phipster
```

If you are upgrading the existing installation at `C:\bibster`, keep it there; no folder rename is required. A machine-level folder is especially useful if you later run Phipster as a SYSTEM startup task.

---

# 2. Install Phipster

Extract the project, open PowerShell in the Phipster directory, then run:

```powershell
npm run win:install
```

The installer:

1. verifies Node.js 20+
2. creates `data` and `logs`
3. creates `.env` if needed
4. generates a random `ADMIN_KEY`
5. runs `npm install`
6. builds the React client and Node server

You can supply the Spotify client ID during first installation:

```powershell
.\scripts\windows-install.ps1 -SpotifyClientId "YOUR_SPOTIFY_CLIENT_ID"
```

Or edit `.env` afterward and rebuild with:

```powershell
npm run build
```

---

# 3. Configuration

The root `.env` file is used for both the server and the Vite production build.

Recommended production values:

```env
NODE_ENV=production
HOST=127.0.0.1
PORT=3000
PUBLIC_BASE_URL=https://bibster.tallgin.com
DB_PATH=
ADMIN_KEY=your-generated-admin-key
ROOM_TTL_HOURS=6
FIDSTER_METADATA_CONTACT=https://bibster.tallgin.com

VITE_SPOTIFY_CLIENT_ID=YOUR_SPOTIFY_CLIENT_ID
VITE_SPOTIFY_REDIRECT_URI=https://bibster.tallgin.com/spotify/callback
VITE_PUBLIC_BASE_URL=https://bibster.tallgin.com
```

`DB_PATH=` may remain empty. Phipster will then store its SQLite database at:

```text
C:\phipster\data\bibster.sqlite
```

If you set `DB_PATH` to a relative path, it is resolved relative to the Phipster project directory rather than whichever working directory happened to start Node.

The same deterministic behavior is used for `.env` and `client\dist`, which makes Task Scheduler startup reliable on Windows.

### Important when changing `VITE_...` values

Vite embeds these values during the frontend build. After changing `VITE_SPOTIFY_CLIENT_ID` or another `VITE_...` value, rebuild:

```powershell
npm run build
```

Then restart Phipster.

---

# 4. Start Phipster

Run:

```powershell
npm run win:start
```

The local console should show something similar to:

```text
Phipster server listening on http://127.0.0.1:3000
Song catalog: 16 tracks
```

Verify locally from another PowerShell window:

```powershell
Invoke-RestMethod http://127.0.0.1:3000/api/health
```

You should receive an object containing `ok = True`, the active room count, and the song count.

---

# 5. Connect your existing Cloudflare Tunnel

Because you already use Cloudflare Tunnels, add one hostname to the existing tunnel:

```text
Public hostname: bibster.tallgin.com
Service type:    HTTP
Service URL:     http://127.0.0.1:3000
```

That is the only upstream Phipster needs.

Socket.IO uses WebSockets, and it stays on the same `bibster.tallgin.com` origin as the normal HTTP requests, so there is no second port or hostname to publish.

After the tunnel configuration is active, test:

```text
https://bibster.tallgin.com/api/health
```

Then open:

```text
https://bibster.tallgin.com
```

### If your tunnel is configured with a local YAML file

An example is included at:

```text
cloudflared-config.example.yml
```

The relevant ingress rule is:

```yaml
- hostname: bibster.tallgin.com
  service: http://127.0.0.1:3000
```

A complete example:

```yaml
tunnel: YOUR-TUNNEL-UUID
credentials-file: C:\Users\YOUR-WINDOWS-USER\.cloudflared\YOUR-TUNNEL-UUID.json

ingress:
  - hostname: bibster.tallgin.com
    service: http://127.0.0.1:3000
  - service: http_status:404
```

If the tunnel is dashboard-managed, do not replace its config with this file; simply add the public hostname/service mapping to your existing tunnel.

---

# 6. Spotify setup

Create/configure your Spotify developer application and register this redirect URI exactly:

```text
https://bibster.tallgin.com/spotify/callback
```

Set its client ID in `.env`:

```env
VITE_SPOTIFY_CLIENT_ID=your_spotify_client_id
```

Then rebuild:

```powershell
npm run build
```

The Display Host uses Spotify Authorization Code + PKCE and requests:

- `streaming`
- `user-read-email`
- `user-read-private`
- `user-read-playback-state`
- `user-modify-playback-state`
- `playlist-read-private`
- `playlist-read-collaborative`

For multiplayer, only the Display Host needs to connect Spotify. The host can choose the built-in catalog or one of its loadable Spotify playlists, review/correct release years, then copy that playlist into the room before starting. Player phones see the playlist name/track count but never receive unrevealed song metadata or Spotify URIs. Solo mode uses the same signed-in Spotify account and plays through a **Phipster Solo** Web Playback device.

If your saved Spotify authorization predates playlist support, Phipster may ask you to reconnect once so Spotify can grant the playlist-read scopes.

Phipster can still start without Spotify configured, which is useful for testing multiplayer room/game flow before music playback is connected.

---

# 7. Single Player

Open:

```text
https://bibster.tallgin.com/solo
```

Solo mode has three setup steps:

1. **Choose a Spotify playlist.** Phipster lists playlists owned by your Spotify account and collaborative playlists you can edit. Spotify's current playlist-items endpoint rejects unrelated followed playlists, so those are intentionally filtered out.
2. **Review release years.** Spotify's album release year is used initially. You can edit any year manually or run the MusicBrainz checker.
3. **Start a scored run.** Choose 10, 20, 30, or all available tracks. One random track starts the timeline and the remaining selected tracks become the hidden round deck.

### Solo scoring

Each round can award:

```text
Correct chronological placement       +100
Correct song title                     +25
Correct artist / band                  +25
Consecutive-placement streak bonus     +25 per streak step, max +100/round
```

A wrong chronology placement resets the placement streak, but correct title/artist guesses still score. Equal-year songs remain valid immediately before or after one another. Best scores are stored locally in that browser separately for each playlist and session length.

### Release-year audit

Spotify exposes the album release date and track ISRC in its playlist track objects. Phipster sends only the track title, artist, ISRC (when present), and Spotify year to its own fixed `/api/metadata/year-check` endpoint. The Windows server then queries MusicBrainz at its documented rate limit and returns the recording's earliest known release date.

The checker classifies results as:

- **High confidence** — ISRC match with a strong MusicBrainz result. These mismatches can be bulk-applied with **Apply high-confidence fixes**.
- **Medium confidence** — strong title/artist text match. These are shown as suggestions but are not bulk-applied.
- **Low / uncertain** — no reliable date or match. Keep Spotify's year or enter a year manually.

This is deliberately a review tool, not an infallible automatic authority: remixes, live recordings, rerecordings, regional releases, and metadata mistakes can make multiple years defensible. Every proposed change remains visible and editable.

Corrections are stored in browser local storage under the playlist ID and are applied whenever that playlist is loaded again. The same corrections are reused when the Display Host selects that playlist for multiplayer. They do not alter the Spotify playlist itself or the shared SQLite catalog.

MusicBrainz requires a meaningful User-Agent and asks API clients to average no more than one request per second. Phipster serializes checks server-side, caches successful results in memory for the running server process, and limits each public client to 500 audit requests per hour. `FIDSTER_METADATA_CONTACT` in `.env` can be set to a public project URL or contact email; when blank, `PUBLIC_BASE_URL` is used. MusicBrainz's public API is free for non-commercial use; review MetaBrainz terms if you later turn Phipster into a commercial/public service.

---

# 8. Import songs

The database auto-seeds demo entries. For real gameplay, import songs containing Spotify track URIs.

Open:

```text
https://bibster.tallgin.com/admin
```

Use the `ADMIN_KEY` from `.env` and import JSON such as:

```json
[
  {
    "title": "Song title",
    "artist": "Artist",
    "year": 1999,
    "spotifyUri": "spotify:track:TRACK_ID"
  }
]
```

You can also import from PowerShell:

```powershell
$headers = @{ "x-admin-key" = "YOUR_ADMIN_KEY" }
$body = Get-Content .\songs.json -Raw
Invoke-RestMethod `
  -Method Post `
  -Uri "https://bibster.tallgin.com/api/admin/songs/import" `
  -Headers $headers `
  -ContentType "application/json" `
  -Body $body
```

For a real game, import enough tracks for all starting timeline cards plus the intended number of rounds.

---

# 9. Multiplayer — full rules implementation

1. Open `https://bibster.tallgin.com` on the TV/laptop and choose **Display Host**.
2. Choose **Individuals** or **Teams**. In Team mode, one connected phone represents one team.
3. Turn **FIDSTER tokens** on or off. With tokens enabled, every player/team starts with 2 tokens and can hold at most 5.
4. Choose the **song source**. You can keep the built-in SQLite catalog, or open **Choose Spotify playlist**, select one of the host account's loadable playlists, review/correct release years, and press **Use this playlist**. The room stores that playlist privately in memory.
5. Players scan the room QR code and join. Their lobby shows which song pool is active, but no unrevealed track details are sent to them.
6. Start the game. The server deals one face-up starter song to each timeline, then rotates the join order so the player/team with the **oldest starter card goes first**.
7. Before each song starts, the active player sees the pre-listen decision screen. If they have at least 3 tokens they may exchange 3 tokens for the hidden card immediately; otherwise they start the song.
8. While listening, the active player taps timeline gaps. **Every tentative position is broadcast live** and appears on the Display Host as a moving `?` card. It is not final until **Lock placement** is pressed.
9. **Every player/team may submit one song-title + artist guess on every turn**, not only the active player. Guesses are accepted from playback start until reveal, including during the FIDSTER challenge window. Each correct match independently earns that participant 1 token, up to the 5-token maximum, even if the active player's timeline placement is wrong.
10. The active player may spend 1 token after playback starts to discard/skip the current song and draw a new one. The same player keeps the turn and returns to the pre-listen screen for the replacement card. Guesses already submitted for the skipped song are final and any token already earned remains earned; the replacement song starts a fresh guessing round for everyone.
11. After the active player locks a placement, the position freezes. If tokens are enabled and another connected player/team has a token, the game opens the **FIDSTER challenge window** instead of revealing immediately. Participants who have not yet guessed may still submit their song + artist guess until the host reveals.
12. An opponent can spend 1 token and claim a different gap on the active player's timeline. Each opponent can claim once, and **no two FIDSTER tokens may claim the same gap**. Claims are ordered by the time the server receives them.
13. The Display Host presses **Reveal placement** after everybody has had a chance to challenge.
14. If the original placement is correct, the active player keeps the card and every FIDSTER bet is lost. This remains true when equal-year placements make more than one gap chronologically valid.
15. If the original placement is wrong, the first FIDSTER claim whose selected gap is chronologically valid steals the card. The stolen revealed card is inserted automatically into the winner's own timeline. If no claim is valid, the card is discarded.
16. A player/team may exchange **3 tokens before listening** to add the current card directly to their timeline without guessing. The server inserts it chronologically and marks that player/team to **skip their next turn**.
17. The first player/team to reach the configured target (10 by default) wins. A FIDSTER steal or 3-token direct card can also produce the winning card.

The chronology rule is:

```text
leftYear <= hiddenYear <= rightYear
```

when a neighbor exists. Equal-year songs can therefore be placed immediately before or after one another.

### Live placement and FIDSTER challenge states

The server uses these phases:

```text
LOBBY
  ↓
PRE-LISTEN  ← 3-token direct-card decision happens here
  ↓
LISTENING / LIVE PLACEMENT ← tentative gap is broadcast in real time
  ↓
LOCKED FIDSTER WINDOW      ← opponent token claims happen here
  ↓
REVEAL
  ↓
NEXT TURN / SKIP-NEXT processing
  ↓
GAME OVER
```

If tokens are disabled, or no connected opponent has a token available, locking a placement goes directly to the reveal.

### Song + artist token matching

Every player/team gets one independent title + artist guess per song while tokens are enabled. It does not matter whose turn it is. A participant can submit while the active player is moving the live placement, or during the locked FIDSTER challenge window before reveal. Correct guesses award 1 token independently, capped at 5 tokens per participant.

Phipster compares the submitted title and artist on the server. Matching is deliberately forgiving: it is case-insensitive, normalizes punctuation and accents, ignores leading `The`, `feat./ft.` suffixes and common version labels, and tolerates a small number of spelling mistakes based on answer length. Short or vague partial guesses are still rejected. For collaborations, the first credited artist is enough; the full artist credit also remains valid. Player clients never receive the hidden song metadata before reveal.

---

# 10. Start Phipster automatically with Windows

Once installation and `npm run build` work, Phipster can register itself with Windows Task Scheduler.

Open **PowerShell as Administrator** in the Phipster folder and run:

```powershell
npm run win:startup
```

This creates a task named:

```text
Phipster Server
```

It runs at Windows startup as `SYSTEM`, launches the exact installed `node.exe`, sets the Phipster directory as the working directory, and automatically retries after failures.

Start the task immediately without rebooting:

```powershell
Start-ScheduledTask -TaskName "Phipster Server"
```

Check its state:

```powershell
Get-ScheduledTask -TaskName "Phipster Server" | Get-ScheduledTaskInfo
```

Remove the task later with an elevated PowerShell:

```powershell
npm run win:remove-startup
```

### Project directory permissions

If you use the SYSTEM task, keep Phipster in a normal machine-level directory such as `C:\phipster` (or your existing `C:\bibster`), not in a locked-down network share or unusual user-only location. SYSTEM must be able to write to `data\bibster.sqlite`.

Your Cloudflare Tunnel can continue to run using however you already manage `cloudflared`; Phipster and cloudflared are independent processes.

---

# 11. Updating Phipster

### Updating v1.3.1 to v1.4.0

v1.4.0 adds Spotify playlist song pools to multiplayer. There is no SQLite migration and no new npm dependency. Keep `.env` and `data\bibster.sqlite`, overwrite the application files, then run:

```powershell
cd C:\bibster
npm run build
npm run test -w server
npm run win:start
```

Your existing Spotify playlist permissions, Cloudflare Tunnel, callback URI, and Windows startup setup remain unchanged. The Display Host now gets a **Song source** panel in the lobby.



### Updating v1.3.0 to v1.3.1

v1.3.1 only changes guess matching and Spotify playlist artist metadata. There is no database migration and no new npm dependency. Keep `.env` and `data\bibster.sqlite`, overwrite the application files, then run:

```powershell
cd C:\bibster
npm run build
npm run test -w server
npm run win:start
```

### Updating your existing v1.2.0 installation to v1.3.0

The SQLite song schema did not change and v1.3 adds no npm packages. Keep your existing `.env` and `data\bibster.sqlite`, replace the application files with this release, then run:

```powershell
cd C:\bibster  # existing installation; new installs may use C:\phipster
npm run build
```

An `npm install` is not required when upgrading from a working v1.2 install because no dependencies changed. Restart the interactive process or your existing `Bibster Server` task (or the new `Phipster Server` task) afterward. Existing song data is preserved. Active in-memory game rooms do not survive a server restart, so update between games.

After source changes:

```powershell
npm install
npm run build
```

If running interactively, stop the existing process with Ctrl+C and run:

```powershell
npm run win:start
```

If your current installation still uses the v1.1 task name, it continues to work:

```powershell
Stop-ScheduledTask -TaskName "Bibster Server"
Start-ScheduledTask -TaskName "Bibster Server"
```

Or, from an Administrator PowerShell, migrate it once to the new display name:

```powershell
npm run win:startup
Start-ScheduledTask -TaskName "Phipster Server"
```

The SQLite song database in `data\bibster.sqlite` is not deleted by a rebuild.

---

# 12. Local development on Windows

Run:

```powershell
npm install
npm run dev
```

Open:

```text
http://localhost:5173
```

The Vite development server proxies `/api` and `/socket.io` to the Node server on `127.0.0.1:3000`.

For Spotify local-development redirects, configure a Spotify-approved loopback redirect separately. Production continues to use:

```text
https://bibster.tallgin.com/spotify/callback
```

---

# 13. Useful commands

```powershell
# Install/build for Windows
npm run win:install

# Build after changing source or VITE_ environment values
npm run build

# Run production server interactively
npm run win:start

# Type checking
npm run typecheck

# Game-rule tests
npm run test -w server

# Register autostart (elevated PowerShell)
npm run win:startup

# Remove autostart (elevated PowerShell)
npm run win:remove-startup

# Local health check
Invoke-RestMethod http://127.0.0.1:3000/api/health
```

---

# 14. Security notes

- Phipster binds to `127.0.0.1` by default so only software on the Windows server, including `cloudflared`, can reach the origin directly.
- Cloudflare provides the public TLS/HTTPS endpoint.
- Player clients receive no hidden title, artist, year, or Spotify URI before reveal.
- The Display Host necessarily receives the current Spotify URI because its browser performs playback.
- `ADMIN_KEY` is used to protect catalog administration; keep it secret.
- The public release-year checker accepts only fixed track metadata fields, serializes MusicBrainz requests to its documented rate, and applies a 500-check/hour client limit.
- Spotify PKCE does not require a client secret in the browser.
- Active room state is in memory. Restarting Node ends active games, while the SQLite song catalog persists.

For a private friends/family server this is a practical setup. If you later expose Phipster broadly, add stronger host/admin authentication, rate limiting, stricter origin controls, structured logging, backups, and persistent room state.

## TypeScript build note: `import.meta.env`

If you previously downloaded an earlier Phipster Windows package and saw:

```text
Property 'env' does not exist on type 'ImportMeta'.
```

that package was missing `client/src/vite-env.d.ts`. The current package includes the Vite client type declaration and explicit Phipster `VITE_*` environment variable typings.

## Multiplayer reliability checks

The [27 October 2026 bug audit](docs/BUG_AUDIT_2026-10-27.md) records reproduced problems, fixes, and remaining deployment limitations.

- Spotify can be enabled/reconnected from the display during a game, including after refreshing the page. Use **Play song / retry** if the browser blocks autoplay.
- If the active player disconnects, the host can choose **Skip offline player** to discard that turn without charging a token. Other offline players are skipped when advancing turns; they retain their cards and may reconnect.
- An exhausted song pool now ends the game explicitly without a winner. A failed skip never charges a token.
- A connection banner reports network loss. Commands are not buffered while disconnected; a request timeout asks you to check the current state before retrying.
- Rooms are still held in memory: stop/restart the server only between games.

Run `npm test` for server rules and socket integration checks. For browser regression checks, run `npx playwright install chromium` once, then `npm run test:e2e`. Browser tests mock Spotify, so also check actual audio on your host device before a party.
