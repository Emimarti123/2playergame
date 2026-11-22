// Sprite sheet del ninja, dibujado con Canvas al cargar la página (sin archivos de imagen).
//
// Cada sheet es una rejilla de celdas de 64x64 (6 columnas). Filas:
//   0 idle (4)  1 run (6)  2 jump (3: subiendo, cima, cayendo)
//   3 throw (3) 4 hurt (2) 5 ko (1)
//   6 slash (3: prepara, corta, recupera) 7 parry (1) 8 stun (2: aturdido)
// El personaje mira a la derecha; el cliente lo voltea con scale(-1, 1).
// Ancla: centro horizontal de la celda (x=32) y suela de los pies en y=61.
// Se dibuja a RES veces el tamaño para que se vea nítido al escalar.
(() => {
  'use strict';

  const CELL = 64;
  const COLS = 6;
  const ROWS = ['idle', 'run', 'jump', 'throw', 'hurt', 'ko', 'slash', 'parry', 'stun'];
  const RES = 2;

  const OUT = '#14121e'; // contorno
  const SUIT = '#34384e'; // traje
  const SUIT_HI = '#4e5470'; // luz del traje
  const SUIT_BACK = '#26293a'; // brazo y pierna de atrás
  const SKIN = '#f1c8a0';
  const STEEL = '#c8d0dc';

  const PALETTES = {
    rojo: { band: '#e63946', bandDk: '#961e2d' },
    azul: { band: '#3a86ff', bandDk: '#1e4baa' },
  };

  // ---------------------------------------------------------------------------
  // Primitivas
  // ---------------------------------------------------------------------------
  function limb(g, pts, w, color) {
    g.lineCap = 'round';
    g.lineJoin = 'round';
    for (const [lw, c] of [[w + 2, OUT], [w, color]]) {
      g.strokeStyle = c;
      g.lineWidth = lw;
      g.beginPath();
      g.moveTo(pts[0][0], pts[0][1]);
      for (const p of pts.slice(1)) g.lineTo(p[0], p[1]);
      g.stroke();
    }
  }

  function blob(g, cx, cy, rx, ry, color, outline = true) {
    if (outline) {
      g.fillStyle = OUT;
      g.beginPath();
      g.ellipse(cx, cy, rx + 1, ry + 1, 0, 0, Math.PI * 2);
      g.fill();
    }
    g.fillStyle = color;
    g.beginPath();
    g.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
    g.fill();
  }

  function rect(g, x0, y0, x1, y1, color) {
    g.fillStyle = color;
    g.fillRect(x0, y0, x1 - x0, y1 - y0);
  }

  function star(g, cx, cy, r) {
    g.beginPath();
    for (let i = 0; i < 8; i++) {
      const a = 0.3 + (i * Math.PI) / 4;
      const rr = i % 2 === 0 ? r : r * 0.38;
      g.lineTo(cx + rr * Math.cos(a), cy + rr * Math.sin(a));
    }
    g.closePath();
    g.fillStyle = STEEL;
    g.fill();
    g.strokeStyle = OUT;
    g.lineWidth = 0.8;
    g.stroke();
  }

  // Katana en la mano: `angle` en radianes (0 = al frente, negativo = hacia arriba).
  const HILT = '#2a1d14', GUARD = '#d4a72c', SHEATH = '#5e321a';
  function katana(g, hand, angle) {
    const dx = Math.cos(angle), dy = Math.sin(angle);
    const at = (d) => [hand[0] + dx * d, hand[1] + dy * d];
    limb(g, [at(2.5), at(24)], 2.2, STEEL); // hoja
    limb(g, [at(-6), at(1.5)], 2.6, HILT); // mango
    const gp = at(2.2);
    limb(g, [[gp[0] - dy * 2.8, gp[1] + dx * 2.8], [gp[0] + dy * 2.8, gp[1] - dx * 2.8]], 1.6, GUARD); // guarda
  }

  // Dibuja un ninja con origen en la esquina de su celda. `pose` define las articulaciones.
  function ninja(g, pose, pal) {
    const bob = pose.bob || 0;
    const lean = pose.lean || 0;
    const hx = 32 + lean, hy = 20 + bob; // centro de la cabeza
    const sx = 31 + lean * 0.6, sy = 34 + bob; // hombros
    const hipx = 31 + lean * 0.3, hipy = 45 + bob; // cadera

    // Cola de la banda (detrás de todo)
    const t = pose.tail || 0;
    limb(g, [[hx - 10, hy - 3], [hx - 17, hy - 4 + 3 * Math.sin(t)], [hx - 24, hy - 2 + 4 * Math.sin(t + 1.3)]], 3, pal.band);

    // Brazo y pierna de atrás
    limb(g, [[hipx, hipy], ...pose.legB], 6, SUIT_BACK);
    limb(g, [[sx, sy], ...pose.armB], 5, SUIT_BACK);

    // Katana enfundada en la espalda (o en la mano, detrás del cuerpo, si así lo pide la pose)
    if (pose.sword === undefined) {
      limb(g, [[sx + 3, sy + 11], [sx - 12, sy - 8]], 2.6, SHEATH);
      limb(g, [[sx - 12, sy - 8], [sx - 16, sy - 14]], 2.4, HILT);
    } else if (pose.swordBack) {
      katana(g, pose.armF[pose.armF.length - 1], pose.sword);
    }

    // Torso y cinturón
    const tx = (sx + hipx) / 2, ty = (sy + hipy) / 2;
    blob(g, tx, ty, 8, 8.5, SUIT);
    blob(g, tx + 2, ty - 2, 3, 4, SUIT_HI, false);
    rect(g, hipx - 7.5, hipy - 3.5, hipx + 7.5, hipy - 0.5, pal.band);

    // Pierna y brazo de adelante
    limb(g, [[hipx, hipy], ...pose.legF], 6, SUIT);
    const hand = pose.armF[pose.armF.length - 1];
    if (pose.sword !== undefined && !pose.swordBack) katana(g, hand, pose.sword);
    limb(g, [[sx, sy], ...pose.armF], 5, SUIT);
    blob(g, hand[0], hand[1], 2.6, 2.6, SKIN);
    if (pose.star) star(g, hand[0] + 3, hand[1] - 3, 4);

    // Cabeza (capucha), franja de la cara y ojos
    blob(g, hx, hy, 12, 11.5, SUIT);
    blob(g, hx - 3, hy - 5, 4, 3, SUIT_HI, false);
    rect(g, hx - 4, hy - 1, hx + 11, hy + 5, SKIN);
    if (pose.eye === 'x') {
      g.strokeStyle = OUT;
      g.lineWidth = 1;
      g.lineCap = 'butt';
      for (const ex of [hx + 3, hx + 8]) {
        g.beginPath();
        g.moveTo(ex - 1.5, hy + 0.5); g.lineTo(ex + 1.5, hy + 4);
        g.moveTo(ex + 1.5, hy + 0.5); g.lineTo(ex - 1.5, hy + 4);
        g.stroke();
      }
    } else {
      rect(g, hx + 2, hy + 0.5, hx + 4, hy + 4, OUT);
      rect(g, hx + 7, hy + 0.5, hx + 9, hy + 4, OUT);
    }
    // Banda en la frente
    rect(g, hx - 12, hy - 5, hx + 12, hy - 2, pal.band);
    rect(g, hx - 12, hy - 2.5, hx + 12, hy - 2, pal.bandDk);
  }

  // ---------------------------------------------------------------------------
  // Poses (coordenadas dentro de la celda)
  // ---------------------------------------------------------------------------
  function poseIdle(i) {
    const b = Math.sin((i / 4) * 2 * Math.PI);
    return {
      bob: b, tail: i * 1.4,
      legF: [[36, 54 + b / 2], [37, 61]], legB: [[27, 54 + b / 2], [25, 61]],
      armF: [[37, 40 + b], [40, 44 + b]], armB: [[26, 40 + b], [24, 44 + b]],
    };
  }

  function poseRun(i) {
    const p = (i / 6) * 2 * Math.PI;
    const bob = -Math.abs(Math.sin(p)) * 2;
    const leg = (ph) => [
      [33 + 7 * Math.sin(ph + 0.8), 53 + bob - 2 * Math.max(0, Math.cos(ph))],
      [31 + 11 * Math.sin(ph), 61 - Math.max(0, 6 * Math.cos(ph))],
    ];
    const arm = (ph) => [
      [31 + 6 * Math.sin(ph), 40 + bob],
      [32 + 10 * Math.sin(ph), 44 + bob - 3 * Math.abs(Math.sin(ph))],
    ];
    return { bob, lean: 3, tail: i * 1.2, legF: leg(p), legB: leg(p + Math.PI), armF: arm(p + Math.PI), armB: arm(p) };
  }

  function poseJump(i) {
    if (i === 0) { // subiendo: rodillas y brazos arriba
      return { bob: -2, tail: 0.5,
        legF: [[38, 49], [35, 57]], legB: [[28, 51], [24, 58]],
        armF: [[38, 30], [42, 24]], armB: [[24, 31], [21, 26]] };
    }
    if (i === 1) { // cima: hecho bolita
      return { bob: 0, tail: 2,
        legF: [[39, 50], [34, 55]], legB: [[29, 52], [26, 56]],
        armF: [[39, 38], [41, 44]], armB: [[24, 38], [23, 43]] };
    }
    return { bob: 0, tail: 3.5, // cayendo: piernas estiradas, brazos abiertos
      legF: [[36, 54], [39, 62]], legB: [[28, 54], [24, 61]],
      armF: [[39, 33], [46, 30]], armB: [[23, 33], [17, 31]] };
  }

  function poseThrow(i) {
    if (i === 0) { // preparar: brazo atrás con el shuriken
      return { bob: 0, lean: -2, tail: 0.3, star: true,
        legF: [[37, 54], [40, 61]], legB: [[26, 54], [22, 61]],
        armF: [[23, 32], [17, 27]], armB: [[36, 40], [38, 43]] };
    }
    if (i === 1) { // lanzar: brazo estirado al frente
      return { bob: 1, lean: 3, tail: 1.5,
        legF: [[39, 54], [43, 61]], legB: [[26, 55], [21, 61]],
        armF: [[40, 34], [49, 33]], armB: [[24, 40], [21, 44]] };
    }
    return { bob: 1, lean: 2, tail: 2.8,
      legF: [[38, 54], [41, 61]], legB: [[26, 55], [22, 61]],
      armF: [[39, 38], [45, 41]], armB: [[25, 40], [22, 44]] };
  }

  function poseHurt(i) {
    return { bob: 1, lean: -4 - i, tail: i * 2, eye: 'x',
      legF: [[35, 54], [38, 61]], legB: [[27, 54], [23, 61]],
      armF: [[36, 32], [41, 26]], armB: [[24, 32], [19, 27]] };
  }

  function poseSlash(i) {
    if (i === 0) { // prepara: espada levantada atrás, por encima de la cabeza
      return { bob: 0, lean: -3, tail: 0.4, sword: -2.5, swordBack: true,
        legF: [[38, 54], [42, 61]], legB: [[26, 54], [21, 61]],
        armF: [[30, 27], [25, 21]], armB: [[25, 40], [22, 44]] };
    }
    if (i === 1) { // corta: brazo estirado, hoja al frente
      return { bob: 1, lean: 4, tail: 1.8, sword: 0.12,
        legF: [[41, 54], [46, 61]], legB: [[25, 55], [19, 61]],
        armF: [[40, 34], [48, 36]], armB: [[24, 38], [20, 42]] };
    }
    return { bob: 1, lean: 2, tail: 2.9, sword: 0.6, // recupera: hoja hacia abajo
      legF: [[40, 54], [44, 61]], legB: [[25, 55], [20, 61]],
      armF: [[39, 40], [44, 45]], armB: [[25, 40], [22, 44]] };
  }

  function poseParry() { // guardia: katana vertical frente a la cara, con las dos manos
    return { bob: 0, lean: -1, tail: 1.2, sword: -1.45,
      legF: [[37, 54], [41, 61]], legB: [[27, 54], [22, 61]],
      armF: [[38, 38], [42, 33]], armB: [[34, 39], [40, 35]] };
  }

  function poseStun(i) { // aturdido: tambaleándose, brazos colgando
    const w = i === 0 ? -2 : 2;
    return { bob: 1, lean: w, tail: i * 2.4, eye: 'x',
      legF: [[35 + w / 2, 54], [37, 61]], legB: [[28 + w / 2, 54], [26, 61]],
      armF: [[34 + w, 42], [35 + w, 48]], armB: [[27 + w, 42], [26 + w, 48]] };
  }

  const POSE_KO = { bob: 0, tail: 1, eye: 'x',
    legF: [[35, 54], [37, 62]], legB: [[28, 54], [26, 62]],
    armF: [[36, 40], [40, 47]], armB: [[26, 40], [23, 47]] };

  // Recuadro con contenido (píxeles no transparentes) de un canvas
  function contentBox(c) {
    const { data, width, height } = c.getContext('2d').getImageData(0, 0, c.width, c.height);
    let x0 = width, y0 = height, x1 = -1, y1 = -1;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if (data[(y * width + x) * 4 + 3] > 8) {
          if (x < x0) x0 = x;
          if (x > x1) x1 = x;
          if (y < y0) y0 = y;
          if (y > y1) y1 = y;
        }
      }
    }
    return { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
  }

  // Ninja tirado en el suelo: se dibuja de pie en un canvas aparte, se gira 90° y se
  // acomoda centrado y apoyado sobre la línea de los pies.
  function drawKo(g, pal) {
    const tmp = document.createElement('canvas');
    tmp.width = tmp.height = CELL * 2 * RES;
    const tg = tmp.getContext('2d');
    tg.scale(RES, RES);
    tg.translate(CELL, CELL);
    tg.rotate(-Math.PI / 2);
    tg.translate(-32, -46);
    ninja(tg, POSE_KO, pal);

    const box = contentBox(tmp);
    const maxW = (CELL - 2) * RES;
    const k = Math.min(1, maxW / box.w);
    const w = box.w * k, h = box.h * k;
    g.save();
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.drawImage(tmp, box.x, box.y, box.w, box.h, (CELL * RES - w) / 2, 5 * CELL * RES + 61 * RES - h, w, h);
    g.restore();
  }

  // ---------------------------------------------------------------------------
  // Construcción del sheet completo para un color
  // ---------------------------------------------------------------------------
  // Algunos frames se dibujan corridos a la izquierda para que la espada quepa en la celda;
  // el ancla horizontal de ese frame se corre igual (ver anchorX).
  const SHIFT = { slash: [0, -10, -8] };
  const shiftX = (name, i) => (SHIFT[name] ? SHIFT[name][i] : 0);
  const anchorX = (name, i) => 32 + shiftX(name, i);

  const MAKERS = {
    idle: [poseIdle, 4], run: [poseRun, 6], jump: [poseJump, 3], throw: [poseThrow, 3], hurt: [poseHurt, 2],
    slash: [poseSlash, 3], parry: [poseParry, 1], stun: [poseStun, 2],
  };
  const cache = {};

  function build(color) {
    if (cache[color]) return cache[color];
    const pal = PALETTES[color];
    const c = document.createElement('canvas');
    c.width = CELL * COLS * RES;
    c.height = CELL * ROWS.length * RES;
    const g = c.getContext('2d');
    g.scale(RES, RES);
    ROWS.forEach((name, r) => {
      if (name === 'ko') return drawKo(g, pal);
      const [fn, n] = MAKERS[name];
      for (let i = 0; i < n; i++) {
        g.save();
        g.translate(i * CELL + shiftX(name, i), r * CELL - 4); // -4: los pies no se salen de la celda
        ninja(g, fn(i), pal);
        g.restore();
      }
    });
    cache[color] = c;
    return c;
  }

  const COUNTS = { idle: 4, run: 6, jump: 3, throw: 3, hurt: 2, ko: 1, slash: 3, parry: 1, stun: 2 };

  window.NinjaSprites = { build, CELL, RES, ROWS, COUNTS, anchorX };
})();
