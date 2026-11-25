# Installazione e aggiornamento

Guida per chi installa e gestisce l'app (di solito l'IT). Non serve leggere il codice.

## Cosa serve

| Risorsa | Minimo consigliato | Note |
|---|---|---|
| Sistema | Linux con Docker e Docker Compose v2 | Va bene anche Podman con compose |
| CPU / RAM | 2 vCPU, 2 GB (meglio 4 GB) | L'app è un solo processo Node: più CPU non la rende più veloce. La build dell'immagine richiede più memoria del normale funzionamento |
| Disco | 20 GB SSD | Sistema, immagini Docker, database (pochi MB ogni mille utenti), foto e PDF |
| Rete in ingresso | 443 (e 80 per il certificato) | Solo se usi il compose con Caddy |
| Rete in uscita | HTTPS verso i servizi di mappa e geocodifica; SMTP se vuoi le email | Vedi "Servizi esterni" |

L'app è un'istanza unica per azienda: il database è un file SQLite cifrato, non si scala su più
server. Per qualche migliaio di dipendenti basta ampiamente.

## Installazione in 5 passi

1. **Scarica il codice** sul server: `git clone https://github.com/waymatch/waymatch.git` e
   `cd waymatch`.
2. **Crea il `.env`**: `cp .env.example .env`, poi imposta almeno:
   - `JWT_SECRET`: genera con `openssl rand -hex 32`. Il server **rifiuta** di partire con il
     valore d'esempio o con un valore corto.
   - `DB_ENCRYPTION_KEY`: genera con `openssl rand -hex 32` (64 caratteri esadecimali).
3. **Conserva `DB_ENCRYPTION_KEY` fuori dal server** (password manager, cassaforte aziendale).
   Se la perdi, il database cifrato è **illeggibile per sempre** e nessuno può recuperarlo,
   nemmeno chi ha scritto il codice. I backup non la contengono.
4. **Scegli come esporre l'app** (sezione sotto).
5. **Avvia** e apri il sito: al primo accesso compare il **setup guidato** (nome azienda, primo
   mobility manager, sedi).

## Come esporre l'app

### A. Con Caddy e HTTPS automatico (consigliato se non hai già un proxy)

```bash
# nel .env, oltre ai segreti:
DOMINIO=waymatch.tuaazienda.it
EMAIL_ACME=it@tuaazienda.it

docker compose -f docker-compose.produzione.yml up -d --build
```

Caddy ottiene e rinnova da solo il certificato. Il DNS di `DOMINIO` deve già puntare al server e
le porte 80 e 443 devono essere raggiungibili da internet. L'app non pubblica nessuna porta:
l'unico ingresso è Caddy.

### B. Dietro il proxy o il load balancer dell'azienda

```bash
docker compose up -d --build
```

L'app ascolta sulla porta **7777** del server (inoltra alla 4000 del container). Il tuo proxy
deve:
- terminare l'HTTPS e inoltrare a `http://<server>:7777`;
- impostare l'intestazione `X-Forwarded-For` con l'indirizzo del client (l'app si fida di **un
  solo** proxy davanti a sé);
- **non** lasciare la porta 7777 raggiungibile da altre macchine che non siano il proxy
  (firewall, o `127.0.0.1:7777:4000` in `docker-compose.yml` se il proxy è sullo stesso server).
  Chi raggiunge direttamente la porta può falsificare l'indirizzo IP e aggirare i limiti di
  tentativi.

## Configurazione (`.env`)

| Variabile | Obbligatoria | Cosa fa |
|---|---|---|
| `JWT_SECRET` | sì | Firma dei token di accesso. Se la cambi, tutti devono rifare il login |
| `DB_ENCRYPTION_KEY` | sì | Cifra il database. **Non cambiarla** dopo la prima installazione e **non perderla** |
| `JWT_SECRET_FILE`, `DB_ENCRYPTION_KEY_FILE` | no | Alternativa: percorso di un file (Docker/Podman secrets, Vault) |
| `DOMINIO`, `EMAIL_ACME` | solo con Caddy | Dominio pubblico ed email per gli avvisi sul certificato |
| `APP_URL` | no | Indirizzo pubblico, usato nei link delle email |
| `ALLOWED_ORIGIN` | no | Sito autorizzato a chiamare l'API (CORS). Vuoto = nessun altro sito |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`, `SMTP_SECURE` | no | Invio email. Senza `SMTP_HOST` le email sono disattivate (vedi sotto) |
| `TILE_URL`, `TILE_ATTRIBUTION`, `TILE_MAX_ZOOM` | no | Provider della mappa. Default OpenStreetMap, **solo per prove** (vedi sotto) |
| `NOMINATIM_URL`, `OSRM_URL`, `PHOTON_URL`, `OSM_USER_AGENT`, `GEO_COUNTRY_CODES` | no | Ricerca indirizzi e percorsi. Default: server pubblici di OpenStreetMap |
| `RITENZIONE_STORICO_MESI` | no | Mesi di conservazione di storico e log prima dell'archiviazione (default 24) |
| `CONTROLLO_AGGIORNAMENTI` | no | `0` disattiva il controllo giornaliero delle nuove versioni su GitHub (vedi [Sicurezza](sicurezza.md)) |

