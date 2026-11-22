// Plantillas para generar fondos y personajes con IA, y probadores de las imágenes resultantes.
(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const { LAYOUT, COLS, ROWS } = window.Characters;
  const S = window.NinjaSprites;

  const CELL_NAMES = {
    idle: ['Parado 1', 'Parado 2', 'Parado 3', 'Parado 4'],
    run: ['Correr 1', 'Correr 2', 'Correr 3', 'Correr 4'],
    jump: ['Salto: sube', 'Salto: cima', 'Salto: cae'],
    hurt: ['Recibe golpe'],
    throw: ['Lanzar: prepara', 'Lanzar: suelta'],
    ko: ['K.O. (tirado)'],
    slash: ['Espada: prepara', 'Espada: corta', 'Espada: recupera'],
    parry: ['Parry (guardia)'],
    stun: ['Aturdido 1', 'Aturdido 2'],
  };
  const EMPTY_CELLS = [[3, 3], [5, 2], [5, 3]];
  // Qué frame del ninja incluido se usa como ejemplo en cada celda
  const NINJA_PICK = { idle: [0, 1, 2, 3], run: [0, 1, 3, 4], jump: [0, 1, 2], hurt: [0], throw: [0, 1], ko: [0], slash: [0, 1, 2], parry: [0], stun: [0, 1] };
  const CHROMA = '#00ff00';

  // Descarga un canvas como PNG. El enlace se agrega a la página antes de hacer clic (Firefox
  // ignora enlaces sueltos) y, como plan B, la imagen se muestra para guardarla con clic derecho
  // (algunos navegadores, como el integrado de VS Code, bloquean las descargas).
  function download(canvas, name) {
    canvas.toBlob((blob) => {
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = name;
      a.style.display = 'none';
      document.body.append(a);
      a.click();
      a.remove();
      showFallback(url, name);
    }, 'image/png');
  }

  function showFallback(url, name) {
    let box = document.getElementById('dl-fallback');
    if (!box) {
      box = document.createElement('div');
      box.id = 'dl-fallback';
      box.className = 'fallback';
      document.body.append(box);
    }
    box.replaceChildren();
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'ghost';
    close.textContent = 'Cerrar';
    close.addEventListener('click', () => box.remove());
    const p = document.createElement('p');
    p.innerHTML = `¿No se descargó <b>${name}</b>? Haz <b>clic derecho sobre la imagen → "Guardar imagen como…"</b>, o ábrela en otra pestaña.`;
    const link = document.createElement('a');
    link.href = url;
    link.target = '_blank';
    link.rel = 'noopener';
    link.download = name;
    link.textContent = 'Abrir / descargar imagen';
    const img = document.createElement('img');
    img.src = url;
    img.alt = name;
    box.append(close, p, link, img);
    box.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }
  const slug = (name) => name.replace(/\.[^.]+$/, '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 32) || 'nuevo';
  const title = (s) => s.replace(/-/g, ' ').replace(/^./, (c) => c.toUpperCase());

  // ---------------------------------------------------------------------------
  // 1. Plantilla de personaje
  // ---------------------------------------------------------------------------
  function paintCharTemplate(c, labels) {
    const g = c.getContext('2d');
    const cw = c.width / COLS, ch = c.height / ROWS;
    g.fillStyle = CHROMA;
    g.fillRect(0, 0, c.width, c.height);
    const sheet = S.build('rojo');
    const k = (ch * 0.68) / 57; // el ninja mide ~57 px en su celda; deja lugar para la espada
    for (const [anim, cells] of Object.entries(LAYOUT)) {
      cells.forEach(([r, col], i) => {
        const row = S.ROWS.indexOf(anim);
        const f = NINJA_PICK[anim][i];
        const R = S.RES;
        g.imageSmoothingQuality = 'high';
        g.drawImage(sheet, f * S.CELL * R, row * S.CELL * R, S.CELL * R, S.CELL * R,
          col * cw + cw / 2 - 32 * k, r * ch + ch * 0.94 - 61 * k, S.CELL * k, S.CELL * k); // celda centrada: la espada cabe
        if (labels) {
          g.fillStyle = 'rgba(0,0,0,0.65)';
          g.fillRect(col * cw + 6, r * ch + 6, cw - 12, 30);
          g.fillStyle = '#fff';
          g.font = '600 20px system-ui, sans-serif';
          g.textBaseline = 'top';
          g.fillText(`${r + 1}.${col + 1}  ${CELL_NAMES[anim][i]}`, col * cw + 14, r * ch + 11);
        }
      });
    }
    if (labels) {
      g.strokeStyle = 'rgba(0,0,0,0.35)';
      g.lineWidth = 2;
      for (let i = 1; i < COLS; i++) { g.beginPath(); g.moveTo(i * cw, 0); g.lineTo(i * cw, c.height); g.stroke(); }
      for (let i = 1; i < ROWS; i++) { g.beginPath(); g.moveTo(0, i * ch); g.lineTo(c.width, i * ch); g.stroke(); }
      for (const [r, col] of EMPTY_CELLS) {
        g.fillStyle = 'rgba(0,0,0,0.65)';
        g.fillRect(col * cw + 6, r * ch + 6, cw - 12, 30);
        g.fillStyle = '#fff';
        g.fillText(`${r + 1}.${col + 1}  (vacía)`, col * cw + 14, r * ch + 11);
      }
    }
  }

  paintCharTemplate($('tpl-char'), true);
  $('dl-char').addEventListener('click', () => {
    const c = document.createElement('canvas');
    c.width = 1024; c.height = 1536;
    paintCharTemplate(c, false);
    download(c, 'plantilla-personaje.png');
  });

  // ---------------------------------------------------------------------------
  // 2. Referencia de estilo y guía de zonas (1600x900 = el doble del juego)
  // ---------------------------------------------------------------------------
  function paintStyle(c) {
    const g = c.getContext('2d');
    g.save();
    g.scale(c.width / 800, c.height / 450);
    window.Stages.paintScenery(g, window.Stages.THEMES.atardecer);
    g.restore();
  }

  function paintZones(c) {
    const g = c.getContext('2d');
    const k = c.width / 800;
    g.drawImage(window.Stages.paintTheme('atardecer'), 0, 0, c.width, c.height);
    g.save();
    g.scale(k, k);
    g.font = '700 13px system-ui, sans-serif';
    g.textBaseline = 'middle';
    const label = (text, x, y, color = '#fff') => {
      const w = g.measureText(text).width + 12;
      g.fillStyle = 'rgba(0,0,0,0.7)';
      g.fillRect(x - w / 2, y - 10, w, 20);
      g.fillStyle = color;
      g.textAlign = 'center';
      g.fillText(text, x, y);
    };
    g.fillStyle = 'rgba(255,183,3,0.35)';
    g.fillRect(0, 400, 800, 50);
    label('SUELO: lo dibuja el juego (franja inferior, 11 %)', 400, 425, '#ffb703');
    g.strokeStyle = '#3ddc97';
    g.setLineDash([6, 4]);
    g.lineWidth = 2;
    for (const p of window.Stages.PLATFORMS) g.strokeRect(p.x - 6, p.y - 6, p.w + 12, 24);
    label('plataformas: las dibuja el juego', 400, 250, '#3ddc97');
    g.strokeStyle = '#ff7b7b';
    g.strokeRect(8, 8, 196, 56);
    g.strokeRect(596, 8, 196, 56);
    label('marcador', 106, 78, '#ff7b7b');
    label('marcador', 694, 78, '#ff7b7b');
    g.restore();
  }

  paintStyle($('tpl-style'));
  $('dl-style').addEventListener('click', () => download($('tpl-style'), 'referencia-estilo-fondo.png'));
  $('dl-zones').addEventListener('click', () => {
    const c = document.createElement('canvas');
    c.width = 1600; c.height = 900;
    paintZones(c);
    download(c, 'guia-zonas.png');
  });

  // ---------------------------------------------------------------------------
  // 3. Probador de personaje
  // ---------------------------------------------------------------------------
  const animCanvases = [];
  let testChar = null;
  let charFile = null;

  function readImage(file) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('No se pudo leer la imagen'));
      img.src = url;
    });
  }

  async function testCharacter() {
    const file = $('in-char').files[0];
    if (!file) return;
    charFile = file;
    const status = $('char-status');
    try {
      const img = await readImage(file);
      const facingLeft = $('in-char-left').checked;
      testChar = window.Characters.fromImage(img, { flip: facingLeft });
      const notes = [];
      const ratio = img.naturalHeight / img.naturalWidth;
      if (Math.abs(ratio - 1.5) > 0.06 && Math.abs(ratio - 1) > 0.06) notes.push(`la proporción es rara (${img.naturalWidth}×${img.naturalHeight}); lo ideal es 1024×1536`);
      if (testChar.rows === 4) notes.push('es una cuadrícula de 4x4 (formato anterior): no tiene poses de espada, parry ni aturdido; se usan otras en su lugar');
      for (const [anim, cells] of Object.entries(LAYOUT)) {
        const expected = cells.filter(([r]) => r < testChar.rows).length;
        const found = testChar.found[anim];
        if (expected && found < expected) notes.push(`"${anim}": se encontraron ${found} de ${expected} poses`);
      }
      status.innerHTML = `<span class="ok">Personaje leído.</span> Fondo: ${testChar.bgMode === 'transparente' ? 'transparente' : 'color plano (quitado automáticamente)'}.` +
        (notes.length ? `<br><span class="warn">Revisa: ${notes.join('; ')}.</span>` : '');

      // Sheet con las cajas detectadas
      const sc = $('char-sheet');
      sc.hidden = false;
      sc.width = 1024; sc.height = Math.round(1024 * img.naturalHeight / img.naturalWidth);
      const g = sc.getContext('2d');
      const k = sc.width / img.naturalWidth;
      g.clearRect(0, 0, sc.width, sc.height);
      for (let y = 0; y < sc.height; y += 16) for (let x = 0; x < sc.width; x += 16) {
        g.fillStyle = (x + y) % 32 ? '#3a3355' : '#2a2442';
        g.fillRect(x, y, 16, 16);
      }
      g.drawImage(testChar.source, 0, 0, sc.width, sc.height);
      g.lineWidth = 2;
      for (const [anim, frames] of Object.entries(testChar.frames)) {
        if (!testChar.found[anim]) continue; // prestados de otra animación
        for (const f of frames) {
          g.strokeStyle = '#3ddc97';
          g.strokeRect(f.sx * k, f.sy * k, f.sw * k, f.sh * k);
          g.fillStyle = '#e63946';
          g.beginPath(); g.arc((f.sx + f.ax) * k, (f.sy + f.ay) * k, 4, 0, Math.PI * 2); g.fill();
        }
      }

      // Animaciones sobre el escenario
      const box = $('char-anims');
      box.replaceChildren();
      animCanvases.length = 0;
      for (const anim of Object.keys(LAYOUT)) {
        const fig = document.createElement('figure');
        const c = document.createElement('canvas');
        c.width = c.height = 120;
        const cap = document.createElement('figcaption');
        cap.textContent = anim;
        fig.append(c, cap);
        box.append(fig);
        animCanvases.push({ c, anim });
      }

      const id = slug(file.name);
      const entry = { id, name: title(id), image: `personajes/${file.name}` };
      if (facingLeft) entry.facing = 'left';
      $('char-json').hidden = false;
      $('char-json').textContent = `1) Copia la imagen a:  public/personajes/${file.name}\n2) Agrega en public/catalog.json, dentro de "characters":\n   ${JSON.stringify(entry)}`;
    } catch (err) {
      status.innerHTML = `<span class="warn">${err.message}</span>`;
    }
  }
  $('in-char').addEventListener('change', testCharacter);
  $('in-char-left').addEventListener('change', () => charFile && testCharacter());

  const bgThumb = window.Stages.paintTheme('atardecer');
  function animate(now) {
    for (const { c, anim } of animCanvases) {
      const g = c.getContext('2d');
      g.drawImage(bgThumb, 250, 300, 120, 120, 0, 0, 120, 120);
      const n = window.Characters.frameCount(testChar, anim);
      const i = Math.floor(now / (anim === 'run' ? 85 : 220)) % n;
      window.Characters.draw(g, testChar, anim, i, 60, 108, 1, 1.15);
    }
    requestAnimationFrame(animate);
  }
  requestAnimationFrame(animate);

  // ---------------------------------------------------------------------------
  // 4. Probador de fondo
  // ---------------------------------------------------------------------------
  let stageImg = null;
  let stageFile = null;
  let ninjaL = null, ninjaR = null;
  window.Characters.load({ id: 'ninja', builtin: 'ninja' }, 'left').then((c) => (ninjaL = c));
  window.Characters.load({ id: 'ninja', builtin: 'ninja' }, 'right').then((c) => (ninjaR = c));

  function renderStage() {
    if (!stageImg) return;
    const floor = $('in-floor').value;
    const st = window.Stages.fromImage(stageImg, floor);
    const c = $('stage-prev');
    c.hidden = false;
    const g = c.getContext('2d');
    g.drawImage(st, 0, 0);
    if (ninjaL) window.Characters.draw(g, ninjaL, 'idle', 0, 150, 400, 1);
    if (ninjaR) window.Characters.draw(g, ninjaR, 'idle', 0, 650, 400, -1);
    const id = slug(stageFile.name);
    $('stage-json').hidden = false;
    $('stage-json').textContent = `1) Copia la imagen a:  public/fondos/${stageFile.name}\n2) Agrega en public/catalog.json, dentro de "stages":\n   ${JSON.stringify({ id, name: title(id), image: `fondos/${stageFile.name}`, floor })}`;
  }
  $('in-stage').addEventListener('change', async () => {
    stageFile = $('in-stage').files[0];
    if (!stageFile) return;
    stageImg = await readImage(stageFile);
    renderStage();
  });
  $('in-floor').addEventListener('input', renderStage);
})();
