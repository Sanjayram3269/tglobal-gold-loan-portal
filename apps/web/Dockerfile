# Development stage for the web app, used by compose.yaml hot-reload.

FROM node:22-slim AS development

WORKDIR /app

COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/

RUN npm ci

COPY . .

CMD ["npm", "run", "dev", "--workspace=web"]
