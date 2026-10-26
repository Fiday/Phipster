# phipster v1.3.0 upgrade — Solo mode

This upgrade is designed for the existing Windows + Cloudflare Tunnel installation at `C:\bibster`.

## Preserved as-is

Keep these files/data from your current installation:

- `C:\bibster\.env`
- `C:\bibster\data\bibster.sqlite`
- your existing Cloudflare Tunnel/public hostname configuration
- your existing Windows scheduled task

There is no SQLite migration and no new npm dependency in v1.3.0.

## Upgrade

1. Finish any active multiplayer room (rooms are in memory and disappear on restart).
2. Stop phipster.
3. Extract the v1.3.0 upgrade patch into `C:\bibster` and allow Windows to overwrite files.
4. Rebuild:

```powershell
cd C:\bibster
npm run build
npm run test -w server
```

5. Start phipster again:

```powershell
npm run win:start
```

Or restart your Task Scheduler task.

## Spotify permission update

Solo mode adds these OAuth scopes:

- `playlist-read-private`
- `playlist-read-collaborative`

Existing Spotify login state still works for multiplayer. When you first open **Single Player**, phipster detects an old token that does not contain playlist access and offers **Reconnect Spotify**. Do that once; the callback URL remains:

```text
https://bibster.tallgin.com/spotify/callback
```

No Spotify developer-dashboard redirect change is needed if that URL is already registered.

## Release-year checker

No MusicBrainz API key is needed. The server identifies itself using `PUBLIC_BASE_URL` by default. Optionally add this to `.env`:

```env
phipster_METADATA_CONTACT=https://bibster.tallgin.com
```

A contact email can also be used. This value is only sent as the contact identifier in phipster's MusicBrainz User-Agent.

## Cloudflare

No change. Keep routing:

```text
bibster.tallgin.com -> http://127.0.0.1:3000
```

The new Solo page and metadata endpoint are served by the same Node process and hostname.
