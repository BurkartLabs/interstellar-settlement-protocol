# The ISP server as one long-lived container (AB#735; Decision #591: Azure Container Apps, data on Azure Files).
#
#   docker build -t isp .
#   docker run -p 3000:3000 -v isp-data:/data --env-file isp.env isp     (isp.env sets the JWT secret)
#
# What the server writes (accounts-snapshot.json, state.json) goes to ISP_DATA_DIR, /data here: mount a volume there
# or it is lost with the container. JWT_SECRET comes from the platform (a Key Vault reference in Azure), never from the
# image; without it the server refuses to start (Bug #589).

FROM node:24-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
# Production dependencies only, exactly as locked.
RUN npm ci --omit=dev --no-audit --no-fund && npm cache clean --force

FROM node:24-alpine
ENV NODE_ENV=production \
    PORT=3000 \
    ISP_DATA_DIR=/data
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
COPY server ./server
COPY public ./public
# The game's catalogues. .dockerignore keeps out anything the server writes here (Bug #415: the accounts snapshot).
COPY data ./data
# The data directory belongs to the unprivileged user the server runs as; the code stays owned by root, read-only to it.
RUN mkdir -p /data && chown node:node /data
USER node
EXPOSE 3000
VOLUME ["/data"]
HEALTHCHECK --interval=30s --timeout=3s --start-period=20s CMD wget -qO- "http://127.0.0.1:${PORT}/healthz" || exit 1
# node is PID 1 and handles SIGTERM itself: it writes the data directory, then exits (Bug #1153).
CMD ["node", "server/index.js"]
