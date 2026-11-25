#!/usr/bin/env bash
# Ripristina un backup creato da scripts/backup.sh nell'installazione Docker.
#
# Uso:   scripts/ripristina.sh <file.tar.gz> [-y]
#
# ATTENZIONE: sostituisce database e file caricati attuali. Prima li mette da parte in
# data/prima-ripristino-<data>/ (non li cancella). Serve la stessa DB_ENCRYPTION_KEY con cui
# è stato fatto il backup: senza, il database non si apre.
set -euo pipefail
cd "$(dirname "$0")/.."

ARCHIVIO="${1:-}"
[ -n "$ARCHIVIO" ] && [ -f "$ARCHIVIO" ] || { echo "Uso: scripts/ripristina.sh <file.tar.gz> [-y]" >&2; exit 1; }
ELENCO="$(tar -tzf "$ARCHIVIO")" || ELENCO=""
grep -qx 'db.bak' <<<"$ELENCO" || { echo "Archivio non valido: manca db.bak" >&2; exit 1; }

if [ "${2:-}" != "-y" ]; then
  echo "Ripristino di $ARCHIVIO: l'app verrà fermata e i dati attuali sostituiti (copia di sicurezza in data/prima-ripristino-*)."
  read -r -p "Continuare? scrivi 'si': " risposta
  [ "$risposta" = "si" ] || { echo "Annullato."; exit 1; }
fi

# Si riparte con gli stessi file Compose con cui il container è stato creato (produzione o prova):
# senza questo, "up" userebbe docker-compose.yml e pubblicherebbe la porta del backend.
if [ -z "${COMPOSE_FILE:-}" ]; then
  USATI="$(docker inspect -f '{{ index .Config.Labels "com.docker.compose.project.config_files" }}' waymatch 2>/dev/null || true)"
  [ -n "$USATI" ] && export COMPOSE_FILE="${USATI//,/:}"
fi

echo "Fermo l'app..."
docker compose stop waymatch

