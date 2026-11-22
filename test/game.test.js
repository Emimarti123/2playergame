'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { getConfig } = require('../server/config');
const G = require('../server/game');

const DT = 1 / 60;
const run = (game, seconds, opts) => {
  let scorer = null;
  for (let i = 0; i < Math.round(seconds / DT); i++) scorer = G.step(game, DT, opts) || scorer;
  return scorer;
};
const newGame = () => G.createGame(getConfig());

test('los ninjas empiezan en el suelo, mirándose, con vida completa', () => {
  const g = newGame();
  const { left, right } = g.players;
  assert.equal(left.y, g.cfg.GROUND_Y);
  assert.equal(left.facing, 1);
  assert.equal(right.facing, -1);
  assert.equal(left.hp, g.cfg.MAX_HP);
});

test('correr a la derecha mueve al ninja y no atraviesa la pared', () => {
  const g = newGame();
  G.setInput(g, 'left', { r: true });
  run(g, 0.5);
  assert.ok(g.players.left.x > g.cfg.SPAWN.left + 80);
  run(g, 5);
  assert.equal(g.players.left.x, g.cfg.WIDTH - g.cfg.HIT_W / 2);
});

test('saltar despega y vuelve a aterrizar en el suelo', () => {
  const g = newGame();
  g.players.right.x = 290; // hueco sin plataformas encima
  G.setInput(g, 'right', { u: true });
  G.step(g, DT);
  assert.equal(g.players.right.grounded, false);
  run(g, 0.2);
  assert.ok(g.players.right.y < g.cfg.GROUND_Y - 60);
  run(g, 1.5);
  assert.equal(g.players.right.y, g.cfg.GROUND_Y);
  assert.equal(g.players.right.grounded, true);
});

test('mantener el salto no hace rebotar en bucle (hay que soltar)', () => {
  const g = newGame();
  G.setInput(g, 'left', { u: true });
  run(g, 1.5);
  assert.equal(g.players.left.grounded, true);
});

test('un toque rápido (presionar y soltar antes del tick) sí salta y sí dispara', () => {
  const g = newGame();
  g.players.left.x = 290;
  G.setInput(g, 'left', { u: true, f: true });
  G.setInput(g, 'left', {});
  G.step(g, DT);
  assert.equal(g.players.left.grounded, false);
  assert.equal(g.stars.length, 1);
});

test('un toque durante la cuenta regresiva no dispara al empezar', () => {
  const g = newGame();
  G.setInput(g, 'left', { f: true });
  G.setInput(g, 'left', {});
  run(g, 0.5, { frozen: true });
  G.step(g, DT);
  assert.equal(g.stars.length, 0);
});

test('soltar el salto antes produce un salto más corto', () => {
  const peak = (holdS) => {
    const g = newGame();
    G.setInput(g, 'left', { u: true });
    let minY = Infinity;
    for (let i = 0; i < 90; i++) {
      if (i * DT >= holdS) G.setInput(g, 'left', {});
      G.step(g, DT);
      minY = Math.min(minY, g.players.left.y);
    }
    return g.cfg.GROUND_Y - minY;
  };
  assert.ok(peak(0.05) < peak(1) - 40);
});

test('se aterriza sobre una plataforma al caer desde arriba y se baja con abajo', () => {
  const g = newGame();
  const pl = g.cfg.PLATFORMS[0];
  const p = g.players.left;
  p.x = pl.x + pl.w / 2;
  p.y = pl.y - 50;
  p.grounded = false;
  run(g, 0.5);
  assert.equal(p.y, pl.y);
  assert.equal(p.grounded, true);
  G.setInput(g, 'left', { d: true });
  run(g, 0.6);
  assert.equal(p.y, g.cfg.GROUND_Y);
});

test('las plataformas se atraviesan desde abajo', () => {
  const g = newGame();
  const pl = g.cfg.PLATFORMS[0];
  const p = g.players.left;
  p.x = pl.x + pl.w / 2;
  G.setInput(g, 'left', { u: true });
  let minY = Infinity;
  for (let i = 0; i < 40; i++) { G.step(g, DT); minY = Math.min(minY, p.y); }
  assert.ok(minY < pl.y, 'subió por encima de la plataforma');
  run(g, 1);
  assert.equal(p.y, pl.y, 'y quedó parado encima');
});

test('lanzar crea un shuriken con cooldown y máximo por jugador', () => {
  const g = newGame();
  G.setInput(g, 'left', { f: true });
  G.step(g, DT);
  assert.equal(g.stars.length, 1);
  assert.equal(g.stars[0].owner, 'left');
  assert.ok(g.stars[0].vx > 0);
  G.step(g, DT);
  assert.equal(g.stars.length, 1, 'cooldown');
});

