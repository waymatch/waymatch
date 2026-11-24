#!/usr/bin/env bash
# Backup dell'installazione Docker: database (cifrato) + file caricati (logo, PDF, voucher).
#
# Uso:   scripts/backup.sh [cartella-destinazione] [copie-da-tenere]
#        (predefiniti: ./backups e 14)
# Da pianificare, ad esempio ogni notte con cron:
#        0 2 * * *  cd /percorso/waymatch && scripts/backup.sh /mnt/backup/waymatch 30
#
# Il database viene copiato con un'istantanea coerente anche con l'app in funzione e resta
# cifrato; la chiave DB_ENCRYPTION_KEY NON è nel backup: conservala a parte (password manager,
# cassaforte). I file caricati invece non sono cifrati: proteggi la cartella dei backup.
set -euo pipefail
cd "$(dirname "$0")/.."

DEST="${1:-backups}"
TENERE="${2:-14}"
[[ "$TENERE" =~ ^[0-9]+$ ]] && [ "$TENERE" -ge 1 ] || { echo "Il numero di copie da tenere deve essere un intero >= 1" >&2; exit 1; }

mkdir -p "$DEST"
umask 077
FILE="$DEST/waymatch-$(date +%Y%m%d-%H%M%S).tar.gz"
# Il nome temporaneo contiene il PID: due esecuzioni nello stesso secondo non si pestano i piedi.
PARZIALE="$FILE.parziale.$$"
trap 'rm -f "$PARZIALE"' EXIT

# Dentro il container: istantanea del database in una cartella temporanea propria di questa
# esecuzione (esecuzioni in parallelo non si toccano), poi un unico archivio su stdout
# (database + cartella uploads). Così non servono permessi sulle cartelle dei volumi.
if ! docker compose exec -T waymatch sh -c \
  'd=$(mktemp -d) && node scripts/backup-db.js "$d/db.bak" >&2 && tar -czf - -C "$d" db.bak -C /app uploads; esito=$?; [ -n "$d" ] && rm -rf "$d"; exit $esito' \
  > "$PARZIALE"; then
  rm -f "$PARZIALE"
  echo "Backup fallito: l'app è in funzione? (docker compose ps)" >&2
  exit 1
fi

# Controlla che l'archivio sia leggibile e contenga il database.
ELENCO="$(tar -tzf "$PARZIALE")" || ELENCO=""
if ! grep -qx 'db.bak' <<<"$ELENCO"; then
  rm -f "$PARZIALE"
  echo "Backup scartato: l'archivio non contiene il database." >&2
  exit 1
fi
mv "$PARZIALE" "$FILE"

# Tiene solo le ultime N copie.
# (prefisso "carpooling-" delle versioni precedenti incluso; senza archivi non c'è nulla da potare)
shopt -s nullglob
VECCHI=("$DEST"/waymatch-*.tar.gz "$DEST"/carpooling-*.tar.gz)
if [ "${#VECCHI[@]}" -gt "$TENERE" ]; then
  ls -1t -- "${VECCHI[@]}" | tail -n +"$((TENERE + 1))" | xargs -r rm -f --
fi

echo "✔ Backup creato: $FILE ($(du -h "$FILE" | cut -f1))"
