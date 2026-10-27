import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { io } from 'socket.io-client';

let server, baseUrl, directory;
const sockets = [];
before(async () => {
  directory = await mkdtemp(join(tmpdir(), 'phipster-test-'));
  server = spawn(process.execPath, ['server/dist/index.js'], {
    env: { ...process.env, PORT: '0', HOST: '127.0.0.1', DB_PATH: join(directory, 'test.sqlite') },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  baseUrl = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Server startup timed out')), 10000);
    server.once('exit', code => { clearTimeout(timer); reject(new Error(`Server exited: ${code}`)); });
    server.stdout.on('data', data => {
      const match = String(data).match(/listening on (http:\/\/[^\s]+)/);
      if (match) { clearTimeout(timer); resolve(match[1]); }
    });
    server.stderr.on('data', data => process.stderr.write(data));
  });
});
after(async () => {
  sockets.forEach(socket => socket.disconnect());
  if (server && server.exitCode === null) {
    await new Promise(resolve => { server.once('exit', resolve); server.kill(); });
  }
  if (directory) await rm(directory, { recursive: true, force: true });
});
async function connect() {
  const socket = io(baseUrl, { forceNew: true, reconnection: false });
  sockets.push(socket);
  await new Promise((resolve, reject) => { socket.once('connect', resolve); socket.once('connect_error', reject); });
  return socket;
}
async function request(socket, event, payload = {}) {
  const reply = await socket.timeout(3000).emitWithAck(event, payload);
  assert.equal(reply.ok, true, reply.error);
  return reply.data;
}
function nextState(socket, predicate) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { socket.off('room:state', listener); reject(new Error('Missing room state')); }, 3000);
    const listener = state => {
      if (!predicate(state)) return;
      clearTimeout(timer); socket.off('room:state', listener); resolve(state);
    };
    socket.on('room:state', listener);
  });
}

test('malformed events without acknowledgements do not crash the server', async () => {
  const client = await connect();
  client.emit('player:join', null);
  client.emit('room:create', {});
  const room = await request(client, 'room:create');
  assert.match(room.code, /^[A-Z2-9]{4}$/);
  assert.equal((await fetch(`${baseUrl}/api/health`)).status, 200);
});

test('switching rooms detaches old presence and stops cross-room broadcasts', async () => {
  const hostA = await connect(), hostB = await connect(), player = await connect();
  const a = await request(hostA, 'room:create'), b = await request(hostB, 'room:create');
  const joined = await request(player, 'player:join', { code: a.code, name: 'Anna' });
  const left = nextState(hostA, state => state.players.some(p => p.id === joined.playerId && !p.connected));
  await request(player, 'player:join', { code: b.code, name: 'Anna' });
  await left;
  const received = [];
  player.on('room:state', state => received.push(state.code));
  // Same server sends A then B; receipt of B is an ordering barrier, no sleep needed.
  await request(hostA, 'game:restart', { code: a.code, hostToken: a.hostToken });
  const bUpdate = nextState(player, state => state.code === b.code);
  await request(hostB, 'game:restart', { code: b.code, hostToken: b.hostToken });
  await bUpdate;
  assert.equal(received.includes(a.code), false);
});

test('host and two phones complete a challenge, reconnect, skip, and restart', async () => {
  const host = await connect(), phoneA = await connect(), phoneB = await connect();
  const room = await request(host, 'room:create');
  const a = await request(phoneA, 'player:join', { code: room.code, name: 'A' });
  const b = await request(phoneB, 'player:join', { code: room.code, name: 'B' });
  const started = nextState(host, state => state.phase === 'prelisten');
  await request(host, 'game:start', { code: room.code, hostToken: room.hostToken, winTarget: 10 });
  const state = await started;
  const active = state.currentPlayerId === a.playerId ? a : b;
  const phone = active === a ? phoneA : phoneB;
  const identity = { code: room.code, playerId: active.playerId };
  await request(phone, 'player:start-song', identity);
  const skipped = nextState(host, state => state.phase === 'prelisten' && state.round === 2);
  await request(phone, 'player:skip', identity);
  assert.equal((await skipped).players.find(p => p.id === active.playerId).tokens, 1);
  await request(phone, 'player:start-song', identity);
  await request(phone, 'player:preview', { ...identity, slot: 0 });
  await request(phone, 'player:lock', { ...identity, slot: 0 });
  const challenged = nextState(host, state => state.phase === 'reveal');
  await request(host, 'game:reveal', { code: room.code, hostToken: room.hostToken });
  await challenged;
  await request(host, 'game:next', { code: room.code, hostToken: room.hostToken });
  const detached = nextState(host, state => !state.players.find(p => p.id === active.playerId).connected);
  phone.disconnect();
  await detached;
  const replacement = await connect();
  const rejoined = await request(replacement, 'player:join', { code: room.code, name: active === a ? 'A' : 'B', reconnectToken: active.reconnectToken });
  assert.equal(rejoined.playerId, active.playerId);
  assert.equal(rejoined.state.players.length, 2);
  const restarted = nextState(host, state => state.phase === 'lobby');
  await request(host, 'game:restart', { code: room.code, hostToken: room.hostToken });
  assert.equal((await restarted).round, 0);
});
