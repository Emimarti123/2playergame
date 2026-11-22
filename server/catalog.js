'use strict';

// Catálogo de escenarios y personajes (public/catalog.json). El servidor solo necesita los ids
// para validar lo que eligen los jugadores; el cliente usa el resto (nombre, imagen…).

const fs = require('fs');
const path = require('path');

const FILE = path.join(__dirname, '..', 'public', 'catalog.json');
const ID_RE = /^[a-z0-9_-]{1,32}$/;

function validateCatalog(raw) {
  const out = { stages: [], characters: [] };
  for (const kind of ['stages', 'characters']) {
    const seen = new Set();
    const list = raw && Array.isArray(raw[kind]) ? raw[kind] : [];
    for (const e of list) {
      if (!e || typeof e.id !== 'string' || !ID_RE.test(e.id) || seen.has(e.id)) {
        console.warn(`catalog.json: se ignora una entrada inválida o repetida en "${kind}":`, e && e.id);
        continue;
      }
      seen.add(e.id);
      out[kind].push(e.id);
    }
  }
  if (!out.stages.length || !out.characters.length) {
    throw new Error('catalog.json necesita al menos un escenario y un personaje válidos');
  }
  return out;
}

function loadCatalog(file = FILE) {
  return validateCatalog(JSON.parse(fs.readFileSync(file, 'utf8')));
}

module.exports = { loadCatalog, validateCatalog };
