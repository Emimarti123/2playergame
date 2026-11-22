'use strict';

const { getConfig } = require('./config');
const G = require('./game');
const { loadCatalog } = require('./catalog');

const { SIDES, opposite } = G;
const IN_PROGRESS = new Set(['COUNTDOWN', 'PLAYING', 'POINT_PAUSE']);
const INPUT_KEYS = ['l', 'r', 'u', 'd', 'f', 'a', 'p'];
const RANDOM = 'random';

/**
 * Estado del duelo: exactamente dos slots (left/right), fases y reglas de entrada.
 * No conoce sockets: recibe ids de socket/jugador y avisa por `emit(event, payload, side?)`.
 * Todo el tiempo avanza con tick(dtMs) (sin setTimeout) para que sea determinista y testeable.
 *
 * Fases: WAITING → READY → COUNTDOWN → PLAYING ⇄ POINT_PAUSE → GAME_OVER → (revancha) COUNTDOWN
 */
class Duel {
  constructor(opts = {}, emit = () => {}) {
    this.cfg = { ...getConfig(), ...opts };
    this.emit = emit;
    this.game = G.createGame(this.cfg);
    this.slots = { left: null, right: null };
    this.phase = 'WAITING';
    this.phaseMs = 0;
    this.round = 1;
    this.roundReset = false;
    this.winner = null;
    this.lastKo = null;
    // Menú: cada jugador elige personaje y escenario (o "random"). Al empezar la partida se
    // sortea el escenario entre las dos elecciones, como en los juegos de pelea clásicos.
    this.rng = opts.rng || Math.random;
    this.catalog = opts.catalog || loadCatalog();
    this.stage = this.catalog.stages[0]; // escenario de la partida (resultado del sorteo)
    this.stageRoll = null; // { left, right }: elecciones ya resueltas que entraron al sorteo
    this.stagePicks = { left: this.catalog.stages[0], right: this.catalog.stages[0] };
    this.chars = { left: this.catalog.characters[0], right: this.catalog.characters[0] };
  }

  // ---------- Entrada (cupo máximo: 2) ----------

  _findByPlayer(playerId) {
    if (this.cfg.ALLOW_SAME_BROWSER) return null; // solo desarrollo
    return SIDES.find((s) => this.slots[s] && this.slots[s].playerId === playerId) || null;
  }

  canJoin(playerId) {
    return !!this._findByPlayer(playerId) || SIDES.some((s) => !this.slots[s]);
  }

  join(playerId, socketId) {
    const existing = this._findByPlayer(playerId);
    if (existing) {
      const slot = this.slots[existing];
      const replacedSocketId = slot.connected && slot.socketId !== socketId ? slot.socketId : null;
      slot.socketId = socketId;
      slot.connected = true;
      slot.graceLeft = 0;
      this.emit('opponent_back', {}, opposite(existing));
      this.emit('phase', this.phasePayload());
      this._maybeStart();
      return { ok: true, side: existing, reconnected: true, replacedSocketId };
    }

    const side = SIDES.find((s) => !this.slots[s]);
    if (!side) return { ok: false, reason: 'duel_full' };

    this.slots[side] = {
      playerId,
      socketId,
      connected: true,
      ready: false,
      rematch: false,
      graceLeft: 0,
      idleMs: 0,
    };
    if (SIDES.every((s) => this.slots[s]) && this.phase === 'WAITING') this._setPhase('READY');
    else this.emit('phase', this.phasePayload());
    return { ok: true, side, reconnected: false, replacedSocketId: null };
  }

  sideOf(socketId) {
    return SIDES.find((s) => this.slots[s] && this.slots[s].connected && this.slots[s].socketId === socketId) || null;
  }

  leave(socketId) {
    const side = this.sideOf(socketId);
    if (!side) return; // socket ya reemplazado o expulsado
    const slot = this.slots[side];
    slot.connected = false;
    slot.graceLeft = this.cfg.RECONNECT_GRACE_MS;
    G.setInput(this.game, side, {}); // que no se quede corriendo solo
    this.emit('opponent_left', { graceMs: this.cfg.RECONNECT_GRACE_MS }, opposite(side));
    this.emit('phase', this.phasePayload());
  }

  // ---------- Acciones de jugador ----------

