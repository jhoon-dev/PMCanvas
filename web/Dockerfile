FROM node:24-bookworm-slim
WORKDIR /app/web
ENV NODE_ENV=production
COPY web/package.json web/package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force
COPY --chown=node:node web/server ./server
COPY --chown=node:node web/public ./public
COPY --chown=node:node web/migrations ./migrations
COPY --chown=node:node web/scripts ./scripts
COPY --chown=node:node shared /app/shared
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 CMD node -e "fetch('http://127.0.0.1:3000'+(process.env.BASE_PATH||'')+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node","server/main.mjs"]
