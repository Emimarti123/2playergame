(() => {
  'use strict';

  const { W, H, GROUND_Y, PLATFORMS } = window.Stages;
  const SPAWN = { left: 150, right: 650 };
  const INTERP_DELAY = 50; // ms de buffer para interpolar al RIVAL (el estado llega 60 veces por segundo)
  const STEP = 1 / 60; // tick fijo, igual que el servidor
  const SIM_PHASES = ['COUNTDOWN', 'PLAYING', 'POINT_PAUSE']; // fases en las que el servidor simula
  const PREDICTED_SOUNDS = new Set(['jump', 'throw', 'slash']); // suenan al instante con la predicción
  const SNAP_DIST = 120; // si un ninja salta más que esto (reinicio de ronda) no se interpola
  const FPS = { idle: 6, run: 12, throw: 10, hurt: 8, ko: 1, stun: 6 };

  // Cada jugador tiene un color fijo según su lado (el personaje lo escoge en el menú)
  const SIDE_INFO = {
    left: { name: 'Rojo', color: '#e63946', css: 'red' },
    right: { name: 'Azul', color: '#3a86ff', css: 'blue' },
  };

  // ---------------------------------------------------------------------------
  // DOM
  // ---------------------------------------------------------------------------
  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');
  const overlay = document.getElementById('overlay');
  const elTitle = document.getElementById('overlay-title');
  const elSub = document.getElementById('overlay-sub');
  const btnReady = document.getElementById('btn-ready');
  const btnRematch = document.getElementById('btn-rematch');
  const btnSound = document.getElementById('btn-sound');
  const elRole = document.getElementById('role');
  const elPing = document.getElementById('ping');
  const elMenu = document.getElementById('menu');
  const elMenuChars = document.getElementById('menu-chars');
  const elMenuStages = document.getElementById('menu-stages');

  // ---------------------------------------------------------------------------
  // Catálogo, personajes y escenarios cargados
  // ---------------------------------------------------------------------------
  let catalog = { stages: [{ id: 'atardecer', name: 'Atardecer', builtin: 'atardecer' }], characters: [{ id: 'ninja', name: 'Ninja', builtin: 'ninja' }] };
  const loadedChars = { left: {}, right: {} }; // side -> id -> personaje listo
  const loadedStages = {}; // id -> canvas
  let fallbackStage = window.Stages.paintTheme('atardecer');

  const RANDOM = 'random';
  const RANDOM_ENTRY = { id: RANDOM, name: 'Al azar' };
  const charEntry = (id) => catalog.characters.find((c) => c.id === id) || catalog.characters[0];
  const stageEntry = (id) => catalog.stages.find((s) => s.id === id) || catalog.stages[0];

  function ensureChar(side, id) {
    const entry = charEntry(id);
    if (!(entry.id in loadedChars[side])) {
      loadedChars[side][entry.id] = null;
      window.Characters.load(entry, side).then((ch) => {
        loadedChars[side][entry.id] = ch;
        renderMenu();
      });
    }
    return loadedChars[side][entry.id];
  }
  function ensureStage(id) {
    const entry = stageEntry(id);
    if (!(entry.id in loadedStages)) {
      loadedStages[entry.id] = null;
      window.Stages.build(entry).then((c) => {
        loadedStages[entry.id] = c;
        renderMenu();
      });
    }
    return loadedStages[entry.id];
  }

  // El ninja incluido sirve de respaldo mientras carga una imagen
  const defaultChar = { left: null, right: null };
  window.Characters.load({ id: 'ninja', builtin: 'ninja' }, 'left').then((c) => (defaultChar.left = c));
  window.Characters.load({ id: 'ninja', builtin: 'ninja' }, 'right').then((c) => (defaultChar.right = c));

  fetch('catalog.json')
    .then((r) => r.json())
    .then((c) => {
      if (c && Array.isArray(c.stages) && c.stages.length && Array.isArray(c.characters) && c.characters.length) catalog = c;
      buildMenu();
    })
    .catch(() => buildMenu());

  // ---------------------------------------------------------------------------
  // Red
  // ---------------------------------------------------------------------------
  let storedId = null;
  try { storedId = sessionStorage.getItem('ninjaPlayerId'); } catch (_) { /* sin storage */ }

  // WebSocket directo (sin el "polling" inicial); si la red no lo permite, cae a polling
  const socket = io({ auth: { playerId: storedId }, transports: ['websocket', 'polling'] });

  // ---------------------------------------------------------------------------
  // Predicción: tu ninja se simula aquí al instante con la misma física del servidor
  // (game-core.js) y se corrige con cada estado oficial. El rival se interpola.
  // ---------------------------------------------------------------------------
  let predictor = null;
  let predAcc = 0;
  const predOffset = { x: 0, y: 0 }; // suaviza las correcciones para que no se vean saltos

  let mySide = null;
  let phase = null; // último payload de 'phase'
  let phaseAt = 0;
  let full = false;
  let kicked = false;
  let opponentGrace = null; // { until }
  let snaps = []; // { at, s }
  let pendingEvents = []; // { at, ev } — se disparan cuando el render alcanza ese momento
  let last = null; // último snapshot recibido (para el HUD)

  socket.on('joined', ({ side, playerId, cfg }) => {
    mySide = side;
    predictor = cfg && window.GameCore ? window.GameCore.createPredictor(cfg, side) : null;
    predAcc = 0;
    predOffset.x = predOffset.y = 0;
    sent = ''; // reenviar el estado de teclas actual con numeración nueva
    syncInput();
    kicked = false;
    try { sessionStorage.setItem('ninjaPlayerId', playerId); } catch (_) { /* ignore */ }
    elRole.textContent = ''; // solo se usa para avisos (reconectando, sin cupo…)
    elRole.className = '';
    buildMenu();
  });

  socket.on('connect_error', (err) => {
    if (err && err.message === 'duel_full') {
      full = true;
      elRole.textContent = 'Sin cupo: el duelo ya tiene 2 jugadores';
      elRole.className = '';
      socket.disconnect(); // sin reintentos
    } else {
      elRole.textContent = 'Reconectando…';
    }
    updateOverlay();
  });
  socket.on('duel_full', () => { full = true; socket.disconnect(); updateOverlay(); });
  socket.on('kicked', () => {
    kicked = true;
    mySide = null;
    elRole.textContent = 'Expulsado por inactividad';
    elRole.className = '';
    updateOverlay();
  });
  socket.on('disconnect', () => { if (!full && !kicked) elRole.textContent = 'Reconectando…'; });

  socket.on('phase', (p) => {
    const prev = phase;
    phase = p;
    phaseAt = performance.now();
    if (p.phase === 'WAITING') opponentGrace = null; // el slot del rival ya se liberó
    if (p.phase === 'COUNTDOWN' && (!prev || prev.phase !== 'COUNTDOWN')) sfx('ready');
    if (p.phase === 'PLAYING' && prev && prev.phase !== 'PLAYING') sfx('fight');
    if (p.phase === 'GAME_OVER' && (!prev || prev.phase !== 'GAME_OVER')) sfx(p.winner === mySide ? 'win' : 'lose');
    ensureStage(p.stage);
    for (const side of ['left', 'right']) if (p.stagePicks[side] !== RANDOM) ensureStage(p.stagePicks[side]);
    ensureChar('left', p.chars.left);
    ensureChar('right', p.chars.right);
    btnReady.disabled = false;
    btnRematch.disabled = false;
    renderMenu();
    updateOverlay();
  });

  socket.on('state', (s) => {
    const at = performance.now();
    snaps.push({ at, s });
    if (snaps.length > 30) snaps.shift();
    for (const ev of s.events || []) pendingEvents.push({ at, ev });
    last = s;
    const me = mySide && s.players[mySide];
    if (predictor && me && me.st) {
      const r = predictor.reconcile(me.st, me.n, me.nt, STEP);
      predOffset.x -= r.dx;
      predOffset.y -= r.dy;
      if (Math.hypot(predOffset.x, predOffset.y) > 80) predOffset.x = predOffset.y = 0; // teletransporte (nueva ronda)
    }
  });

  socket.on('opponent_left', ({ graceMs }) => {
    opponentGrace = { until: performance.now() + graceMs };
    updateOverlay();
  });
  socket.on('opponent_back', () => { opponentGrace = null; updateOverlay(); });

  btnReady.addEventListener('click', () => { unlockAudio(); socket.emit('ready'); btnReady.disabled = true; });
  btnRematch.addEventListener('click', () => { unlockAudio(); socket.emit('rematch'); btnRematch.disabled = true; });

  // Ping con ack
  setInterval(() => {
    if (!socket.connected) return;
    const t0 = performance.now();
    socket.timeout(2000).emit('latency', (err) => {
      elPing.textContent = err ? '— ms' : `${Math.round(performance.now() - t0)} ms`;
    });
  }, 2000);

  // ---------------------------------------------------------------------------
  // Menú: personaje (cada quien el suyo) y escenario (compartido)
  // ---------------------------------------------------------------------------
  function card(kind, entry) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'card';
    b.dataset.id = entry.id;
    const c = document.createElement('canvas');
    if (kind === 'char') { c.width = 72; c.height = 72; } else { c.width = 128; c.height = 72; }
    const name = document.createElement('span');
    name.className = 'card-name';
    name.textContent = entry.name || entry.id;
    const tag = document.createElement('span');
    tag.className = 'card-tag';
    b.append(c, name, tag);
    b.addEventListener('click', () => {
      unlockAudio();
      socket.emit('select', kind === 'char' ? { char: entry.id } : { stage: entry.id });
      b.blur();
    });
    return b;
  }

  function buildMenu() {
    elMenuChars.replaceChildren(...catalog.characters.map((e) => card('char', e)));
    elMenuStages.replaceChildren(...[...catalog.stages, RANDOM_ENTRY].map((e) => card('stage', e)));
    renderMenu();
  }

  function renderMenu() {
    const me = mySide || 'left';
    const rival = me === 'left' ? 'right' : 'left';
    for (const b of elMenuChars.children) {
      const id = b.dataset.id;
      const ch = ensureChar(me, id);
      const c = b.querySelector('canvas');
      const g = c.getContext('2d');
      g.clearRect(0, 0, c.width, c.height);
      if (ch) window.Characters.draw(g, ch, 'idle', 0, c.width / 2, c.height - 6, 1, 0.78);
      const mine = phase && phase.chars[me] === id;
      const theirs = phase && phase.occupied[rival] && phase.chars[rival] === id;
      b.classList.toggle('selected', !!mine);
      b.style.setProperty('--sel', SIDE_INFO[me].color);
      b.querySelector('.card-tag').textContent = theirs ? `Rival (${SIDE_INFO[rival].name})` : '';
      b.setAttribute('aria-pressed', String(!!mine));
    }
    for (const b of elMenuStages.children) {
      const id = b.dataset.id;
      const c = b.querySelector('canvas');
      const g = c.getContext('2d');
      if (id === RANDOM) paintRandomThumb(g, c.width, c.height);
      else {
        const st = ensureStage(id);
        if (st) g.drawImage(st, 0, 0, c.width, c.height);
      }
      // Cada jugador elige su escenario; al empezar se sortea entre las dos elecciones
      const mine = phase && phase.stagePicks[me] === id;
      const theirs = phase && phase.occupied[rival] && phase.stagePicks[rival] === id;
      b.classList.toggle('selected', !!mine);
      b.style.setProperty('--sel', SIDE_INFO[me].color);
      b.querySelector('.card-tag').textContent = theirs ? `Rival (${SIDE_INFO[rival].name})` : '';
      b.setAttribute('aria-pressed', String(!!mine));
    }
  }

  function paintRandomThumb(g, w, h) {
    const grad = g.createLinearGradient(0, 0, w, h);
    grad.addColorStop(0, '#2b1d4e');
    grad.addColorStop(1, '#8a3f6e');
    g.fillStyle = grad;
    g.fillRect(0, 0, w, h);
    g.fillStyle = '#ffb703';
    g.font = '800 44px system-ui, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText('?', w / 2, h / 2 + 2);
  }

  // ---------------------------------------------------------------------------
  // Input: se manda el estado de las 5 acciones solo cuando cambia
  // ---------------------------------------------------------------------------
  // W A S D moverse · Q espadazo · E shuriken · Shift izquierdo parry (las flechas también mueven)
  const KEYMAP = {
    KeyA: 'l', ArrowLeft: 'l',
    KeyD: 'r', ArrowRight: 'r',
    KeyW: 'u', ArrowUp: 'u',
    KeyS: 'd', ArrowDown: 'd',
    KeyQ: 'a',
    KeyE: 'f',
    ShiftLeft: 'p',
  };
  const held = {}; // code -> bool
  let sent = '';

  function syncInput() {
    const st = { l: false, r: false, u: false, d: false, f: false, a: false, p: false };
    for (const code in held) if (held[code]) st[KEYMAP[code]] = true;
    const key = JSON.stringify(st);
    if (key !== sent) {
      sent = key;
      if (predictor) socket.emit('input', { ...st, n: predictor.setInput(st) });
      else socket.emit('input', st);
    }
  }
  window.addEventListener('keydown', (e) => {
    if (e.code === 'KeyM' && !e.repeat) { toggleSound(); return; }
    const k = KEYMAP[e.code];
    if (!k) return;
    if (e.target instanceof HTMLButtonElement && e.code === 'Space') return; // deja usar los botones
    e.preventDefault();
    unlockAudio();
    held[e.code] = true;
    syncInput();
  });
  window.addEventListener('keyup', (e) => {
    if (!KEYMAP[e.code]) return;
    held[e.code] = false;
    syncInput();
  });
  window.addEventListener('blur', () => { for (const k in held) held[k] = false; syncInput(); });

  // ---------------------------------------------------------------------------
  // Sonido (WebAudio sintetizado, sin archivos)
  // ---------------------------------------------------------------------------
  let audio = null;
  let soundOn = true;
  try { soundOn = localStorage.getItem('ninjaSound') !== 'off'; } catch (_) { /* ignore */ }
  function renderSoundBtn() {
    btnSound.textContent = soundOn ? '🔊' : '🔇';
    btnSound.setAttribute('aria-pressed', String(soundOn));
  }
  function toggleSound() {
    soundOn = !soundOn;
    try { localStorage.setItem('ninjaSound', soundOn ? 'on' : 'off'); } catch (_) { /* ignore */ }
    renderSoundBtn();
  }
  btnSound.addEventListener('click', () => { unlockAudio(); toggleSound(); btnSound.blur(); });
  renderSoundBtn();

  function unlockAudio() {
    if (audio) { if (audio.state === 'suspended') audio.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (AC) audio = new AC();
  }
  function tone(freq, dur, { type = 'square', vol = 0.08, slide = 0, delay = 0 } = {}) {
    const t0 = audio.currentTime + delay;
    const o = audio.createOscillator();
    const g = audio.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t0);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq + slide), t0 + dur);
    g.gain.setValueAtTime(vol, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g).connect(audio.destination);
    o.start(t0);
    o.stop(t0 + dur + 0.02);
  }
  function sfx(name) {
    if (!audio || !soundOn) return;
    switch (name) {
      case 'throw': tone(900, 0.09, { type: 'triangle', vol: 0.06, slide: -500 }); break;
      case 'jump': tone(300, 0.12, { type: 'square', vol: 0.04, slide: 300 }); break;
      case 'hit': tone(180, 0.18, { type: 'sawtooth', vol: 0.1, slide: -120 }); break;
      case 'stomp': tone(120, 0.2, { type: 'square', vol: 0.1, slide: -60 }); tone(500, 0.1, { vol: 0.05, delay: 0.05 }); break;
      case 'clash': tone(1500, 0.08, { type: 'square', vol: 0.05 }); tone(2100, 0.1, { type: 'triangle', vol: 0.05, delay: 0.03 }); break;
      case 'slash': tone(700, 0.14, { type: 'sawtooth', vol: 0.04, slide: -450, delay: 0.12 }); break;
      case 'swordClash': tone(1200, 0.18, { type: 'square', vol: 0.06, slide: -200 }); tone(1900, 0.22, { type: 'triangle', vol: 0.06, delay: 0.02 }); break;
      case 'parry': tone(2200, 0.12, { type: 'triangle', vol: 0.08 }); tone(3300, 0.25, { type: 'sine', vol: 0.06, delay: 0.04 }); break;
      case 'ko': tone(400, 0.5, { type: 'sawtooth', vol: 0.1, slide: -330 }); break;
      case 'ready': tone(660, 0.12, { vol: 0.05 }); break;
      case 'fight': tone(523, 0.1, { vol: 0.06 }); tone(784, 0.18, { vol: 0.06, delay: 0.1 }); break;
      case 'win': [523, 659, 784, 1046].forEach((f, i) => tone(f, 0.18, { vol: 0.06, delay: i * 0.12 })); break;
      case 'lose': [392, 330, 262].forEach((f, i) => tone(f, 0.25, { type: 'triangle', vol: 0.07, delay: i * 0.18 })); break;
      default: break;
    }
  }

  // ---------------------------------------------------------------------------
  // Overlay por fase
  // ---------------------------------------------------------------------------
  function show(title, sub, { clear = false, ready = false, rematch = false, menu = false } = {}) {
    overlay.classList.remove('hidden');
    overlay.classList.toggle('clear', clear);
    overlay.classList.toggle('with-menu', menu);
    elTitle.textContent = title;
    elSub.textContent = sub || '';
    btnReady.hidden = !ready;
    btnRematch.hidden = !rematch;
    elMenu.hidden = !menu;
  }
  function hideOverlay() { overlay.classList.add('hidden'); elMenu.hidden = true; }

  function msLeft() {
    return phase ? Math.max(0, phase.endsInMs - (performance.now() - phaseAt)) : 0;
  }
  // "Sorteo: Noche (Rojo) vs Bosque (Azul) → Bosque"
  function stageAnnouncement() {
    const name = stageEntry(phase.stage).name;
    const roll = phase.stageRoll;
    if (!roll || roll.left === roll.right) return `Escenario: ${name}`;
    return `Sorteo: ${stageEntry(roll.left).name} vs ${stageEntry(roll.right).name} → ${name}`;
  }
  const playerLabel = (side) => `${SIDE_INFO[side].name} (${charEntry(phase.chars[side]).name})`;

  function updateOverlay() {
    if (full) return show('Duelo lleno', 'Ya hay 2 jugadores peleando. Solo se permiten 2; intenta más tarde.');
    if (kicked) return show('Fuera del dojo', 'Te sacamos por inactividad. Recarga la página para volver a entrar.');
    if (!phase) return show('Conectando…', '');
    const inProgress = ['COUNTDOWN', 'PLAYING', 'POINT_PAUSE'].includes(phase.phase);
    if (opponentGrace) {
      const s = Math.max(0, Math.ceil((opponentGrace.until - performance.now()) / 1000));
      return inProgress
        ? show('Rival desconectado', `Pausa. Si no vuelve en ${s} s ganas por abandono.`)
        : show('Rival desconectado', `Esperando reconexión (${s} s)…`);
    }
    switch (phase.phase) {
      case 'WAITING':
        return show('Esperando rival…', '', { menu: true });
      case 'READY': {
        const iAmReady = mySide && phase.ready[mySide];
        return show(
          iAmReady ? 'Esperando al rival…' : '¡Rival encontrado!',
          iAmReady ? 'Tú ya estás listo. Aún puedes cambiar tu personaje o el escenario.' : 'Escoge personaje y escenario, y pulsa "¡Listo!".',
          { ready: !iAmReady, menu: true }
        );
      }
      case 'COUNTDOWN':
        return show(String(Math.max(1, Math.ceil(msLeft() / 1000))), `${stageAnnouncement()}\nRonda ${phase.round} · primero en ${phase.winScore} K.O.`, { clear: true });
      case 'POINT_PAUSE': {
        const resetDone = msLeft() < 1200;
        return resetDone
          ? show(`Ronda ${phase.round}`, '¡Prepárate!', { clear: true })
          : show('K.O.', `${phase.lastKo === mySide ? 'Caíste' : `Cayó ${playerLabel(phase.lastKo)}`} · ${phase.score.left} – ${phase.score.right}`, { clear: true });
      }
      case 'GAME_OVER': {
        const won = phase.winner === mySide;
        const iWant = mySide && phase.rematch[mySide];
        return show(
          won ? '¡Victoria!' : 'Derrota',
          `Rojo ${phase.score.left} – ${phase.score.right} Azul` + (iWant ? ' · esperando al rival para la revancha' : ''),
          { rematch: !iWant, menu: true }
        );
      }
      default:
        return hideOverlay();
    }
  }

  // ---------------------------------------------------------------------------
  // Interpolación (~100 ms en el pasado, como el Pong dual)
  // ---------------------------------------------------------------------------
  const lerp = (a, b, t) => a + (b - a) * t;

  function interpolated(target) {
    if (!snaps.length) return null;
    let a = null, b = null;
    for (let i = snaps.length - 1; i >= 0; i--) {
      if (snaps[i].at <= target) { a = snaps[i]; b = snaps[i + 1] || null; break; }
    }
    if (!a) return snaps[0].s;
    if (!b) return a.s;
    const t = Math.min(1, (target - a.at) / (b.at - a.at || 1));
    const A = a.s, B = b.s;
    const players = {};
    for (const side of ['left', 'right']) {
      const pa = A.players[side], pb = B.players[side];
      const jump = Math.hypot(pb.x - pa.x, pb.y - pa.y) > SNAP_DIST;
      players[side] = jump ? pb : { ...pb, x: lerp(pa.x, pb.x, t), y: lerp(pa.y, pb.y, t) };
    }
    const prevStars = new Map(A.stars.map((s) => [s.id, s]));
    const stars = B.stars.map((s) => {
      const p = prevStars.get(s.id);
      return p ? { ...s, x: lerp(p.x, s.x, t), y: lerp(p.y, s.y, t) } : s;
    });
    return { players, stars };
  }

  // ---------------------------------------------------------------------------
  // Efectos: partículas y sacudida de cámara
  // ---------------------------------------------------------------------------
  const particles = [];
  const flashes = []; // destello circular de un parry exitoso
  let shake = 0;

  function burst(x, y, color, n, speed) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const v = speed * (0.4 + Math.random() * 0.8);
      particles.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 80, life: 0.5 + Math.random() * 0.3, t: 0, color, size: 2 + Math.random() * 3 });
    }
  }

  function handleEvent(ev) {
    switch (ev.type) {
      case 'throw':
      case 'jump':
      case 'slash':
        // Los de tu ninja ya sonaron al instante con la predicción
        if (!(predictor && ev.side === mySide)) sfx(ev.type);
        break;
      case 'hit':
        sfx(ev.kind === 'stomp' ? 'stomp' : 'hit');
        burst(ev.x, ev.y, SIDE_INFO[ev.side].color, 16, 260);
        burst(ev.x, ev.y, '#fff3c4', 8, 200);
        shake = Math.max(shake, ev.kind === 'stomp' ? 9 : 6);
        break;
      case 'clash':
        sfx(ev.kind === 'sword' ? 'swordClash' : 'clash');
        burst(ev.x, ev.y, '#ffe066', ev.kind === 'sword' ? 24 : 14, ev.kind === 'sword' ? 320 : 240);
        if (ev.kind === 'sword') shake = Math.max(shake, 7);
        break;
      case 'parry':
        sfx('parry');
        burst(ev.x, ev.y, '#ffffff', 18, 300);
        burst(ev.x, ev.y, '#9fd3ff', 12, 220);
        flashes.push({ x: ev.x, y: ev.y, t: 0 });
        shake = Math.max(shake, 5);
        break;
      case 'ko':
        sfx('ko');
        shake = 14;
        break;
      default: break;
    }
  }

  function updateParticles(dt) {
    for (const p of particles) {
      p.t += dt;
      p.vy += 900 * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
    }
    for (let i = particles.length - 1; i >= 0; i--) if (particles[i].t >= particles[i].life) particles.splice(i, 1);
    for (const f of flashes) f.t += dt;
    for (let i = flashes.length - 1; i >= 0; i--) if (flashes[i].t > 0.3) flashes.splice(i, 1);
  }

  // ---------------------------------------------------------------------------
  // Dibujo de personajes y shurikens
  // ---------------------------------------------------------------------------
  const animState = { left: { a: 'idle', t: 0 }, right: { a: 'idle', t: 0 } };

  function frameIndex(side, ch, p, dt) {
    const st = animState[side];
    if (st.a !== p.a) { st.a = p.a; st.t = 0; }
    st.t += dt;
    const count = window.Characters.frameCount(ch, p.a);
    if (p.a === 'jump') return count >= 3 ? (p.vy < -150 ? 0 : p.vy <= 150 ? 1 : 2) : 0;
    if (p.a === 'slash') return Math.min(count - 1, p.k || 0); // fase dictada por el servidor
    if (p.a === 'parry') return 0;
    if (p.a === 'throw' || p.a === 'ko') return Math.min(count - 1, Math.floor(st.t * FPS[p.a]));
    return Math.floor(st.t * FPS[p.a]) % count;
  }

  function floorBelow(x, y) {
    let best = GROUND_Y;
    for (const pl of PLATFORMS) {
      if (x > pl.x && x < pl.x + pl.w && pl.y >= y - 1 && pl.y < best) best = pl.y;
    }
    return best;
  }

  function currentChar(side) {
    const id = phase ? phase.chars[side] : 'ninja';
    return ensureChar(side, id) || defaultChar[side];
  }

  function drawPlayer(side, p, dt, now) {
    const color = SIDE_INFO[side].color;
    // Sombra y aro del color del jugador sobre la superficie de abajo
    const fy = floorBelow(p.x, p.y);
    const air = Math.max(0, fy - p.y);
    const rx = Math.max(8, 22 - air / 10);
    ctx.fillStyle = `rgba(0,0,0,${Math.max(0.08, 0.32 - air / 500)})`;
    ctx.beginPath();
    ctx.ellipse(p.x, fy + 2, rx, 5, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = color;
    ctx.globalAlpha = 0.8;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.ellipse(p.x, fy + 2, rx + 2, 6, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.globalAlpha = 1;

    const ch = currentChar(side);
    if (ch) {
      const i = frameIndex(side, ch, p, dt);
      ctx.save();
      if (p.inv && p.a !== 'ko' && Math.floor(now / 70) % 2 === 0) ctx.globalAlpha = 0.35; // parpadeo invulnerable
      if (p.a === 'parry' && p.k === 1) ctx.globalAlpha = 0.75; // parry fallido: vulnerable
      window.Characters.draw(ctx, ch, p.a, i, p.x, p.y, p.f);
      ctx.restore();
    }
    drawActionFx(side, p, now);

    // Indicador "TÚ"
    if (side === mySide && p.a !== 'ko') {
      const y = p.y - 92 + Math.sin(now / 200) * 3;
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.moveTo(p.x - 7, y); ctx.lineTo(p.x + 7, y); ctx.lineTo(p.x, y + 8);
      ctx.closePath(); ctx.fill();
      ctx.font = '700 11px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('TÚ', p.x, y - 4);
    }
  }

  // Efectos dibujados por código (iguales para cualquier personaje)
  function drawActionFx(side, p, now) {
    const color = SIDE_INFO[side].color;
    const cy = p.y - 34;
    if (p.a === 'slash' && p.k === 1) {
      // Arco del corte al frente
      ctx.save();
      ctx.translate(p.x, cy);
      ctx.scale(p.f, 1);
      ctx.lineCap = 'round';
      ctx.strokeStyle = color;
      ctx.globalAlpha = 0.5;
      ctx.lineWidth = 10;
      ctx.beginPath(); ctx.arc(4, 0, 46, -1.1, 1.0); ctx.stroke();
      ctx.strokeStyle = '#ffffff';
      ctx.globalAlpha = 0.9;
      ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(4, 0, 48, -1.0, 0.9); ctx.stroke();
      ctx.restore();
    } else if (p.a === 'slash' && p.k === 0) {
      // Destello en la preparación: avisa que viene un espadazo
      ctx.fillStyle = 'rgba(255,255,255,0.8)';
      const fx = p.x - p.f * 8, fy = p.y - 80;
      ctx.beginPath();
      ctx.moveTo(fx, fy - 6); ctx.lineTo(fx + 2, fy - 2); ctx.lineTo(fx + 6, fy); ctx.lineTo(fx + 2, fy + 2);
      ctx.lineTo(fx, fy + 6); ctx.lineTo(fx - 2, fy + 2); ctx.lineTo(fx - 6, fy); ctx.lineTo(fx - 2, fy - 2);
      ctx.closePath(); ctx.fill();
    } else if (p.a === 'parry' && p.k === 0) {
      // Guardia activa: media luna brillante al frente
      ctx.save();
      ctx.translate(p.x, cy);
      ctx.scale(p.f, 1);
      ctx.strokeStyle = '#bfe3ff';
      ctx.globalAlpha = 0.55 + 0.3 * Math.sin(now / 40);
      ctx.lineWidth = 4;
      ctx.beginPath(); ctx.arc(0, 0, 34, -1.2, 1.2); ctx.stroke();
      ctx.restore();
    } else if (p.a === 'stun') {
      // Estrellitas girando sobre la cabeza
      for (let i = 0; i < 3; i++) {
        const a = now / 180 + (i * Math.PI * 2) / 3;
        const sx = p.x + Math.cos(a) * 16, sy = p.y - 82 + Math.sin(a) * 5;
        ctx.fillStyle = '#ffe066';
        ctx.beginPath();
        for (let k = 0; k < 10; k++) {
          const r = k % 2 ? 2 : 5, b = (k * Math.PI) / 5 - Math.PI / 2;
          ctx.lineTo(sx + Math.cos(b) * r, sy + Math.sin(b) * r);
        }
        ctx.closePath(); ctx.fill();
      }
    }
  }

  function drawStar(s, now) {
    const color = SIDE_INFO[s.o].color;
    ctx.strokeStyle = color + '66';
    ctx.lineWidth = 4;
    ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(s.x - s.d * 26, s.y); ctx.lineTo(s.x - s.d * 6, s.y); ctx.stroke();
    ctx.save();
    ctx.translate(s.x, s.y);
    ctx.rotate((now / 1000) * 18 * s.d);
    ctx.beginPath();
    for (let i = 0; i < 8; i++) {
      const a = (i * Math.PI) / 4;
      const r = i % 2 === 0 ? 10 : 3.5;
      ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r);
    }
    ctx.closePath();
    ctx.fillStyle = '#d7dde8';
    ctx.fill();
    ctx.strokeStyle = '#14121e';
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.fillStyle = color;
    ctx.beginPath(); ctx.arc(0, 0, 2.5, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }

  // ---------------------------------------------------------------------------
  // HUD en el canvas: corazones y rondas ganadas
  // ---------------------------------------------------------------------------
  function heart(x, y, s, fill) {
    ctx.beginPath();
    ctx.moveTo(x, y + s * 0.3);
    ctx.bezierCurveTo(x, y, x - s * 0.5, y, x - s * 0.5, y + s * 0.3);
    ctx.bezierCurveTo(x - s * 0.5, y + s * 0.6, x, y + s * 0.8, x, y + s);
    ctx.bezierCurveTo(x, y + s * 0.8, x + s * 0.5, y + s * 0.6, x + s * 0.5, y + s * 0.3);
    ctx.bezierCurveTo(x + s * 0.5, y, x, y, x, y + s * 0.3);
    ctx.fillStyle = fill;
    ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.6)';
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }

  function drawHUD(state) {
    const maxHp = phase ? phase.maxHp : 5;
    const winScore = phase ? phase.winScore : 3;
    const score = last ? last.score : { left: 0, right: 0 };
    for (const side of ['left', 'right']) {
      const info = SIDE_INFO[side];
      const hp = state ? state.players[side].hp : maxHp;
      const dirX = side === 'left' ? 1 : -1;
      const x0 = side === 'left' ? 14 : W - 14;
      ctx.fillStyle = 'rgba(18,14,31,0.6)';
      ctx.fillRect(side === 'left' ? 8 : W - 8 - 196, 8, 196, 56);
      ctx.fillStyle = info.color;
      ctx.font = '800 15px system-ui, sans-serif';
      ctx.textAlign = side === 'left' ? 'left' : 'right';
      ctx.textBaseline = 'top';
      const charName = phase ? charEntry(phase.chars[side]).name : 'Ninja';
      ctx.fillText(charName.toUpperCase(), x0, 14);
      for (let i = 0; i < maxHp; i++) {
        heart(x0 + dirX * (10 + i * 24), 36, 18, i < hp ? info.color : 'rgba(255,255,255,0.15)');
      }
      for (let i = 0; i < winScore; i++) {
        const cx = x0 + dirX * (138 + i * 16);
        ctx.beginPath();
        ctx.arc(cx, 44, 6, 0, Math.PI * 2);
        ctx.fillStyle = i < score[side] ? '#ffb703' : 'rgba(255,255,255,0.15)';
        ctx.fill();
      }
    }
    if (phase && phase.phase !== 'WAITING' && phase.phase !== 'READY') {
      ctx.fillStyle = 'rgba(243,238,252,0.85)';
      ctx.font = '700 14px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(`RONDA ${phase.round}`, W / 2, 14);
    }
    ctx.textBaseline = 'alphabetic';
  }

  // ---------------------------------------------------------------------------
  // Partículas ambientales del escenario (detrás de los personajes)
  // ---------------------------------------------------------------------------
  const AMBIENT_COUNT = { snow: 70, petals: 40, leaves: 24, embers: 45, fireflies: 22, gulls: 3 };
  const ambient = { kind: null, list: [] };
  const rnd = (a, b) => a + Math.random() * (b - a);

  function spawnAmbient(kind, anywhere) {
    const p = { t: Math.random() * 10, x: rnd(0, W), y: anywhere ? rnd(0, GROUND_Y) : -10 };
    switch (kind) {
      case 'snow': Object.assign(p, { vx: rnd(-8, 8), vy: rnd(25, 60), r: rnd(1, 2.8) }); break;
      case 'petals': Object.assign(p, { x: anywhere ? p.x : rnd(-100, W), vx: rnd(18, 40), vy: rnd(22, 45), r: rnd(2.5, 4), rot: rnd(0, 6) }); break;
      case 'leaves': Object.assign(p, { x: anywhere ? p.x : rnd(-100, W), vx: rnd(10, 25), vy: rnd(18, 35), r: rnd(3, 5), rot: rnd(0, 6) }); break;
      case 'embers': Object.assign(p, { y: anywhere ? rnd(150, GROUND_Y) : GROUND_Y + 5, vx: rnd(-10, 10), vy: rnd(-70, -30), r: rnd(1, 2.5) }); break;
      case 'fireflies': Object.assign(p, { y: rnd(160, GROUND_Y - 10), vx: rnd(-12, 12), vy: rnd(-8, 8), r: rnd(1.5, 2.5) }); break;
      case 'gulls': Object.assign(p, { x: anywhere ? p.x : -30, y: rnd(50, 150), vx: rnd(35, 65), vy: 0, r: rnd(0.8, 1.2) }); break;
      default: break;
    }
    return p;
  }

  function drawAmbient(kind, dt, now) {
    if (ambient.kind !== kind) { ambient.kind = kind; ambient.list = []; }
    if (!kind || !AMBIENT_COUNT[kind]) return;
    while (ambient.list.length < AMBIENT_COUNT[kind]) ambient.list.push(spawnAmbient(kind, true));
    ctx.save();
    for (let i = 0; i < ambient.list.length; i++) {
      let p = ambient.list[i];
      p.t += dt;
      const sway = Math.sin(p.t * 1.7 + i) * 12;
      p.x += (p.vx + (kind === 'snow' || kind === 'petals' || kind === 'leaves' ? sway : 0)) * dt;
      p.y += p.vy * dt;
      if (kind === 'fireflies') { p.vx += rnd(-20, 20) * dt; p.vy += rnd(-20, 20) * dt; p.vx *= 0.99; p.vy *= 0.99; }
      const gone = p.y > GROUND_Y + 10 || p.x > W + 40 || p.x < -120 || (kind === 'embers' && p.y < 40) ||
        (kind === 'fireflies' && (p.y < 120 || p.y > GROUND_Y));
      if (gone) { p = ambient.list[i] = spawnAmbient(kind, kind === 'fireflies'); continue; }
      switch (kind) {
        case 'snow':
          ctx.fillStyle = 'rgba(255,255,255,0.85)';
          ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2); ctx.fill();
          break;
        case 'petals':
        case 'leaves':
          ctx.fillStyle = kind === 'petals' ? (i % 2 ? '#ffc4d6' : '#f7a6c1') : (i % 2 ? '#9ed2aa' : '#6fae7e');
          ctx.beginPath(); ctx.ellipse(p.x, p.y, p.r, p.r * 0.55, p.rot + p.t * 2, 0, Math.PI * 2); ctx.fill();
          break;
        case 'embers': {
          const a = Math.max(0, Math.min(1, (p.y - 40) / 200)) * (0.6 + 0.4 * Math.sin(p.t * 12 + i));
          ctx.fillStyle = `rgba(255,${140 + (i % 3) * 40},60,${a})`;
          ctx.fillRect(p.x, p.y, p.r * 1.5, p.r * 1.5);
          break;
        }
        case 'fireflies': {
          const a = 0.15 + 0.85 * Math.max(0, Math.sin(p.t * 2.2 + i * 1.3));
          const glow = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.r * 5);
          glow.addColorStop(0, `rgba(230,255,120,${a * 0.6})`);
          glow.addColorStop(1, 'rgba(230,255,120,0)');
          ctx.fillStyle = glow;
          ctx.beginPath(); ctx.arc(p.x, p.y, p.r * 5, 0, Math.PI * 2); ctx.fill();
          ctx.fillStyle = `rgba(250,255,190,${a})`;
          ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2); ctx.fill();
          break;
        }
        case 'gulls': {
          const flap = Math.sin(p.t * 8 + i) * 4 * p.r;
          ctx.strokeStyle = 'rgba(60,50,80,0.8)';
          ctx.lineWidth = 1.8;
          ctx.beginPath();
          ctx.moveTo(p.x - 9 * p.r, p.y - flap);
          ctx.quadraticCurveTo(p.x - 4 * p.r, p.y - 4 * p.r, p.x, p.y);
          ctx.quadraticCurveTo(p.x + 4 * p.r, p.y - 4 * p.r, p.x + 9 * p.r, p.y - flap);
          ctx.stroke();
          break;
        }
        default: break;
      }
    }
    ctx.restore();
  }

  // ---------------------------------------------------------------------------
  // Bucle de render
  // ---------------------------------------------------------------------------
  function idlePreview() {
    const mk = (side) => ({ x: SPAWN[side], y: GROUND_Y, vy: 0, f: side === 'left' ? 1 : -1, hp: 5, a: 'idle', inv: false });
    return { players: { left: mk('left'), right: mk('right') }, stars: [] };
  }

  let prevNow = performance.now();
  let prevNowRaw = performance.now();
  function frame(now) {
    const dt = Math.min(0.05, (now - prevNow) / 1000);
    prevNow = now;
    const target = now - INTERP_DELAY;

    while (pendingEvents.length && pendingEvents[0].at <= target) handleEvent(pendingEvents.shift().ev);

    const playing = phase && ['COUNTDOWN', 'PLAYING', 'POINT_PAUSE', 'GAME_OVER'].includes(phase.phase);
    const state = (playing && interpolated(target)) || idlePreview();

    // Predicción: ticks fijos de tu ninja mientras el servidor también simula
    const simulating = predictor && phase && SIM_PHASES.includes(phase.phase) && !opponentGrace;
    if (simulating) {
      predAcc = Math.min(predAcc + (now - prevNowRaw) / 1000, 0.25);
      while (predAcc >= STEP) {
        for (const ev of predictor.tick(STEP, phase.phase !== 'PLAYING')) {
          if (ev.side === mySide && PREDICTED_SOUNDS.has(ev.type)) sfx(ev.type);
        }
        predAcc -= STEP;
      }
      const k = Math.exp(-dt * 14);
      predOffset.x *= k;
      predOffset.y *= k;
      const me = predictor.player;
      const C = window.GameCore;
      state.players = { ...state.players };
      state.players[mySide] = {
        x: me.x + predOffset.x,
        y: me.y + predOffset.y,
        vy: me.vy,
        f: me.facing,
        hp: me.hp,
        a: C.anim(me),
        k: C.animPhase(predictor.cfg, me),
        inv: me.invT > 0,
      };
    } else {
      predAcc = 0;
    }
    prevNowRaw = now;

    updateParticles(dt);
    updateOverlayTick();

    ctx.save();
    if (shake > 0) {
      ctx.translate((Math.random() - 0.5) * shake, (Math.random() - 0.5) * shake);
      shake = Math.max(0, shake - 40 * dt);
    }
    // En el menú se ve el escenario que elegiste; en la partida, el que salió en el sorteo
    let stageId = phase ? phase.stage : null;
    if (phase && mySide && ['WAITING', 'READY'].includes(phase.phase) && phase.stagePicks[mySide] !== RANDOM) stageId = phase.stagePicks[mySide];
    const stage = (stageId && ensureStage(stageId)) || fallbackStage;
    ctx.drawImage(stage, 0, 0);
    drawAmbient(window.Stages.ambientOf(stageId ? stageEntry(stageId) : null), dt, now);
    const order = mySide === 'left' ? ['right', 'left'] : ['left', 'right']; // tú encima
    for (const side of order) drawPlayer(side, state.players[side], dt, now);
    for (const s of state.stars) drawStar(s, now);
    for (const p of particles) {
      ctx.globalAlpha = Math.max(0, 1 - p.t / p.life);
      ctx.fillStyle = p.color;
      ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
    }
    ctx.globalAlpha = 1;
    for (const f of flashes) {
      const k = f.t / 0.3;
      ctx.strokeStyle = `rgba(220,240,255,${1 - k})`;
      ctx.lineWidth = 4 * (1 - k) + 1;
      ctx.beginPath(); ctx.arc(f.x, f.y, 10 + k * 46, 0, Math.PI * 2); ctx.stroke();
    }
    ctx.restore();

    drawHUD(playing ? state : null);
    requestAnimationFrame(frame);
  }

  // Refresca textos que dependen del tiempo (cuenta regresiva, gracia del rival, pausa)
  let lastOverlayKey = '';
  function updateOverlayTick() {
    if (!phase) return;
    if (phase.phase === 'COUNTDOWN' || phase.phase === 'POINT_PAUSE' || opponentGrace) {
      const ms = opponentGrace ? opponentGrace.until - performance.now() : msLeft();
      const key = `${phase.phase}|${Math.ceil(ms / 1000)}|${phase.phase === 'POINT_PAUSE' && ms < 1200}`;
      if (key !== lastOverlayKey) { lastOverlayKey = key; updateOverlay(); }
    }
  }

  requestAnimationFrame(frame);
  updateOverlay();
})();