test('un shuriken que alcanza al rival le quita 1 corazón y lo empuja', () => {
  const g = newGame();
  G.setInput(g, 'left', { f: true });
  G.step(g, DT);
  G.setInput(g, 'left', {});
  run(g, 1.2);
  const r = g.players.right;
  assert.equal(r.hp, g.cfg.MAX_HP - 1);
  assert.equal(g.stars.length, 0);
  assert.ok(g.events.some((e) => e.type === 'hit' && e.side === 'right' && e.kind === 'star'));
});

test('saltar esquiva el shuriken', () => {
  const g = newGame();
  G.setInput(g, 'left', { f: true });
  G.step(g, DT);
  G.setInput(g, 'left', {});
  run(g, 0.62); // el shuriken va llegando
  G.setInput(g, 'right', { u: true });
  run(g, 0.6);
  assert.equal(g.players.right.hp, g.cfg.MAX_HP);
});

test('tras recibir daño hay invulnerabilidad', () => {
  const g = newGame();
  const r = g.players.right;
  r.invT = 1;
  g.stars.push({ id: 99, owner: 'left', x: r.x - 20, y: r.y - 30, vx: 600 });
  run(g, 0.1);
  assert.equal(r.hp, g.cfg.MAX_HP);
});

test('dos shurikens rivales se anulan al chocar', () => {
  const g = newGame();
  G.setInput(g, 'left', { f: true });
  G.setInput(g, 'right', { f: true });
  G.step(g, DT);
  G.setInput(g, 'left', {});
  G.setInput(g, 'right', {});
  run(g, 1);
  assert.equal(g.stars.length, 0);
  assert.equal(g.players.left.hp, g.cfg.MAX_HP);
  assert.equal(g.players.right.hp, g.cfg.MAX_HP);
  assert.ok(g.events.some((e) => e.type === 'clash'));
});

test('caer sobre la cabeza del rival (pisotón) le quita vida y rebota', () => {
  const g = newGame();
  const a = g.players.left, v = g.players.right;
  a.x = v.x;
  a.y = v.y - g.cfg.HIT_H - 30;
  a.grounded = false;
  a.vy = 200;
  run(g, 0.1);
  assert.equal(v.hp, g.cfg.MAX_HP - 1);
  assert.ok(a.vy < 0, 'rebotó hacia arriba');
});

test('el KO devuelve el lado que anota', () => {
  const g = newGame();
  g.players.right.hp = 1;
  G.setInput(g, 'left', { f: true });
  G.step(g, DT);
  G.setInput(g, 'left', {});
  const scorer = run(g, 1.2);
  assert.equal(scorer, 'left');
  assert.equal(g.players.right.hp, 0);
});

test('en modo frozen no hay input ni daño', () => {
  const g = newGame();
  G.setInput(g, 'left', { r: true, f: true });
  run(g, 0.5, { frozen: true });
  assert.equal(g.players.left.x, g.cfg.SPAWN.left);
  assert.equal(g.stars.length, 0);
});

test('resetRound restaura vida y posiciones pero conserva el marcador', () => {
  const g = newGame();
  g.score.left = 2;
  g.players.right.hp = 0;
  g.players.left.x = 400;
  g.stars.push({ id: 1, owner: 'left', x: 1, y: 1, vx: 1 });
  G.resetRound(g);
  assert.equal(g.players.right.hp, g.cfg.MAX_HP);
  assert.equal(g.players.left.x, g.cfg.SPAWN.left);
  assert.equal(g.stars.length, 0);
  assert.equal(g.score.left, 2);
});

test('anim refleja el estado del ninja', () => {
  const g = newGame();
  const p = g.players.left;
  assert.equal(G.anim(p), 'idle');
  p.vx = 200; assert.equal(G.anim(p), 'run');
  p.grounded = false; assert.equal(G.anim(p), 'jump');
  p.throwT = 0.1; assert.equal(G.anim(p), 'throw');
  p.hurtT = 0.1; assert.equal(G.anim(p), 'hurt');
  p.hp = 0; p.grounded = true; assert.equal(G.anim(p), 'ko');
});

// ---------------------------------------------------------------------------
// Espada y parry
// ---------------------------------------------------------------------------
// Pone a los ninjas frente a frente a `gap` px de distancia, en el suelo.
function faceOff(gap = 40) {
  const g = newGame();
  g.players.left.x = 400 - gap / 2;
  g.players.right.x = 400 + gap / 2;
  return g;
}
const tap = (g, side, key) => { G.setInput(g, side, { [key]: true }); G.setInput(g, side, {}); };

test('espadazo: no hace daño durante la preparación, sí al cortar', () => {
  const g = faceOff();
  tap(g, 'left', 'a');
  run(g, g.cfg.SLASH_STARTUP_S - 0.03);
  assert.equal(g.players.right.hp, g.cfg.MAX_HP, 'aún preparando');
  run(g, 0.1);
  assert.equal(g.players.right.hp, g.cfg.MAX_HP - 1);
  assert.ok(g.events.some((e) => e.type === 'hit' && e.kind === 'sword'));
});

