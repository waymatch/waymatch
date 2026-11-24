// Percorsi comuni alle suite: tutto relativo al repository, nessun percorso assoluto.
// Ogni suite fa girare un'istanza isolata del server con database e uploads in una
// cartella temporanea fuori dal repository (CP_TEST_DIR, creata da esegui.js).
const fs = require('fs');
const os = require('os');
const path = require('path');

const BACKEND = path.resolve(__dirname, '..');
const FRONTEND = path.resolve(BACKEND, '..', 'frontend');

function cartellaProva(nome) {
  const radice = process.env.CP_TEST_DIR || fs.mkdtempSync(path.join(os.tmpdir(), 'waymatch-test-'));
  const dir = path.join(radice, nome);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(path.join(dir, 'data'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'uploads'), { recursive: true });
  return dir;
}

module.exports = { BACKEND, FRONTEND, cartellaProva };
