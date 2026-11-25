# Changelog

I cambiamenti di ogni versione, per chi installa e per chi sviluppa. Le novità raccontate per chi
usa l'app sono in [docs/novita.md](docs/novita.md).

Il formato segue [Keep a Changelog](https://keepachangelog.com/it-IT/1.1.0/) e le versioni seguono
il [versionamento semantico](https://semver.org/lang/it/). Le versioni 0.x sono di sviluppo: la
1.0.0 sarà la prima versione pubblica stabile.

## [0.10.0] — 2026-11

Rilascio interno di prova: non è pubblicato come release su GitHub.

### Aggiunto
- **Gamification facoltativa**: interruttore del Mobility Manager (Impostazioni generali →
  Gamification), spenta sulle installazioni nuove e accesa su quelle già configurate. Spenta, non si
  assegnano punti e non si vedono punti, premi, classifiche e contest; i viaggi contano per i report.
- **Azzeramento dei punteggi** con riepilogo ed export Excel dei riscatti e scelta su premi non
  consegnati (tenuti o annullati). Confine esatto per generazione dei punti; lo storico resta.
- **Foto del profilo** facoltativa: ritaglio nel browser, 256×256 senza metadati, cifrata su disco
  (AES-256-GCM, chiave derivata da `DB_ENCRYPTION_KEY`), visibile ai colleghi accanto al nome;
  rimovibile dall'utente e dal Mobility Manager; nell'export dei dati personali.
- **Avviso di nuova versione** per il Mobility Manager (controllo giornaliero delle release su GitHub,
  disattivabile con `CONTROLLO_AGGIORNAMENTI=0`).
- **Log tecnico** in JSON con livelli (`LOG_LEVEL`), segreti oscurati ed **eventi di sicurezza** solo
  per l'IT (accessi, uscite, sessioni, permessi, limiti di frequenza).
- **Log attività**: filtri per area, sede, periodo e ricerca libera, anche nell'export.
- **Turni fissi in pausa** se il conducente ha documenti da accettare: corse già create mantenute,
  nessuna nuova occorrenza, riattivazione e ripristino di date bloccati, ripresa all'accettazione.
- **Rimozione del logo** aziendale; foto anche in home, classifiche, lista utenti e report.
- Avviso sugli orari indicativi (traffico e imprevisti) nei passaggi e nelle offerte.

### Modificato
- `scripts/ripristina.sh`: prima copia completa dei dati attuali, poi la sostituzione; con un
  ripristino interrotto l'app resta ferma (segnaposto `data/.ripristino-in-corso`).
- Informazioni si apre dall'icona ⓘ accanto al nome; «Mobility Manager» con le maiuscole ovunque;
  revisione dei testi.
- Nuovo simbolo WayMatch: due tragitti che si uniscono presto e proseguono insieme. Cambiano tutti
- Nuovo simbolo WayMatch: due tragitti che si uniscono presto e proseguono insieme. Cambiano tutti
  i file del kit che lo contengono (lockup, icone, favicon, badge, powered by, banner, anteprima
  social); nomi dei file, palette, font e testi restano uguali. Il componente `Simbolo` prende la
  larghezza dalle proporzioni del disegno, verificate da un test.
- README come presentazione del progetto, con versione inglese (`README.en.md`); i dettagli tecnici
  sono in `docs/` (`funzionalita.md`, `sicurezza.md`, `installazione.md`, `sviluppo.md`).

## [0.9.1] — 2026-11

### Aggiunto
- `PRICING.md`: WayMatch è gratuito; al posto di una richiesta di denaro, l'invito a fare qualcosa
  per qualcun altro (non è una condizione della licenza). Visibile anche in Informazioni → Il
  progetto.
- `ADOPTERS.md` e modello di segnalazione `adozione` per le aziende che vogliono dire di usarlo.

### Rimosso
- Link di donazione e `.github/FUNDING.yml`. Un test impedisce che tornino richieste di denaro.

## [0.9.0] — 2026-11

### Aggiunto
- Manifest dinamico (`/manifest.webmanifest`) con nome, nome breve (max 12 caratteri), colore del
  tema e icone dell'azienda. Ordine delle icone: icona quadrata caricata in Impostazioni →
  Branding, poi il logo (centrato nella zona sicura delle icone maskable), poi l'icona WayMatch.
  Favicon, icona per iPhone e icona delle notifiche seguono la stessa regola.
- Test di accessibilità con axe-core in Chromium su 50 schermate e stati (WCAG 2.1 A/AA).

### Corretto
- Accessibilità: etichette collegate ai campi, nomi accessibili per pulsanti-icona e selezioni,
  collegamento "Salta al contenuto", punti di riferimento, ordine dei titoli, finestre modali con
  focus gestito ed Esc, rispetto di "riduci movimento", errori annunciati dai lettori di schermo,
  contrasto del "Powered by".

### Modificato
- Servizio Docker, immagine e container si chiamano `waymatch`. Restano invariati, per
  compatibilità, `data/carpooling.db`, il cookie di rinnovo e la chiave nel browser. Chi aggiorna
  da un'installazione con i nomi precedenti deve fermare e rimuovere il vecchio container prima
  di `docker compose up -d --build`; i dati in `./data` e `./uploads` non cambiano.

## [0.8.0] — 2026-11

### Aggiunto
- Identità WayMatch: kit grafico in `assets/brand/` (fonte unica; le copie in
  `frontend/public/brand/` sono verificate da un test), icone `any` e `maskable`, icona
  monocromatica per le notifiche.
- Avviso nelle Impostazioni quando il colore primario scelto ha poco contrasto, con la variante
  leggibile più vicina; il colore d'accento si adatta da solo.

### Modificato
- Tema: palette Acqua (variabili `--wm-*`), font Space Grotesk e Inter. Contrasto WCAG AA
  verificato per ogni coppia testo/sfondo (`brand.test.mjs`).
- Marchio e azienda separati: logo, nome e colori dell'azienda nell'intestazione e nel login;
  WayMatch come "Powered by" e in Informazioni. Le installazioni con i colori predefiniti passano
  ai nuovi; i colori personalizzati restano.

## [0.7.0] — 2026-11

### Aggiunto
- Pagina **Informazioni**: guida utenti, guida mobility manager, novità, Sistema (solo mobility
  manager: versione, servizi attivi, numeri, nessun segreto; `GET /api/sistema`) e Il progetto.
  `/guida` reindirizza qui.
- Schede condivise (`components/Schede.jsx`) per Profilo, Impostazioni e Informazioni.

### Modificato
- Impaginazione unica per tutte le pagine; Offri su due colonne sugli schermi larghi.
- Menu da telefono: pannello laterale sotto l'intestazione, per tutti gli utenti.

## [0.6.0] — 2026-11

### Aggiunto
- Guida dentro l'app: i file di `docs/` sono incorporati alla build. Visualizzatore Markdown
  dedicato (`GuidaMarkdown.jsx`): solo elementi React, nessun HTML grezzo, link esterni solo
  http(s).
- Giorni lavorativi configurabili (Impostazioni → Calendario, predefinito lunedì-sabato):
  passaggi e turni fissi si creano solo in quei giorni.
- Provider dei tile configurabile (`TILE_URL`, `TILE_ATTRIBUTION`, `TILE_MAX_ZOOM`); predefinito
  OpenStreetMap, adatto solo alle prove. Con un provider personalizzato l'attribuzione è
  obbligatoria; la CSP ammette solo l'host scelto.
- `scripts/backup.sh` e `scripts/ripristina.sh`; `docker-compose.produzione.yml` con Caddy e HTTPS
  automatico.
- Funzionamento senza SMTP dichiarato nell'interfaccia: il recupero password passa dal mobility
  manager e la casella "Email" delle notifiche non compare (`email_attive` nel branding).

### Modificato
- `PUT /api/settings` aggiorna solo i campi presenti nella richiesta.
- Le tile della mappa mandano l'origine del sito come Referer
  (`strict-origin-when-cross-origin`), come richiede OpenStreetMap; il resto dell'app non manda
  il Referer.

### Rimosso
- Scelta dello stile della mappa nelle impostazioni (dipende dal provider) e colonna
  `mappa_stile` del database, rimossa all'avvio. Fare un backup prima di aggiornare.

## [0.5.0] — 2026-11

### Aggiunto
- Licenza PolyForm Internal Use 1.0.0, `SECURITY.md`, `CONTRIBUTING.md`, modelli di segnalazione
  e integrazione continua con GitHub Actions.
- Intestazione `Permissions-Policy` (camera, microfono, posizione, pagamenti, USB e sensori
  disattivati).

### Sicurezza
- Il cambio della password provvisoria è imposto dal server: finché non è fatto, le API
  rispondono 403 `PASSWORD_DA_CAMBIARE`, tranne profilo, cambio password, logout e rinnovo.
- Reset password limitato a 3 richieste all'ora per indirizzo email, oltre al limite per IP, senza
  rivelare quali indirizzi esistono. Limiti anche su `POST /setup` e
  `POST /auth/reimposta-password`.
- L'app ha sempre almeno un mobility manager attivo: modifica, eliminazione, import CSV e
  anonimizzazione che lo lascerebbero senza sono rifiutate per intero. Nessuno può disattivare
  il proprio account.
- Anonimizzazione GDPR in un'unica transazione sincrona (niente doppia elaborazione) e senza
  l'email originale nel registro delle attività.
- Il server non parte se `JWT_SECRET` è più corto di 32 caratteri o è il valore d'esempio.
- Font inclusi nel progetto (`@fontsource`): il browser non contatta Google Fonts.

### Corretto
- Un errore in una route asincrona non termina più il processo: tutte passano da
  `asyncHandler` (verificato da un test) e `unhandledRejection` è gestito.
- La finestra del cambio password provvisoria scorre sugli schermi bassi.

## [0.4.0] — 2026-11

### Aggiunto
- Sessioni: token di accesso di 8 ore rinnovato automaticamente finché la sessione è in uso
  (nuovo login dopo 7 giorni di inattività o 30 dall'accesso), segreto di rinnovo in un cookie
  httpOnly `SameSite=Strict`, elenco dei dispositivi collegati con revoca singola o totale.
  Chi aggiorna da una versione precedente deve rifare il login una volta.
- Suite di test nel repository (`npm test` in `backend`).

### Sicurezza
- bcrypt a costo 12 (gli hash esistenti si aggiornano al primo login), tempi di risposta uguali
  per email inesistente, account disattivato e password sbagliata, operazioni bcrypt asincrone,
  contatore dei tentativi atomico.
- `/uploads` non è più pubblico, tranne il logo in uso; i PDF dei documenti legali si aprono con
  un link firmato valido 15 minuti. Nomi dei file caricati generati dal server (UUID).
- Export Excel: i testi che iniziano con `= + - @`, tab o a capo sono neutralizzati.

### Corretto
- Il voucher digitale e l'anteprima dei PDF legali erano bloccati dalla CSP.

## [0.3.0] — 2026-11

### Sicurezza
- Corretti controlli di autorizzazione e la fiducia nell'indirizzo IP inviato dal client.
- Aggiornati Node e le dipendenze; `npm audit` pulito su backend e frontend.

## [0.2.0] — 2026-10

### Aggiunto
- Database cifrato per intero (`better-sqlite3-multiple-ciphers`, chiave `DB_ENCRYPTION_KEY`) e
  script di migrazione per i database in chiaro (`backend/scripts/cifra-database.js`).
- Rotazione dei log del container; conservazione di 24 mesi (configurabile) per log punti,
  attività e viaggi, con archiviazione su log strutturato prima della cancellazione.

### Sicurezza
- Policy password unica: almeno 14 caratteri, maiuscola, numero e carattere speciale.
- Messaggi di errore generici verso il client; dettagli solo nei log del server.
- `helmet` e Content-Security-Policy esplicita.
- Correzioni da analisi statica (SAST) e scansione delle dipendenze: limiti espliciti sulle
  query, validazione dei giorni dei turni fissi, controlli sui percorsi dei file, confronti a
  tempo costante. `react-router-dom` 7, Vite 6.

## [0.1.0] — 2026-09

Prima versione: passaggi (singoli e turni fissi, ricerca, richieste, lista d'attesa, soste,
percorso su mappa), punti, classifica, contest, premi e voucher, report di chilometri, CO2 e costi
con esportazione Excel e PDF, notifiche in app e push, email opzionali, diritti GDPR
(esportazione, cancellazione, consensi), ruoli, import CSV degli utenti, sedi, branding
dell'azienda, PWA installabile.
