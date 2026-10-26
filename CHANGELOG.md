# Changelog

## 1.4.0 — Multiplayer Spotify playlist decks

### Added

- Display Host song-source selector: built-in catalog or Spotify playlist.
- Multiplayer playlist picker using the same Spotify account/scopes as Solo.
- Release-year audit and manual correction workflow in the multiplayer lobby.
- Private per-room Spotify song pool stored server-side; unrevealed playlist metadata stays off player clients.
- Active song-source name and track count in Display Host and client lobby/game UI.
- Server validation and tests for Spotify room decks, corrected years, private playback URIs, source switching, and first-artist guess matching.

### Changed

- Room state now exposes only safe song-source metadata (`catalog`/`spotify`, name, track count).
- Restarting a room preserves its selected song source.
- No database migration, new npm dependency, Spotify scope change, Cloudflare change, or Windows startup change is required.

## 1.3.1 — Forgiving title/artist guesses

### Changed

- Song-title and artist guesses now tolerate small spelling mistakes instead of requiring exact normalized equality.
- Very short or vague partial guesses remain rejected to avoid easy false positives.
- Solo playlist tracks retain Spotify's ordered artist list, so the first credited artist alone is sufficient on collaborations.
- Multiplayer catalog matching accepts the first artist for common comma-separated collaboration credits while guarding comma-style single artist names such as `Earth, Wind & Fire` and `Tyler, The Creator`.
- Guess UI now explains that close spelling counts and the first artist is enough.
- No database migration, new npm package, Cloudflare change, or Windows service change is required.

## 1.3.0 — Solo mode + Spotify playlists + release-year audit

### Added

- Single-player mode at `/solo` with scored chronology runs.
- Selectable 10/20/30/all-track sessions with per-playlist, per-session-length local best scores.
- Spotify playlist picker for playlists owned by the signed-in user or playlists they collaborate on.
- Solo Spotify playback through a dedicated **Phipster Solo** Web Playback device.
- Solo scoring: 100 points for correct chronology, 25 for title, 25 for artist, plus a placement-streak bonus up to 100 per round.
- Release-year audit against MusicBrainz, preferring ISRC matches and the recording first-release date.
- High-confidence mismatch suggestions, one-click fixes, bulk application of high-confidence ISRC fixes, and manual year editing.
- Corrected playlist years persist locally in the browser and are used by the solo game.
- Server-side MusicBrainz throttling/cache and a fixed metadata lookup endpoint; no MusicBrainz credentials are required for personal/non-commercial use.

### Changed

- Spotify login now also requests `playlist-read-private` and `playlist-read-collaborative`. Existing Spotify sessions remain valid for multiplayer; Solo prompts for a one-time reconnect when playlist permission is missing.
- Home screen now offers Display Host, Single Player, and Client modes.
- No database migration, new npm package, Cloudflare change, or Windows service change is required.

## 1.2.0 — Phipster rename + everyone can guess

### Added

- Every connected player/team can submit one song-title + artist guess on every song, even when it is another participant's turn.
- Guesses remain open through the locked FIDSTER challenge window until the host reveals.
- The Display Host shows how many participants have submitted a guess and lists all guess results at reveal.
- Each correct participant independently earns 1 token, still capped at 5.

### Changed

- Public game branding is now **Phipster**.
- FIDSTER challenge/token markers now use `F` in the UI.
- Existing `bibster.tallgin.com`, SQLite filename, browser storage keys, and socket event identifiers remain compatible with the current deployment.

## 1.1.0 — Full game rules

### Added

- Optional FIDSTER token mode with 2 starting tokens and a maximum of 5.
- Earn 1 token by correctly naming both song title and artist.
- Spend 1 token on your turn to discard the current song and draw another without ending the turn.
- Spend 3 tokens before listening to add the current card directly to the timeline; the player then skips their next turn.
- Opponent FIDSTER challenge window after a placement is locked.
- Multiple FIDSTER claims in server arrival order, with one claim per opponent and no duplicate claimed slots.
- Correct challenge steals the card when the original placement is wrong.
- Original player keeps the card whenever their placement is valid, including equal-year edge cases; all challenge tokens are still spent.
- Live placement preview broadcast while the active player is deciding, visible on the Display Host and other clients.
- Locked placement and named FIDSTER token markers on the Display Host.
- Individual / team mode; in team mode one connected client represents one team.
- Oldest starter card determines the first turn while retaining join order as clockwise order.
- Server-side player/socket ownership checks for game actions.
- Full rule-engine tests for chronology and token flows.

### Changed

- Added a pre-listen game phase so the 3-token exchange can happen before music playback.
- Locking a placement opens a challenge window when an eligible opponent has a token; otherwise it reveals immediately.
- Scoreboard now shows token counts and pending skip-next-turn status.
- Reveal UI shows steals, token guesses, and challenge resolution.

### Deployment

- Still runs directly on Windows with Node.js.
- Still binds to `127.0.0.1:3000` by default.
- Existing Cloudflare Tunnel configuration is unchanged.
- SQLite song schema is unchanged from v1.0.x.
