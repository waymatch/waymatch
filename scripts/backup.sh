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

# Dentro il container: istantanea del database in /tmp, poi un unico archivio su stdout
# (database + cartella uploads). Così non servono permessi sulle cartelle dei volumi.
if ! docker compose exec -T waymatch sh -c \
  'rm -f /tmp/db.bak && node scripts/backup-db.js /tmp/db.bak >&2 && tar -czf - -C /tmp db.bak -C /app uploads; rm -f /tmp/db.bak' \
  > "$FILE.parziale"; then
  rm -f "$FILE.parziale"
  echo "Backup fallito: l'app è in funzione? (docker compose ps)" >&2
  exit 1
fi

# Controlla che l'archivio sia leggibile e contenga il database.
ELENCO="$(tar -tzf "$FILE.parziale")" || ELENCO=""
if ! grep -qx 'db.bak' <<<"$ELENCO"; then
  rm -f "$FILE.parziale"
  echo "Backup scartato: l'archivio non contiene il database." >&2
  exit 1
fi
mv "$FILE.parziale" "$FILE"

# Tiene solo le ultime N copie.
ls -1t "$DEST"/waymatch-*.tar.gz "$DEST"/carpooling-*.tar.gz 2>/dev/null | tail -n +"$((TENERE + 1))" | xargs -r rm -f --

echo "✔ Backup creato: $FILE ($(du -h "$FILE" | cut -f1))"
