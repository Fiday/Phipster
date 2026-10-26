# phipster v1.2.0 upgrade

This release can replace phipster/phipster v1.1.0 without changing your Cloudflare Tunnel, database, or Spotify redirect URL.

## Existing installation at C:\phipster

1. Finish any active game. Rooms are held in memory and do not survive a restart.
2. Keep these existing files/directories:
   - `C:\phipster\.env`
   - `C:\phipster\data\phipster.sqlite`
3. Extract the v1.2.0 upgrade patch directly into `C:\phipster` and allow Windows to overwrite the application files.
4. Open PowerShell:

```powershell
cd C:\phipster
npm run build
npm run test -w server
```

No new npm packages were added in v1.2.0. If your existing `node_modules` is intact, an additional `npm install` is not required.

5. Restart phipster:

```powershell
npm run win:start
```

If you use the old v1.1 scheduled task, it still works:

```powershell
Stop-ScheduledTask -TaskName "phipster Server"
Start-ScheduledTask -TaskName "phipster Server"
```

To rename that scheduled task to `phipster Server`, run this once from an Administrator PowerShell:

```powershell
cd C:\phipster
npm run win:startup
Start-ScheduledTask -TaskName "phipster Server"
```

## Compatibility intentionally retained

- Public URL: `https://phipster.tallgin.com`
- Cloudflare Tunnel upstream: `http://127.0.0.1:3000`
- SQLite database: `data\phipster.sqlite`
- Existing `.env`
- Existing browser storage / reconnect sessions

The visible game name is now **phipster**.
