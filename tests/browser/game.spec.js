import { test, expect } from '@playwright/test';

async function mockSpotify(page) {
  await page.addInitScript(() => {
    localStorage.setItem('phipster.spotify.tokens', JSON.stringify({ accessToken: 'test', refreshToken: 'test', expiresAt: Date.now() + 600000, scope: 'playlist-read-private' }));
    window.Spotify = { Player: class {
      listeners = {};
      addListener(event, callback) { this.listeners[event] = callback; return true; }
      connect() { queueMicrotask(() => this.listeners.ready?.({ device_id: 'test-device' })); return Promise.resolve(true); }
      disconnect() {}
      activateElement() { return Promise.resolve(); }
      togglePlay() { return Promise.resolve(); }
    } };
  });
  await page.route('https://api.spotify.com/v1/me/player**', route => route.fulfill({ status: 204 }));
}

async function roomWithPhones(page, browser) {
  await page.goto('/display');
  const code = await page.locator('.room-chip strong').innerText();
  const contexts = await Promise.all([browser.newContext(), browser.newContext()]);
  const phones = [];
  for (const [index, context] of contexts.entries()) {
    const phone = await context.newPage(); phones.push(phone);
    await phone.goto(`http://127.0.0.1:5173/join/${code}`);
    await phone.getByPlaceholder('e.g. Anna or Team Disco').fill(`Player ${index + 1}`);
    await phone.getByRole('button', { name: 'Join game', exact: true }).click();
    await expect(phone.getByText(`You're in, Player ${index + 1}.`)).toBeVisible();
  }
  await page.getByRole('button', { name: 'Start game', exact: true }).click();
  await expect(page.getByText('BEFORE LISTENING', { exact: true })).toBeVisible();
  const activeName = (await page.locator('.reveal-copy h1').innerText()).replace("'s turn", '');
  const activeIndex = activeName === 'Player 1' ? 0 : 1;
  return { contexts, phones, active: phones[activeIndex], opponent: phones[1 - activeIndex] };
}