  // Valida el input: objeto con, a lo más, las acciones l/r/u/d/f/a/p en booleano
  // y opcionalmente n = número de input (entero ≥ 0) que usa la predicción del cliente.
  static parseInput(msg) {
    if (!msg || typeof msg !== 'object' || Array.isArray(msg)) return null;
    const out = {};
    for (const k of Object.keys(msg)) {
      if (k === 'n') {
        if (!Number.isSafeInteger(msg.n) || msg.n < 0) return null;
        continue;
      }
      if (!INPUT_KEYS.includes(k) || typeof msg[k] !== 'boolean') return null;
      out[k] = msg[k];
    }
    return out;
  }

  input(side, msg) {
    if (!SIDES.includes(side) || !this.slots[side]) return false;
    const parsed = Duel.parseInput(msg);
    if (!parsed) return false;
    G.setInput(this.game, side, parsed);
    if (msg.n !== undefined) {
      const p = this.game.players[side];
      p.seq = msg.n;
      p.seqTicks = 0;
    }
    return true;
  }

  // Elegir escenario y/o personaje en el menú: { stage?: id | 'random', char?: id }.
  // Solo fuera de la partida (WAITING, READY, GAME_OVER).
  select(side, msg) {
    if (!SIDES.includes(side) || !this.slots[side]) return false;
    if (IN_PROGRESS.has(this.phase)) return false;
    if (!msg || typeof msg !== 'object' || Array.isArray(msg)) return false;
    const { stage, char } = msg;
    if (stage === undefined && char === undefined) return false;
    if (stage !== undefined && stage !== RANDOM && !this.catalog.stages.includes(stage)) return false;
    if (char !== undefined && !this.catalog.characters.includes(char)) return false;
    if (stage !== undefined) this.stagePicks[side] = stage;
    if (char !== undefined) this.chars[side] = char;
    this.emit('phase', this.phasePayload());
    return true;
  }

  ready(side) {
    if (this.phase !== 'READY' || !this.slots[side]) return false;
    this.slots[side].ready = true;
    this.emit('phase', this.phasePayload());
    this._maybeStart();
    return true;
  }

  rematch(side) {
    if (this.phase !== 'GAME_OVER' || !this.slots[side]) return false;
    this.slots[side].rematch = true;
    this.emit('phase', this.phasePayload());
    if (SIDES.every((s) => this.slots[s] && this.slots[s].connected && this.slots[s].rematch)) {
      this._newMatch();
      this._rollStage();
      this._setPhase('COUNTDOWN');
    }
    return true;
  }

  // ---------- Bucle ----------

  _paused() {
    return IN_PROGRESS.has(this.phase) && SIDES.some((s) => this.slots[s] && !this.slots[s].connected);
  }

  tick(dtMs) {
    // Gracia de reconexión
    for (const s of SIDES) {
      const slot = this.slots[s];
      if (slot && !slot.connected) {
        slot.graceLeft -= dtMs;
        if (slot.graceLeft <= 0) this._release(s);
      }
    }
    if (this._paused()) return;

    this.phaseMs += dtMs;
    const dt = dtMs / 1000;

    switch (this.phase) {
      case 'READY':
        for (const s of SIDES) {
          const slot = this.slots[s];
          if (slot && slot.connected && !slot.ready) {
            slot.idleMs += dtMs;
            if (slot.idleMs >= this.cfg.IDLE_KICK_MS) {
              this.emit('kick', { socketId: slot.socketId, reason: 'idle' });
              this._release(s);
              break;
            }
          }
        }
        break;

      case 'COUNTDOWN':
        G.step(this.game, dt, { frozen: true });
        if (this.phaseMs >= this.cfg.COUNTDOWN_MS) this._setPhase('PLAYING');
        break;

      case 'PLAYING': {
        const scorer = G.step(this.game, dt);
        if (scorer) this._onKo(scorer);
        break;
      }

      case 'POINT_PAUSE':
        G.step(this.game, dt, { frozen: true });
        if (!this.roundReset && this.phaseMs >= this.cfg.ROUND_RESET_AT_MS) {
          this.roundReset = true;
          this.round += 1;
          G.resetRound(this.game);
          this.emit('phase', this.phasePayload());
        }
        if (this.phaseMs >= this.cfg.POINT_PAUSE_MS) this._setPhase('PLAYING');
        break;

      default:
        break;
    }
  }

  _onKo(scorer) {
    this.game.score[scorer] += 1;
    const score = { ...this.game.score };
    this.lastKo = opposite(scorer);
    this.emit('point', { scorer, score });
    if (score[scorer] >= this.cfg.WIN_SCORE) {
      this.winner = scorer;
      this._resetFlags();
      this._setPhase('GAME_OVER');
      this.emit('game_over', { winner: scorer, score, reason: 'score' });
    } else {
      this.roundReset = false;
      this._setPhase('POINT_PAUSE');
    }
  }

