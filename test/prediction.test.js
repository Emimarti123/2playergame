'use strict';

// Predicción del cliente: se simula un servidor y un cliente unidos por una "red" con
// latencia fija (en ticks), como en el juego real.

const test = require('node:test');
const assert = require('node:assert/strict');
const { getConfig } = require('../server/config');
const G = require('../server/game');

const DT = 1 / 60;

function setupNet(latencyTicks) {
  const cfg = getConfig();
  const server = G.createGame(cfg);
  const client = G.createPredictor(cfg, 'left');
  const toServer = []; // { at, input, n }
  const toClient = []; // { at, st, n, nt }
  let tick = 0;
  const corrections = [];

  return {
    server,
    client,
    corrections,
    press(input) {
      const n = client.setInput(input);
      toServer.push({ at: tick + latencyTicks, input, n });
    },
    step() {
      tick++;
      // Servidor: aplica inputs que ya llegaron y simula un tick
      while (toServer.length && toServer[0].at <= tick) {
        const m = toServer.shift();
        G.setInput(server, 'left', m.input);
        server.players.left.seq = m.n;
        server.players.left.seqTicks = 0;
      }
      G.step(server, DT);
      const p = server.players.left;
      toClient.push({ at: tick + latencyTicks, st: G.exportState(p), n: p.seq, nt: p.seqTicks });
      // Cliente: simula su tick y reconcilia con los snapshots que llegaron
      client.tick(DT, false);
      while (toClient.length && toClient[0].at <= tick) {
        const s = toClient.shift();
        const r = client.reconcile(s.st, s.n, s.nt, DT);
        corrections.push(Math.hypot(r.dx, r.dy));
      }
    },
    run(ticks) { for (let i = 0; i < ticks; i++) this.step(); },
  };
}

test('el ninja propio responde al instante (sin esperar al servidor)', () => {
  const net = setupNet(6); // ~100 ms de ida y vuelta
  net.press({ r: true });
  net.step();
  assert.ok(net.client.player.vx > 0, 'el cliente ya se mueve en el primer tick');
  assert.equal(net.server.players.left.vx, 0, 'el servidor todavía no recibe el input');
});

test('sin interferencias, la predicción coincide con el servidor y no necesita correcciones', () => {
  const net = setupNet(6);
  net.run(30); // primeros snapshots (antes de cualquier input se toman tal cual)
  const plan = [
    [{ r: true }, 20], [{ r: true, u: true }, 3], [{ r: true }, 25], [{}, 10],
    [{ l: true }, 15], [{ l: true, a: true }, 2], [{ l: true }, 30], [{ p: true }, 2], [{}, 40],
    [{ u: true }, 1], [{}, 1], [{ r: true, f: true }, 1], [{ r: true }, 20], [{}, 60],
  ];
  net.corrections.length = 0;
  for (const [input, ticks] of plan) {
    net.press(input);
    net.run(ticks);
  }
  net.run(30); // que llegue todo
  const max = Math.max(...net.corrections);
  assert.ok(max < 1e-6, `corrección máxima ${max}`);
  const c = net.client.player, s = net.server.players.left;
  assert.ok(Math.abs(c.x - s.x) < 1e-6 && Math.abs(c.y - s.y) < 1e-6, 'misma posición final');
});

test('un toque rápido (presionar y soltar entre dos ticks) se predice igual que en el servidor', () => {
  const net = setupNet(5);
  net.run(20);
  net.corrections.length = 0;
  net.press({ u: true });
  net.press({});
  net.run(60);
  assert.ok(Math.max(...net.corrections) < 1e-6);
  assert.ok(net.client.player.grounded);
});

test('si el servidor decide otra cosa (un golpe), el cliente se corrige', () => {
  const net = setupNet(6);
  net.run(20);
  net.press({ r: true });
  net.run(10);
  // El servidor aplica un golpe que el cliente no podía prever
  const p = net.server.players.left;
  p.vx = -500; p.vy = -400; p.grounded = false; p.hurtT = 0.35; p.hp -= 1;
  net.run(20);
  const max = Math.max(...net.corrections);
  assert.ok(max > 1, 'hubo corrección');
  assert.equal(net.client.player.hp, net.server.players.left.hp, 'la vida viene del servidor');
  net.press({});
  net.run(60);
  assert.ok(Math.abs(net.client.player.x - net.server.players.left.x) < 1e-6, 'y vuelve a coincidir');
});

test('el snapshot trae el estado completo y el número de input', () => {
  const g = G.createGame(getConfig());
  const p = g.players.right;
  p.x = 123.5; p.action = 'slash'; p.actionT = 0.1;
  const st = G.exportState(p);
  const q = G.createGame(getConfig()).players.right;
  G.importState(q, st);
  assert.equal(q.x, 123.5);
  assert.equal(q.action, 'slash');
  assert.equal(q.actionT, 0.1);
});
