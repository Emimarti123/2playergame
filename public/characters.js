// Personajes: el ninja incluido (dibujado en sprites.js) o un sprite sheet en imagen.
//
// FORMATO DE LA IMAGEN (cuadrícula de 4 columnas x 6 filas, 1024x1536, mirando a la DERECHA):
//   Fila 1: parado (4 frames, respiración)
//   Fila 2: corriendo (4 frames, ciclo)
//   Fila 3: salto subiendo · salto en la cima · salto cayendo · recibiendo golpe
//   Fila 4: lanzar (preparar) · lanzar (soltar) · K.O. tirado en el suelo · (vacía)
//   Fila 5: espadazo (preparar) · espadazo (cortar) · espadazo (recuperar) · parry (guardia)
//   Fila 6: aturdido 1 · aturdido 2 · (vacía) · (vacía)
// También se acepta el formato anterior de 4x4 (filas 1-4): sin poses de espada, se usan
// las de lanzar, parado y golpe en su lugar.
// Fondo transparente o de un color plano (se quita solo). No hace falta que cada pose
// quede centrada: se recorta cada celda por separado y se alinea por los pies.
(() => {
  'use strict';

  const TARGET_H = 76; // alto en pantalla del personaje parado (px), igual que el ninja
  const RES = 2; // los frames se guardan al doble para que se vean nítidos
  const COLS = 4;
  const ROWS = 6;
  const LAYOUT = {
    idle: [[0, 0], [0, 1], [0, 2], [0, 3]],
    run: [[1, 0], [1, 1], [1, 2], [1, 3]],
    jump: [[2, 0], [2, 1], [2, 2]],
    hurt: [[2, 3]],
    throw: [[3, 0], [3, 1]],
    ko: [[3, 2]],
    slash: [[4, 0], [4, 1], [4, 2]],
    parry: [[4, 3]],
    stun: [[5, 0], [5, 1]],
  };
  const ANIMS = Object.keys(LAYOUT);
  // Si falta una animación (p. ej. sheet de 4x4), se usa otra parecida
  const FALLBACK = { slash: 'throw', parry: 'idle', stun: 'hurt' };
  // Filas de la imagen: 6 si es vertical (2:3), 4 si es cuadrada (formato anterior)
  const rowsOf = (w, h) => (h / w > 1.25 ? 6 : 4);

  // ---------------------------------------------------------------------------
  // Ninja incluido: frames del sheet que dibuja sprites.js
  // ---------------------------------------------------------------------------
  function builtinNinja(color) {
    const S = window.NinjaSprites;
    const sheet = S.build(color);
    const R = S.RES, C = S.CELL;
    const anims = {};
    S.ROWS.forEach((name, r) => {
      anims[name] = [];
      for (let i = 0; i < S.COUNTS[name]; i++) {
        anims[name].push({ src: sheet, sx: i * C * R, sy: r * C * R, sw: C * R, sh: C * R, ax: S.anchorX(name, i) * R, ay: 61 * R });
      }
    });
    return { anims, scale: 1.3 / R, flip: false };
  }

  // ---------------------------------------------------------------------------
  // Quitar el fondo: transparente si ya lo es; si no, se toma el color de las esquinas
  // y se borra por inundación desde los bordes de cada celda (y los huecos muy parecidos).
  // ---------------------------------------------------------------------------
  function removeBackground(img, rows) {
    const { data, width: W, height: H } = img;
    const corners = [];
    for (const [cx, cy] of [[2, 2], [W - 3, 2], [2, H - 3], [W - 3, H - 3]]) {
      const i = (cy * W + cx) * 4;
      corners.push([data[i], data[i + 1], data[i + 2], data[i + 3]]);
    }
    const avgAlpha = corners.reduce((a, c) => a + c[3], 0) / 4;
    if (avgAlpha < 40) {
      for (let i = 3; i < data.length; i += 4) if (data[i] < 40) data[i] = 0;
      return 'transparente';
    }
    const key = [0, 1, 2].map((k) => corners.map((c) => c[k]).sort((a, b) => a - b)[1]); // mediana baja
    const dist = (i) => Math.hypot(data[i] - key[0], data[i + 1] - key[1], data[i + 2] - key[2]);
    const NEAR = 75; // se considera fondo
    const SOFT = 120; // borde suave

    const seen = new Uint8Array(W * H);
    const stack = [];
    const push = (x, y) => {
      if (x < 0 || y < 0 || x >= W || y >= H) return;
      const p = y * W + x;
      if (seen[p]) return;
      seen[p] = 1;
      if (dist(p * 4) < NEAR) stack.push(p);
    };
    // Semillas: bordes de la imagen y líneas entre celdas
    for (let x = 0; x < W; x++) for (let r = 0; r <= rows; r++) push(x, Math.min(H - 1, Math.round((r * H) / rows)));
    for (let y = 0; y < H; y++) for (let c = 0; c <= COLS; c++) push(Math.min(W - 1, Math.round((c * W) / COLS)), y);
    while (stack.length) {
      const p = stack.pop();
      data[p * 4 + 3] = 0;
      const x = p % W, y = (p / W) | 0;
      push(x + 1, y); push(x - 1, y); push(x, y + 1); push(x, y - 1);
    }
    // Huecos encerrados (entre brazo y cuerpo) muy parecidos al fondo, y bordes suaves
    for (let p = 0; p < W * H; p++) {
      const i = p * 4;
      if (data[i + 3] === 0) continue;
      const d = dist(i);
      if (d < NEAR * 0.5) data[i + 3] = 0;
      else if (d < SOFT && touchesClear(data, W, H, p)) data[i + 3] = Math.round(data[i + 3] * (d - NEAR * 0.5) / (SOFT - NEAR * 0.5));
    }
    removeChromaLeftovers(data, W, H, key);
    return 'color';
  }

  // Fondo de "pantalla verde" (o de otro color saturado): el personaje no debe tener ese color,
  // así que se borran los restos que quedaron en huecos cerrados (entre piernas, capa, brazo)
  // y se quita el halo de ese color en los contornos.
  function removeChromaLeftovers(data, W, H, key) {
    const dom = key.indexOf(Math.max(...key));
    const others = [0, 1, 2].filter((k) => k !== dom);
    if (key[dom] - Math.max(key[others[0]], key[others[1]]) < 80) return; // fondo no saturado
    const excess = (i) => data[i + dom] - Math.max(data[i + others[0]], data[i + others[1]]);
    for (let p = 0; p < W * H; p++) {
      const i = p * 4;
      if (data[i + 3] && excess(i) > 50) data[i + 3] = 0;
    }
    // Halo: en los 2 px junto a lo transparente, el canal del fondo no puede dominar
    for (let p = 0; p < W * H; p++) {
      const i = p * 4;
      if (!data[i + 3] || excess(i) <= 0 || !nearClear(data, W, H, p, 2)) continue;
      data[i + dom] = Math.max(data[i + others[0]], data[i + others[1]]);
    }
  }

  function nearClear(data, W, H, p, r) {
    const x = p % W, y = (p / W) | 0;
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        const nx = x + dx, ny = y + dy;
        if (nx >= 0 && ny >= 0 && nx < W && ny < H && data[(ny * W + nx) * 4 + 3] === 0) return true;
      }
    }
    return false;
  }

  function touchesClear(data, W, H, p) {
    const x = p % W, y = (p / W) | 0;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy;
      if (nx >= 0 && ny >= 0 && nx < W && ny < H && data[((ny * W) + nx) * 4 + 3] === 0) return true;
    }
    return false;
  }

  // Recorte de una celda: caja del contenido (ignora pixeles sueltos) y ancla en los pies.
  function frameIn(img, x0, y0, w, h, isKo) {
    const { data, width: W } = img;
    const inset = Math.round(Math.min(w, h) * 0.01);
    x0 += inset; y0 += inset; w -= inset * 2; h -= inset * 2;
    const colN = new Uint32Array(w), rowN = new Uint32Array(h);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (data[((y0 + y) * W + (x0 + x)) * 4 + 3] > 60) { colN[x]++; rowN[y]++; }
      }
    }
    const minN = Math.max(2, Math.round(Math.min(w, h) * 0.008));
    let bx0 = 0, bx1 = w - 1, by0 = 0, by1 = h - 1;
    while (bx0 < w && colN[bx0] < minN) bx0++;
    while (bx1 > bx0 && colN[bx1] < minN) bx1--;
    while (by0 < h && rowN[by0] < minN) by0++;
    while (by1 > by0 && rowN[by1] < minN) by1--;
    if (bx0 >= bx1 || by0 >= by1) return null;
    const fw = bx1 - bx0 + 1, fh = by1 - by0 + 1;
    if (fw * fh < w * h * 0.01) return null; // celda vacía

    // Ancla horizontal: centro de los pies (cuarto inferior); en el K.O., centro de la caja
    let ax = fw / 2;
    if (!isKo) {
      let sum = 0, n = 0;
      for (let y = by1 - Math.round(fh * 0.25); y <= by1; y++) {
        for (let x = bx0; x <= bx1; x++) {
          if (data[((y0 + y) * W + (x0 + x)) * 4 + 3] > 60) { sum += x - bx0; n++; }
        }
      }
      if (n) ax = sum / n;
    }
    return { sx: x0 + bx0, sy: y0 + by0, sw: fw, sh: fh, ax, ay: fh };
  }

  // Convierte una imagen (sprite sheet 4x4) en un personaje listo para dibujar.
  function fromImage(image, { flip = false } = {}) {
    const W = image.naturalWidth || image.width;
    const H = image.naturalHeight || image.height;
    const c = document.createElement('canvas');
    c.width = W; c.height = H;
    const g = c.getContext('2d', { willReadFrequently: true });
    g.drawImage(image, 0, 0);
    const img = g.getImageData(0, 0, W, H);
    const rows = rowsOf(W, H);
    const bgMode = removeBackground(img, rows);
    g.putImageData(img, 0, 0);

    const cw = W / COLS, chh = H / rows;
    const raw = {};
    for (const name of ANIMS) {
      raw[name] = [];
      for (const [r, col] of LAYOUT[name]) {
        if (r >= rows) continue;
        const f = frameIn(img, Math.round(col * cw), Math.round(r * chh), Math.round(cw), Math.round(chh), name === 'ko');
        if (f) raw[name].push(f);
      }
    }
    if (!raw.idle.length) throw new Error('No se encontró al personaje en la fila 1 (parado)');
    const found = {};
    for (const name of ANIMS) found[name] = raw[name].length;
    for (const name of ANIMS) {
      if (!raw[name].length) raw[name] = raw[FALLBACK[name]] && raw[FALLBACK[name]].length ? raw[FALLBACK[name]] : [raw.idle[0]];
    }

    // Escala: el personaje parado mide TARGET_H en pantalla. Se reduce una sola vez
    // (con suavizado de calidad) a RES veces ese tamaño.
    const idleH = Math.max(...raw.idle.map((f) => f.sh));
    const k = (TARGET_H / idleH) * RES;
    const small = document.createElement('canvas');
    small.width = Math.max(1, Math.round(W * k));
    small.height = Math.max(1, Math.round(H * k));
    const sg = small.getContext('2d');
    sg.imageSmoothingQuality = 'high';
    sg.drawImage(c, 0, 0, small.width, small.height);

    const anims = {};
    for (const name of ANIMS) {
      anims[name] = raw[name].map((f) => ({
        src: small, sx: f.sx * k, sy: f.sy * k, sw: f.sw * k, sh: f.sh * k, ax: f.ax * k, ay: f.ay * k,
      }));
    }
    return { anims, scale: 1 / RES, flip, bgMode, rows, found, frames: raw, source: c };
  }

  // ---------------------------------------------------------------------------
  // Carga (con caché) a partir de una entrada del catálogo
  // ---------------------------------------------------------------------------
  const cache = new Map();

  function loadImage(src) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error(`No se pudo cargar ${src}`));
      img.src = src;
    });
  }

  // `side` solo importa para el ninja incluido (rojo a la izquierda, azul a la derecha).
  function load(entry, side) {
    const key = entry.builtin ? `${entry.id}:${side}` : entry.id;
    if (!cache.has(key)) {
      const p = entry.builtin
        ? Promise.resolve(builtinNinja(side === 'right' ? 'azul' : 'rojo'))
        : loadImage(entry.image)
            .then((img) => fromImage(img, { flip: entry.facing === 'left' }))
            .catch((err) => {
              console.warn(`Personaje "${entry.id}": ${err.message}. Se usa el ninja.`);
              return builtinNinja(side === 'right' ? 'azul' : 'rojo');
            });
      cache.set(key, p);
    }
    return cache.get(key);
  }

  function frameCount(ch, anim) {
    return (ch.anims[anim] || ch.anims.idle).length;
  }

  // Dibuja un frame con los pies en (x, y). facing: 1 derecha, -1 izquierda.
  function draw(ctx, ch, anim, i, x, y, facing, extraScale = 1) {
    const frames = ch.anims[anim] || ch.anims.idle;
    const f = frames[Math.max(0, Math.min(i, frames.length - 1))];
    const s = ch.scale * extraScale;
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(facing * s * (ch.flip ? -1 : 1), s);
    ctx.drawImage(f.src, f.sx, f.sy, f.sw, f.sh, -f.ax, -f.ay, f.sw, f.sh);
    ctx.restore();
  }

  window.Characters = { load, fromImage, draw, frameCount, LAYOUT, COLS, ROWS, TARGET_H, rowsOf };
})();
