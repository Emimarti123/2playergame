'use strict';

// Lógica pura de Mikyosho: sin sockets ni timers. Todo se mueve con dt (segundos).
// Física de plataformas basada en el ejemplo de sprite (gravedad, aterrizaje sobre
// obstáculos, AABB) y estructura de juego basada en el Pong dual.
//
// Input por jugador: l/r moverse, u saltar, d bajar, f shuriken, a espadazo, p parry.
// Acciones (p.action): 'slash' (espadazo) · 'parry' (ventana activa) · 'parryFail'
// (parry que no paró nada: vulnerable) · 'stun' (aturdido tras chocar con un parry).

const SIDES = ['left', 'right'];
const opposite = (s) => (s === 'left' ? 'right' : 'left');
const NO_INPUT = Object.freeze({ l: false, r: false, u: false, d: false, f: false, a: false, p: false });
const MAX_EVENTS = 64;

function makePlayer(cfg, side) {
  return {
    side,
    x: cfg.SPAWN[side],
    y: cfg.GROUND_Y,
    prevY: cfg.GROUND_Y,
    vx: 0,
    vy: 0,
    grounded: true,
    facing: side === 'left' ? 1 : -1,
    hp: cfg.MAX_HP,
    input: { ...NO_INPUT },
    // Buffers de pulsación: un toque rápido (presionar y soltar entre dos ticks) no se pierde,
    // y mantener la tecla no repite la acción.
    jumpBuf: 0,
    fireBuf: 0,
    attackBuf: 0,
    parryBuf: 0,
    canCut: false, // el salto corto solo aplica a saltos normales (no al rebote del pisotón)
    cooldown: 0,
    throwT: 0,
    hurtT: 0,
    invT: 0,
    dropT: 0,
    action: null,
    actionT: 0,
    slashHit: false, // este espadazo ya golpeó (o fue parado / chocó)
  };
}

function createGame(cfg) {
  return {
    cfg,
    players: { left: makePlayer(cfg, 'left'), right: makePlayer(cfg, 'right') },
    stars: [],
    nextStarId: 1,
    score: { left: 0, right: 0 },
    events: [],
  };
}

function pushEvent(game, ev) {
  game.events.push(ev);
  if (game.events.length > MAX_EVENTS) game.events.shift();
}

// Reinicia posiciones, vida y proyectiles (inicio de cada ronda). Conserva el marcador.
function resetRound(game) {
  for (const s of SIDES) {
    const keepInput = game.players[s].input;
    game.players[s] = makePlayer(game.cfg, s);
    game.players[s].input = keepInput;
  }
  game.stars = [];
}

function resetScore(game) {
  game.score.left = 0;
  game.score.right = 0;
}

const PRESS_BUFFER_S = 0.15;

function setInput(game, side, input) {
  const p = game.players[side];
  const next = { ...NO_INPUT, ...input };
  if (next.u && !p.input.u) p.jumpBuf = PRESS_BUFFER_S;
  if (next.f && !p.input.f) p.fireBuf = PRESS_BUFFER_S;
  if (next.a && !p.input.a) p.attackBuf = PRESS_BUFFER_S;
  if (next.p && !p.input.p) p.parryBuf = PRESS_BUFFER_S;
  p.input = next;
}

// ---------------------------------------------------------------------------
// Acciones (espada y parry)
// ---------------------------------------------------------------------------
function slashPhase(cfg, p) {
  if (p.action !== 'slash') return -1;
  if (p.actionT < cfg.SLASH_STARTUP_S) return 0; // preparación (se ve venir)
  if (p.actionT < cfg.SLASH_STARTUP_S + cfg.SLASH_ACTIVE_S) return 1; // corte: hace daño
  return 2; // recuperación
}

function setAction(p, action) {
  p.action = action;
  p.actionT = 0;
  if (action === 'slash') p.slashHit = false;
}

