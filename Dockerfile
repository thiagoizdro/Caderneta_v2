# 1) Compila o PWA
FROM node:24-alpine AS client
WORKDIR /app
COPY package.json package-lock.json ./
COPY client/package.json client/
COPY server/package.json server/
RUN npm ci --workspace client --include-workspace-root=false --ignore-scripts
COPY client client
RUN npm run build -w client

# 2) API + arquivos estáticos
FROM node:24-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
COPY server/package.json server/
RUN npm ci --workspace server --omit=dev --include-workspace-root=false --ignore-scripts
COPY server server
COPY --from=client /app/client/dist client/dist
EXPOSE 3001
CMD ["node", "server/src/index.js"]
