# Node 26 only (rulebook). Docker on OrbStack, never Docker Desktop. Two stages: the web app is built in the first, the server image carries only the built files.
FROM node:26-alpine AS web
WORKDIR /app
COPY package.json package-lock.json ./
COPY web/package.json web/
COPY server/package.json server/
RUN npm ci -w web && npm cache clean --force
COPY web web
RUN npm run build -w web

FROM node:26-alpine
WORKDIR /app
ENV NODE_ENV=production PORT=7814
COPY package.json package-lock.json ./
COPY web/package.json web/
COPY server/package.json server/
RUN npm ci --omit=dev -w server && npm cache clean --force
# server/src includes server/src/local: the lab's own tool server and approval service, forked by server/src/index.js on a loopback port nothing publishes (no extra port, volume or tmpfs).
COPY server/src server/src
COPY server/diagrams server/diagrams
# The Story wording (GET /api/story/wording reads it; the compose mount makes an edit show without a rebuild)
COPY video/captions.md video/captions.md
COPY data data
COPY --from=web /app/web/dist web/dist
USER node
EXPOSE 7814
# Inside the container the server must listen on all interfaces, so CALAB_BIND is set here on purpose.
# The compose file publishes the port on 127.0.0.1 only; do not publish it more widely.
ENV CALAB_BIND=0.0.0.0
CMD ["node", "server/src/index.js"]
