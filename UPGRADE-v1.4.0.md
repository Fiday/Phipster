# Phipster v1.4.0 upgrade — multiplayer Spotify playlists

This update is intended for an existing **Phipster v1.3.1** installation such as `C:\bibster`.

## What changed

- The Display Host lobby now has a **Song source** panel.
- Multiplayer can use either the existing SQLite catalog or a Spotify playlist selected by the Display Host.
- Spotify playlist tracks are copied into the active room as a private in-memory deck; player clients never receive unrevealed track metadata or Spotify URIs.
- The Display Host can run the same MusicBrainz release-year checks used in Solo, manually edit years, and apply high-confidence fixes before loading the playlist into the room.
- Per-playlist year corrections are shared with Solo mode through the existing browser-local correction storage.
- Clients see the selected playlist name and track count, but still only receive revealed song information.
- Restarting a game keeps the room's selected song source. You can switch back to the built-in catalog from the lobby.
- No new npm packages, database migration, Spotify scopes, callback URL, Cloudflare settings, or Windows service changes are required.

## Upgrade

Stop Phipster, extract the v1.4.0 patch over `C:\bibster`, and keep these files:

```text
C:\bibster\.env
C:\bibster\data\bibster.sqlite
```

Then run:

```powershell
cd C:\bibster
npm run build
npm run test -w server
npm run win:start
```

If you run Phipster using Task Scheduler, restart the existing task instead of `npm run win:start`.

## Using a playlist in multiplayer

1. Open **Display Host**.
2. Connect Spotify and enable the playback device as usual.
3. In **Song source**, choose **Choose Spotify playlist**.
4. Pick a playlist you own or collaborate on.
5. Optionally check/correct release years.
6. Press **Use this playlist**.
7. Join player phones and start the game normally.

The server validates that the selected song pool has enough tracks for the current number of players and win target.
