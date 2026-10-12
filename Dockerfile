# 隐匿对话 — self-hosted relay. Serve it over HTTPS (see docker-compose.yml):
# browsers only allow the page's encryption on HTTPS or localhost.
FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production PORT=8080
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force
COPY dist ./dist
COPY src/rules.js ./src/rules.js
COPY server ./server
# Where the LAN mode keeps its certificates (docker-compose.lan.yml).
RUN mkdir /certs && chown node:node /certs
USER node
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://127.0.0.1:8080/ >/dev/null || exit 1
CMD ["node", "server/server.mjs"]