## Servizi esterni

L'app, per funzionare al meglio, contatta:

- **Ricerca indirizzi e percorsi** (Nominatim, OSRM): chiamati dal server, non dal browser. I
  server pubblici sono pensati per un uso leggero: per un uso aziendale continuo valuta un'istanza
  tua o un provider.
- **Tile della mappa**: chiamati dal browser degli utenti, dal provider di `TILE_URL`. Il server
  pubblico di OpenStreetMap non è adatto alla produzione (può bloccarti). Scegli un provider con
  chiave e piano adeguato oppure [ospita i tuoi tile](./tile-self-hosted.md). L'attribuzione è
  obbligatoria.
- Nient'altro: i font sono inclusi nel progetto, nessuna chiamata a Google.

Se la macchina non può uscire su internet, servono istanze interne di questi servizi.

## Email (SMTP): opzionale

Senza `SMTP_HOST` l'app funziona comunque:
- le notifiche restano **in-app** e **push del browser**;
- il recupero password passa dal **mobility manager**: l'utente invia la richiesta dal login, il
  mobility manager la trova in "Reset password" e genera una password temporanea, che l'utente
  dovrà cambiare al primo accesso;
- l'interfaccia lo dice (niente casella "Email" nelle preferenze notifiche).

Con SMTP configurato, il recupero password manda un link all'utente e le notifiche possono
arrivare anche via email. Dal pannello del mobility manager c'è una pagina di diagnostica per
provare l'invio.

## Accesso con credenziali aziendali (SSO)

Per ora non c'è SSO ([perché, e come riparlarne](funzionalita.md#per-ora-non-previsto)): gli
utenti hanno credenziali gestite dall'app (password di almeno 14 caratteri,
blocco temporaneo dopo tentativi falliti, sessioni revocabili dal profilo). Gli account si
creano a mano o con l'import CSV.

## Backup e ripristino

Fai il backup **ogni notte** e **prima di ogni aggiornamento**.

```bash
scripts/backup.sh /percorso/dei/backup 30     # tiene le ultime 30 copie
```

Per pianificarlo (cron, `crontab -e`):

```
0 2 * * *  cd /percorso/waymatch && scripts/backup.sh /mnt/backup/waymatch 30
```

