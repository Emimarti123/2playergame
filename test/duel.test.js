'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { Duel } = require('../server/duel');

function setup(opts = {}) {
  const events = [];
  const duel = new Duel({ RECONNECT_GRACE_MS: 1000, WIN_SCORE: 2, ...opts }, (e, p, side) => events.push({ e, p, side }));
  const names = () => events.map((x) => x.e);
  return { duel, events, names };
}

function startPlaying(duel) {
  duel.join('player-aaaa', 's1');
  duel.join('player-bbbb', 's2');
  duel.ready('left');
  duel.ready('right');
  duel.tick(duel.cfg.COUNTDOWN_MS);
  assert.equal(duel.phase, 'PLAYING');
}

// Fuerza un KO del lado `victim` disparándole un shuriken a quemarropa.
function koSide(duel, victim) {
  const g = duel.game;
  const v = g.players[victim];
  v.hp = 1;
  v.invT = 0;
  g.stars.push({ id: 999, owner: victim === 'left' ? 'right' : 'left', x: v.x, y: v.y - 30, vx: 1 });
  duel.tick(16);
}

test('1er y 2º jugador reciben lados distintos; el 3º es rechazado', () => {
  const { duel } = setup();
  const a = duel.join('player-aaaa', 's1');
  const b = duel.join('player-bbbb', 's2');
  assert.deepEqual([a.side, b.side], ['left', 'right']);
  assert.equal(duel.canJoin('player-cccc'), false);
  const c = duel.join('player-cccc', 's3');
  assert.equal(c.ok, false);
  assert.equal(c.reason, 'duel_full');
});

test('fases: WAITING → READY → COUNTDOWN → PLAYING', () => {
  const { duel } = setup();
  assert.equal(duel.phase, 'WAITING');
  duel.join('player-aaaa', 's1');
  assert.equal(duel.phase, 'WAITING');
  duel.join('player-bbbb', 's2');
  assert.equal(duel.phase, 'READY');
  duel.ready('left');
  assert.equal(duel.phase, 'READY');
  duel.ready('right');
  assert.equal(duel.phase, 'COUNTDOWN');
  duel.tick(duel.cfg.COUNTDOWN_MS - 1);
  assert.equal(duel.phase, 'COUNTDOWN');
  duel.tick(1);
  assert.equal(duel.phase, 'PLAYING');
});

test('KO → punto, pausa con reinicio de ronda y vuelta a PLAYING', () => {
  const { duel, names } = setup();
  startPlaying(duel);
  koSide(duel, 'right');
  assert.equal(duel.phase, 'POINT_PAUSE');
  assert.deepEqual(duel.game.score, { left: 1, right: 0 });
  assert.ok(names().includes('point'));
  assert.equal(duel.game.players.right.hp, 0);
  duel.tick(duel.cfg.ROUND_RESET_AT_MS);
  assert.equal(duel.round, 2);
  assert.equal(duel.game.players.right.hp, duel.cfg.MAX_HP);
  duel.tick(duel.cfg.POINT_PAUSE_MS);
  assert.equal(duel.phase, 'PLAYING');
});

test('llegar a WIN_SCORE termina el duelo y la revancha reinicia', () => {
  const { duel, names } = setup();
  startPlaying(duel);
  koSide(duel, 'left');
  duel.tick(duel.cfg.POINT_PAUSE_MS);
  duel.tick(duel.cfg.POINT_PAUSE_MS);
  koSide(duel, 'left');
  assert.equal(duel.phase, 'GAME_OVER');
  assert.equal(duel.winner, 'right');
  assert.ok(names().includes('game_over'));
  duel.rematch('left');
  assert.equal(duel.phase, 'GAME_OVER');
  duel.rematch('right');
  assert.equal(duel.phase, 'COUNTDOWN');
  assert.deepEqual(duel.game.score, { left: 0, right: 0 });
  assert.equal(duel.round, 1);
});

test('desconexión: el slot se reserva, la partida se pausa y nadie más entra', () => {
  const { duel } = setup();
  startPlaying(duel);
  duel.leave('s1');
  assert.equal(duel.canJoin('player-cccc'), false, 'el 3º sigue sin entrar durante la gracia');
  const x = duel.game.players.right.x;
  duel.game.players.right.input.r = true;
  duel.tick(500);
  assert.equal(duel.game.players.right.x, x, 'pausado');
  const back = duel.join('player-aaaa', 's1b');
  assert.equal(back.side, 'left');
  assert.equal(back.reconnected, true);
});