test('two phones place, challenge, reveal, refresh and continue', async ({ page, browser }) => {
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  const { contexts, active, opponent } = await roomWithPhones(page, browser);
  try {
    await active.getByRole('button', { name: 'Start song', exact: true }).click();
    await active.getByRole('button', { name: 'Place token in position 1', exact: true }).click();
    await expect(page.locator('.ghost-card')).toBeVisible();
    await active.getByRole('button', { name: 'Lock placement', exact: true }).click();
    await opponent.getByRole('button', { name: 'Place token in position 2', exact: true }).click();
    opponent.once('dialog', dialog => dialog.accept());
    await opponent.getByRole('button', { name: 'Call FIDSTER — spend 1 token', exact: true }).click();
    await expect(page.locator('.challenge-marker')).toBeVisible();
    await page.getByRole('button', { name: 'Reveal placement', exact: true }).click();
    await expect(active.getByText('REVEAL', { exact: true })).toBeVisible();
    await page.reload();
    await expect(page.getByRole('button', { name: 'Next turn', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Next turn', exact: true }).click();
    await expect(opponent.getByRole('button', { name: 'Start song', exact: true })).toBeVisible();
    expect(errors).toEqual([]);
  } finally { await Promise.all(contexts.map(context => context.close())); }
});

test('Spotify can be enabled after reloading an ongoing game', async ({ page, browser }) => {
  await mockSpotify(page);
  const { contexts, active } = await roomWithPhones(page, browser);
  try {
    await active.getByRole('button', { name: 'Start song', exact: true }).click();
    await page.reload();
    await page.getByRole('button', { name: 'Enable player', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Reconnect player', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Play song / retry', exact: true })).toBeVisible();
  } finally { await Promise.all(contexts.map(context => context.close())); }
});

test('a disconnected active player can be skipped without ending the room', async ({ page, browser }) => {
  const { contexts, active } = await roomWithPhones(page, browser);
  try {
    await active.context().setOffline(true);
    // Close the page to deliver a definite disconnect instead of waiting for heartbeat expiry.
    await active.close();
    await page.getByRole('button', { name: 'Skip offline player', exact: true }).click();
    await expect(page.getByText(/host skipped this turn/)).toBeVisible();
    await page.getByRole('button', { name: 'Next turn', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Start song', exact: true })).toBeVisible();
  } finally { await Promise.all(contexts.map(context => context.close())); }
});

test('Spotify account errors and false connect results reject initialization promptly', async ({ page }) => {
  await mockSpotify(page);
  await page.goto('/');
  const results = await page.evaluate(async () => {
    const { phipsterSpotifyPlayer } = await import('/src/lib/spotify.ts');
    const outcomes = [];
    for (const mode of ['account_error', 'false']) {
      window.Spotify.Player = class {
        listeners = {};
        addListener(event, callback) { this.listeners[event] = callback; return true; }
        disconnect() {}
        connect() {
          if (mode === 'account_error') queueMicrotask(() => this.listeners.account_error({ message: 'Premium required' }));
          return Promise.resolve(mode !== 'false');
        }
      };
      const player = new phipsterSpotifyPlayer();
      const result = await Promise.race([
        player.init(() => {}).then(() => 'unexpected success', error => error.message),
        new Promise(resolve => setTimeout(() => resolve('hung'), 1000)),
      ]);
      outcomes.push(result); player.destroy();
    }
    return outcomes;
  });
  expect(results[0]).toBe('Premium required');
  expect(results[1]).toContain('could not connect');
});

test('a slow earlier playlist response cannot replace the latest selection', async ({ page }) => {
  await mockSpotify(page);
  await page.route('https://api.spotify.com/v1/me', route => route.fulfill({ json: { id: 'me' } }));
  const playlists = ['Slow', 'Latest'].map(name => ({ id: name, name, owner: { id: 'me' }, collaborative: false, items: { total: 12 } }));
  await page.route('https://api.spotify.com/v1/me/playlists**', route => route.fulfill({ json: { items: playlists, next: null } }));
  let slowRoute;
  await page.route('https://api.spotify.com/v1/playlists/*/items**', async route => {
    if (route.request().url().includes('/Slow/')) { slowRoute = route; return; }
    await route.fulfill({ json: { items: [], next: null } });
  });
  await page.goto('/display');
  await page.getByRole('button', { name: 'Choose Spotify playlist', exact: true }).click();
  await page.getByRole('button', { name: /Slow.*12 items/ }).click();
  await expect.poll(() => Boolean(slowRoute)).toBe(true);
  await page.getByRole('button', { name: /Latest.*12 items/ }).click();
  await expect(page.locator('.multiplayer-playlist-audit')).toContainText('0 playable');
  await slowRoute.fulfill({ json: { items: [{ item: { id: 'old', type: 'track', uri: 'spotify:track:old', name: 'Wrong old song', artists: [{ name: 'Artist' }], album: { name: 'Old', release_date: '2000' } } }], next: null } });
  await expect(page.locator('.multiplayer-playlist-audit')).not.toContainText('Wrong old song');
  await expect(page.locator('.multiplayer-playlist-audit')).toContainText('0 playable');
});

test('simultaneous Spotify refreshes share one request and temporary failure preserves login', async ({ page }) => {
  await mockSpotify(page);
  await page.goto('/');
  let refreshes = 0;
  await page.route('https://accounts.spotify.com/api/token', route => {
    refreshes++;
    return route.fulfill({ json: { access_token: 'renewed', refresh_token: 'rotated', expires_in: 3600 } });
  });
  const tokens = await page.evaluate(async () => {
    const storageKey = 'phipster.spotify.tokens';
    const saved = JSON.parse(localStorage.getItem(storageKey)); saved.expiresAt = 0;
    localStorage.setItem(storageKey, JSON.stringify(saved));
    const { getSpotifyAccessToken } = await import('/src/lib/spotify.ts');
    return Promise.all([getSpotifyAccessToken(), getSpotifyAccessToken(), getSpotifyAccessToken()]);
  });
  expect(tokens).toEqual(['renewed', 'renewed', 'renewed']);
  expect(refreshes).toBe(1);
  await page.unroute('https://accounts.spotify.com/api/token');
  await page.route('https://accounts.spotify.com/api/token', route => route.fulfill({ status: 503 }));
  const failure = await page.evaluate(async () => {
    const storageKey = 'phipster.spotify.tokens';
    const saved = JSON.parse(localStorage.getItem(storageKey)); saved.expiresAt = 0;
    localStorage.setItem(storageKey, JSON.stringify(saved));
    const { getSpotifyAccessToken } = await import('/src/lib/spotify.ts');
    try { await getSpotifyAccessToken(); } catch (error) {
      return { message: error.message, saved: Boolean(localStorage.getItem(storageKey)) };
    }
  });
  expect(failure.message).toContain('503');
  expect(failure.saved).toBe(true);
});

test('pause waits for an in-flight play request so old audio cannot restart after reveal', async ({ page }) => {
  await mockSpotify(page);
  await page.goto('/');
  const order = await page.evaluate(async () => {
    const { phipsterSpotifyPlayer } = await import('/src/lib/spotify.ts');
    const player = new phipsterSpotifyPlayer();
    await player.init(() => {});
    const originalFetch = window.fetch;
    const calls = [];
    let finishPlay;
    const pending = new Promise(resolve => { finishPlay = resolve; });
    window.fetch = async (url, options) => {
      if (String(url).includes('/me/player/play?')) {
        calls.push('play-start'); await pending; calls.push('play-end');
        return new Response(null, { status: 204 });
      }
      if (String(url).includes('/me/player/pause?')) {
        calls.push('pause'); return new Response(null, { status: 204 });
      }
      return originalFetch(url, options);
    };
    const playing = player.playUri('spotify:track:test');
    const pausing = player.pause();
    await new Promise(resolve => setTimeout(resolve, 0));
    finishPlay();
    await Promise.all([playing, pausing]);
    window.fetch = originalFetch; player.destroy();
    return calls;
  });
  expect(order).toEqual(['play-start', 'play-end', 'pause']);
});
