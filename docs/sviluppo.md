# Per chi sviluppa

## Struttura

```
backend/    Node 22, Express 4, SQLite cifrato (better-sqlite3-multiple-ciphers)
  routes/     un file per area (auth, rides, bookings, users, privacy...)
  utils/      logica condivisa (sessioni, password, notifiche, tile, export...)
  middleware/ autenticazione e ruoli
  scripts/    migrazione cifratura, backup del database
  test/       suite di test (npm test)
frontend/   React 18, Vite, Tailwind: PWA servita dal backend in produzione
scripts/    backup.sh, ripristina.sh (installazioni Docker)
docs/       questa documentazione
```

## Sviluppo locale

```bash
(cd backend && npm install) && (cd frontend && npm install)
# una sola volta: la chiave del database locale, da conservare (cambiarla rende illeggibile il
# database creato con la precedente; backend/data è ignorata da git). Se il file esiste già,
# restringine i permessi senza rigenerarlo: chmod 600 backend/data/chiave-db
(umask 077; mkdir -p backend/data && openssl rand -hex 32 > backend/data/chiave-db)
# backend (porta 4000); il JWT_SECRET può cambiare a ogni avvio (chiude solo le sessioni aperte):
cd backend && JWT_SECRET=$(openssl rand -hex 32) DB_ENCRYPTION_KEY_FILE=data/chiave-db node server.js
# frontend con ricarica a caldo (altro terminale):
cd frontend && npm run dev
```

## Test

```bash
cd backend
npm test               # tutte le suite
npm test -- sessioni   # solo quelle il cui nome contiene "sessioni"
```

Ogni suite avvia un'istanza isolata del server (porta, database e upload propri in una cartella
temporanea). La suite nel browser usa Chromium (`CHROME_PATH` per indicarlo) e ricompila il
frontend; se Chromium manca viene saltata con un avviso. Le stesse suite girano in GitHub Actions
a ogni modifica.

Regole che i test difendono e che conviene non rompere:
- ogni handler `async` delle route passa da `asyncHandler` (un errore deve dare 500, non fermare il
  processo);
- niente chiamate a servizi esterni dal browser oltre al provider dei tile;
- le password provvisorie bloccano tutte le API tranne il cambio password;
- l'ultimo mobility manager non si può disattivare né declassare.

## Guida nell'app e versioni

La sezione **Informazioni** dell'app mostra `docs/guida-utente.md`, `docs/guida-mobility-manager.md` (solo
ai mobility manager), `docs/novita.md` e le immagini di `docs/img/`, incorporati al momento della
build: la guida è sempre quella della versione installata. Le immagini sono file separati,
caricati solo quando si apre la guida (non entrano nella cache offline della PWA).

Il Markdown è mostrato da `frontend/src/components/GuidaMarkdown.jsx`, che genera solo elementi
React (nessun HTML grezzo). Supporta titoli, paragrafi, elenchi, tabelle, blocchi di codice,
citazioni, immagini di `docs/img/` e link http(s); gli altri link diventano testo.

A ogni rilascio:
1. aumenta `version` in `frontend/package.json` e `backend/package.json` (stesso numero, secondo il
   [versionamento semantico](https://semver.org/lang/it/)) e crea il tag `vX.Y.Z`;
2. aggiungi in cima a `docs/novita.md` una sezione `## Versione X.Y.Z` scritta per gli utenti;
3. aggiorna le guide se l'interfaccia è cambiata (e gli screenshot);
4. sposta le voci di `[Non rilasciato]` del CHANGELOG sotto la nuova versione.

## Le suite di test

```bash
cd backend
npm test              # tutte le suite (circa 3 minuti)
npm test -- sessioni  # solo le suite il cui nome contiene "sessioni"
```

Le suite stanno in `backend/test/` e non finiscono nell'immagine Docker. Ognuna avvia
un'istanza isolata del server su una porta propria, con database cifrato e
uploads in una cartella temporanea cancellata alla fine: non toccano `data/` né
`uploads/`. Richiedono `npm install` sia in `backend` sia in `frontend`.

| Suite | Cosa verifica |
|---|---|
| `accesso.test.js` | login, tempi pareggiati, bcrypt 12 e rehash, blocco, reset in parallelo, import CSV |
| `sessioni.test.js` | sessioni rinnovabili, scadenze, logout, revoca, cambio e reset password |
| `client.test.mjs` | rinnovo automatico del token in `frontend/src/api.js` |
| `password-provvisoria.test.js` | cambio della password provvisoria imposto dal server |
| `configurazione.test.js` | segreti deboli rifiutati, nessun font da Google, file del progetto presenti |
| `handler-async.test.js` | ogni handler async passa da `asyncHandler`: un errore dà 500 e non ferma il server |
| `limiti-e-anonimizzazione.test.js` | limiti su reset password e `/setup`, anonimizzazione elaborata una sola volta, header Permissions-Policy |
| `ultimo-admin.test.js` | non si può disattivare né declassare l'ultimo mobility manager (modifica, eliminazione, import CSV, anonimizzazione) |
| `export.test.js` | formule neutralizzate negli export Excel |
| `backup.test.js` | copia del database cifrato: coerente, cifrata, mai sovrascritta |
| `calendario.test.js` | giorni lavorativi per passaggi e turni fissi |
| `icona.test.js` | icona e manifest dell'app: icona caricata, logo, WayMatch |
| `brand.test.mjs` | asset del marchio identici al kit, contrasto AA del tema, nessun residuo del vecchio nome |
| `upload-browser.test.mjs` | file caricati, password provvisoria, guida e Informazioni, in Chromium headless |
| `accessibilita.test.mjs` | WCAG 2.1 A/AA con axe-core su circa 50 schermate e stati, prove da tastiera |

Le suite nel browser ricompilano prima il frontend e usa Chromium: `CHROME_PATH`, oppure
quello installato da Playwright in `~/.cache/ms-playwright`. Se non lo trova la salta,
con un avviso nel riepilogo.


## Contribuire

Vedi [CONTRIBUTING.md](../CONTRIBUTING.md). Per le vulnerabilità: [SECURITY.md](../SECURITY.md).