test('si no vuelve en el tiempo de gracia, el rival gana por abandono y se libera el slot', () => {
  const { duel, events } = setup();
  startPlaying(duel);
  duel.leave('s2');
  duel.tick(1001);
  const over = events.find((x) => x.e === 'game_over');
  assert.equal(over.p.winner, 'left');
  assert.equal(over.p.reason, 'abandon');
  assert.equal(duel.phase, 'WAITING');
  assert.equal(duel.canJoin('player-cccc'), true);
});

test('input: solo acepta {l,r,u,d,f} booleanos', () => {
  assert.equal(Duel.parseInput(null), null);
  assert.equal(Duel.parseInput('basura'), null);
  assert.equal(Duel.parseInput([true]), null);
  assert.equal(Duel.parseInput({ l: 1 }), null);
  assert.equal(Duel.parseInput({ x: true }), null);
  assert.deepEqual(Duel.parseInput({ l: true, f: false }), { l: true, f: false });
  const { duel } = setup();
  duel.join('player-aaaa', 's1');
  assert.equal(duel.input('left', { r: 'si' }), false);
  assert.equal(duel.input('left', { r: true }), true);
  assert.equal(duel.game.players.left.input.r, true);
  assert.equal(duel.input('right', { r: true }), false, 'slot vacío');
});

test('expulsión por inactividad en READY', () => {
  const { duel, names } = setup({ IDLE_KICK_MS: 1000 });
  duel.join('player-aaaa', 's1');
  duel.join('player-bbbb', 's2');
  duel.ready('left');
  duel.tick(1000);
  assert.ok(names().includes('kick'));
  assert.equal(duel.slots.right, null);
  assert.equal(duel.phase, 'WAITING');
});

test('snapshot incluye ninjas, shurikens, marcador y eventos (y los vacía)', () => {
  const { duel } = setup();
  startPlaying(duel);
  duel.input('left', { f: true });
  duel.tick(16);
  const s = duel.snapshot();
  assert.equal(s.stars.length, 1);
  assert.equal(s.players.left.a, 'throw');
  assert.ok(s.events.some((e) => e.type === 'throw'));
  assert.equal(duel.snapshot().events.length, 0);
});

test('menú: cada jugador elige su personaje y cualquiera el escenario (validado con el catálogo)', () => {
  const catalog = { stages: ['atardecer', 'noche'], characters: ['ninja', 'samurai'] };
  const { duel } = setup({ catalog });
  assert.equal(duel.stage, 'atardecer');
  assert.deepEqual(duel.chars, { left: 'ninja', right: 'ninja' });
  duel.join('player-aaaa', 's1');
  assert.equal(duel.select('left', { char: 'samurai' }), true);
  assert.equal(duel.select('left', { stage: 'noche' }), true);
  assert.equal(duel.chars.left, 'samurai');
  assert.equal(duel.stagePicks.left, 'noche');
  assert.equal(duel.select('left', { stage: 'random' }), true, '"al azar" es válido');
  assert.equal(duel.stagePicks.left, 'random');
  duel.select('left', { stage: 'noche' });
  assert.equal(duel.select('right', { char: 'samurai' }), false, 'slot vacío');
  assert.equal(duel.select('left', { char: 'no-existe' }), false);
  assert.equal(duel.select('left', { stage: 42 }), false);
  assert.equal(duel.select('left', 'basura'), false);
  assert.equal(duel.select('left', {}), false);
  duel.join('player-bbbb', 's2');
  const p = duel.phasePayload();
  assert.deepEqual(p.stagePicks, { left: 'noche', right: 'atardecer' });
  assert.deepEqual(p.chars, { left: 'samurai', right: 'ninja' });
});

test('sorteo de escenario: al empezar se elige una de las dos elecciones', () => {
  const catalog = { stages: ['atardecer', 'noche', 'bosque'], characters: ['ninja'] };
  const seq = (...vals) => { let i = 0; return () => vals[i++ % vals.length]; };

  // rng 0.7 → gana la elección del jugador derecho
  let { duel } = setup({ catalog, rng: seq(0.7) });
  duel.join('player-aaaa', 's1');
  duel.join('player-bbbb', 's2');
  duel.select('left', { stage: 'noche' });
  duel.select('right', { stage: 'bosque' });
  duel.ready('left');
  duel.ready('right');
  assert.equal(duel.phase, 'COUNTDOWN');
  assert.deepEqual(duel.stageRoll, { left: 'noche', right: 'bosque' });
  assert.equal(duel.stage, 'bosque');

  // rng 0.2 → gana la del izquierdo
  ({ duel } = setup({ catalog, rng: seq(0.2) }));
  duel.join('player-aaaa', 's1');
  duel.join('player-bbbb', 's2');
  duel.select('left', { stage: 'noche' });
  duel.select('right', { stage: 'bosque' });
  duel.ready('left');
  duel.ready('right');
  assert.equal(duel.stage, 'noche');
});

