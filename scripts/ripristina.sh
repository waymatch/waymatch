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
set +e
docker compose run --rm --no-deps -T --entrypoint sh waymatch -c '
  set -e
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
  FATTO=0
  rimetti_a_posto() {
    rm -f /app/data/carpooling.db /app/data/carpooling.db-wal /app/data/carpooling.db-shm || return 1
    for f in "$SALVA"/carpooling.db*; do [ -e "$f" ] && { mv "$f" /app/data/ || return 1; }; done
    if [ -d "$SALVA/uploads" ]; then
      find /app/uploads -mindepth 1 -delete || return 1
      cp -a "$SALVA/uploads/." /app/uploads/ || return 1
    fi
    chown -R node:node /app/data /app/uploads
  }
  alla_fine() {
    if [ "$FATTO" != 1 ]; then
      echo "Errore: rimetto a posto i dati precedenti..." >&2
      rimetti_a_posto || exit 3
    fi
  }
  # Da qui in poi, se qualcosa non va, i dati precedenti tornano al loro posto.
  trap alla_fine EXIT
  for f in /app/data/carpooling.db /app/data/carpooling.db-wal /app/data/carpooling.db-shm; do [ -e "$f" ] && mv "$f" "$SALVA/"; done
  [ -d /app/uploads ] && cp -a /app/uploads "$SALVA/uploads"
  mv /tmp/ripr/db.bak /app/data/carpooling.db
  find /app/uploads -mindepth 1 -delete
  [ -d /tmp/ripr/uploads ] && cp -a /tmp/ripr/uploads/. /app/uploads/
  chown -R node:node /app/data /app/uploads
  FATTO=1
  echo "Dati precedenti messi da parte in $SALVA (nella cartella data/ del server)"
' < "$ARCHIVIO"
esito=$?
set -e
if [ "$esito" -eq 3 ]; then
  echo "ERRORE GRAVE: il ripristino è fallito e i dati precedenti non sono stati rimessi a posto." >&2
  echo "L'app resta ferma. I dati precedenti sono nella cartella data/prima-ripristino-* del server: non avviarla prima di averli recuperati." >&2
  exit 1
elif [ "$esito" -ne 0 ]; then
  echo "Ripristino non eseguito: riavvio l'app com'era." >&2
  docker compose up -d waymatch
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
