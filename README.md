# TGlobal Gold Loan Portal

A full-stack gold-loan intake demo built for the TGlobal Full-Stack Developer Intern take-home assignment. It combines a responsive React portal, a validated Node.js API, PostgreSQL persistence, exact quote calculations, and a Groq-powered assistant that calls backend tools and requires explicit confirmation before an application is submitted.

> **Demo only:** the reference gold rate is fixed at ₹7,000 per gram for 24K gold. Quotes are indicative, not a lending decision or approval. Do not use this demo with real applicant data.

## Submission status

- **Core application:** implemented and manually exercised end to end.
- **Automated verification:** latest local run passed **36/36 tests across four Vitest files**; API TypeScript build and frontend TypeScript/Vite production build both passed after a fresh npm ci.
- **GitHub CI:** [Run #34 passed](https://github.com/Sanjayram3269/tglobal-gold-loan-portal/actions/runs/38037015978) for commit a31e7f27d49a14c018e26ab1aa0660edfc334962.
- **AI conversation checks:** five required scenarios and four additional manual scenarios are recorded in [docs/AI_EVALUATIONS.md](docs/AI_EVALUATIONS.md). These are manual observations, not automated live-model CI tests.
- **Submission files:** this README, [AI_LOG.md](AI_LOG.md), [.env.example](.env.example), migrations/seed, tests, and GitHub Actions workflow are included.
- **Bonus scope and limitations:** see [Bonus scope](#bonus-scope) and [Known limitations](#known-limitations).

## Product walkthrough

### Borrower portal

1. Enter jewellery net/gross weights, karat, and a loan plan.
2. View backend-calculated indicative estimates for each available plan and choose a plan.
3. Enter contact details, review the summary, and submit.
4. Receive an application reference or a friendly duplicate-application message.

### AI loan assistant

- Retrieves available plans from PostgreSQL.
- Calls the backend quote calculator rather than doing arithmetic in the model.
- Collects missing application details and prepares a review card.
- Does **not** create a lead during preparation. A separate explicit confirmation action is required before the backend creates the application.
- Refuses unrelated requests, avoids unsupported lender-eligibility claims, and does not promise approval.
- Uses a ten-minute, single-use in-memory confirmation token.

### Demo applications view

Lists applications newest first, masks mobile numbers, and supports filtering by plan. **This view and its API are not authenticated**; they are for a local/reviewer demo only.

## Technology

| Area | Implementation |
|---|---|
| Frontend | React 19, TypeScript, Vite, responsive CSS |
| API | Node.js, Express 5, TypeScript |
| Validation | Zod |
| Database | PostgreSQL 17 |
| ORM / migrations | Prisma 7 |
| Money calculations | Decimal.js; eligible loan is floored to whole rupees |
| AI | Groq API through the OpenAI-compatible SDK; default model openai/gpt-oss-20b |
| Tests | Vitest, Supertest |
| CI | GitHub Actions: API tests and API/frontend production builds |

## Architecture

See [ARCHITECTURE.md](ARCHITECTURE.md) for component boundaries, request flows, data integrity, errors, and deliberate limitations.

The guided form and AI flow both use the same backend validation, quote calculation, and duplicate protection. The model never acts as the source of truth for financial calculations.

## Financial rules

Mock 24K rate: **₹7,000/g**.

| Plan ID | Plan | Interest p.a. | Max LTV | Tenure |
|---|---|---:|---:|---|
| PLAN_BULLET_01 | Bullet Repayment | 12.0% | 70% | 12 months |
| PLAN_EMI_01 | Monthly EMI | 10.5% | 75% | 12 months |

Calculation:
- pureGoldGrams = netWeightGrams × (karat / 24)
- goldValue = pureGoldGrams × rate24kPerGram
- eligibleLoan = floor(goldValue × min(plan.maxLtv, 0.75))

Reference results:

| Input | Expected result |
|---|---|
| 45g net, 22K, Monthly EMI | 41.25g pure gold; ₹288,750 gold value; ₹216,562 eligible loan |
| 45g net, 22K, Bullet | ₹288,750 gold value; ₹202,125 eligible loan |
| 10g net, 18K, Monthly EMI | 7.5g pure gold; ₹52,500 gold value; ₹39,375 eligible loan |

The quote endpoint reports an indicative eligible amount, not a calculated EMI or final repayment schedule.

## API

Base path: /api/v1

| Method | Endpoint | Purpose |
|---|---|---|
| GET | /loan-schemes | Return available seeded schemes |
| POST | /quotes | Validate input and calculate an estimate without writing a lead |
| POST | /leads | Revalidate, recalculate, check duplicates, and create a SUBMITTED lead |
| GET | /leads | List newest applications first with mobile numbers masked |
| POST | /assistant/chat | Run the tool-using assistant |
| POST | /assistant/confirm | Submit a prepared application after explicit confirmation |

### Validation and integrity

- Applicant name: 2–60 ASCII letters/spaces.
- Indian mobile: ^[6-9]\d{9}$.
- Weights: 0 < net ≤ gross ≤ 1000g.
- Karat: 18, 22, or 24.
- Unknown plan: 404; invalid input: 400; duplicate mobile within seven days: 409.
- Successful lead creation: 201 with an application reference.
- Errors return a consistent error object with code, message, and fields, plus a top-level message for simple clients.
- Quote endpoint does not create a lead; the server recomputes the quote during submission.
- Transaction-scoped PostgreSQL advisory locking protects the seven-day duplicate check against concurrent requests.
- Mobile numbers are masked in lead-list responses.
- POST /leads also accepts an optional Idempotency-Key header for safe retries; see the next section.

### Idempotent lead submission

POST /api/v1/leads accepts an optional `Idempotency-Key` request header so clients can retry submissions safely.

Header contract:

- Optional. Requests without the header behave exactly as before.
- 1–255 characters, using only letters, digits, and the characters `. _ ~ : -`.
- An invalid key (empty, longer than 255 characters, or containing other characters) returns 400 with code `IDEMPOTENCY_KEY_INVALID`.

Behavior:

- The first request with a key runs normally. Its key, a canonical SHA-256 fingerprint of the validated payload, the response status, and the response body are persisted in PostgreSQL in the same transaction that creates the lead, so the record and the idempotency result commit or roll back atomically.
- Repeating the same key with an equivalent validated request returns the original HTTP status with a byte-identical response body, sets an `Idempotency-Replayed: true` header, and does not create another lead.
- Reusing a key with a different validated payload returns 409 with code `IDEMPOTENCY_KEY_REUSED`.
- Concurrent requests that share a key are handled with the primary-key uniqueness constraint plus transactions: one request produces the result and the others replay it (or receive 409 for a mismatched payload). No duplicate leads are created.
- Terminal results (201 success, 404 unknown scheme, and the 409 seven-day duplicate-mobile rejection) are stored and replayed consistently, so duplicate protection stays active even when idempotency keys are used.
- Field-validation failures (400) and invalid keys never consume the key; a corrected retry with the same key proceeds normally.
- Persisted response bodies contain only the existing masked mobile representation (for example `9876XXXX10`), and the stored fingerprint is a SHA-256 hash; raw applicant details are not logged.

Example request:

    curl -X POST http://localhost:4000/api/v1/leads \
      -H "Content-Type: application/json" \
      -H "Idempotency-Key: order-2026-10-10-0001" \
      -d '{"name":"Ramesh Babu","mobile":"8907682981","netWeightGrams":45,"grossWeightGrams":50,"karat":22,"schemeId":"PLAN_EMI_01"}'

Retrying the identical request (same key, same payload) returns the same 201 response with `Idempotency-Replayed: true`; sending a different payload under the same key returns 409 `IDEMPOTENCY_KEY_REUSED`.

## Local setup

### Prerequisites

- Node.js 22 and npm.
- PostgreSQL 17, locally or through Docker.
- A Groq API key for live assistant conversations. Automated tests and production builds do not require a live model key.

### Install and configure

From PowerShell:

    git clone https://github.com/Sanjayram3269/tglobal-gold-loan-portal.git
    cd tglobal-gold-loan-portal
    npm ci
    Copy-Item .env.example apps/api/.env

Edit apps/api/.env and set your PostgreSQL DATABASE_URL and server-side GROQ_API_KEY. Keep this file local; never commit it.

Apply migrations and seed the plans:

    npm exec --workspace=@tglobal/api -- prisma migrate deploy
    npm run seed --workspace=@tglobal/api

Start the API and frontend:

    npm run dev

Open the Vite URL printed in the terminal. The API defaults to port 4000; Vite usually uses 5173, but may choose another available port.

## Environment variables

| Variable | Used by | Purpose |
|---|---|---|
| DATABASE_URL | API | PostgreSQL connection string |
| PORT | API | API listen port; defaults to 4000 |
| WEB_ORIGIN | API | Comma-separated allowed browser origins |
| GROQ_API_KEY | API only | Secret key for live AI calls |
| GROQ_MODEL | API | Groq model ID; defaults to openai/gpt-oss-20b |
| VITE_API_URL | Frontend build | Public API base URL; defaults to http://localhost:4000 |

Never place secrets in variables prefixed with VITE_: Vite embeds those values in client-side assets. If a key has been committed or exposed, revoke and rotate it.

## Test and build

    npm ci
    npm test
    npm run build
    npm run lint

**Latest local verification:** npm test passed 48 tests across four files; npm run build passed for API and frontend; npm run lint passed; npm audit reported 0 vulnerabilities; prisma validate, prisma generate, and prisma migrate status all passed against PostgreSQL 17. CI runs API tests and production builds; it does not run live-model evaluations or provision a fresh PostgreSQL service.

See:
- [AI evaluation results](docs/AI_EVALUATIONS.md)
- [AI-assisted development log](AI_LOG.md)
- [Architecture notes](ARCHITECTURE.md)
- [GitHub Actions](https://github.com/Sanjayram3269/tglobal-gold-loan-portal/actions)

## Bonus scope

The assignment makes bonuses optional and says they do not replace required work. Implemented and manually checked in this project:

- **Concurrency-safe duplicate protection:** PostgreSQL transaction-scoped advisory locks protect concurrent requests for the same mobile.
- **Single-use confirmation:** confirmation tokens expire after ten minutes and are consumed before the database write; unit tests cover replay attempts.
- **Prompt-injection handling and multilingual conversation:** manual checks for prompt injection and Hinglish are recorded in the evaluation report.
- **Change-mind flow:** cancelling at the review step leaves the lead count unchanged, per manual test.
- **CI and architecture documentation:** GitHub Actions runs automated tests/builds; architecture and request flow are documented.

Not implemented or not claimed as complete:

- Idempotency-Key replay semantics for POST /leads.
- A lead status-transition workflow with a durable audit log.
- Cached gold-rate endpoint.
- Fourth check_existing_application tool.
- Streaming assistant responses and visible tool-status chips.
- Ten-plus automated live-model evaluations or an npm run eval runner.
- Appraisal-slip image extraction or natural-language admin filtering.
- API rate limiting.
- Admin authentication/role-based access control.
- A full-stack Docker Compose deployment and two-minute demo video.

## Known limitations and security notes

- Fixed mock gold rate; no live market feed or jewellery-authenticity valuation.
- No real loan approval, identity verification, collateral verification, credit assessment, or repayment-schedule calculation.
- Admin list endpoint is unauthenticated; do not use with real applicant information.
- Confirmation tokens are stored in process memory, expire after ten minutes, and are lost on restart. This is not durable across multiple API instances.
- Live-model evaluations are manual observations and are not part of CI.
- The latest npm ci reported **five high-severity npm audit findings**. The build and tests pass, but the dependency advisories have not been fully investigated. Avoid npm audit fix --force; review the audit details and make compatible updates separately before production use.

## Repository structure

    .
    ├── .github/workflows/ci.yml
    ├── apps/
    │   ├── api/
    │   │   ├── prisma/              # Schema, migration and seed
    │   │   ├── src/domain/          # Financial calculator
    │   │   ├── src/services/        # Assistant and confirmation flow
    │   │   └── tests/               # Four Vitest files in total
    │   └── web/src/                 # React portal and assistant widget
    ├── ARCHITECTURE.md
    ├── docs/AI_EVALUATIONS.md
    ├── AI_LOG.md
    ├── .env.example
    ├── package.json
    └── README.md

## Final hand-in checklist

- [x] Core API, calculation, persistence, borrower form, assistant, and applications view.
- [x] Server-side validation, scheme lookup, duplicate rejection, masked mobile numbers, and explicit AI confirmation.
- [x] Unit/HTTP tests; latest local result: 36/36 passing.
- [x] API and frontend production builds pass locally.
- [x] .env.example, AI_LOG.md, AI evaluation report, Prisma migration/seed, and CI workflow committed.
- [x] Required and bonus manual conversation scenarios recorded in AI_EVALUATIONS.md.
- [x] Latest verified GitHub Actions run passed on commit a31e7f2.
- [ ] Review/fix the five high-severity dependency audit findings before any production deployment.
- [ ] Add authentication, rate limiting, durable confirmation state, and monitoring before production use.
