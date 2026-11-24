# Ospitare i propri tile della mappa

L'app mostra la mappa con tile raster presi dall'indirizzo `TILE_URL` del tuo `.env`. Se non vuoi
dipendere da un provider esterno (chiavi, limiti d'uso, i tuoi utenti che contattano terzi), puoi
servire i tile dal tuo server. Per un'azienda con molti utenti ha senso: non ci sono limiti
di richieste, non servono chiavi e nessun dato lascia la tua rete.

> **Stato di questa guida.** I comandi vengono dal README ufficiale del progetto
> [`overv/openstreetmap-tile-server`](https://github.com/Overv/openstreetmap-tile-server) e **non
> sono stati provati su questa app**. Provali prima su una regione piccola (per esempio il
> Lussemburgo, qualche decina di MB) e solo dopo importa il tuo paese. Le dimensioni indicate
> sono ordini di grandezza da verificare.

## Cosa ti serve

- Un server Linux con Docker, separato da quello dell'app se possibile: l'importazione dei dati
  è pesante in CPU, RAM e disco.
- **Disco:** il file dei dati di un paese è di qualche GB e il database che ne risulta è
  parecchie volte più grande (per l'Italia, decine di GB). Controlla le dimensioni del file del
  tuo paese su [Geofabrik](https://download.geofabrik.de/) e prevedi un multiplo.
- **RAM:** la cache dell'importazione è di 800 MB per impostazione predefinita
  (`OSM2PGSQL_EXTRA_ARGS=-C 4096` la porta a 4 GB); l'importazione di un paese grande richiede
  più RAM di un piccolo server.
- **Tempo:** l'importazione richiede ore per un paese grande. Il rendering dei tile avviene alla
  richiesta: i primi tile di una zona sono lenti, poi restano in cache.
- Una connessione a internet durante l'importazione (il server in funzione non ne ha bisogno).

## 1. Importare i dati

```bash
docker volume create osm-data

docker run --rm \
    -e DOWNLOAD_PBF=https://download.geofabrik.de/europe/italy-latest.osm.pbf \
    -e DOWNLOAD_POLY=https://download.geofabrik.de/europe/italy.poly \
    -v osm-data:/data/database/ \
    overv/openstreetmap-tile-server \
    import
```

Se il comando termina senza errori l'importazione è riuscita. Se si ferma per memoria, aggiungi
`-e FLAT_NODES=enabled`. Se compare un errore su "shared memory", aggiungi `--shm-size="192m"`.
Per usare un file già scaricato al posto di `DOWNLOAD_PBF`, montalo su `/data/region.osm.pbf`
(`-v /percorso/italy-latest.osm.pbf:/data/region.osm.pbf`).

## 2. Far partire il server dei tile

Il proxy (Caddy) gira in un container: per raggiungere `tile-server` per nome devono stare sulla
stessa rete Docker, cioè **sullo stesso host dell'app**. Se invece i tile stanno su un altro
server, pubblica lì la porta sulla rete interna e nel Caddyfile usa il suo indirizzo al posto di
`tile-server:80` (per esempio `reverse_proxy 10.0.0.5:8080`). Trova quella dell'app con `docker network ls` (di solito `<cartella>_default`,
per esempio `waymatch_default`) e usala qui:

```bash
docker run -d --name tile-server \
    --network waymatch_default \
    -p 127.0.0.1:8080:80 \
    -e ALLOW_CORS=enabled \
    -v osm-data:/data/database/ \
    overv/openstreetmap-tile-server \
    run
```

I tile sono serviti all'indirizzo `http://127.0.0.1:8080/tile/{z}/{x}/{y}.png`. Per riavviarlo
dopo un riavvio del server aggiungi `--restart unless-stopped`. `THREADS=N` regola il numero di
thread di rendering (4 per impostazione predefinita).

## 3. Collegarlo all'app

Il browser carica i tile direttamente da `TILE_URL`, quindi il server dei tile deve essere
raggiungibile dai browser degli utenti, **in HTTPS** (l'app è in HTTPS: un indirizzo http verrebbe
bloccato dal browser). Il modo più semplice è esporlo con lo stesso proxy dell'app, su un
sottodominio. Con Caddy:

```
tiles.tuaazienda.it {
    reverse_proxy tile-server:80
}
```

Poi nel `.env` dell'app:

```
TILE_URL=https://tiles.tuaazienda.it/tile/{z}/{x}/{y}.png
TILE_ATTRIBUTION=&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors
```

L'attribuzione OpenStreetMap è obbligatoria anche se ospiti tu i tile: i dati sono di OSM. La
CSP dell'app ammette automaticamente l'host di `TILE_URL`.

## Aggiornare la mappa

I dati non si aggiornano da soli. Due strade:

- **Rifare l'importazione** ogni tanto (per esempio una volta l'anno): è la più semplice.
  Importa in un **volume nuovo** (`docker volume create osm-data-2`, poi `-v osm-data-2:/data/database/`):
  sullo stesso volume l'importazione fallirebbe per l'utente `renderer` già esistente e sostituirebbe
  comunque i dati. Quando è finita, ferma e rimuovi `tile-server`, riavvialo con il volume nuovo e
  solo allora elimina quello vecchio (`docker volume rm osm-data`). Se la prima importazione non
  era stata lanciata con `--rm`, il suo container fermo tiene ancora il volume: rimuovilo prima
  (`docker ps -a --filter volume=osm-data`, poi `docker rm <id>`).
- **Aggiornamento automatico**: importa con `-e UPDATES=enabled` e il file `.poly` montato su
  `/data/region.poly`, e avvia il server con lo stesso `-e UPDATES=enabled`. Non combinarlo con
  `FLAT_NODES` se non importi l'intero pianeta (la documentazione del progetto lo sconsiglia).

## Sicurezza e manutenzione

- Il server dei tile non ha un'autenticazione: i tile sono dati pubblici di OSM. Non esporre
  la porta del database (5432) e tieni il server aggiornato.
- Non c'è bisogno di fare il backup dei tile: si rigenerano dai dati. Fai il backup del volume
  `osm-data` solo se vuoi evitare di rifare l'importazione.
