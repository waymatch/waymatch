# Sicurezza

Come WayMatch protegge dati e accessi, per chi deve valutarlo (IT, sicurezza, DPO). Per segnalare una
vulnerabilità: [SECURITY.md](../SECURITY.md).

## In breve

- Database **cifrato per intero** a riposo; password con **bcrypt** (costo 12).
- Accesso con token di **8 ore**, sessioni rinnovabili e **revocabili** dal profilo; blocco dopo
  tentativi falliti; tempi di risposta uguali per non rivelare quali email esistono.
- **Nessun dato a terzi**: l'app gira sul vostro server; mappe e indirizzi passano da servizi che
  scegliete voi; font inclusi nel progetto.
- Container **non root**, segreti anche da file (Docker/Podman secrets, Vault), intestazioni di
  sicurezza e **Content-Security-Policy** stretta.
- File caricati **non pubblici** (tranne il logo), export Excel protetti dalle formule.
- **Accessibilità** e sicurezza verificate da test automatici a ogni modifica.

## Cifratura del database

Il file del database (`./data/carpooling.db`) è cifrato per intero — non solo alcuni
campi — con `DB_ENCRYPTION_KEY` (vedi `.env.example`). Protegge i dati personali
(indirizzi, email, numeri di telefono, tutto il resto) da chi riuscisse ad accedere al
file senza passare dall'applicazione: un backup rubato o smarrito, una chiavetta USB, un
accesso al filesystem del server non autorizzato, un disco dismesso senza cancellazione
sicura. **Non protegge** da un'applicazione compromessa mentre è in esecuzione: la chiave
deve comunque stare in memoria del processo per leggere/scrivere i dati normalmente, quindi
chi ottiene l'esecuzione di codice sul server ha comunque accesso ai dati in chiaro
(esattamente come per qualunque cifratura a riposo, non solo questa).

**Genera la chiave** con `openssl rand -hex 32` (64 caratteri esadecimali, 32 byte): il
server rifiuta di avviarsi se manca o non è in questo formato.

> ⚠️ **Se perdi questa chiave senza averne una copia altrove, il database diventa
> permanentemente illeggibile.** Non è come `JWT_SECRET` (che si rigenera senza perdere
> dati — nel peggiore dei casi tutti rifanno login): qui la chiave protegge i dati stessi,
> e nessuno può recuperarli senza. Conservane una copia in un password manager o in un
> backup offline separato dal server, non solo nel file `.env`.

### Migrare un'installazione esistente (database già in chiaro)

Se stai aggiornando un'installazione che gira da prima dell'introduzione di questa
cifratura, il database esistente è ancora in chiaro: impostare `DB_ENCRYPTION_KEY` da sola
non lo cifra retroattivamente, e il server si rifiuterà di aprire un file che non è ancora
cifrato con quella chiave. Serve una migrazione una tantum, con l'app **ferma**:

```bash
# 1. Ferma il container (nessuna scrittura concorrente durante la migrazione)
docker compose stop

# 2. Genera e annota la chiave, poi impostala in .env
openssl rand -hex 32
# aggiungi il risultato a .env come DB_ENCRYPTION_KEY=...

# 3. Esegui la migrazione (crea automaticamente un backup del file in chiaro prima di
#    toccarlo, e verifica al termine che ogni tabella abbia lo stesso numero di righe di
#    prima — si ferma con un errore chiaro se qualcosa non torna, senza cancellare nulla)
docker compose build waymatch        # l'immagine deve contenere lo script di migrazione
docker compose run --rm waymatch node scripts/cifra-database.js

# 4. Riavvia normalmente
docker compose up -d --build
```

Lo script (`backend/scripts/cifra-database.js`) lascia il backup del database originale in
chiaro accanto al file cifrato (`carpooling.db.prima-della-cifratura-<timestamp>.bak`):
verificato che tutto funzioni, puoi eliminarlo — ma solo dopo esserti accertato di avere
`DB_ENCRYPTION_KEY` al sicuro altrove, non prima.

### Foto del profilo

Le foto del profilo (facoltative) stanno in `uploads/foto-profilo/`, **cifrate** con AES-256-GCM
e una chiave derivata da `DB_ENCRYPTION_KEY` (HKDF): nessuna chiave in più da gestire, e un backup
senza la chiave non le rivela. Prima della cifratura sono ridotte a 256×256 e ricodificate in
JPEG, quindi senza i metadati dello scatto (posizione GPS, dispositivo); un'immagine che dichiara
più di 4096×4096 pixel è rifiutata prima della decodifica. Sono servite solo a utenti autenticati,
con cache solo nel loro browser. Sono incluse nell'export dei dati personali e cancellate con
l'anonimizzazione. Gli altri file caricati (logo, PDF dei documenti, immagini dei voucher) non
sono dati personali e non sono cifrati.


