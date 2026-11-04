// Controlli statici del questionario, senza accesso a Supabase o invio di dati.
const fs = require('node:fs');
const assert = require('node:assert/strict');
const html = fs.readFileSync(require('node:path').join(__dirname, '..', 'index.html'), 'utf8');
const section = (start, end) => {
  const a = html.indexOf(start);
  const b = html.indexOf(end, a + start.length);
  assert.ok(a >= 0 && b > a, 'Sezione mancante: ' + start);
  return html.slice(a, b);
};
const bdsm = section('const domandeBDSM=[', 'const praticheBDSM=[');
const mappa = section('const praticheBDSM=[', 'const opzioniInteresse=[');
const carattere = section('const domandeCarattere=[', 'function renderQuestions(');
const count = (s) => [...s.matchAll(/^\['[^']+',/gm)].length;
assert.equal(count(bdsm), 6, 'Sono richieste sei domande BDSM');
assert.equal(count(mappa), 12, 'Sono richieste dodici pratiche');
assert.equal(count(carattere), 4, 'Sono richieste quattro domande caratteriali');
for (const key of ['desidero', 'curioso', 'non_interessa', 'limite']) {
  assert.ok(html.includes("['" + key + "'"), 'Interesse mancante: ' + key);
}
for (const key of ['pseudonimo', 'ruolo', 'genere', 'eta', 'consenso', 'maggiorenne']) {
  assert.ok(html.includes('id="' + key + '"'), 'Campo mancante: ' + key);
}
assert.match(html, /generi\.length/, 'Controllo generi preferiti mancante');
assert.match(html, /window\.turnstile\?\.getResponse\(\)/, 'Verifica antispam mancante');
assert.match(html, /if\(!response\.ok\)/, 'Gestione errore HTTP mancante');
assert.match(html, /functions\/v1\/invio-candidatura/, 'Endpoint candidatura mancante');
console.log('OK: 6 domande BDSM, 12 pratiche, 4 domande caratteriali, campi e controlli di invio.');
