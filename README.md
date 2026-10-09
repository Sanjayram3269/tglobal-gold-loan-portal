# TGlobal Gold Loan Portal

A full-stack gold-loan intake demo built for the TGlobal Full-Stack Developer Intern take-home assignment. It combines a responsive React portal, a validated Node.js API, PostgreSQL persistence, exact quote calculations, and a Groq-powered assistant that uses backend tools and requires explicit confirmation before an application is submitted.

> **Demo only:** the reference gold rate is fixed at ₹7,000 per gram for 24K gold. Quotes are indicative, not a lending decision or approval. Do not use this demo with real applicant data.

## Status

- **Core implementation:** complete.
- **Local end-to-end check:** the developer reports that the borrower flow and assistant have been tested end to end locally.
- **Automated checks:** the verified CI run recorded 25 tests passing across three Vitest files, followed by successful API and frontend builds. Check the [Actions page](https://github.com/Sanjayram3269/tglobal-gold-loan-portal/actions) for the latest run on the current commit.
- **Remaining before final hand-in:** record the outcomes of the five live-model scenarios in [AI evaluations](docs/AI_EVALUATIONS.md), review the dependency audit, and do a final deployment/configuration check if publishing a live demo.
- **Optional bonuses:** not all bonus items are implemented. See [Bonus scope](#bonus-scope).

## Product walkthrough

### Borrower portal

1. Enter jewellery net/gross weights, karat, and a loan plan.
2. View a live, backend-calculated estimate.
3. Enter contact details, review the summary, and explicitly submit.
4. Receive an application reference or a friendly duplicate-application message.

### AI loan assistant

- Retrieves available plans from PostgreSQL.
- Calls the backend quote calculation rather than doing arithmetic in the model.
- Collects missing application details and prepares a review card.
- Does **not** create a lead during preparation. A separate confirmation action is required before the backend creates the application.
- Avoids promising approval or inventing repayment schedules that the quote API does not calculate.

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
| AI | Groq API through the OpenAI-compatible SDK; default model `openai/gpt-oss-20b` |
| Tests | Vitest, Supertest |
| CI | GitHub Actions: API tests and frontend/API production builds |

## Architecture

```text
React borrower form ───────┐
React AI chat ─────────────┼──> Express API ──> Zod validation
Demo applications view ───┘        │
                                   ├──> Loan calculator / application service
                                   │              │
                                   │              v
                                   └──────────> PostgreSQL
AI orchestrator ──> get_loan_schemes
                ├─> calculate_quote
                └─> submit_application (prepare only)
                          │
                          v
                explicit UI confirmation
                          │
                          v
                 server-side lead creation
```

The API and database are the source of truth. The client never supplies a trusted eligible-loan amount. Both the guided form and AI flow use server-side validation, calculation, and duplicate protection.

## Financial rules

Mock 24K rate: **₹7,000/g**.

| Plan ID | Plan | Interest p.a. | Max LTV | Tenure |
|---|---|---:|---:|---|
| `PLAN_BULLET_01` | Bullet Repayment | 12.0% | 70% | 12 months |
| `PLAN_EMI_01` | Monthly EMI | 10.5% | 75% | 12 months |

```text
pureGoldGrams = netWeightGrams × (karat / 24)
goldValue     = pureGoldGrams × rate24kPerGram
eligibleLoan  = floor(goldValue × min(plan.maxLtv, 0.75))
```

Reference results:

| Input | Expected result |
|---|---|
| 45g net, 22K, Monthly EMI | 41.25g pure gold; ₹288,750 gold value; ₹216,562 eligible loan |
| 45g net, 22K, Bullet | ₹288,750 gold value; ₹202,125 eligible loan |
| 10g net, 18K, Monthly EMI | 7.5g pure gold; ₹52,500 gold value; ₹39,375 eligible loan |

The quote endpoint reports an indicative eligible amount, not a calculated EMI or final repayment schedule.

## API

Base path: `/api/v1`

| Method | Endpoint | Purpose |
|---|---|---|
| `GET` | `/loan-schemes` | Return available seeded schemes |
| `POST` | `/quotes` | Validate input and calculate per-plan estimates without writing a lead |
| `POST` | `/leads` | Revalidate, recalculate, check duplicates, and create a `SUBMITTED` lead |
| `GET` | `/leads` | List newest applications first with mobile numbers masked |

The AI flow also uses `POST /api/v1/assistant/chat` and `POST /api/v1/assistant/confirm`.

### Validation and integrity

- Applicant name: 2–60 letters/spaces.
- Indian mobile: `^[6-9]\\d{9}$`.
- Weights: `0 < net ≤ gross ≤ 1000g`.
- Karat: 18, 22, or 24.
- Unknown plan: `404`; invalid input: `400`; duplicate mobile within seven days: `409`.
- Successful lead creation: `201` with an application reference.
- Quote endpoint does not create a lead.
- Server recomputes the quote on submission.
- Transaction-scoped PostgreSQL advisory locking protects the seven-day duplicate check against concurrent requests.
- Mobile numbers are masked in lead-list responses.

## Local setup

### Prerequisites

- Node.js 22 and npm.
- PostgreSQL 17, locally or through Docker.
- A Groq API key for live assistant conversations. Automated tests and production builds should not require a live model key.

### Install and configure

From PowerShell:

```powershell
git clone https://github.com/Sanjayram3269/tglobal-gold-loan-portal.git
cd tglobal-gold-loan-portal
npm ci
Copy-Item .env.example apps/api/.env
```

Edit `apps/api/.env` and set your PostgreSQL `DATABASE_URL` and server-side `GROQ_API_KEY`. Keep this file local; never commit it.

Apply migrations and seed the plans:

```powershell
npm exec --workspace=@tglobal/api -- prisma migrate deploy
npm run seed --workspace=@tglobal/api
```

Start the API and frontend:

```powershell
npm run dev
```

Open the Vite URL printed in the terminal. The API defaults to port `4000`; Vite usually uses `5173`, but may choose another available port.

## Environment variables

| Variable | Used by | Purpose |
|---|---|---|
| `DATABASE_URL` | API | PostgreSQL connection string |
| `PORT` | API | API listen port; defaults to `4000` |
| `WEB_ORIGIN` | API | Comma-separated allowed browser origins |
| `GROQ_API_KEY` | API only | Secret key for live AI calls |
| `GROQ_MODEL` | API | Groq model ID; defaults to `openai/gpt-oss-20b` |
| `VITE_API_URL` | Frontend build | Public base URL for the API; defaults to `http://localhost:4000` |

Never place secrets in variables prefixed with `VITE_`: Vite embeds those values in client-side assets. If a key has been committed or exposed, revoke and rotate it.

## Test and build

```powershell
npm test
npm run build
npm run lint
```

The root `npm test` runs the API Vitest suite. `npm run build` builds the API and frontend. `npm run lint` runs the frontend ESLint checks. CI currently runs API tests and production builds; it does not run live-model evaluations or provision a fresh PostgreSQL service.

See:
- [AI evaluation scenarios](docs/AI_EVALUATIONS.md)
- [AI-assisted development log](AI_LOG.md)
- [GitHub Actions](https://github.com/Sanjayram3269/tglobal-gold-loan-portal/actions)

## Deployment notes

The frontend can be deployed to Vercel, but **Vercel hosting the frontend alone does not deploy this Express API or PostgreSQL database**. For a working public demo:

1. Deploy the API to a Node-compatible host and provision a hosted PostgreSQL database.
2. Configure the API's server-side `DATABASE_URL`, `GROQ_API_KEY`, `GROQ_MODEL`, `PORT`, and `WEB_ORIGIN` environment variables.
3. Run Prisma migrations and seed the schemes against the hosted database.
4. In Vercel, set `VITE_API_URL` to the deployed API's public base URL and redeploy the frontend so the URL is embedded in the build.
5. Set `WEB_ORIGIN` to the exact deployed frontend origin (including the production Vercel domain). Confirm CORS, health checks, scheme loading, quotes, assistant chat, confirmation, and application listing against the deployed services.

Do not publish a working demo with real borrower information: the applications view has no authentication, there is no rate limiting, and assistant confirmation tokens are held in process memory for ten minutes. The in-memory token approach is not durable across restarts or multiple API instances.

## Bonus scope

The assignment lists optional hardening, agent, AI-extra, and operations bonuses. The current implementation includes concurrency-safe duplicate checks and a GitHub Actions workflow. The following items are **not claimed as complete** unless implemented and tested in a later commit:

- Idempotency-Key replay and conflict handling.
- Lead status workflow with an audit log.
- Cached gold-rate endpoint.
- Fourth `check_existing_application` tool.
- Automated live-model evaluation runner / ten-plus evaluations.
- Appraisal-slip image extraction or natural-language admin filtering.
- API rate limiting.
- Full Docker Compose deployment and a two-minute demo video.
- Admin authentication and role-based authorization.

## Known limitations

- Fixed mock gold rate; no live market feed or valuation of jewellery authenticity.
- No real loan approval, identity verification, collateral verification, credit assessment, or repayment-schedule calculation.
- Admin list endpoint is unauthenticated and must not be used with real personal data.
- AI confirmation tokens are in-memory and expire after ten minutes.
- Live-model scenarios need to be run and their observed outcomes recorded.
- The last recorded dependency installation reported five high-severity npm audit findings. Review current advisories and apply compatible fixes before any production use.

## Repository structure

```text
.
├── .github/workflows/ci.yml
├── apps/
│   ├── api/
│   │   ├── prisma/              # Schema, migrations, seed
│   │   ├── src/domain/          # Financial calculator
│   │   ├── src/services/        # AI tools and confirmation flow
│   │   └── tests/               # Calculator, assistant and HTTP tests
│   └── web/src/                 # React portal and assistant widget
├── docs/AI_EVALUATIONS.md
├── AI_LOG.md
├── .env.example
├── package.json
└── README.md
```

## Final hand-in checklist

- [x] Core API, calculation, persistence, borrower flow, assistant, and demo applications view implemented.
- [x] Calculator, assistant-confirmation, and HTTP tests included.
- [x] Environment template and AI log committed.
- [x] CI workflow configured.
- [x] Developer reports local end-to-end testing completed.
- [ ] Record actual results for all five required AI conversation evaluations.
- [ ] Check the latest CI run on the final commit.
- [ ] Review current npm audit findings.
- [ ] If deploying, test the deployed frontend and backend together with production environment variables.