## Sicurezza e hardening

- **Il processo applicativo non gira come root.** Il container parte da root solo per una
  frazione di secondo, per un `chown` sulle cartelle dati montate da bind mount (necessario
  perché una cartella host appena creata è di root); subito dopo il privilegio viene
  ceduto in modo irreversibile con `exec setpriv --reuid=node --regid=node` (sostituisce
  il processo, non lo affianca) prima di eseguire qualunque riga di codice dell'app — vedi
  `docker-entrypoint.sh`. Verifica: `docker exec <container> cat /proc/1/status | grep Uid`
  deve mostrare `1000`, non `0`. Nota: una sessione interattiva aperta con `docker exec -it`
  di default usa l'utente immagine (root, per compatibilità con l'operazione di chown);
  per una shell non privilegiata usa `docker exec --user node -it <container> sh`.

- **Password**: mai in chiaro né cifrate in modo reversibile — sono hash `bcrypt` (costo
  12, salt incluso per record), che è la pratica corretta e più robusta di una cifratura
  reversibile (nessuno, nemmeno con la chiave, può risalire alla password originale).
  Il login risponde con lo stesso messaggio e gli stessi tempi
  sia per un'email inesistente sia per una password sbagliata (verifica bcrypt su un hash
  fittizio), così non rivela quali indirizzi sono registrati. Unica eccezione voluta: un
  account bloccato per troppi tentativi risponde "account bloccato".
- **Sessioni**: ogni login crea una sessione nel database (tabella `sessioni`). Il token
  di accesso dura **8 ore** e l'app lo rinnova da sola finché la sessione è in uso: il
  login serve di nuovo solo dopo **7 giorni di inattività** o **30 giorni** dall'accesso
  (costanti in `backend/utils/sessioni.js`). Il segreto di rinnovo sta in un cookie
  httpOnly, quindi uno script nella pagina non può leggerlo; nel database se ne salva solo
  l'hash. Il logout chiude la sessione anche sul server. Dal profilo (scheda "Sicurezza")
  si vedono i dispositivi collegati, si scollega il singolo dispositivo o tutti gli altri.
  Un cambio password chiude le altre sessioni; un reset (via link o da un mobility
  manager) le chiude tutte. Una sessione revocata smette di funzionare subito, non alla
  scadenza del token.

- **Segreti (JWT_SECRET, credenziali SMTP)**: passano tramite `.env` (file con
  permessi ristretti, mai in git — vedi `.gitignore`), la pratica standard per container.
  Se la policy aziendale richiede di non avere segreti in chiaro nemmeno lì, il codice
  supporta anche la convenzione "secret a file": `JWT_SECRET_FILE=/run/secrets/jwt_secret`
  (idem `SMTP_PASS_FILE`) al posto del valore diretto — compatibile con Podman secrets,
  Docker secrets o un file scritto da un Vault Agent, senza modifiche al codice. Vedi
  l'esempio commentato in `docker-compose.yml` e `.env.example`. Se manca sia la variabile
  diretta sia quella `_FILE`, il server si rifiuta di avviarsi (fail-fast, nessun default
  debole).

- **Podman**: `docker-compose.yml` non usa estensioni specifiche di Docker, dovrebbe
  funzionare invariato con `podman compose` o `podman-compose`. Unico accorgimento noto su
  host RHEL/Fedora con SELinux enforcing: se i bind mount (`./data`, `./uploads`) danno
  errori di permesso, aggiungere `:Z` in fondo al mount (es. `./data:/app/data:Z`).

- **Pulizia dati / crescita del database**: SQLite è in modalità WAL con checkpoint
  automatico (non cresce senza limite in condizioni normali). Uno scheduler interno pota
  automaticamente ogni giorno le notifiche già lette più vecchie di 90 giorni (e comunque
  tutte oltre 18 mesi) e i token di reset password scaduti/usati oltre 30 giorni — sono
  dati "di servizio", non uno storico da conservare.

  Per i dati che *sono* uno storico — log punti (`points_log`), viaggi/prenotazioni
  conclusi e log attività amministrative (`audit_log`) — la finestra di conservazione nel
  database applicativo è **24 mesi** (configurabile con la variabile d'ambiente
  `RITENZIONE_STORICO_MESI`, è una policy aziendale non una costante tecnica). Ogni riga
  più vecchia della finestra viene prima emessa come evento su stdout (vedi "Log
  management" sotto), poi rimossa. Il log punti non viene solo cancellato: le righe di ogni
  utente vengono consolidate in un'unica riga che ne preserva la somma esatta (vedi
  `scheduler.js`, funzione `archiviaDatiStorici`) — altrimenti il saldo spendibile, calcolato
  come somma di tutte le righe, cambierebbe silenziosamente. Verificato con un test
  dedicato: il totale punti prima e dopo l'archiviazione coincide sempre.

  Il log del container (stdout/stderr, letto con `docker logs`) è comunque soggetto anche
  lui a un limite: `docker-compose.yml` imposta una rotazione (max 50MB totali).

