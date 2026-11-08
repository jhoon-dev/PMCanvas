FROM node:24-bookworm-slim AS runtime
WORKDIR /app/web
COPY web/package.json web/package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force
FROM postgres:18-bookworm
COPY --from=runtime /usr/local/bin/node /usr/local/bin/node
COPY --from=runtime /app/web/node_modules /app/web/node_modules
COPY web/package.json /app/web/package.json
COPY web/server /app/web/server
COPY web/migrations /app/web/migrations
COPY shared /app/shared
RUN node --version
WORKDIR /app/web
USER 1000:1000
CMD ["node","server/backup-worker.mjs"]