test('sorteo de escenario: "al azar" se resuelve a un escenario del catálogo', () => {
  const catalog = { stages: ['atardecer', 'noche', 'bosque'], characters: ['ninja'] };
  // 1º rng resuelve el azar del izquierdo (0.9 → bosque), 2º elige lado (0.1 → izquierdo)
  const vals = [0.9, 0.1];
  let i = 0;
  const { duel } = setup({ catalog, rng: () => vals[i++ % vals.length] });
  duel.join('player-aaaa', 's1');
  duel.join('player-bbbb', 's2');
  duel.select('left', { stage: 'random' });
  duel.select('right', { stage: 'noche' });
  duel.ready('left');
  duel.ready('right');
  assert.deepEqual(duel.stageRoll, { left: 'bosque', right: 'noche' });
  assert.equal(duel.stage, 'bosque');
});

test('la revancha vuelve a sortear el escenario con las nuevas elecciones', () => {
  const catalog = { stages: ['atardecer', 'noche'], characters: ['ninja'] };
  const { duel } = setup({ catalog, rng: () => 0.9 });
  startPlaying(duel);
  koSide(duel, 'left');
  duel.tick(duel.cfg.POINT_PAUSE_MS);
  duel.tick(duel.cfg.POINT_PAUSE_MS);
  koSide(duel, 'left');
  assert.equal(duel.phase, 'GAME_OVER');
  duel.select('right', { stage: 'noche' });
  duel.rematch('left');
  duel.rematch('right');
  assert.equal(duel.stage, 'noche');
});

test('menú: no se puede cambiar durante la partida; sí en GAME_OVER', () => {
  const catalog = { stages: ['atardecer', 'noche'], characters: ['ninja', 'samurai'] };
  const { duel } = setup({ catalog });
  startPlaying(duel);
  assert.equal(duel.select('left', { stage: 'noche' }), false);
  koSide(duel, 'right');
  assert.equal(duel.select('left', { char: 'samurai' }), false, 'POINT_PAUSE');
  duel.tick(duel.cfg.POINT_PAUSE_MS);
  duel.tick(duel.cfg.POINT_PAUSE_MS);
  koSide(duel, 'right');
  assert.equal(duel.phase, 'GAME_OVER');
  assert.equal(duel.select('right', { char: 'samurai' }), true);
});

test('al liberarse un lugar, su personaje vuelve al predeterminado', () => {
  const catalog = { stages: ['atardecer'], characters: ['ninja', 'samurai'] };
  const { duel } = setup({ catalog });
  duel.join('player-aaaa', 's1');
  duel.select('left', { char: 'samurai' });
  duel.leave('s1');
  duel.tick(1001);
  assert.equal(duel.chars.left, 'ninja');
});

test('input acepta espada (a) y parry (p)', () => {
  assert.deepEqual(Duel.parseInput({ a: true, p: false }), { a: true, p: false });
  const { duel } = setup();
  startPlaying(duel);
  duel.input('left', { a: true });
  duel.tick(16);
  assert.equal(duel.snapshot().players.left.a, 'slash');
});

test('input con número (n): el snapshot reporta el último aplicado y los ticks desde él', () => {
  assert.deepEqual(Duel.parseInput({ r: true, n: 7 }), { r: true });
  assert.equal(Duel.parseInput({ r: true, n: -1 }), null);
  assert.equal(Duel.parseInput({ r: true, n: 1.5 }), null);
  assert.equal(Duel.parseInput({ r: true, n: '3' }), null);
  const { duel } = setup();
  startPlaying(duel);
  duel.input('left', { r: true, n: 5 });
  duel.tick(1000 / 60);
  duel.tick(1000 / 60);
  const s = duel.snapshot().players.left;
  assert.equal(s.n, 5);
  assert.equal(s.nt, 2);
  assert.ok(Array.isArray(s.st));
});