test('espadazo: empuja más que el shuriken y solo golpea una vez', () => {
  const g = faceOff();
  tap(g, 'left', 'a');
  run(g, 0.2);
  assert.equal(g.players.right.vx > g.cfg.KNOCKBACK_X, true);
  run(g, 0.5);
  assert.equal(g.players.right.hp, g.cfg.MAX_HP - 1);
});

test('espadazo: fuera de alcance o de espaldas no golpea', () => {
  const g = faceOff(g0().cfg.SLASH_RANGE + 40);
  tap(g, 'left', 'a');
  run(g, 0.6);
  assert.equal(g.players.right.hp, g.cfg.MAX_HP);
  const h = faceOff();
  h.players.left.facing = -1;
  tap(h, 'left', 'a');
  run(h, 0.6);
  assert.equal(h.players.right.hp, h.cfg.MAX_HP);
});
function g0() { return newGame(); }

test('durante el espadazo no se puede caminar ni volver a atacar', () => {
  const g = faceOff(200);
  const x = g.players.left.x;
  tap(g, 'left', 'a');
  G.setInput(g, 'left', { r: true });
  run(g, 0.2);
  assert.ok(Math.abs(g.players.left.x - x) < 1);
});

test('parry: detiene el espadazo, no hay daño y el atacante queda aturdido', () => {
  const g = faceOff();
  tap(g, 'left', 'a');
  run(g, 0.1);
  tap(g, 'right', 'p');
  run(g, 0.1);
  assert.equal(g.players.right.hp, g.cfg.MAX_HP);
  assert.equal(g.players.left.action, 'stun');
  assert.equal(G.anim(g.players.left), 'stun');
  assert.equal(g.players.right.action, null, 'quien hizo parry queda libre para contraatacar');
  assert.ok(g.events.some((e) => e.type === 'parry' && e.kind === 'sword' && e.side === 'right'));
});

test('parry: hay que mirar hacia el atacante', () => {
  const g = faceOff();
  g.players.right.facing = 1; // de espaldas
  tap(g, 'left', 'a');
  run(g, 0.1);
  tap(g, 'right', 'p');
  run(g, 0.1);
  assert.equal(g.players.right.hp, g.cfg.MAX_HP - 1);
});

test('parry fallido: quedas un momento sin poder actuar y te pueden golpear', () => {
  const g = faceOff();
  tap(g, 'right', 'p');
  run(g, g.cfg.PARRY_WINDOW_S + 0.05);
  assert.equal(g.players.right.action, 'parryFail');
  tap(g, 'right', 'a');
  run(g, 0.05);
  assert.notEqual(g.players.right.action, 'slash', 'no puede atacar');
  tap(g, 'left', 'a');
  run(g, 0.2);
  assert.equal(g.players.right.hp, g.cfg.MAX_HP - 1);
});

test('parry a shuriken: rebota hacia quien lo lanzó, más rápido, y le pega', () => {
  const g = newGame();
  tap(g, 'left', 'f');
  G.step(g, DT);
  // Espera a que el shuriken esté cerca y hace parry
  while (g.stars.length && g.stars[0].x < g.players.right.x - 70) G.step(g, DT);
  tap(g, 'right', 'p');
  run(g, 0.15);
  assert.equal(g.players.right.hp, g.cfg.MAX_HP);
  assert.ok(g.events.some((e) => e.type === 'parry' && e.kind === 'star'));
  const s = g.stars[0];
  assert.equal(s.owner, 'right');
  assert.ok(s.vx < -g.cfg.STAR_SPEED, 'regresa más rápido');
  run(g, 1);
  assert.equal(g.players.left.hp, g.cfg.MAX_HP - 1);
});

test('espada contra espada: chocan, nadie recibe daño y ambos retroceden', () => {
  const g = faceOff();
  tap(g, 'left', 'a');
  tap(g, 'right', 'a');
  run(g, 0.2);
  assert.equal(g.players.left.hp, g.cfg.MAX_HP);
  assert.equal(g.players.right.hp, g.cfg.MAX_HP);
  assert.ok(g.players.left.vx < 0 && g.players.right.vx > 0);
  assert.ok(g.events.some((e) => e.type === 'clash' && e.kind === 'sword'));
});

test('recibir daño interrumpe el espadazo', () => {
  const g = faceOff();
  tap(g, 'right', 'a');
  g.players.right.actionT = 0.01;
  g.stars.push({ id: 50, owner: 'left', x: g.players.right.x - 5, y: g.players.right.y - 30, vx: 600 });
  G.step(g, DT);
  assert.equal(g.players.right.action, null);
  assert.equal(g.players.right.hp, g.cfg.MAX_HP - 1);
});