// Avanza el reloj de la acción en curso y la termina / encadena cuando toca.
function tickAction(cfg, p, dt) {
  if (!p.action) return;
  p.actionT += dt;
  switch (p.action) {
    case 'slash':
      if (p.actionT >= cfg.SLASH_STARTUP_S + cfg.SLASH_ACTIVE_S + cfg.SLASH_RECOVERY_S) setAction(p, null);
      break;
    case 'parry':
      if (p.actionT >= cfg.PARRY_WINDOW_S) setAction(p, 'parryFail'); // no paró nada
      break;
    case 'parryFail':
      if (p.actionT >= cfg.PARRY_FAIL_S) setAction(p, null);
      break;
    case 'stun':
      if (p.actionT >= cfg.STUN_S) setAction(p, null);
      break;
    default:
      setAction(p, null);
  }
}

// ---------------------------------------------------------------------------
// Movimiento de un ninja (ejes separados, como en el ejemplo de sprite)
// ---------------------------------------------------------------------------
function movePlayer(game, p, dt, frozen) {
  const cfg = game.cfg;
  const alive = p.hp > 0;
  tickAction(cfg, p, dt);
  const controllable = !frozen && alive && p.hurtT <= 0;
  const free = controllable && !p.action; // puede moverse y empezar acciones
  const inp = free ? p.input : NO_INPUT;

  // Horizontal con aceleración. Durante una acción se clavan los pies (en el aire se conserva el impulso).
  const dir = (inp.r ? 1 : 0) - (inp.l ? 1 : 0);
  const target = dir * cfg.RUN_SPEED;
  let accel = p.grounded ? cfg.ACCEL_GROUND : cfg.ACCEL_AIR;
  if (!controllable || p.action === 'stun') accel = 700;
  else if (p.action) accel = p.grounded ? cfg.ACCEL_GROUND : 0;
  if (p.vx < target) p.vx = Math.min(target, p.vx + accel * dt);
  else if (p.vx > target) p.vx = Math.max(target, p.vx - accel * dt);
  if (dir !== 0) p.facing = dir;

  // Salto (por pulsación, con buffer) y salto corto al soltar
  if (free && p.jumpBuf > 0 && p.grounded) {
    p.vy = cfg.JUMP_VELOCITY;
    p.grounded = false;
    p.jumpBuf = 0;
    p.canCut = true;
    pushEvent(game, { type: 'jump', side: p.side });
  }
  if (!p.input.u && p.canCut && p.vy < cfg.JUMP_CUT) p.vy = cfg.JUMP_CUT;

  // Bajar de una plataforma
  if (inp.d && p.grounded && p.y < cfg.GROUND_Y) {
    p.dropT = cfg.DROP_S;
    p.grounded = false;
  }

  // Eje X: paredes de la arena
  const half = cfg.HIT_W / 2;
  p.x += p.vx * dt;
  if (p.x < half) { p.x = half; p.vx = 0; }
  if (p.x > cfg.WIDTH - half) { p.x = cfg.WIDTH - half; p.vx = 0; }

  // Eje Y: gravedad y aterrizaje sobre suelo o plataformas (solo cayendo, desde arriba)
  p.prevY = p.y;
  p.vy += cfg.GRAVITY * dt;
  p.y += p.vy * dt;

  let floor = cfg.GROUND_Y;
  if (p.vy >= 0 && p.dropT <= 0) {
    for (const pl of cfg.PLATFORMS) {
      const overX = p.x + half * 0.6 > pl.x && p.x - half * 0.6 < pl.x + pl.w;
      if (overX && p.prevY <= pl.y + 0.5 && p.y >= pl.y) floor = Math.min(floor, pl.y);
    }
  }
  if (p.y >= floor) {
    p.y = floor;
    p.vy = 0;
    p.grounded = true;
    p.canCut = false;
  } else {
    p.grounded = false;
  }
  // Techo
  if (p.y - cfg.HIT_H < 0) {
    p.y = cfg.HIT_H;
    if (p.vy < 0) p.vy = 0;
  }

  // Temporizadores
  p.cooldown = Math.max(0, p.cooldown - dt);
  p.throwT = Math.max(0, p.throwT - dt);
  p.hurtT = Math.max(0, p.hurtT - dt);
  p.invT = Math.max(0, p.invT - dt);
  p.dropT = Math.max(0, p.dropT - dt);
  p.jumpBuf = Math.max(0, p.jumpBuf - dt);

  // Empezar espadazo o parry (con buffer, como el salto)
  if (free && p.attackBuf > 0) {
    setAction(p, 'slash');
    p.attackBuf = 0;
    pushEvent(game, { type: 'slash', side: p.side });
  } else if (free && p.parryBuf > 0) {
    setAction(p, 'parry');
    p.parryBuf = 0;
  }
  p.attackBuf = Math.max(0, p.attackBuf - dt);
  p.parryBuf = Math.max(0, p.parryBuf - dt);

  // Lanzar shuriken (mantener = ráfaga al ritmo del cooldown; un toque se guarda en buffer)
  if (free && !p.action && (inp.f || p.fireBuf > 0) && p.cooldown <= 0) {
    const mine = game.stars.filter((s) => s.owner === p.side).length;
    if (mine < cfg.STAR_MAX_PER_PLAYER) {
      game.stars.push({
        id: game.nextStarId++,
        owner: p.side,
        x: p.x + p.facing * 20,
        y: p.y - 36,
        vx: p.facing * cfg.STAR_SPEED,
      });
      p.cooldown = cfg.STAR_COOLDOWN_S;
      p.fireBuf = 0;
      p.throwT = cfg.THROW_ANIM_S;
      pushEvent(game, { type: 'throw', side: p.side });
    }
  }
  p.fireBuf = Math.max(0, p.fireBuf - dt);
}

