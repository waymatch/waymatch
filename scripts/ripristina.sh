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
# non parte, ma il segnaposto resta e l'app non viene riavviata su dati a metà. Contiene la riga
# "copia completa" solo da quando i dati precedenti sono interi nella copia di sicurezza.
SEGNAPOSTO=/app/data/.ripristino-in-corso
set +e
docker compose run --rm --no-deps -T --entrypoint sh waymatch -c '
  set -e
  SEGNAPOSTO='"$SEGNAPOSTO"'
  # 0 solo se il segnaposto manca di sicuro (ENOENT); 2 se esiste; 4 se non si riesce a verificarlo.
  c=0; node -e "try { require(\"fs\").lstatSync(process.argv[1]); process.exit(2) } catch (e) { process.exit(e.code === \"ENOENT\" ? 0 : 4) }" "$SEGNAPOSTO" || c=$?
  if [ "$c" = 2 ]; then
    # Senza la riga "copia completa" quel ripristino si è fermato prima di toccare i dati.
    g=0; grep -qx "copia completa" "$SEGNAPOSTO" || g=$?
    if [ "$g" = 1 ]; then rm -f "$SEGNAPOSTO"; c=0; fi
  fi
  if [ "$c" = 2 ]; then
    echo "Un ripristino precedente si è interrotto: recupera i dati come indicato in data/.ripristino-in-corso, poi cancellalo e riprova." >&2
    cat "$SEGNAPOSTO" >&2 || true
    exit 1
  elif [ "$c" != 0 ]; then
    echo "Non riesco a verificare data/.ripristino-in-corso: ripristino annullato, nulla è stato modificato." >&2
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
  # Prima si COPIA tutto in $SALVA, senza toccare i dati attuali; solo quando la copia è completa
  # (riga "copia completa" nel segnaposto) si sostituiscono. $SALVA non viene più modificata, nemmeno
  # dal rollback: in ogni momento i dati precedenti sono intatti in data/ oppure completi in $SALVA.
  echo "copia di sicurezza: data/${SALVA##*/}" > "$SEGNAPOSTO"
  FATTO=0
  TOCCATI=0 # 1 da quando la copia è completa e si cominciano a sostituire i dati
  # Errore durante la copia (per esempio disco pieno): i dati non sono stati toccati, si toglie
  # solo la copia incompleta.
  # La copia si fa in una cartella "-incompleta", rinominata solo quando è intera: una copia
  # interrotta non si confonde con una buona.
  PARZIALE="$SALVA-incompleta"
  togli_copia() { [ "$TOCCATI" = 1 ] || { rm -rf "$PARZIALE"; rm -f "$SEGNAPOSTO"; }; }
  trap togli_copia EXIT
  mkdir -p "$PARZIALE"
  for n in carpooling.db carpooling.db-wal carpooling.db-shm; do
    if [ -e "/app/data/$n" ]; then cp -a "/app/data/$n" "$PARZIALE/"; fi
  done
  if [ -d /app/uploads ]; then cp -a /app/uploads "$PARZIALE/uploads"; fi
  sync
  mv "$PARZIALE" "$SALVA"
  echo "copia completa" >> "$SEGNAPOSTO"
  TOCCATI=1
  rimetti_a_posto() {
    rm -f /app/data/carpooling.db /app/data/carpooling.db-wal /app/data/carpooling.db-shm || return 1
    for n in carpooling.db carpooling.db-wal carpooling.db-shm; do
      if [ -e "$SALVA/$n" ]; then cp -a "$SALVA/$n" /app/data/ || return 1; fi
    done
    mkdir -p /app/uploads || return 1
    find /app/uploads -mindepth 1 -delete || return 1
    if [ -d "$SALVA/uploads" ]; then cp -a "$SALVA/uploads/." /app/uploads/ || return 1; fi
    chown -R node:node /app/data /app/uploads || return 1
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
  # Il WAL del database precedente non deve finire applicato a quello del backup.
  rm -f /app/data/carpooling.db-wal /app/data/carpooling.db-shm
  mv /tmp/ripr/db.bak /app/data/carpooling.db
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
  # Esito 0 solo se il segnaposto manca di sicuro (ENOENT): un errore di lettura non autorizza il riavvio.
  # Un segnaposto senza la riga "copia completa" (ripristino fermato prima di toccare i dati) si toglie.
  RIMASTO="$(docker compose run --rm --no-deps -T --entrypoint node waymatch -e '
    const fs = require("fs"), p = process.argv[1];
    try { fs.lstatSync(p); } catch (e) { process.exit(e.code === "ENOENT" ? 0 : 4); }
    let t;
    try { t = fs.readFileSync(p, "utf8"); } catch { process.exit(4); }
    if (!/^copia completa$/m.test(t)) { try { fs.unlinkSync(p); process.exit(0); } catch { process.exit(4); } }
    process.stdout.write(t);
    process.exit(2);' "$SEGNAPOSTO")"
  controllo=$?
  set -e
  if [ "$esito" -ne 3 ] && [ "$controllo" -eq 0 ]; then
    echo "Ripristino non eseguito, dati invariati: riavvio l'app com'era." >&2
    docker compose up -d waymatch
    exit 1
  fi
  if [ "$esito" -ne 3 ] && [ "$controllo" -ne 2 ]; then
    echo "ERRORE: non riesco a verificare se il ripristino ha lasciato i dati a metà (data/.ripristino-in-corso)." >&2
    echo "L'app resta ferma: controlla la cartella data/ del server e avviala a mano con gli stessi file Compose dell'installazione." >&2
    exit 1
  fi
  echo "ERRORE GRAVE: il ripristino si è interrotto e non risulta che i dati precedenti siano stati rimessi a posto." >&2
  echo "L'app resta ferma. Recupera i dati precedenti come spiegato in docs/installazione.md (\"Ripristino interrotto\"), poi cancella data/.ripristino-in-corso e avvia l'app." >&2
  [ -n "$RIMASTO" ] && printf 'Contenuto di data/.ripristino-in-corso:\n%s\n' "$RIMASTO" >&2
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