# Si lavora in un container usa e getta con gli stessi volumi, così i permessi sono quelli giusti.
# Esiti del container: 0 fatto; 1 fallito prima di toccare i dati o con i dati rimessi a posto;
# 3 fallito e dati precedenti NON rimessi a posto (l'app resta ferma).
# Il segnaposto data/.ripristino-in-corso esiste da prima di toccare i dati finché il ripristino o
# il rollback non sono conclusi: se il container viene ucciso (kill -9, memoria esaurita) il trap
# non parte, ma il segnaposto resta e l'app non viene riavviata su dati a metà.
SEGNAPOSTO=/app/data/.ripristino-in-corso
set +e
docker compose run --rm --no-deps -T --entrypoint sh waymatch -c '
  set -e
  SEGNAPOSTO='"$SEGNAPOSTO"'
  if [ -e "$SEGNAPOSTO" ]; then
    echo "Un ripristino precedente si è interrotto (dati di prima in $(cat "$SEGNAPOSTO")): recupera quei dati e cancella data/.ripristino-in-corso prima di riprovare." >&2
    exit 1
  fi
  mkdir -p /tmp/ripr && tar -xzf - -C /tmp/ripr
  [ -f /tmp/ripr/db.bak ] || { echo "db.bak mancante" >&2; exit 1; }
  # Prima di toccare nulla: il database del backup deve aprirsi con la chiave attuale.
  node -e "
    const D = require(\"better-sqlite3-multiple-ciphers\");
    const { readSecret } = require(\"/app/utils/secrets\");
    const d = new D(\"/tmp/ripr/db.bak\", { readonly: true });
    d.pragma(\"key=\x27\" + readSecret(\"DB_ENCRYPTION_KEY\") + \"\x27\");
    const n = d.prepare(\"SELECT COUNT(*) AS n FROM users\").get().n;
    if (d.pragma(\"integrity_check\", { simple: true }) !== \"ok\") throw new Error(\"integrità\");
    console.log(\"Backup leggibile con la chiave attuale: \" + n + \" utenti\");
  " || { echo "Il backup non si apre con la DB_ENCRYPTION_KEY attuale: ripristino annullato, nulla è stato modificato." >&2; exit 1; }
  SALVA=/app/data/prima-ripristino-$(date +%Y%m%d-%H%M%S)
  mkdir -p "$SALVA"
  echo "data/${SALVA##*/}" > "$SEGNAPOSTO"
  FATTO=0
  SPOSTATI=""        # file del database messi da parte con successo
  COPIA_UPLOADS=0    # 1 solo quando la copia degli upload in $SALVA è completa
  NUOVO_DB=0         # 1 da quando si tocca il database nuovo
  MODIFICA_UPLOADS=0 # 1 da quando si toccano gli upload attuali
  rimetti_a_posto() {
    # Si recupera solo ciò che è stato davvero salvato: gli originali rimasti al loro posto non si toccano.
    if [ "$NUOVO_DB" = 1 ]; then rm -f /app/data/carpooling.db || return 1; fi
    for n in $SPOSTATI; do mv "$SALVA/$n" /app/data/ || return 1; done
    if [ "$MODIFICA_UPLOADS" = 1 ] && [ "$COPIA_UPLOADS" = 1 ]; then
      find /app/uploads -mindepth 1 -delete || return 1
      cp -a "$SALVA/uploads/." /app/uploads/ || return 1
    fi
    chown -R node:node /app/data /app/uploads
    rm -f "$SEGNAPOSTO" || return 1
  }
  alla_fine() {
    if [ "$FATTO" != 1 ]; then
      echo "Errore: rimetto a posto i dati precedenti..." >&2
      rimetti_a_posto || exit 3
    fi
  }
  # Da qui in poi, se qualcosa non va, i dati precedenti tornano al loro posto.
  trap alla_fine EXIT
  for n in carpooling.db carpooling.db-wal carpooling.db-shm; do
    if [ -e "/app/data/$n" ]; then
      mv "/app/data/$n" "$SALVA/" || exit 1
      SPOSTATI="$SPOSTATI $n"
    fi
  done
  if [ -d /app/uploads ]; then
    cp -a /app/uploads "$SALVA/uploads" || exit 1
    COPIA_UPLOADS=1
  fi
  NUOVO_DB=1
  mv /tmp/ripr/db.bak /app/data/carpooling.db
  MODIFICA_UPLOADS=1
  mkdir -p /app/uploads
  find /app/uploads -mindepth 1 -delete
  if [ -d /tmp/ripr/uploads ]; then cp -a /tmp/ripr/uploads/. /app/uploads/; fi
  chown -R node:node /app/data /app/uploads
  FATTO=1
  rm -f "$SEGNAPOSTO"
  echo "Dati precedenti messi da parte in $SALVA (nella cartella data/ del server)"
' < "$ARCHIVIO"
esito=$?
set -e
if [ "$esito" -ne 0 ]; then
  # Si riavvia solo se il segnaposto non c'è: dati mai toccati o rimessi a posto. Se il controllo
  # stesso non riesce, l'app resta ferma (meglio ferma che su un database vuoto).
  set +e
  RIMASTO="$(docker compose run --rm --no-deps -T --entrypoint sh waymatch -c \
    'if [ -e "$1" ]; then cat "$1"; exit 2; fi' sh "$SEGNAPOSTO")"
  controllo=$?
  set -e
  if [ "$esito" -ne 3 ] && [ "$controllo" -eq 0 ]; then
    echo "Ripristino non eseguito, dati invariati: riavvio l'app com'era." >&2
    docker compose up -d waymatch
    exit 1
  fi
  echo "ERRORE GRAVE: il ripristino si è interrotto e non risulta che i dati precedenti siano stati rimessi a posto." >&2
  echo "L'app resta ferma. I dati precedenti sono in ${RIMASTO:-data/prima-ripristino-*} sul server: recuperali, poi cancella data/.ripristino-in-corso e avvia l'app." >&2
  exit 1
fi

echo "Riavvio l'app..."
docker compose up -d waymatch
for i in $(seq 1 30); do
  if docker compose exec -T waymatch node -e "fetch('http://127.0.0.1:4000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" 2>/dev/null; then
    echo "✔ Ripristino completato, l'app risponde."
    exit 0
  fi
  sleep 1
done
echo "L'app non risponde dopo il ripristino: controlla docker compose logs waymatch" >&2
exit 1