// ---------------------------------------------------------------------------
// Daño y colisiones
// ---------------------------------------------------------------------------
function hitbox(cfg, p) {
  return { x0: p.x - cfg.HIT_W / 2, x1: p.x + cfg.HIT_W / 2, y0: p.y - cfg.HIT_H, y1: p.y };
}

// Zona que corta la espada: al frente del personaje, de la cabeza a casi los pies.
function slashBox(cfg, p) {
  const xa = p.x, xb = p.x + p.facing * cfg.SLASH_RANGE;
  return { x0: Math.min(xa, xb), x1: Math.max(xa, xb), y0: p.y - cfg.HIT_H - 10, y1: p.y - 4 };
}

const overlap = (a, b) => a.x0 < b.x1 && a.x1 > b.x0 && a.y0 < b.y1 && a.y1 > b.y0;

function canBeHit(p) {
  return p.hp > 0 && p.invT <= 0;
}

// ¿`v` está en su ventana de parry y mirando hacia el punto x?
function parrying(v, fromX) {
  const toward = Math.sign(fromX - v.x) || v.facing;
  return v.hp > 0 && v.action === 'parry' && v.facing === toward;
}

function parrySuccess(game, v, kind, x, y) {
  setAction(v, null); // puede contraatacar de inmediato
  v.invT = Math.max(v.invT, game.cfg.PARRY_INVULN_S);
  pushEvent(game, { type: 'parry', side: v.side, kind, x: Math.round(x), y: Math.round(y) });
}

