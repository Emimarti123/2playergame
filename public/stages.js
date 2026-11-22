// Escenarios: el paisaje puede venir de una imagen (catálogo) o dibujarse con Canvas
// (temas incluidos). El suelo y las plataformas SIEMPRE los dibuja el código, para que
// coincidan con la física del servidor en cualquier fondo.
//
// Todos los temas siguen la misma estética: ilustración plana, capas de siluetas
// (lejos = claro, cerca = oscuro), cielo en degradado y un astro grande como foco.
(() => {
  'use strict';

  // Deben coincidir con server/config.js
  const W = 800, H = 450, GROUND_Y = 400;
  const PLATFORMS = [
    { x: 90, y: 300, w: 170 },
    { x: 540, y: 300, w: 170 },
    { x: 315, y: 215, w: 170 },
    { x: 150, y: 140, w: 110 },
    { x: 540, y: 140, w: 110 },
  ];

  function hash(n) {
    let h = Math.imul(n | 0, 0x45d9f3b) ^ 0x1b873593;
    h = Math.imul(h ^ (h >>> 16), 0x45d9f3b);
    h = Math.imul(h ^ (h >>> 16), 0x45d9f3b);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  }

  // Aclara (+) u oscurece (−) un color #rrggbb
  function shade(hex, amt) {
    const n = parseInt(hex.slice(1), 16);
    const ch = (v) => Math.max(0, Math.min(255, Math.round(v + amt * 255)));
    return '#' + [n >> 16, (n >> 8) & 255, n & 255].map((v) => ch(v).toString(16).padStart(2, '0')).join('');
  }

  // ---------------------------------------------------------------------------
  // Piezas de dibujo reutilizables
  // ---------------------------------------------------------------------------
  function sky(g, stops, mid = 0.55) {
    const grad = g.createLinearGradient(0, 0, 0, GROUND_Y);
    grad.addColorStop(0, stops[0]);
    grad.addColorStop(mid, stops[1]);
    grad.addColorStop(1, stops[2]);
    g.fillStyle = grad;
    g.fillRect(0, 0, W, H);
  }

  function stars(g, n, maxY, seed = 0) {
    for (let i = 0; i < n; i++) {
      g.fillStyle = `rgba(255,255,255,${0.2 + hash(i + seed) * 0.5})`;
      g.fillRect(hash(i * 3 + 1 + seed) * W, hash(i * 7 + 2 + seed) * maxY, 1.5, 1.5);
    }
  }

  // Astro grande con halo (luna o sol); `craters` opcional
  function orb(g, x, y, r, color, glow, craters) {
    g.fillStyle = glow;
    g.beginPath(); g.arc(x, y, r * 1.3, 0, Math.PI * 2); g.fill();
    g.fillStyle = color;
    g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
    if (craters) {
      g.fillStyle = craters;
      [[-30, -25, 14], [30, 25, 10], [15, -35, 7], [-40, 30, 8]].forEach(([dx, dy, cr]) => {
        g.beginPath(); g.arc(x + dx * r / 92, y + dy * r / 92, cr * r / 92, 0, Math.PI * 2); g.fill();
      });
    }
  }

  // Cordillera ondulada (como el ejemplo de sprite)
  function mountains(g, base, amp, color, wl, ph) {
    g.fillStyle = color;
    g.beginPath();
    g.moveTo(0, GROUND_Y);
    for (let x = 0; x <= W; x += 6) {
      g.lineTo(x, base - amp * (0.55 + 0.3 * Math.sin(x / wl + ph) + 0.15 * Math.sin(x / (wl * 0.37) + 1.7 + ph)));
    }
    g.lineTo(W, GROUND_Y);
    g.closePath();
    g.fill();
  }

  // Monte en forma de cono con cima nevada (opcional)
  function peakPath(g, cx, base, w, h) {
    g.beginPath();
    g.moveTo(cx - w / 2, base);
    g.quadraticCurveTo(cx - w * 0.18, base - h * 0.55, cx - w * 0.07, base - h);
    g.lineTo(cx + w * 0.07, base - h);
    g.quadraticCurveTo(cx + w * 0.18, base - h * 0.55, cx + w / 2, base);
    g.closePath();
  }

  function peak(g, cx, base, w, h, color, cap) {
    g.fillStyle = color;
    peakPath(g, cx, base, w, h);
    g.fill();
    if (cap) {
      g.fillStyle = cap;
      g.beginPath();
      g.moveTo(cx - w * 0.07, base - h);
      g.lineTo(cx + w * 0.07, base - h);
      g.lineTo(cx + w * 0.15, base - h * 0.72);
      g.lineTo(cx + w * 0.06, base - h * 0.78);
      g.lineTo(cx, base - h * 0.7);
      g.lineTo(cx - w * 0.07, base - h * 0.79);
      g.lineTo(cx - w * 0.15, base - h * 0.72);
      g.closePath();
      g.fill();
    }
  }

  function pagoda(g, cx, base, s, color) {
    g.fillStyle = color;
    for (let i = 0; i < 3; i++) {
      const y = base - i * 34 * s;
      const w = (90 - i * 20) * s;
      g.fillRect(cx - w * 0.32, y - 26 * s, w * 0.64, 26 * s);
      g.beginPath();
      g.moveTo(cx - w * 0.62, y - 22 * s);
      g.quadraticCurveTo(cx, y - 44 * s, cx + w * 0.62, y - 22 * s);
      g.lineTo(cx + w * 0.4, y - 30 * s);
      g.lineTo(cx - w * 0.4, y - 30 * s);
      g.closePath();
      g.fill();
    }
    g.fillRect(cx - 2 * s, base - 130 * s, 4 * s, 30 * s);
  }

  function bambooStalk(g, x, h, w, color, joint, leaves) {
    g.fillStyle = color;
    g.fillRect(x, GROUND_Y - h, w, h);
    g.fillStyle = joint;
    for (let y = GROUND_Y - h + 18; y < GROUND_Y; y += 22) g.fillRect(x - 1, y, w + 2, 2);
    if (leaves) {
      g.fillStyle = leaves;
      for (let k = 0; k < 3; k++) {
        const ly = GROUND_Y - h + 10 + k * 28;
        const dir = k % 2 ? 1 : -1;
        g.beginPath();
        g.moveTo(x + w / 2, ly);
        g.quadraticCurveTo(x + w / 2 + dir * 14, ly - 8, x + w / 2 + dir * 26, ly + 2);
        g.quadraticCurveTo(x + w / 2 + dir * 12, ly + 2, x + w / 2, ly);
        g.fill();
      }
    }
  }

  function torii(g, cx, base, s, color) {
    g.fillStyle = color;
    g.fillRect(cx - 30 * s, base - 70 * s, 6 * s, 70 * s);
    g.fillRect(cx + 24 * s, base - 70 * s, 6 * s, 70 * s);
    g.fillRect(cx - 38 * s, base - 58 * s, 76 * s, 5 * s);
    g.beginPath();
    g.moveTo(cx - 46 * s, base - 72 * s);
    g.quadraticCurveTo(cx, base - 80 * s, cx + 46 * s, base - 72 * s);
    g.lineTo(cx + 42 * s, base - 80 * s);
    g.quadraticCurveTo(cx, base - 88 * s, cx - 42 * s, base - 80 * s);
    g.closePath();
    g.fill();
  }

  function pine(g, x, base, h, color, snow) {
    const w = h * 0.45;
    g.fillStyle = shade(color, -0.08);
    g.fillRect(x - 2, base - h * 0.15, 4, h * 0.15);
    for (let k = 0; k < 3; k++) {
      const top = base - h + k * h * 0.22;
      const bw = w * (0.55 + k * 0.25);
      g.fillStyle = color;
      g.beginPath();
      g.moveTo(x, top);
      g.lineTo(x + bw / 2, top + h * 0.38);
      g.lineTo(x - bw / 2, top + h * 0.38);
      g.closePath();
      g.fill();
      if (snow) {
        g.fillStyle = snow;
        g.beginPath();
        g.moveTo(x, top);
        g.lineTo(x + bw * 0.2, top + h * 0.15);
        g.lineTo(x, top + h * 0.11);
        g.lineTo(x - bw * 0.2, top + h * 0.15);
        g.closePath();
        g.fill();
      }
    }
  }

  // Cerezo: tronco y copa hecha de círculos de dos tonos
  function sakura(g, x, base, s, trunk, light, dark, seed) {
    g.strokeStyle = trunk;
    g.lineCap = 'round';
    g.lineWidth = 9 * s;
    g.beginPath(); g.moveTo(x, base); g.quadraticCurveTo(x + 6 * s, base - 50 * s, x - 4 * s, base - 95 * s); g.stroke();
    g.lineWidth = 5 * s;
    g.beginPath(); g.moveTo(x + 2 * s, base - 60 * s); g.lineTo(x + 34 * s, base - 92 * s); g.stroke();
    g.beginPath(); g.moveTo(x, base - 70 * s); g.lineTo(x - 32 * s, base - 100 * s); g.stroke();
    for (const [col, n] of [[dark, 9], [light, 11]]) {
      g.fillStyle = col;
      for (let i = 0; i < n; i++) {
        const a = hash(seed + i * 5 + (col === light ? 50 : 0)) * Math.PI * 2;
        const rr = hash(seed + i * 7 + 3) * 46 * s;
        g.beginPath();
        g.arc(x + Math.cos(a) * rr * 1.3, base - 110 * s + Math.sin(a) * rr * 0.7, (16 + hash(seed + i) * 12) * s, 0, Math.PI * 2);
        g.fill();
      }
    }
  }

  function cloud(g, x, y, s, color) {
    g.fillStyle = color;
    g.beginPath();
    g.ellipse(x, y, 42 * s, 13 * s, 0, 0, Math.PI * 2);
    g.ellipse(x - 26 * s, y + 3 * s, 24 * s, 9 * s, 0, 0, Math.PI * 2);
    g.ellipse(x + 24 * s, y - 4 * s, 26 * s, 11 * s, 0, 0, Math.PI * 2);
    g.fill();
  }

  // Casa japonesa en silueta, con ventanas encendidas opcionales
  function house(g, x, base, w, h, color, windowColor, seed) {
    g.fillStyle = color;
    g.fillRect(x, base - h, w, h);
    g.beginPath();
    g.moveTo(x - w * 0.18, base - h + 4);
    g.quadraticCurveTo(x + w / 2, base - h - w * 0.45, x + w * 1.18, base - h + 4);
    g.lineTo(x + w, base - h - 6);
    g.lineTo(x, base - h - 6);
    g.closePath();
    g.fill();
    if (windowColor) {
      g.fillStyle = windowColor;
      const n = Math.max(1, Math.floor(w / 26));
      for (let i = 0; i < n; i++) {
        if (hash(seed + i) < 0.35) continue;
        g.fillRect(x + 8 + i * ((w - 16) / n), base - h * 0.7, (w - 16) / n - 8, h * 0.32);
      }
    }
  }

  function lantern(g, x, y, s, color, glow) {
    const rg = g.createRadialGradient(x, y, 2, x, y, 20 * s);
    rg.addColorStop(0, glow);
    rg.addColorStop(1, 'rgba(255,150,70,0)');
    g.fillStyle = rg;
    g.beginPath(); g.arc(x, y, 20 * s, 0, Math.PI * 2); g.fill();
    g.strokeStyle = 'rgba(20,10,30,0.9)';
    g.lineWidth = 1;
    g.beginPath(); g.moveTo(x, y - 12 * s); g.lineTo(x, y - 9 * s); g.stroke();
    g.fillStyle = color;
    g.beginPath(); g.ellipse(x, y, 7 * s, 9 * s, 0, 0, Math.PI * 2); g.fill();
    g.fillStyle = 'rgba(0,0,0,0.35)';
    g.fillRect(x - 4 * s, y - 10 * s, 8 * s, 2 * s);
    g.fillRect(x - 4 * s, y + 8 * s, 8 * s, 2 * s);
  }

  function boat(g, x, y, s, color) {
    g.fillStyle = color;
    g.beginPath();
    g.moveTo(x - 30 * s, y);
    g.lineTo(x + 30 * s, y);
    g.lineTo(x + 22 * s, y + 8 * s);
    g.lineTo(x - 22 * s, y + 8 * s);
    g.closePath();
    g.fill();
    g.fillRect(x - 1.5 * s, y - 40 * s, 3 * s, 40 * s);
    g.beginPath();
    g.moveTo(x + 2 * s, y - 38 * s);
    g.lineTo(x + 24 * s, y - 6 * s);
    g.lineTo(x + 2 * s, y - 6 * s);
    g.closePath();
    g.fill();
  }

  // ---------------------------------------------------------------------------
  // Temas. paint(g) dibuja el paisaje; floor = color del suelo; ambient = partículas
  // animadas que dibuja el cliente; snowPlatforms = nieve encima de las plataformas.
  // ---------------------------------------------------------------------------
  // Atardecer / Noche: el escenario original con dos paletas
  function classic(t) {
    return (g) => {
      sky(g, t.sky);
      stars(g, 60, 170);
      orb(g, 400, 175, 92, t.moon, t.glow, t.crater);
      mountains(g, GROUND_Y - 60, 150, t.far, 120, 0.3);
      mountains(g, GROUND_Y - 20, 100, t.near, 80, 2.1);
      pagoda(g, 70, GROUND_Y, 0.9, t.silhouette);
      pagoda(g, 735, GROUND_Y, 0.75, t.silhouette);
      for (let i = 0; i < 9; i++) {
        const x = 180 + i * 55 + hash(i + 30) * 30;
        if (x > 330 && x < 470) continue;
        bambooStalk(g, x, 90 + hash(i + 40) * 60, 6, t.bamboo[0], t.bamboo[1]);
      }
    };
  }

  const THEMES = {
    atardecer: {
      floor: '#4a3b5c',
      paint: classic({
        sky: ['#2b1d4e', '#8a3f6e', '#f19a5b'], moon: '#ffe3b8', glow: 'rgba(255,230,190,0.18)',
        crater: 'rgba(214,160,120,0.35)', far: '#5b3466', near: '#3b2350', silhouette: '#24163a', bamboo: ['#2d4a3a', '#1f3529'],
      }),
    },

    noche: {
      floor: '#2d3552',
      ambient: 'fireflies',
      paint: classic({
        sky: ['#070b1f', '#16244d', '#36507f'], moon: '#eef3ff', glow: 'rgba(200,220,255,0.14)',
        crater: 'rgba(150,170,210,0.35)', far: '#22325a', near: '#141f3d', silhouette: '#0b1230', bamboo: ['#1d3a40', '#132a2f'],
      }),
    },

    // Bosque de bambú de día: muchas cañas en capas, más claras al fondo
    bambu: {
      floor: '#4b5a3a',
      ambient: 'leaves',
      paint(g) {
        sky(g, ['#8fcfbf', '#cdebc9', '#f4f1c9']);
        orb(g, 590, 110, 52, '#fff7d6', 'rgba(255,250,220,0.35)');
        cloud(g, 180, 90, 1.1, 'rgba(255,255,255,0.55)');
        cloud(g, 420, 60, 0.8, 'rgba(255,255,255,0.45)');
        mountains(g, GROUND_Y - 90, 110, '#a6d1b0', 140, 1.2);
        mountains(g, GROUND_Y - 40, 90, '#7fb892', 90, 3.0);
        const layers = [
          { n: 22, w: 5, h: [180, 300], c: '#8cc49a', j: '#78b088', l: '#9ed2aa' },
          { n: 16, w: 7, h: [220, 340], c: '#5f9c6f', j: '#4c855b', l: '#6fae7e' },
          { n: 9, w: 10, h: [280, 380], c: '#356b48', j: '#26553a', l: '#3f7a53' },
        ];
        layers.forEach((L, li) => {
          for (let i = 0; i < L.n; i++) {
            const x = (i + hash(i * 13 + li * 101) * 0.8) * (W / L.n);
            if (li === 2 && x > 250 && x < 550) continue; // centro despejado
            const h = L.h[0] + hash(i * 17 + li * 7) * (L.h[1] - L.h[0]);
            bambooStalk(g, x, h, L.w, L.c, L.j, L.l);
          }
        });
      },
    },

    // Cerezos en flor con un monte nevado al fondo y un torii
    cerezos: {
      floor: '#6b4a5a',
      ambient: 'petals',
      paint(g) {
        sky(g, ['#f6c1d1', '#ffcfb5', '#ffeccc']);
        orb(g, 400, 150, 70, '#fff3e6', 'rgba(255,240,230,0.4)');
        cloud(g, 140, 80, 1, 'rgba(255,255,255,0.5)');
        cloud(g, 660, 110, 1.2, 'rgba(255,255,255,0.45)');
        peak(g, 400, GROUND_Y - 30, 520, 250, '#d99ab3', '#fff6fa');
        mountains(g, GROUND_Y - 20, 70, '#c47e9b', 110, 0.8);
        torii(g, 400, GROUND_Y, 1.1, '#b8434f');
        sakura(g, 70, GROUND_Y, 1.25, '#5a3340', '#ffb7cf', '#f28fb0', 3);
        sakura(g, 735, GROUND_Y, 1.1, '#5a3340', '#ffb7cf', '#f28fb0', 41);
        sakura(g, 205, GROUND_Y, 0.75, '#6e4150', '#ffc9da', '#f7a6c1', 77);
        sakura(g, 610, GROUND_Y, 0.8, '#6e4150', '#ffc9da', '#f7a6c1', 99);
        // Pétalos caídos
        for (let i = 0; i < 40; i++) {
          g.fillStyle = hash(i + 300) < 0.5 ? '#ffd1e0' : '#f7a6c1';
          g.beginPath();
          g.ellipse(hash(i + 400) * W, 260 + hash(i + 500) * 130, 2.5, 1.5, hash(i + 600) * 3, 0, Math.PI * 2);
          g.fill();
        }
      },
    },

    // Montaña nevada de noche con pinos
    nieve: {
      floor: '#7d8ba3',
      ambient: 'snow',
      snowPlatforms: true,
      paint(g) {
        sky(g, ['#1d2c4a', '#4d6b96', '#b9cde2']);
        stars(g, 50, 140, 7);
        orb(g, 600, 110, 58, '#f4f8ff', 'rgba(220,235,255,0.25)', 'rgba(180,195,220,0.45)');
        peak(g, 230, GROUND_Y - 20, 520, 280, '#c8d6e6', '#ffffff');
        peak(g, 610, GROUND_Y - 20, 460, 220, '#aebfd5', '#f3f7fc');
        mountains(g, GROUND_Y - 10, 70, '#93a8c2', 100, 2.4);
        for (let i = 0; i < 14; i++) {
          const x = 20 + i * 58 + hash(i + 900) * 20;
          if (x > 300 && x < 500) continue;
          pine(g, x, GROUND_Y, 90 + hash(i + 910) * 70, '#2f4d57', '#eef4fa');
        }
        for (let i = 0; i < 5; i++) pine(g, 320 + i * 40, GROUND_Y, 50 + hash(i + 950) * 20, '#5b7a88', '#f3f7fc');
      },
    },

    // Volcán en erupción: cielo rojo, lava y árboles secos
    volcan: {
      floor: '#3a2626',
      ambient: 'embers',
      paint(g) {
        sky(g, ['#14070b', '#4d1517', '#c2492a'], 0.6);
        // Columna de ceniza
        for (let i = 0; i < 7; i++) cloud(g, 400 + (hash(i + 70) - 0.5) * 160, 40 + i * 18, 1.3 + i * 0.12, `rgba(40,18,20,${0.55 - i * 0.05})`);
        g.fillStyle = 'rgba(255,120,40,0.25)';
        g.beginPath(); g.arc(400, 175, 110, 0, Math.PI * 2); g.fill();
        const vb = GROUND_Y - 10, vw = 560, vh = 250;
        peak(g, 400, vb, vw, vh, '#2a1214');
        // Lava: ríos que bajan pegados a la ladera (recortados a la silueta del volcán)
        g.save();
        peakPath(g, 400, vb, vw, vh);
        g.clip();
        g.shadowColor = '#ff5a1f';
        g.shadowBlur = 10;
        for (const [side, len, w0] of [[-1, 0.42, 7], [1, 0.55, 6], [0.35, 0.3, 4]]) {
          const top = vb - vh + 2;
          g.fillStyle = '#ff7a2b';
          g.beginPath();
          const pts = [];
          for (let k = 0; k <= 10; k++) {
            const t = (k / 10) * len;
            const y = top + t * vh;
            // sigue la pendiente: más abajo, más hacia el borde
            const x = 400 + side * (vw * 0.07 + t * vh * 0.42) + Math.sin(k * 1.3 + side * 3) * 4;
            pts.push([x, y, w0 * (1 - k / 12)]);
          }
          pts.forEach(([x, y, w]) => g.lineTo(x - w / 2, y));
          for (let k = pts.length - 1; k >= 0; k--) g.lineTo(pts[k][0] + pts[k][2] / 2, pts[k][1]);
          g.closePath();
          g.fill();
        }
        g.restore();
        g.fillStyle = '#ffb347';
        g.beginPath(); g.ellipse(400, vb - vh + 2, vw * 0.07, 5, 0, 0, Math.PI * 2); g.fill();
        mountains(g, GROUND_Y - 10, 70, '#1d0b0d', 90, 1.4);
        // Árboles secos en los lados
        g.strokeStyle = '#120607';
        for (const [x, s] of [[60, 1.2], [130, 0.8], [690, 1.1], [760, 0.9]]) {
          g.lineWidth = 6 * s;
          g.beginPath(); g.moveTo(x, GROUND_Y); g.lineTo(x, GROUND_Y - 110 * s); g.stroke();
          g.lineWidth = 3 * s;
          g.beginPath(); g.moveTo(x, GROUND_Y - 70 * s); g.lineTo(x - 28 * s, GROUND_Y - 100 * s); g.stroke();
          g.beginPath(); g.moveTo(x, GROUND_Y - 85 * s); g.lineTo(x + 26 * s, GROUND_Y - 118 * s); g.stroke();
        }
      },
    },

    // Puerto al amanecer: mar con reflejo del sol, islas y barcos
    puerto: {
      floor: '#4a4f66',
      ambient: 'gulls',
      paint(g) {
        sky(g, ['#3a4c86', '#e7896a', '#ffd49b'], 0.6);
        cloud(g, 160, 90, 1.3, 'rgba(255,214,190,0.55)');
        cloud(g, 640, 70, 1, 'rgba(255,214,190,0.5)');
        orb(g, 400, 300, 80, '#fff0c2', 'rgba(255,230,170,0.35)');
        // Islas lejanas
        peak(g, 140, 300, 300, 70, '#8a5f7d');
        peak(g, 690, 300, 260, 55, '#7d5574');
        // Mar
        const sea = g.createLinearGradient(0, 300, 0, GROUND_Y);
        sea.addColorStop(0, '#5b6ea3');
        sea.addColorStop(1, '#2c3b66');
        g.fillStyle = sea;
        g.fillRect(0, 300, W, GROUND_Y - 300);
        // Reflejo del sol y olas
        for (let i = 0; i < 9; i++) {
          const y = 306 + i * 10;
          const w = 120 - i * 9;
          g.fillStyle = `rgba(255,230,170,${0.6 - i * 0.05})`;
          g.fillRect(400 - w / 2, y, w, 3);
        }
        g.strokeStyle = 'rgba(255,255,255,0.25)';
        g.lineWidth = 2;
        for (let i = 0; i < 26; i++) {
          const x = hash(i + 700) * W, y = 312 + hash(i + 710) * 80;
          g.beginPath(); g.moveTo(x, y); g.quadraticCurveTo(x + 8, y - 3, x + 16, y); g.stroke();
        }
        boat(g, 190, 318, 0.9, '#2b2440');
        boat(g, 620, 326, 1.1, '#2b2440');
        // Muelles a los lados
        g.fillStyle = '#3a2e3f';
        g.fillRect(0, GROUND_Y - 40, 110, 8);
        g.fillRect(690, GROUND_Y - 40, 110, 8);
        for (const x of [10, 50, 90, 700, 740, 780]) g.fillRect(x, GROUND_Y - 40, 7, 40);
      },
    },

    // Aldea de noche con faroles colgando y casas iluminadas
    faroles: {
      floor: '#3a2f4f',
      ambient: 'fireflies',
      paint(g) {
        sky(g, ['#0d0a24', '#2a1d55', '#6a3f7d']);
        stars(g, 70, 200, 31);
        orb(g, 400, 140, 75, '#ffe9c9', 'rgba(255,220,180,0.16)', 'rgba(220,180,150,0.35)');
        mountains(g, GROUND_Y - 90, 90, '#3b2a5e', 130, 0.4);
        // Casas: fila lejana y fila cercana (centro más bajo)
        for (let i = 0; i < 12; i++) {
          const x = i * 70 - 10 + hash(i + 120) * 10;
          house(g, x, GROUND_Y - 30, 56, 40 + hash(i + 130) * 30, '#2b1f47', 'rgba(255,200,110,0.55)', i * 9);
        }
        for (let i = 0; i < 7; i++) {
          const x = i * 125 - 20;
          if (x > 250 && x < 500) continue;
          house(g, x, GROUND_Y, 96, 70 + hash(i + 140) * 40, '#1a1230', 'rgba(255,190,90,0.8)', i * 13 + 5);
        }
        // Cuerda con faroles cruzando arriba (sin tapar las esquinas del marcador)
        const y0 = 70, sag = 45;
        g.strokeStyle = 'rgba(20,10,30,0.9)';
        g.lineWidth = 1.5;
        g.beginPath(); g.moveTo(0, y0); g.quadraticCurveTo(W / 2, y0 + sag * 2, W, y0); g.stroke();
        for (let i = 1; i < 12; i++) {
          const t = i / 12;
          const x = t * W;
          if (x < 215 || x > 585) continue;
          const y = (1 - t) * (1 - t) * y0 + 2 * (1 - t) * t * (y0 + sag * 2) + t * t * y0;
          lantern(g, x, y + 12, 1, i % 2 ? '#e8452f' : '#ff9a3c', 'rgba(255,170,80,0.45)');
        }
        // Faroles sobre las casas de los lados
        for (const x of [40, 165, 640, 765]) lantern(g, x, GROUND_Y - 120, 0.9, '#e8452f', 'rgba(255,170,80,0.4)');
      },
    },
  };

  // ---------------------------------------------------------------------------
  // Imagen de catálogo: cubre todo el canvas (recorta lo que sobre, centrada)
  // ---------------------------------------------------------------------------
  function paintImage(g, img) {
    const s = Math.max(W / img.naturalWidth, H / img.naturalHeight);
    const w = img.naturalWidth * s, h = img.naturalHeight * s;
    g.imageSmoothingQuality = 'high';
    g.drawImage(img, (W - w) / 2, (H - h) / 2, w, h);
  }

  // ---------------------------------------------------------------------------
  // Suelo de piedra y plataformas de madera (iguales en todos los escenarios)
  // ---------------------------------------------------------------------------
  function paintFloor(g, floor) {
    g.fillStyle = floor;
    g.fillRect(0, GROUND_Y, W, H - GROUND_Y);
    g.fillStyle = shade(floor, 0.08);
    g.fillRect(0, GROUND_Y, W, 6);
    g.strokeStyle = 'rgba(0,0,0,0.25)';
    g.lineWidth = 2;
    for (let row = 0; row < 3; row++) {
      const y = GROUND_Y + 6 + row * 16;
      g.beginPath(); g.moveTo(0, y); g.lineTo(W, y); g.stroke();
      for (let x = (row % 2) * 30; x < W; x += 60) {
        g.beginPath(); g.moveTo(x, y); g.lineTo(x, y + 16); g.stroke();
      }
    }
  }

  function paintPlatforms(g, snow) {
    for (const p of PLATFORMS) {
      g.fillStyle = 'rgba(0,0,0,0.25)';
      g.fillRect(p.x + 4, p.y + 4, p.w, 14);
      g.fillStyle = '#9c5b32';
      g.fillRect(p.x, p.y, p.w, 12);
      g.fillStyle = '#c47a45';
      g.fillRect(p.x, p.y, p.w, 4);
      g.fillStyle = '#5e321a';
      g.fillRect(p.x, p.y + 12, p.w, 3);
      for (let x = p.x + 22; x < p.x + p.w - 10; x += 34) g.fillRect(x, p.y + 4, 2, 8);
      g.fillStyle = '#b8332f';
      g.fillRect(p.x - 6, p.y - 3, 10, 8);
      g.fillRect(p.x + p.w - 4, p.y - 3, 10, 8);
      if (snow) {
        g.fillStyle = '#f3f7fc';
        g.beginPath();
        g.moveTo(p.x - 4, p.y + 1);
        for (let x = p.x - 4; x <= p.x + p.w + 4; x += 10) g.lineTo(x, p.y - 2 - hash(x) * 3);
        g.lineTo(p.x + p.w + 4, p.y + 2);
        g.closePath();
        g.fill();
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Construcción (con caché) a partir de una entrada del catálogo
  // ---------------------------------------------------------------------------
  const cache = new Map();

  function canvas() {
    const c = document.createElement('canvas');
    c.width = W; c.height = H;
    return c;
  }

  // Dibuja solo el paisaje de un tema (sin suelo ni plataformas). Acepta el tema o su nombre.
  function paintScenery(g, theme) {
    const t = typeof theme === 'string' ? THEMES[theme] || THEMES.atardecer : theme;
    t.paint(g);
  }

  function paintTheme(name) {
    const t = THEMES[name] || THEMES.atardecer;
    const c = canvas();
    const g = c.getContext('2d');
    paintScenery(g, t);
    paintFloor(g, t.floor);
    paintPlatforms(g, t.snowPlatforms);
    return c;
  }

  function build(entry) {
    if (!cache.has(entry.id)) {
      const p = !entry.image
        ? Promise.resolve(paintTheme(entry.builtin))
        : new Promise((resolve) => {
            const img = new Image();
            img.onload = () => resolve(fromImage(img, /^#[0-9a-f]{6}$/i.test(entry.floor || '') ? entry.floor : null));
            img.onerror = () => {
              console.warn(`Escenario "${entry.id}": no se pudo cargar ${entry.image}. Se usa el atardecer.`);
              resolve(paintTheme('atardecer'));
            };
            img.src = entry.image;
          });
      cache.set(entry.id, p);
    }
    return cache.get(entry.id);
  }

  // Dibuja un escenario a partir de una imagen ya cargada (también lo usa plantillas.html)
  function fromImage(img, floor) {
    const c = canvas();
    const g = c.getContext('2d');
    paintImage(g, img);
    paintFloor(g, floor || THEMES.atardecer.floor);
    paintPlatforms(g);
    return c;
  }

  // Partículas ambientales del escenario: del tema incluido o del campo "ambient" del catálogo
  function ambientOf(entry) {
    if (!entry) return null;
    if (entry.ambient) return entry.ambient;
    const t = entry.builtin && THEMES[entry.builtin];
    return t ? t.ambient || null : null;
  }

  window.Stages = { W, H, GROUND_Y, PLATFORMS, THEMES, build, paintTheme, paintScenery, fromImage, ambientOf };
})();
