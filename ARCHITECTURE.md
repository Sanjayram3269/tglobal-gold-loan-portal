# Architecture

## Scope

This is a reviewer/demo implementation of a gold-loan intake workflow. It is not a production lending system and must not be used with real borrower information.

## Components

- **React + Vite (apps/web):** responsive borrower journey, live quote cards, review/submit flow, demo applications table, and AI chat widget.
- **Express + TypeScript (apps/api/src/app.ts):** REST endpoints, Zod request validation, consistent JSON errors, security headers, and configured CORS.
- **Financial domain (apps/api/src/domain/loan-calculator.ts):** deterministic quote calculations using Decimal.js and a fixed ₹7,000/g reference rate for 24K gold.
- **Assistant orchestrator (apps/api/src/services/groq-assistant.ts):** Groq-hosted OpenAI-compatible chat completion with three typed tools: get_loan_schemes, calculate_quote, and submit_application. The last tool only prepares a draft/token; it does not insert a lead.
- **Confirmation service (apps/api/src/services/assistant-confirmation.ts):** validates a draft, creates a ten-minute single-use confirmation token, and only creates the lead after explicit confirmation.
- **PostgreSQL + Prisma 7:** stores schemes and leads; migrations and a seed script are included.
- **GitHub Actions:** installs from the lockfile, runs API tests, and builds the API and frontend.

## Main request flows

### Guided application

1. The UI requests a quote from POST /api/v1/quotes as the user enters valid weights and purity.
2. The API validates the request and retrieves the requested scheme from PostgreSQL.
3. The domain calculator computes pure gold, gold value, and eligible loan. Quote requests do not create a lead.
4. The user enters contact details and reviews the estimate.
5. POST /api/v1/leads validates and recomputes the quote on the server before insertion.

### AI-assisted application

1. The browser sends chat text and bounded conversation history to POST /api/v1/assistant/chat.
2. The assistant can call the schemes tool, quote tool, or application-preparation tool. Financial values come from backend code, not model arithmetic.
3. Application preparation validates details and returns a masked review summary plus an opaque confirmation token. No lead is created at this stage.
4. The user must press the explicit confirmation action, which calls POST /api/v1/assistant/confirm.
5. The server consumes the token, reloads the scheme, recalculates the quote, acquires a PostgreSQL transaction-scoped advisory lock keyed by mobile, checks for a lead in the preceding seven days, and inserts only if no duplicate exists.

## Data and integrity

- Loan schemes hold the scheme name, annual interest rate, LTV cap, tenure and repayment type.
- Leads store applicant/contact details, weights, karat, selected scheme, server-calculated eligible amount, status and timestamps.
- The database schema uses a foreign key from lead to scheme and indexes lead mobile/creation time and creation time.
- Duplicate protection checks the seven-day window under a transaction-scoped advisory lock so concurrent requests for the same mobile serialize.
- Lead-list responses mask mobile numbers and order by newest first.
- The quote is indicative. It does not calculate an EMI schedule or determine actual lender eligibility.

## Error behavior

- Invalid input returns HTTP 400 with a stable error object and field-level details where available.
- Unknown scheme returns 404.
- A recent duplicate returns 409 with the existing application reference.
- Expired or consumed AI confirmation tokens return 410.
- Unexpected errors return a sanitized JSON 500 response without a stack trace in the response body.

## Deliberate demo limitations

- Confirmation tokens are held in process memory for ten minutes. They are single-use but are not durable, session-bound, or shared across API instances.
- The applications endpoint and admin UI have no authentication or authorization.
- No rate limiting, durable audit log, status-transition workflow, or Idempotency-Key replay support is implemented.
- The gold rate is a fixed mock value. No appraisal-slip image extraction, cached live-rate endpoint, or fourth check_existing_application tool is implemented.
- Live-model conversation evaluations are manual; CI runs deterministic API tests and builds only.
- Five high-severity dependency advisories were reported by npm at the latest local install and require separate investigation before production use.

## Verification

- Local tests: 36 passed across four Vitest files on 2026-10-10.
- Local production builds: API TypeScript build and frontend TypeScript/Vite build passed.
- GitHub Actions run #34 passed on commit a31e7f27d49a14c018e26ab1aa0660edfc334962.
- Manual conversation observations are listed in docs/AI_EVALUATIONS.md.
