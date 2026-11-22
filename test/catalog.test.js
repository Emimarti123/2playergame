'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadCatalog, validateCatalog } = require('../server/catalog');

test('el catálogo del juego es válido', () => {
  const c = loadCatalog();
  assert.ok(c.stages.length >= 1);
  assert.ok(c.characters.includes('ninja'));
});

test('se ignoran ids inválidos o repetidos', () => {
  const c = validateCatalog({
    stages: [{ id: 'a' }, { id: 'a' }, { id: 'Con Espacios' }, null, { id: 'b' }],
    characters: [{ id: 'ninja' }, { nombre: 'sin id' }],
  });
  assert.deepEqual(c, { stages: ['a', 'b'], characters: ['ninja'] });
});

test('un catálogo sin escenarios o sin personajes es un error', () => {
  assert.throws(() => validateCatalog({ stages: [], characters: [{ id: 'ninja' }] }));
  assert.throws(() => validateCatalog({}));
});
