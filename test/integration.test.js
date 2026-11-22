'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { io: connectClient } = require('socket.io-client');
const { createServer } = require('../server/index');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function withServer(fn, opts = {}) {
  const server = createServer({ RECONNECT_GRACE_MS: 300, ...opts });
  const port = await server.start(0);
  const url = `http://127.0.0.1:${port}`;
  const clients = [];
  const connect = (playerId) =>
    new Promise((resolve) => {
      const socket = connectClient(url, {
        auth: { playerId },
        forceNew: true,
        reconnection: false,
        transports: ['websocket'],
      });
      const c = { socket, states: 0, joined: null, connected: false, error: null, lastState: null };
      socket.on('state', (s) => { c.states++; c.lastState = s; });
      socket.on('joined', (j) => (c.joined = j));
      socket.on('connect', () => (c.connected = true));
      socket.on('connect_error', (e) => {
        c.error = e.message;
        resolve(c);
      });
      socket.on('phase', () => {
        if (c.joined) resolve(c);
      });
      clients.push(c);
    });
  try {
    await fn({ server, connect, url });
  } finally {
    for (const c of clients) c.socket.close();
    await server.close();
  }
}

test('sirve la página del juego y el generador de sprites', () =>
  withServer(async ({ url }) => {
    const html = await (await fetch(url + '/')).text();
    assert.match(html, /Mikyosho/);
    assert.match(html, /sprites\.js/);
    const js = await fetch(url + '/sprites.js');
    assert.equal(js.status, 200);
    assert.match(await js.text(), /NinjaSprites/);
  }));

test('1º y 2º cliente reciben lados distintos', () =>
  withServer(async ({ connect }) => {
    const a = await connect('player-aaaa');
    const b = await connect('player-bbbb');
    assert.equal(a.joined.side, 'left');
    assert.equal(b.joined.side, 'right');
  }));

test('el 3º cliente recibe duel_full, no conecta y nunca recibe state', () =>
  withServer(async ({ connect }) => {
    const a = await connect('player-aaaa');
    const b = await connect('player-bbbb');
    const c = await connect('player-cccc');
    assert.equal(c.error, 'duel_full');
    assert.equal(c.connected, false);
    assert.equal(c.joined, null);
    await sleep(300);
    assert.ok(a.states > 0 && b.states > 0, 'los jugadores sí reciben state');
    assert.equal(c.states, 0, 'el rechazado nunca recibe state');
  }));

test('un 3º tampoco entra mientras un jugador está en gracia de reconexión', () =>
  withServer(async ({ connect }) => {
    const a = await connect('player-aaaa');
    await connect('player-bbbb');
    a.socket.close();
    await sleep(80);
    const c = await connect('player-cccc');
    assert.equal(c.error, 'duel_full');
  }));

test('reconexión con el mismo playerId recupera el lado; tras la gracia entra otro', () =>
  withServer(async ({ connect }) => {
    const a = await connect('player-aaaa');
    const b = await connect('player-bbbb');
    a.socket.close();
    await sleep(80);
    const a2 = await connect('player-aaaa');
    assert.equal(a2.joined.side, 'left');
    b.socket.close();
    await sleep(500);
    const n = await connect('player-dddd');
    assert.equal(n.joined.side, 'right');
  }));

test('input inválido se ignora; input válido mueve al ninja', () =>
  withServer(async ({ connect, server }) => {
    const a = await connect('player-aaaa');
    await connect('player-bbbb');
    a.socket.emit('input', { r: 'si' });
    a.socket.emit('input', 'basura');
    a.socket.emit('input', { hack: true });
    await sleep(100);
    assert.equal(server.duel.game.players.left.input.r, false);
    a.socket.emit('input', { r: true });
    await sleep(100);
    assert.equal(server.duel.game.players.left.input.r, true);
  }));

test('flujo completo: ambos listos → cuenta regresiva → PLAYING y los shurikens viajan', () =>
  withServer(async ({ connect, server }) => {
    const a = await connect('player-aaaa');
    const b = await connect('player-bbbb');
    a.socket.emit('ready');
    b.socket.emit('ready');
    await sleep(100);
    assert.equal(server.duel.phase, 'COUNTDOWN');
    await sleep(server.cfg.COUNTDOWN_MS + 200);
    assert.equal(server.duel.phase, 'PLAYING');
    a.socket.emit('input', { f: true });
    await sleep(150);
    assert.ok(b.lastState.stars.length >= 1, 'el rival ve el shuriken');
  }));

test('select: el jugador cambia escenario y personaje; un id fuera del catálogo se ignora', () =>
  withServer(async ({ connect, server }) => {
    const a = await connect('player-aaaa');
    await connect('player-bbbb');
    a.socket.emit('select', { stage: 'noche' });
    a.socket.emit('select', { char: 'no-existe' });
    await sleep(100);
    assert.equal(server.duel.stagePicks.left, 'noche');
    assert.equal(server.duel.chars.left, 'ninja');
  }));

test('sirve la física compartida para la predicción y manda la configuración al entrar', () =>
  withServer(async ({ url, connect }) => {
    const js = await (await fetch(url + '/game-core.js')).text();
    assert.match(js, /createPredictor/);
    const a = await connect('player-aaaa');
    assert.equal(typeof a.joined.cfg.GRAVITY, 'number');
    assert.equal(a.joined.cfg.PORT, undefined, 'no se mandan datos del servidor');
  }));