  // ---------- Internos ----------

  _newMatch() {
    G.resetScore(this.game);
    G.resetRound(this.game);
    this.round = 1;
    this.winner = null;
    this.lastKo = null;
    this._resetFlags();
  }

  // Sorteo: cada "al azar" se vuelve un escenario cualquiera y luego se elige una de las dos opciones.
  _rollStage() {
    const list = this.catalog.stages;
    const any = () => list[Math.floor(this.rng() * list.length) % list.length];
    const resolve = (pick) => (pick === RANDOM || !list.includes(pick) ? any() : pick);
    this.stageRoll = { left: resolve(this.stagePicks.left), right: resolve(this.stagePicks.right) };
    this.stage = this.rng() < 0.5 ? this.stageRoll.left : this.stageRoll.right;
  }

  _maybeStart() {
    if (this.phase !== 'READY') return;
    if (SIDES.every((s) => this.slots[s] && this.slots[s].connected && this.slots[s].ready)) {
      this._newMatch();
      this._rollStage();
      this._setPhase('COUNTDOWN');
    }
  }

  _resetFlags() {
    for (const s of SIDES) {
      if (this.slots[s]) {
        this.slots[s].ready = false;
        this.slots[s].rematch = false;
        this.slots[s].idleMs = 0;
      }
    }
  }

  // Libera un slot (gracia agotada o expulsión por inactividad).
  _release(side) {
    const other = opposite(side);
    const wasInProgress = IN_PROGRESS.has(this.phase);
    this.slots[side] = null;
    this.chars[side] = this.catalog.characters[0];
    this.stagePicks[side] = this.catalog.stages[0];

    if (wasInProgress && this.slots[other]) {
      this.emit('game_over', { winner: other, score: { ...this.game.score }, reason: 'abandon' });
    }
    this._newMatch();
    this._setPhase('WAITING');
  }

  _setPhase(phase) {
    this.phase = phase;
    this.phaseMs = 0;
    this.emit('phase', this.phasePayload());
  }

  phasePayload() {
    const occupied = {};
    const ready = {};
    const rematch = {};
    const connected = {};
    for (const s of SIDES) {
      const slot = this.slots[s];
      occupied[s] = !!slot;
      connected[s] = !!(slot && slot.connected);
      ready[s] = !!(slot && slot.ready);
      rematch[s] = !!(slot && slot.rematch);
    }
    return {
      phase: this.phase,
      occupied,
      connected,
      ready,
      rematch,
      score: { ...this.game.score },
      winScore: this.cfg.WIN_SCORE,
      maxHp: this.cfg.MAX_HP,
      round: this.round,
      winner: this.winner,
      lastKo: this.lastKo,
      stage: this.stage,
      stagePicks: { ...this.stagePicks },
      stageRoll: this.stageRoll ? { ...this.stageRoll } : null,
      chars: { ...this.chars },
      endsInMs:
        this.phase === 'COUNTDOWN'
          ? Math.max(0, this.cfg.COUNTDOWN_MS - this.phaseMs)
          : this.phase === 'POINT_PAUSE'
          ? Math.max(0, this.cfg.POINT_PAUSE_MS - this.phaseMs)
          : 0,
    };
  }

  // Estado que se envía a los dos jugadores ~30 veces por segundo.
  snapshot() {
    const r1 = (n) => Math.round(n * 10) / 10;
    const players = {};
    for (const s of SIDES) {
      const p = this.game.players[s];
      players[s] = {
        x: r1(p.x),
        y: r1(p.y),
        vy: Math.round(p.vy),
        f: p.facing,
        hp: p.hp,
        a: G.anim(p),
        k: G.animPhase(this.cfg, p),
        inv: p.invT > 0,
        // Para la predicción del dueño: estado completo, último input aplicado y ticks desde él
        st: G.exportState(p),
        n: p.seq,
        nt: p.seqTicks,
      };
    }
    return {
      players,
      stars: this.game.stars.map((s) => ({ id: s.id, o: s.owner, x: r1(s.x), y: r1(s.y), d: Math.sign(s.vx) })),
      score: { ...this.game.score },
      events: G.drainEvents(this.game),
      t: Date.now(),
    };
  }
}

module.exports = { Duel, SIDES, RANDOM };