- Il backup è un archivio `.tar.gz` con il **database cifrato** (istantanea coerente, anche con
  l'app in funzione) e la cartella dei **file caricati**. La chiave **non** è inclusa.
- I file caricati (logo, PDF dei documenti, immagini dei voucher) **non sono cifrati**, le foto del
  profilo sì (con la stessa chiave del database): proteggi
  la cartella dei backup e copiala fuori dal server.
- Ripristino:

```bash
scripts/ripristina.sh /percorso/waymatch-20261123-020000.tar.gz
```

Lo script verifica che il backup si apra con la `DB_ENCRYPTION_KEY` attuale **prima** di toccare
qualcosa, ferma l'app, mette da parte i dati attuali in `data/prima-ripristino-<data>/`, ripristina
e riavvia. Se qualcosa va storto rimette a posto i dati precedenti. **Prova il ripristino su una
macchina di prova** prima di averne bisogno davvero.

### Ripristino interrotto

Lo script prima **copia** database e upload in `data/prima-ripristino-<data>/` e solo dopo, a copia
completa, sostituisce i dati attuali; la copia non viene più toccata, nemmeno dal rollback. Se il
rollback non riesce, o se il ripristino viene interrotto a metà (per esempio il container viene
ucciso), l'app resta ferma e il file `data/.ripristino-in-corso` indica la cartella della copia.
Un ripristino fermato prima della riga `copia completa` non ha toccato nulla: lo script stesso
toglie il segnaposto e riavvia l'app. Una cartella `prima-ripristino-<data>-incompleta` rimasta è una
copia interrotta e si può cancellare.

Con la riga `copia completa`, la copia contiene i dati precedenti per intero. Con l'app ferma:

1. cancella `data/carpooling.db`, `data/carpooling.db-wal` e `data/carpooling.db-shm`;
2. copia in `data/` i file `carpooling.db*` presenti nella cartella della copia;
3. svuota `uploads/` e copiaci il contenuto di `uploads/` della copia (se la copia non ha
   `uploads/`, prima del ripristino non c'erano file caricati: lascia `uploads/` vuota);
4. cancella `data/.ripristino-in-corso` e avvia l'app con gli stessi file Compose
   dell'installazione (per esempio `docker compose -f docker-compose.produzione.yml up -d`).

## Aggiornare

```bash
scripts/backup.sh /percorso/dei/backup          # 1. backup
git pull                                         # 2. nuovo codice
docker compose up -d --build                     # 3. (o: -f docker-compose.produzione.yml)
curl -s http://localhost:7777/api/health         # 4. deve rispondere {"ok":true}
                                                 #    (con docker-compose.produzione.yml la porta non è
                                                 #    pubblicata: usa https://<il tuo indirizzo>/api/health)
docker compose logs --tail 50 waymatch            # 5. nessun errore
```

Leggi il [CHANGELOG](../CHANGELOG.md): indica i cambiamenti che richiedono attenzione.
Alcune migrazioni del database (per esempio la rimozione di una colonna) **non sono
reversibili**: per questo il backup prima di aggiornare è obbligatorio.

**Tornare indietro**: `git checkout <versione precedente>`, `docker compose up -d --build`, poi
`scripts/ripristina.sh` con il backup fatto prima dell'aggiornamento (il database nuovo potrebbe
non essere leggibile dal codice vecchio).

## Controlli di salute

- `GET /api/health` risponde `{"ok":true}`: usalo per il monitoraggio.
- `docker compose ps` e `docker compose logs waymatch` per lo stato e i log. I log sono in
  JSON, adatti a un sistema di raccolta log.
- Il container si riavvia da solo (`restart: unless-stopped`).

## Problemi comuni

| Sintomo | Causa e rimedio |
|---|---|
| Il container si ferma subito, nel log "JWT_SECRET non valido" | Il segreto è corto o è quello d'esempio: generane uno con `openssl rand -hex 32` |
| "DB_ENCRYPTION_KEY non valida" | Servono esattamente 64 caratteri esadecimali |
| "TILE_URL non valido" / "TILE_ATTRIBUTION mancante" | Controlla l'indirizzo (deve contenere `{z}`, `{x}`, `{y}`) e imposta l'attribuzione |
| Il database non si apre dopo un cambio di server | La `DB_ENCRYPTION_KEY` non è quella con cui è stato creato |
| Mappa con riquadri "403 Access blocked" | Il provider rifiuta le richieste. Con OSM, verifica che il proxy davanti all'app non tolga il Referer alle richieste del browser (l'app lo manda alle sole tile). Se il blocco resta, passa a un provider con chiave |
| Mappa vuota o grigia | Il provider dei tile ti ha bloccato o la chiave è sbagliata: controlla `TILE_URL` e la console del browser |
| "Troppe richieste" o "Troppi tentativi" | Sono i limiti contro gli abusi. Se il proxy non imposta `X-Forwarded-For`, tutti gli utenti sembrano avere lo stesso IP e si bloccano a vicenda |
| Gli utenti nuovi non riescono a usare l'app | Al primo accesso devono scegliere una nuova password e accettare i documenti: è voluto |
| Nessun mobility manager attivo | L'app impedisce di disattivare o declassare l'ultimo. Se succede comunque (database modificato a mano), ripristina un backup |

## Nomi interni

Il servizio Docker, l'immagine e il container si chiamano `waymatch`. Alcuni nomi interni vengono
dal primo nome del progetto e restano così per compatibilità: il file del database
(`data/carpooling.db`), il cookie di rinnovo della sessione (`cp_rinnovo`) e la chiave di accesso
nel browser. Non vanno rinominati a mano.

## Mappe, indirizzi e percorsi (OpenStreetMap)

- **Nominatim** per la ricerca/geocodifica degli indirizzi (autocomplete)
- **OSRM** per il calcolo del percorso stradale reale (km, durata, geometria per la mappa)
- **Un provider di tile a tua scelta** per la mappa visualizzata nell'app (vedi sotto). Di default il server pubblico di OpenStreetMap, solo per prove.

I font (Space Grotesk, Inter) sono inclusi nel progetto: il browser non contatta Google.

Di default l'app usa i server pubblici gratuiti (`nominatim.openstreetmap.org` e
`router.project-osrm.org`), pensati per un uso leggero/di test e soggetti a policy di
utilizzo (rate limit, niente carichi intensivi). Per un uso aziendale continuativo, soprattutto con
molti utenti, è consigliabile ospitare una propria istanza (o un provider
gestito) e puntarci tramite le variabili d'ambiente:

```
NOMINATIM_URL=https://tuo-nominatim.esempio.it
OSRM_URL=https://tuo-osrm.esempio.it
OSM_USER_AGENT=WayMatch/1.0 (contatto@tuaazienda.it)
GEO_COUNTRY_CODES=it
```

### Provider dei tile della mappa

La mappa mostra tile "raster" (immagini quadrate) di un provider che scegli tu nel `.env`:

```
TILE_URL=https://tiles.provider.example/v1/{z}/{x}/{y}.png?key=LA_TUA_CHIAVE
TILE_ATTRIBUTION=&copy; Provider &copy; OpenStreetMap contributors
TILE_MAX_ZOOM=19
```

- **Senza queste variabili** si usa il server pubblico di OpenStreetMap con la sua attribuzione
  (le tile mandano l'origine del sito come Referer, come richiede OSM).
  Va bene per provare. **Non è pensato per applicazioni in produzione** (la
  [policy dei tile OSM](https://operations.osmfoundation.org/policies/tiles/) vieta il carico
  continuo) e può bloccare l'app per volume di richieste.
- **Per un uso aziendale** scegli un provider con chiave e piano adeguato (MapTiler, Stadia
  Maps, Thunderforest, CARTO...) e verifica le sue condizioni d'uso. L'**attribuzione richiesta
  dal provider è obbligatoria**: se imposti `TILE_URL` il server rifiuta di partire senza
  `TILE_ATTRIBUTION`. La chiave sta nell'URL e quindi è visibile nel browser: limitala al tuo
  dominio dal pannello del provider.
- **Ospitare i propri tile**: si può servire una mappa raster dal proprio server a partire dai
  dati OpenStreetMap. Richiede disco e un po' di competenza sistemistica, ma non ha limiti
  d'uso né chiavi, e nessun dato degli utenti esce dalla tua rete. Procedura, requisiti e
  integrazione con l'app: [tile-self-hosted.md](tile-self-hosted.md).
- La politica di sicurezza dei contenuti (CSP) ammette automaticamente solo l'host indicato in
  `TILE_URL`.


## Notifiche push del browser

Le chiavi VAPID vengono generate automaticamente al primo avvio e salvate nel database.
**Importante**: le notifiche push richiedono HTTPS in produzione (funzionano in HTTP solo
su `localhost` per lo sviluppo). Assicurati quindi di mettere l'app dietro un reverse proxy
con certificato SSL (vedi sezione sotto) prima di chiedere agli utenti di attivarle dal
proprio profilo.


## Dettagli sul proxy HTTPS

Per esporre l'app in produzione con un dominio e certificato SSL serve
un reverse proxy (es. Caddy o Nginx) davanti al container, che ascolta su 443 e inoltra
a `localhost:7777` (la porta pubblicata sull'host da `docker-compose.yml`, non la 4000
interna al container). Caddy è probabilmente l'opzione più semplice per gestione
automatica dei certificati Let's Encrypt.

Se il certificato/dominio è gestito centralmente (es. `waymatch.azienda.loc` interno,
con certificato applicato dal reverse proxy aziendale), l'app non deve fare nulla di
diverso: TLS termina sul proxy, il traffico verso il container resta HTTP sulla rete
interna. Basta impostare in `.env`:
```
APP_URL=https://waymatch.azienda.loc
ALLOWED_ORIGIN=https://waymatch.azienda.loc
```
`APP_URL` è usato solo per comporre i link nelle email (es. reset password); `ALLOWED_ORIGIN`
per il CORS. Le API si autenticano con un token Bearer in header. L'unico cookie è quello
di rinnovo della sessione (`cp_rinnovo`, httpOnly, `SameSite=Strict`, path `/api/auth`):
è legato al dominio da cui si apre l'app e viene marcato `Secure` quando il proxy
inoltra `X-Forwarded-Proto: https`. Non serve configurare altro oltre a questi due valori.


## Aggiornare: niente `docker compose pull`

L'immagine non è pubblicata su nessun registry: si costruisce sempre in locale dal `Dockerfile`.
Un `docker compose pull` fallisce con "repository does not exist" (innocuo ma fuorviante): per
aggiornare usa sempre `docker compose up -d --build`.

## Podman

`docker-compose.yml` non usa estensioni specifiche di Docker e funziona con `podman compose`. Su host
con SELinux attivo, se i bind mount (`./data`, `./uploads`) danno errori di permesso, aggiungi `:Z`
(es. `./data:/app/data:Z`).