// Aplica 1 de daño. Devuelve true si fue KO.
function damage(game, victim, dir, kind) {
  const cfg = game.cfg;
  const sword = kind === 'sword';
  victim.hp -= 1;
  victim.invT = cfg.INVULN_S;
  victim.hurtT = cfg.HURT_S;
  victim.vx = dir * (sword ? cfg.SLASH_KNOCKBACK_X : cfg.KNOCKBACK_X);
  victim.vy = sword ? cfg.SLASH_KNOCKBACK_Y : cfg.KNOCKBACK_Y;
  victim.grounded = false;
  victim.canCut = false;
  victim.facing = -dir || victim.facing; // mira hacia quien le pegó
  setAction(victim, null); // un golpe interrumpe lo que estuviera haciendo
  pushEvent(game, { type: 'hit', side: victim.side, kind, x: Math.round(victim.x), y: Math.round(victim.y - cfg.HIT_H / 2) });
  if (victim.hp <= 0) {
    victim.hp = 0;
    pushEvent(game, { type: 'ko', side: victim.side });
    return true;
  }
  return false;
}

// Espada contra espada: si los dos cortan a la vez y se alcanzan, chocan y ambos retroceden.
function checkSwordClash(game, a, b) {
  const cfg = game.cfg;
  if (slashPhase(cfg, a) !== 1 || slashPhase(cfg, b) !== 1 || a.slashHit || b.slashHit) return;
  if (!overlap(slashBox(cfg, a), hitbox(cfg, b)) || !overlap(slashBox(cfg, b), hitbox(cfg, a))) return;
  a.slashHit = b.slashHit = true;
  const d = Math.sign(a.x - b.x) || -a.facing;
  a.vx = d * cfg.SWORD_CLASH_PUSH;
  b.vx = -d * cfg.SWORD_CLASH_PUSH;
  pushEvent(game, { type: 'clash', kind: 'sword', x: Math.round((a.x + b.x) / 2), y: Math.round(Math.min(a.y, b.y) - cfg.HIT_H / 2) });
}

// Espadazo de `a` contra `v`. Devuelve true si fue KO.
function checkSlash(game, a, v) {
  const cfg = game.cfg;
  if (a.hp <= 0 || v.hp <= 0 || a.slashHit || slashPhase(cfg, a) !== 1) return false;
  if (!overlap(slashBox(cfg, a), hitbox(cfg, v))) return false;
  a.slashHit = true;
  if (parrying(v, a.x)) {
    // Parry: sin daño y el atacante queda aturdido
    parrySuccess(game, v, 'sword', (a.x + v.x) / 2, v.y - cfg.HIT_H / 2);
    setAction(a, 'stun');
    a.vx = (Math.sign(a.x - v.x) || -a.facing) * cfg.STUN_PUSH;
    return false;
  }
  if (!canBeHit(v)) return false;
  return damage(game, v, a.facing, 'sword');
}

// Pisotón: caer sobre la cabeza del rival le quita vida y te hace rebotar.
function checkStomp(game, a, v) {
  const cfg = game.cfg;
  if (a.hp <= 0 || !canBeHit(v) || a.vy <= 0) return false;
  const head = v.y - cfg.HIT_H;
  const overX = Math.abs(a.x - v.x) < cfg.HIT_W;
  if (overX && a.prevY <= head + 8 && a.y >= head) {
    a.y = head;
    a.vy = cfg.STOMP_BOUNCE;
    a.grounded = false;
    a.canCut = false;
    pushEvent(game, { type: 'stomp', side: a.side });
    return damage(game, v, Math.sign(v.x - a.x) || a.facing, 'stomp');
  }
  return false;
}

