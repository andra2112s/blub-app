FROM node:24-alpine

RUN apk add --no-cache ffmpeg

WORKDIR /app
ENV NODE_ENV=production

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY src ./src
COPY public ./public

# uid 1000 (node) = uid user "bun" di image Toonflow → bisa menulis ke volume data Toonflow
RUN mkdir -p /data /toonflow-data && chown -R node:node /data /toonflow-data
USER node

EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=5s --retries=3 CMD wget -qO- http://127.0.0.1:8787/health || exit 1
CMD ["node", "--disable-warning=ExperimentalWarning", "src/server.mjs"]
