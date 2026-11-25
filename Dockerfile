# --- Stage 1: build del frontend ---
FROM node:22-bookworm-slim AS frontend-build
WORKDIR /app/frontend
COPY frontend/package.json ./
RUN npm install
COPY frontend ./
# Le guide (docs/) sono incorporate nell'app al momento della build.
COPY docs/guida-utente.md docs/guida-mobility-manager.md docs/novita.md docs/metodo-calcolo.md /app/docs/
COPY docs/img /app/docs/img
# Identità visiva di WayMatch (loghi usati dall'app).
COPY assets/brand/svg /app/assets/brand/svg
RUN npm run build

# --- Stage 2: backend + frontend buildato ---
FROM node:22-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY backend/package.json ./
RUN npm install --omit=dev

COPY backend ./
# Il frontend buildato viene servito staticamente da Express da /app/public
COPY --from=frontend-build /app/backend/public ./public

ENV NODE_ENV=production
ENV DATA_DIR=/app/data
ENV UPLOAD_DIR=/app/uploads

RUN mkdir -p /app/data /app/uploads && chown -R node:node /app/data /app/uploads

COPY docker-entrypoint.sh /usr/local/bin/
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

EXPOSE 4000
# L'entrypoint parte come root solo per sistemare i permessi di DATA_DIR/UPLOAD_DIR
# (utile soprattutto se sono volumi montati creati da una versione precedente
# dell'immagine, che girava come root), poi esegue il comando come utente 'node'
# non privilegiato: vedi docker-entrypoint.sh.
ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["node", "server.js"]
