'use strict';

const path = require('path');
const http = require('http');
const crypto = require('crypto');
const express = require('express');
const { Server } = require('socket.io');
const { getConfig } = require('./config');
const { Duel } = require('./duel');

const ROOM = 'duel';
const PLAYER_ID_RE = /^[A-Za-z0-9_-]{8,64}$/;

function createServer(opts = {}) {
  const cfg = { ...getConfig(), ...opts };
  const app = express();
  app.disable('x-powered-by');
  // Las plantillas y probadores (personajes/fondos) son herramientas locales: no se sirven en Render
  if (cfg.HIDE_TOOLS) {
    app.get(['/plantillas.html', '/plantillas.js', '/plantillas'], (_req, res) => res.sendStatus(404));
  }
  app.use(express.static(path.join(__dirname, '..', 'public')));
  // La misma física del servidor, para la predicción del cliente
  app.get('/game-core.js', (_req, res) => res.type('application/javascript').sendFile(path.join(__dirname, 'game.js')));
  app.get('/health', (_req, res) => res.json({ ok: true, phase: duel.phase }));

  const httpServer = http.createServer(app);
  const io = new Server(httpServer);

  // Constantes de física que necesita el cliente para predecir (sin datos del servidor)
  const { PORT, ALLOW_SAME_BROWSER, HIDE_TOOLS, catalog, ...clientCfg } = cfg;

  const duel = new Duel(cfg, (event, payload, side) => {
    if (event === 'kick') {
      const s = io.sockets.sockets.get(payload.socketId);
      if (s) {
        s.emit('kicked', { reason: payload.reason });
        s.disconnect(true);
      }
      return;
    }
    if (side) {
      const slot = duel.slots[side];
      if (slot && slot.connected) io.to(slot.socketId).emit(event, payload);
    } else {
      io.to(ROOM).emit(event, payload);
    }
  });

  // LÍMITE DE 2 JUGADORES: el cupo se controla aquí, antes de aceptar la conexión.
  // Un 3er cliente es rechazado con `duel_full`: nunca entra a la sala ni recibe `state`.
  io.use((socket, next) => {
    const raw = socket.handshake.auth && socket.handshake.auth.playerId;
    const playerId = typeof raw === 'string' && PLAYER_ID_RE.test(raw) ? raw : crypto.randomUUID();
    if (!duel.canJoin(playerId)) {
      const err = new Error('duel_full');
      err.data = { message: 'Duelo lleno' };
      return next(err);
    }
    socket.data.playerId = playerId;
    next();
  });

  io.on('connection', (socket) => {
    const res = duel.join(socket.data.playerId, socket.id);
    if (!res.ok) {
      // Respaldo por si el cupo se llenó entre el middleware y la conexión
      socket.emit('duel_full', { message: 'Duelo lleno' });
      socket.disconnect(true);
      return;
    }
    if (res.replacedSocketId) {
      const old = io.sockets.sockets.get(res.replacedSocketId);
      if (old) old.disconnect(true);
    }
    socket.join(ROOM);
    socket.emit('joined', { side: res.side, playerId: socket.data.playerId, cfg: clientCfg });
    socket.emit('phase', duel.phasePayload());

    // Límite de frecuencia de mensajes (por socket)
    let windowStart = Date.now();
    let count = 0;
    const allowed = () => {
      const now = Date.now();
      if (now - windowStart >= 1000) {
        windowStart = now;
        count = 0;
      }
      return ++count <= cfg.INPUT_MAX_PER_SEC;
    };
    socket.on('input', (msg) => {
      if (!allowed()) return;
      const side = duel.sideOf(socket.id);
      if (side) duel.input(side, msg); // valida el formato
    });
    socket.on('select', (msg) => {
      if (!allowed()) return;
      const side = duel.sideOf(socket.id);
      if (side) duel.select(side, msg); // valida contra el catálogo
    });
    socket.on('ready', () => {
      const side = duel.sideOf(socket.id);
      if (side) duel.ready(side);
    });
    socket.on('rematch', () => {
      const side = duel.sideOf(socket.id);
      if (side) duel.rematch(side);
    });
    socket.on('latency', (ack) => {
      if (typeof ack === 'function') ack();
    });
    socket.on('disconnect', () => duel.leave(socket.id));
  });

  // Bucle del servidor: pasos FIJOS de 1/TICK_RATE s (igual que la predicción del cliente,
  // así ambos simulan lo mismo), acumulando el tiempo real. `state` cada TICK_RATE/STATE_RATE pasos.
  let timer = null;
  function startLoop() {
    const STEP = 1000 / cfg.TICK_RATE;
    const STEPS_PER_STATE = Math.max(1, Math.round(cfg.TICK_RATE / cfg.STATE_RATE));
    let last = process.hrtime.bigint();
    let acc = 0;
    let stepCount = 0;
    timer = setInterval(() => {
      const now = process.hrtime.bigint();
      acc += Number(now - last) / 1e6;
      last = now;
      if (acc > 250) acc = 250; // si el proceso se trabó, no intentar ponerse al día de golpe
      let sendState = false;
      while (acc >= STEP) {
        duel.tick(STEP);
        acc -= STEP;
        if (++stepCount % STEPS_PER_STATE === 0) sendState = true;
      }
      if (sendState) {
        const room = io.sockets.adapter.rooms.get(ROOM);
        if (room && room.size) io.to(ROOM).emit('state', duel.snapshot());
      }
    }, 4);
  }

  return {
    app,
    httpServer,
    io,
    duel,
    cfg,
    start(port = cfg.PORT) {
      return new Promise((resolve) => {
        httpServer.listen(port, () => {
          startLoop();
          resolve(httpServer.address().port);
        });
      });
    },
    close() {
      clearInterval(timer);
      io.disconnectSockets(true);
      return new Promise((resolve) => io.close(() => resolve()));
    },
  };
}

if (require.main === module) {
  const server = createServer();
  server.start().then((port) => {
    console.log(`Mikyosho escuchando en http://localhost:${port}`);
  });
}

module.exports = { createServer };
