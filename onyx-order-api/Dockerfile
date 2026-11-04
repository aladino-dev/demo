# Onyx Order – API
FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
# Les dépendances « optionnelles » contiennent le composant natif de sharp (conversion des photos) : il faut les installer.
# En production la base est un PostgreSQL externe : on retire seulement la base intégrée (usage local sous Windows).
RUN (npm ci --omit=dev || npm install --omit=dev) && rm -rf node_modules/embedded-postgres node_modules/@embedded-postgres
COPY src ./src
COPY scripts ./scripts
COPY db ./db
COPY data ./data
ENV API_PORT=4000 PHOTOS_DIR=/data/photos
VOLUME /data/photos
EXPOSE 4000
USER node
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://127.0.0.1:4000/api/health || exit 1
CMD ["node", "src/index.js"]
