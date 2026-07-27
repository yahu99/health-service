FROM node:22-alpine

ENV NODE_ENV=production

WORKDIR /app

COPY package.json package-lock.json ./

RUN npm ci --omit=dev

COPY --chown=node:node src ./src
COPY --chown=node:node migrations ./migrations

USER node

EXPOSE 8000

CMD ["node", "src/index.js"]