function moveStars(game, dt, frozen) {
  const cfg = game.cfg;
  const r = cfg.STAR_R;
  for (const s of game.stars) s.x += s.vx * dt;

  // Shuriken contra shuriken: se anulan
  for (let i = 0; i < game.stars.length; i++) {
    const a = game.stars[i];
    if (a.dead) continue;
    for (let j = i + 1; j < game.stars.length; j++) {
      const b = game.stars[j];
      if (b.dead || a.owner === b.owner) continue;
      if (Math.abs(a.x - b.x) < 2 * r && Math.abs(a.y - b.y) < 2 * r) {
        a.dead = b.dead = true;
        pushEvent(game, { type: 'clash', kind: 'star', x: Math.round((a.x + b.x) / 2), y: Math.round((a.y + b.y) / 2) });
        break;
      }
    }
  }

  let ko = null;
  if (!frozen) {
    for (const s of game.stars) {
      if (s.dead) continue;
      const v = game.players[opposite(s.owner)];
      const hb = hitbox(cfg, v);
      const coming = Math.sign(s.vx) === Math.sign(v.x - s.x);

      // Parry: el shuriken rebota hacia quien lo lanzó, más rápido
      if (coming && parrying(v, s.x)) {
        const reach = { x0: hb.x0 - cfg.PARRY_REACH, x1: hb.x1 + cfg.PARRY_REACH, y0: hb.y0, y1: hb.y1 };
        if (s.x + r > reach.x0 && s.x - r < reach.x1 && s.y + r > reach.y0 && s.y - r < reach.y1) {
          s.owner = v.side;
          s.vx = -Math.sign(s.vx) * Math.min(cfg.STAR_MAX_SPEED, Math.abs(s.vx) * cfg.REFLECT_SPEEDUP);
          s.x = v.x + v.facing * (cfg.HIT_W / 2 + cfg.PARRY_REACH + r);
          parrySuccess(game, v, 'star', s.x, s.y);
          continue;
        }
      }

      // Impacto contra el ninja rival (AABB del ninja agrandada por el radio)
      if (!canBeHit(v)) continue;
      if (s.x + r > hb.x0 && s.x - r < hb.x1 && s.y + r > hb.y0 && s.y - r < hb.y1) {
        s.dead = true;
        if (damage(game, v, Math.sign(s.vx), 'star')) { ko = v.side; break; }
      }
    }
  }

  game.stars = game.stars.filter((s) => !s.dead && s.x > -30 && s.x < cfg.WIDTH + 30);
  return ko;
}

// Avanza el juego. Devuelve el lado que anotó (el rival del que quedó KO) o null.
// `frozen`: sin input ni daño (cuenta regresiva / pausa tras KO), pero con gravedad.
function step(game, dt, { frozen = false } = {}) {
  const { left, right } = game.players;
  movePlayer(game, left, dt, frozen);
  movePlayer(game, right, dt, frozen);

  let ko = null;
  if (!frozen) {
    checkSwordClash(game, left, right);
    if (checkSlash(game, left, right)) ko = 'right';
    else if (checkSlash(game, right, left)) ko = 'left';
    else if (checkStomp(game, left, right)) ko = 'right';
    else if (checkStomp(game, right, left)) ko = 'left';
  }
  const starKo = moveStars(game, dt, frozen || ko !== null);
  ko = ko || starKo;
  return ko ? opposite(ko) : null;
}

function anim(p) {
  if (p.hp <= 0) return p.grounded ? 'ko' : 'hurt';
  if (p.hurtT > 0) return 'hurt';
  if (p.action === 'stun') return 'stun';
  if (p.action === 'slash') return 'slash';
  if (p.action === 'parry' || p.action === 'parryFail') return 'parry';
  if (p.throwT > 0) return 'throw';
  if (!p.grounded) return 'jump';
  if (Math.abs(p.vx) > 30) return 'run';
  return 'idle';
}

// Subestado para el dibujo: fase del espadazo (0 prepara, 1 corta, 2 recupera)
// o del parry (0 ventana activa, 1 fallido).
function animPhase(cfg, p) {
  if (p.action === 'slash') return slashPhase(cfg, p);
  if (p.action === 'parry') return 0;
  if (p.action === 'parryFail') return 1;
  return 0;
}

function drainEvents(game) {
  const ev = game.events;
  game.events = [];
  return ev;
}

module.exports = {
  SIDES,
  opposite,
  createGame,
  resetRound,
  resetScore,
  setInput,
  step,
  anim,
  animPhase,
  drainEvents,
};
