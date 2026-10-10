# TGlobal Gold Loan Portal

A full-stack gold-loan intake demonstration built for the TGlobal Full-Stack Developer Intern assignment. It combines a responsive React borrower portal, a validated Express API, PostgreSQL persistence, deterministic quote calculations, an applications dashboard, and a tool-using AI assistant.

> **Demo only:** the 24K gold reference rate is a mock value of ₹7,000 per gram, not a live market price. Quotes are indicative and are not a lending decision or approval. Do not use this demo with real applicant data.

## Contents

- [Features](#features)
- [Technology stack](#technology-stack)
- [Financial rules](#financial-rules)
- [API reference](#api-reference)
- [Reliability and data integrity](#reliability-and-data-integrity)
- [Run locally](#run-locally)
- [Docker Compose](#docker-compose)
- [Tests and verification](#tests-and-verification)
- [Documentation](#documentation)
- [Known limitations](#known-limitations)

## Features

### Borrower experience
- Explore loan schemes and their interest rates, LTV limits, and tenure.
- Enter gold details in a guided application flow and view indicative quotes.
- Review applicant details before submitting an application.
- Receive validation errors and duplicate-application feedback.

### Backend
- Node.js, Express 5, TypeScript, and Zod validation.
- PostgreSQL persistence through Prisma 7.
- Server-side quote recalculation during submission; quote requests do not create leads.
- Seven-day duplicate-mobile protection using transaction-scoped PostgreSQL advisory locking.
- Newest-first application listing with masked mobile numbers.
- Optional `Idempotency-Key` support for safe retries.
- Configurable rate limiting for lead creation.
- Controlled application-status transitions with transactional audit history.
- Cached mock gold-rate endpoint with a five-minute TTL.

### AI loan assistant
The Groq-backed assistant uses backend tools rather than relying on the model for financial arithmetic:

1. `get_loan_schemes()` retrieves available schemes.
2. `calculate_quote(...)` calls the backend quote calculator.
3. `submit_application(payload)` prepares an application for review; it does not create a lead immediately.

A separate explicit confirmation action is required before an application is submitted. Confirmation tokens are single-use and expire after ten minutes. Live AI conversations require a server-side `GROQ_API_KEY`; automated tests and builds do not require a live model key.

## Technology stack

| Area | Technology |
|---|---|
| Frontend | React 19, TypeScript, Vite, responsive CSS |
| API | Node.js, Express 5, TypeScript |
| Validation | Zod |
| Database | PostgreSQL 17 |
| ORM and migrations | Prisma 7 |
| Financial calculations | Decimal.js |
| AI integration | Groq API through an OpenAI-compatible SDK |
| Tests | Vitest, Supertest |
| CI | GitHub Actions |
| Containers | Optional Docker Compose and API/web Dockerfiles |

## Financial rules

The configured 24K reference rate is **₹7,000 per gram**.

- `pureGoldGrams = netWeightGrams × (karat / 24)`
- `goldValue = pureGoldGrams × rate24kPerGram`
- `eligibleLoan = floor(goldValue × min(plan.maxLtv, 0.75))`

Available plans:

| Plan ID | Plan | Annual interest | Maximum LTV | Tenure |
|---|---|---:|---:|---:|
| `PLAN_BULLET_01` | Bullet Repayment | 12.0% | 70% | 12 months |
| `PLAN_EMI_01` | Monthly EMI | 10.5% | 75% | 12 months |

Example: 45 g net weight, 22K, Monthly EMI, and the mock rate produce 41.25 g pure gold, ₹288,750 gold value, and ₹216,562 eligible loan (rounded down to a whole rupee).

The quote is indicative only. It does not calculate a complete repayment schedule or determine real lender eligibility.

## API reference

Base path: `/api/v1`

| Method | Endpoint | Purpose |
|---|---|---|
| GET | `/loan-schemes` | Retrieve available seeded schemes |
| POST | `/quotes` | Validate and calculate a quote without creating a lead |
| POST | `/leads` | Revalidate, recalculate, check duplicates, and create an application |
| GET | `/leads` | List newest applications first with mobile numbers masked |
| PATCH | `/leads/:id/status` | Enforce a status transition and write audit history |
| GET | `/gold-rate` | Return the cached mock rate and cache metadata |
| POST | `/assistant/chat` | Run the tool-using assistant |
| POST | `/assistant/confirm` | Submit a prepared application after explicit confirmation |

Typical responses include HTTP 201 for successful creation, 400 for invalid input, 404 for an unknown resource or scheme, 409 for duplicate applications or conflicting requests, and 429 when the lead-creation rate limit is exceeded.

## Reliability and data integrity

### Duplicate protection and idempotency
Lead creation checks for an application using the same mobile number in the preceding seven days. Transaction-scoped PostgreSQL advisory locking protects this check against concurrent requests.

The optional `Idempotency-Key` header makes retries safe. Equivalent requests with the same key replay the stored response; using the same key with a different payload returns HTTP 409. Idempotency results are persisted transactionally with the lead. A separate retention-cleanup command is opt-in, previews by default, and is never run automatically on startup or in CI. See the API workspace scripts for its options.

### Status workflow and audit history
Allowed transitions are:
- `SUBMITTED → UNDER_REVIEW`
- `UNDER_REVIEW → APPROVED` or `REJECTED`

Approved and rejected states are terminal. Invalid transitions are rejected. The status change and its append-only `LeadStatusHistory` row are written in the same transaction, with concurrent transitions for a lead serialized using an advisory lock.

### Mock gold-rate cache
`GET /api/v1/gold-rate` returns the configured mock rate, source `mock-reference`, currency, and five-minute cache metadata. It is not a live market feed.

### Rate limiting
`POST /api/v1/leads` supports configurable in-process rate limiting and returns HTTP 429 with a `Retry-After` header when the configured limit is exceeded. It is scoped to lead creation and works alongside duplicate protection and idempotency. In-process limits are intended for this single-instance demo, not as a distributed production rate limiter.

## Run locally

### Prerequisites
- Node.js 22 and npm.
- PostgreSQL 17, either locally or through Docker.
- A Groq API key for live AI conversations.

### Setup
Run commands from the repository root:

```powershell
npm ci
Copy-Item .env.example apps/api/.env
```

Edit `apps/api/.env` and set `DATABASE_URL` and the server-side `GROQ_API_KEY`. Keep this file local and never commit it. The tracked `.env.example` contains placeholders only.

Apply migrations and seed the schemes:

```powershell
npm exec --workspace=@tglobal/api -- prisma migrate deploy
npm run seed --workspace=@tglobal/api
```

Start the API and frontend together:

```powershell
npm run dev
```

Open the Vite URL printed in the terminal. The API defaults to port 4000; Vite commonly uses port 5173 but may select another available port.

### Environment variables

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | API PostgreSQL connection string |
| `PORT` | API port; defaults to 4000 |
| `WEB_ORIGIN` | Allowed browser origin(s) |
| `GROQ_API_KEY` | Server-side secret for live AI calls |
| `GROQ_MODEL` | Groq model ID; defaults to `openai/gpt-oss-20b` |
| `VITE_API_URL` | Public API base URL for the frontend build; defaults to `http://localhost:4000` |

Never put secrets in `VITE_*` variables because Vite embeds them in client-side assets.

## Docker Compose

An optional Compose setup and API/web Dockerfiles are included. See [docs/DOCKER_COMPOSE.md](docs/DOCKER_COMPOSE.md) for configuration, environment variables, and startup instructions.

Validate the Compose configuration with:

```powershell
docker compose config
```

This checks Compose configuration but does **not** start containers or prove the full stack works. To start the stack, follow the documented Compose instructions and inspect `docker compose ps` and the service logs. Do not delete database volumes unless you explicitly intend to remove their data.

## Tests and verification

Run from the repository root:

```powershell
npm test
npm run lint
npm run build
npm audit
```

The latest documented local verification on 2026-10-10 reported 72/72 tests passing across six Vitest files, successful lint and API/frontend production builds, zero vulnerabilities reported by `npm audit`, and successful Prisma validation, generation, and migration-status checks against PostgreSQL 17.

GitHub Actions runs automated tests and production builds. Check the Actions page for the status of the current commit:
[GitHub Actions](https://github.com/Sanjayram3269/tglobal-gold-loan-portal/actions).

Live-model conversation evaluations are manual observations documented separately; CI does not call the live model. Compose configuration validation should not be confused with a successful container startup.

## Documentation

- [Architecture](ARCHITECTURE.md) — components, request flows, data integrity, and limitations.
- [AI development log](AI_LOG.md) — AI tools, representative prompts, a generated-code issue, correction, and regression tests.
- [AI evaluations](docs/AI_EVALUATIONS.md) — required conversation scenarios and manual observations.
- [Docker Compose guide](docs/DOCKER_COMPOSE.md) — optional container setup.
- [Demo script](docs/DEMO.md) — suggested walkthrough and recording checklist.
- [.env.example](.env.example) — environment-variable template with no real secrets.

## Known limitations and security notes

This repository is an assignment demo, not a production lending system.

- The gold rate is mocked; there is no live market feed or jewellery-authenticity valuation.
- No actual lending decision, identity verification, collateral verification, credit assessment, or full repayment schedule is provided.
- The admin applications view and lead-list API have no authentication or authorization. Do not use them with real applicant data.
- Confirmation tokens are held in process memory, expire after ten minutes, and are lost on restart; they are not shared across multiple API instances.
- Rate limiting is in-process and is not distributed across multiple API instances.
- Live-model evaluations are manual and are not part of CI.
- Optional features not implemented include a fourth existing-application tool, streamed assistant responses/tool-status UI, appraisal-slip image extraction, and admin authentication.

Before production use, add authentication and authorization, privacy controls, distributed rate limiting, operational monitoring, and a live gold-rate provider with appropriate validation and failure handling.
