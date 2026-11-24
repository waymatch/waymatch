#!/bin/sh
set -e

# Il container parte come root solo per poter sistemare i permessi dei volumi montati
# su DATA_DIR/UPLOAD_DIR (idempotente: se sono già dell'utente giusto non fa nulla di
# rilevante). Questo copre sia un volume nuovo sia uno esistente creato da una versione
# precedente dell'immagine che girava come root. Poi lascia subito il privilegio
# all'utente non privilegiato 'node' (già presente nell'immagine base node:*-bookworm)
# prima di eseguire l'applicazione vera e propria.
chown -R node:node "$DATA_DIR" "$UPLOAD_DIR"
exec setpriv --reuid=node --regid=node --init-groups "$@"
