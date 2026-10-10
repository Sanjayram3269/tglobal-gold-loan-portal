# Local development with Docker Compose

This repository includes an optional `compose.yaml` for a reproducible local stack
with PostgreSQL, the API, and the web app. It is intended for fresh local setups and
reviewers who do not want to install PostgreSQL locally. It does **not** replace the
existing Node.js + local PostgreSQL development story.

## When to use Compose

- Use Compose when you want a self-contained local stack and do not already have a
  suitable PostgreSQL 17 instance running.
- Use the existing npm-based workflow when you already have a local PostgreSQL 17
  database and want to keep using it.

Both paths can coexist. The Compose stack uses its own container database by default
so it does not interfere with any local database you already use.

## Quick start

    git clone https://github.com/Sanjayram3269/tglobal-gold-loan-portal.git
    cd tglobal-gold-loan-portal
    npm ci

Create the Compose environment file from the example:

    cp .env.example .env.compose

Edit `.env.compose` and set the values you want for the Compose stack. The defaults
in `.env.example` are already arranged for a PostgreSQL container on the default
Compose network, but you should still review them before starting.

Start the stack:

    docker compose --env-file .env.compose up -d

The first run pulls the PostgreSQL image and starts three services:

    docker compose --env-file .env.compose ps

Wait for the database to report healthy, then apply migrations and seed the plans
from the API container:

    docker compose --env-file .env.compose exec api npm exec --workspace=@tglobal/api -- prisma migrate deploy
    docker compose --env-file .env.compose exec api npm run seed --workspace=@tglobal/api

After that, the API is available on the host port from `.env.compose` (default 4000)
and the web app is available on the host port from `.env.compose` (default 5173).

Stop the stack when you are done:

    docker compose --env-file .env.compose down

To also remove the container database volume (destroys all data in the Compose
database, not any local database you use outside Compose):

    docker compose --env-file .env.compose down -v

## What Compose provides

- A PostgreSQL 17 service with a health check.
- The API service, built from `apps/api`, connected to that PostgreSQL instance.
- The web app service, served by Vite during development and by a lightweight static
  server from `apps/web/dist` after `npm run build`.
- Explicit startup order and health checks so the API waits for PostgreSQL.
- No credentials embedded in the Compose file. All sensitive values come from the
  environment file.

## Existing data is preserved

The Compose stack uses its own PostgreSQL volume by default. It does **not** connect
to, reset, re-seed, or delete any existing local database unless you explicitly point
`DATABASE_URL` at one or remove the Compose volume with `docker compose down -v`.

If you point the Compose stack at an existing database, the documented steps still only
run `prisma migrate deploy` and `npm run seed`. The migration is additive and the seed
is idempotent/additive: it ensures the two configured loan schemes exist and does not
delete existing leads, status history, or idempotency records. If you want to keep
existing data, do not run any extra reset or re-seed steps.

## Migrations and seeding

Migrations and seeding are explicit manual steps, not automatic startup actions.

1. Apply migrations:
   `docker compose --env-file .env.compose exec api npm exec --workspace=@tglobal/api -- prisma migrate deploy`
2. Seed the configured loan schemes:
   `docker compose --env-file .env.compose exec api npm run seed --workspace=@tglobal/api`

If you already have a database with data, you can still run these commands. The
migration is additive; the seed only ensures the two configured schemes exist.

## Development workflow preserved

The existing local workflow still works unchanged:

- Install: `npm ci`
- Configure: copy `.env.example` to `apps/api/.env` and set your values
- Migrate and seed against your existing database
- Run `npm run dev` for the API and web app

You do not need Docker to develop or test the project.

## Configuration

The Compose file reads from environment variables. Copy `.env.example` to
`.env.compose` and adjust the values for your machine.

Key variables:

| Variable | Used by | Purpose |
|---|---|---|
| DATABASE_URL | API + Prisma | PostgreSQL connection string for the Compose database |
| PORT | API | API listen port exposed on the host |
| WEB_ORIGIN | API | Allowed browser origins for CORS |
| GROQ_API_KEY | API only | Live AI assistant key; optional for local dev without the assistant |
| GROQ_MODEL | API | Groq model ID |
| VITE_API_URL | Web | Public API base URL seen by the browser |

Never commit `.env.compose` or `apps/api/.env`. The Compose file and `.env.example`
do not contain real credentials.

## Frontend in Compose

During development, the web service runs Vite and proxies API requests to the API
service using the host port from `VITE_API_URL`. For a production-like static deploy,
build the frontend first and serve the built output.

If you want a fully static Compose stack, build the frontend outside Compose and serve
`apps/web/dist` from the web container. The Compose file is primarily a development
and reviewer convenience, not a production deployment manifest.

## Verification commands

From the repository root:

    npm ci
    npm test
    npm run build
    npm run lint

Compose-specific checks, when Docker is available:

    docker compose --env-file .env.compose config
    docker compose --env-file .env.compose up -d
    docker compose --env-file .env.compose ps
    docker compose --env-file .env.compose logs api
    docker compose --env-file .env.compose exec api npm exec --workspace=@tglobal/api -- prisma migrate deploy
    docker compose --env-file .env.compose exec api npm run seed --workspace=@tglobal/api

If Docker is not available, run `docker compose --env-file .env.compose config` as a
lightweight structural validation of the Compose file itself. That checks YAML shape,
variable references, and service definitions without starting containers.

## Limitations

- The Compose stack is for local development and reviewer convenience. It is not a
  hardened production deployment.
- The applications dashboard and leads endpoint are not authenticated. Do not expose
  this stack with real applicant data.
- Confirmation tokens live in process memory and are lost on container restart.
- Live AI conversations require `GROQ_API_KEY`. Tests and builds do not.
- The gold rate is a fixed mock value, not a live market feed.
