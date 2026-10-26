# phipster v1.3.1 upgrade

This is a small source-only upgrade from v1.3.0. It makes title/artist guessing more forgiving and allows the first Spotify artist to count on collaborations.

## Keep these files

Do not delete or replace your existing:

- `C:\bibster\.env`
- `C:\bibster\data\bibster.sqlite`

Your Cloudflare Tunnel and Spotify redirect URI stay unchanged.

## Install

1. Stop phipster.
2. Extract the v1.3.1 upgrade ZIP over `C:\bibster`, allowing files to be overwritten.
3. Run:

```powershell
cd C:\bibster
npm run build
npm run test -w server
npm run win:start
```

No `npm install` is required when upgrading from v1.3.0 because this release adds no dependencies.

## Guess behavior

Examples that are accepted:

- `Bohemain Rhapsody` for `Bohemian Rhapsody`
- `Under Presure` for `Under Pressure`
- `Quen` for `Queen`
- `Queen` for a Spotify credit of `Queen, David Bowie`

Examples deliberately rejected:

- `Hotel` for `Hotel California`
- `U3` for `U2`
- `Earth` for `Earth, Wind & Fire`

The tolerance scales with answer length, so longer names can absorb a couple of typing errors while very short names remain strict.
