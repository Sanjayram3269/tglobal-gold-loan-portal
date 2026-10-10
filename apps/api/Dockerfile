# Development stage for the API, used by compose.yaml hot-reload.
# A separate production stage can be added later if needed.

FROM node:22-slim AS development

WORKDIR /app

# Install dependencies first so application source changes do not invalidate the
# dependency layer during local development.
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/

# Use the workspace lockfile at the repository root.
RUN npm ci

COPY . .

# Keep this stage focused on development convenience.
CMD ["npm", "run", "dev", "--workspace=@tglobal/api"]