- **Log tecnico, livelli ed eventi di sicurezza**: il server scrive una riga JSON per evento
  (`@timestamp`, `livello`, `evento`, dati), avvisi ed errori su stderr e il resto su stdout.
  `LOG_LEVEL` (`error`, `warn`, `info` predefinito, `debug`) sceglie da quale livello in su
  scrivere; le voci del log attività e le righe archiviate dal database si scrivono sempre,
  qualunque sia il livello, perché il database le cancella dopo averle emesse. I campi con nomi come password, token, chiave, cookie o authorization sono sempre
  oscurati. Gli eventi di sicurezza hanno `"area": "sicurezza"` e l'indirizzo di provenienza:
  accessi riusciti e falliti (con il motivo; per un utente sconosciuto anche l'email digitata),
  accessi rifiutati per account bloccato, blocchi, uscite, sessioni revocate, cambi e
  reimpostazioni di password, accessi negati per ruolo, richieste respinte dai limiti di
  frequenza. **Stanno solo nel log tecnico**, per l'IT: il Mobility Manager non vede gli orari di
  accesso dei colleghi, che potrebbero configurare un controllo a distanza dei lavoratori (art. 4
  dello Statuto dei lavoratori). Nel log attività del Mobility Manager resta solo il blocco di un
  account, perché richiede un suo intervento. Conservazione e accesso al log tecnico li decide
  l'IT con le proprie politiche.

- **Log management**: ogni azione registrata nel log attività, e ogni riga archiviata dalla
  pulizia periodica sopra, viene anche emessa in tempo reale come una riga JSON su stdout
  (vedi `backend/utils/structuredLog.js`) — il pattern standard di logging per applicazioni
  containerizzate ("12-factor app": i log sono un flusso di eventi su stdout, non un file
  che l'app gestisce da sola). L'app non sa nulla del sistema di raccolta log a valle: sta a
  chi ospita l'app decidere come intercettare questo flusso, ad esempio:
  - lasciare il driver di log di Docker/Podman su `json-file` (il default, già configurato
    con rotazione) e puntarci un agente come Filebeat, Fluent Bit o Vector, che legge i
    file di log dei container e li inoltra a Elastic/Kibana, Splunk, Graylog, o qualunque
    altro backend;
  - oppure cambiare direttamente il driver di log nella sezione `logging:` di
    `docker-compose.yml` (es. `gelf`, `fluentd`, `syslog`, `journald`) per far spedire i log
    dal motore container stesso, senza un agente separato.

  In entrambi i casi non serve alcuna integrazione applicativa specifica: qualunque sistema
  di log management che sappia leggere JSON da stdout/da un container funziona, a
  prescindere da quale sia.

- **Cifratura dei dati personali**: l'intero file del database è cifrato a riposo, quindi
  anche email, telefoni e indirizzi (vedi "Cifratura del database" sopra). Le password
  restano comunque anche hash bcrypt, irreversibili: nessuno può risalire al valore
  originale, nemmeno con la chiave.

- **Header di sicurezza HTTP**: attivato `helmet` con le protezioni di base (niente
  sniffing del content-type, anti-clickjacking, niente referrer verso terzi, HSTS quando
  servito in HTTPS) **e una Content-Security-Policy esplicita** (`backend/server.js`),
  con le sole risorse esterne che l'app carica legittimamente allowlistate: tile mappa dal
  provider dei tile in `TILE_URL` (`img-src`), font inclusi nel progetto (nessuna chiamata a Google Fonts)
  (`style-src`/`font-src`). `style-src` include `'unsafe-inline'` perché Leaflet posiziona
  tile e marker con stili inline via JS — non indebolisce la protezione da XSS, che dipende
  da `script-src` (senza eccezioni). Nessuna chiamata diretta del browser verso servizi
  esterni di geocodifica: passano sempre dal backend, quindi `connect-src` resta `'self'`.
  Se si aggiunge una risorsa esterna (un nuovo font, un provider di mappe diverso...) va allowlistata qui,
  altrimenti il browser la blocca silenziosamente.
  `img-src` ammette anche `blob:`, usato per mostrare le immagini scaricate con il login
  (voucher digitale, template). `object-src` resta `'none'`: per questo i PDF si mostrano
  in un `<iframe>`, non in un `<embed>`.

- **File caricati** (`./uploads`): l'unico file pubblico è il **logo in uso**, che serve
  già nella pagina di login. Ogni altro percorso sotto `/uploads` risponde 404. I template
  dei voucher si scaricano da `GET /api/voucher-templates/:id/immagine` (solo mobility
  manager). I PDF dei documenti legali si scaricano da `GET /api/legal-documents/:id/file`
  con un **link firmato** chiesto all'app (`POST /api/legal-documents/:id/link`): vale 15
  minuti, solo per quel documento e quell'utente, e non funziona come token di accesso.
  Serve perché un `<iframe>` o un link non possono inviare l'header `Authorization`. I
  nomi su disco dei file sono UUID generati dal server.

- **Export Excel** (report e log attività): ai testi che iniziano con `=`, `+`, `-`, `@`,
  tab o a capo viene anteposto un apice (`backend/utils/export.js`), così restano testo
  anche se chi riceve il file modifica la cella o lo salva come CSV. Nel log finiscono
  testi scritti dagli utenti, per esempio il motivo di una richiesta di cancellazione.
  `exceljs` scrive comunque le celle come testo e non come formule: l'apice è una
  seconda protezione. L'app non produce export CSV.

- **CSRF**: nessun middleware CSRF (`csurf`/`csrf`), che gli strumenti di analisi statica
  segnalano di default. **Non applicabile in questa
  architettura**: ogni API che legge o modifica dati richiede il token Bearer nell'header
  `Authorization`, che il browser non allega mai da solo a una richiesta cross-site.
  L'unico cookie (`cp_rinnovo`) serve solo a `POST /api/auth/rinnova` e
  `POST /api/auth/logout`: è `SameSite=Strict`, quindi il browser non lo invia da un
  sito terzo. Anche se lo inviasse, il rinnovo restituisce il nuovo token nel corpo della
  risposta, che un'altra origine non può leggere (CORS chiuso), e il logout al massimo
  disconnetterebbe l'utente. 

- **Policy password**: almeno 14 caratteri, una maiuscola, un numero, un carattere
  speciale — applicata centralmente (`backend/utils/passwordPolicy.js`) su ogni punto
  che imposta una password: setup iniziale, creazione utente (singola e via CSV), cambio
  password personale, reset via link o da parte di un Mobility Manager. Anche le password
  temporanee generate automaticamente dal sistema (in attesa che l'utente ne scelga una
  sua) rispettano lo stesso requisito.

- **Password provvisoria**: chi accede con una password scelta da altri (utente creato
  da un Mobility Manager, a mano o via CSV, oppure dopo un reset da admin) deve sceglierne
  una sua prima di fare qualunque altra cosa. Lo impone il server, non solo la finestra
  del frontend: finché il flag `password_da_cambiare` è attivo, `requireAuth`
  (`backend/middleware/auth.js`) risponde 403 con `codice: "PASSWORD_DA_CAMBIARE"` a
  tutte le API tranne `GET /api/auth/me` e `PUT /api/auth/me/password`. Logout e
  rinnovo restano disponibili.

- **Messaggi di errore**: l'handler generico degli errori non restituisce il dettaglio
  tecnico (`err.message`, potenzialmente informazioni su schema del DB, percorsi,
  versioni di librerie) al client — solo un messaggio generico, mentre il dettaglio va nei
  log del server per il debug. Stessa pulizia sugli endpoint di geocodifica (proxy verso
  servizi esterni). Eccezione voluta: l'endpoint diagnostico email (Impostazioni generali → Email, solo
  Mobility Manager) mostra il vero errore SMTP di ritorno, perché è uno strumento di
  troubleshooting rivolto a chi gestisce quella configurazione, non un endpoint pubblico.

- **Dipendenze**: aggiornate regolarmente; per controllarle in qualunque momento, `npm audit` in
  `backend` e in `frontend`.

- **SSO**: per ora non previsto, vedi [Per ora non previsto](funzionalita.md#per-ora-non-previsto). Autenticazione con email/password interne all'app, hash
  bcrypt come sopra.


## Analisi statica e dipendenze

Il codice è analizzato con strumenti SAST e di scansione delle dipendenze, e i rilievi sono
verificati uno per uno sul codice. Alcuni rilievi tipici di questi strumenti non si applicano a
questa architettura:

- **SSRF** sulle chiamate di geocodifica: l'host di destinazione è fisso (variabili d'ambiente del
  gestore), l'utente controlla solo il testo della ricerca.
- **SSRF** nel frontend: è codice che gira nel browser e chiama solo la propria API.
- **Controllo delle nuove versioni**: una volta al giorno il server legge l'ultima release pubblica
  da `api.github.com` (indirizzo fisso). Non invia dati dell'azienda né degli utenti, ma GitHub
  vede l'indirizzo del server; dalla risposta si usano solo il numero di versione e un link che
  deve portare a `github.com`. Si disattiva con `CONTROLLO_AGGIORNAMENTI=0`.
- **CSRF**: vedi sopra; le API richiedono un token nell'intestazione, che il browser non allega da solo.
