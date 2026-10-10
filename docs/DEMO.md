# Two-minute demo script

This script is a ready-to-follow narration plus click/command sequence for a
two-minute demo of the TGlobal Gold Loan Portal. It uses synthetic demo
information only and does not expose real applicant data, secrets, or API keys.

If a valid video recording can be produced from this thread's browser/recording
tools, record from this script. If not, this script is the fallback deliverable
and the video still needs to be recorded separately.

## Final state to demonstrate

- Repository HEAD: 308978a
- Branch: main
- Tracked tree clean except `.freebuff/`.
- `git diff --check` clean.
- Local verification: 72/72 Vitest tests pass across six files; API TypeScript
  typecheck passes.
- Implemented this sprint: configurable rate limiting on POST /api/v1/leads
  and an optional Docker Compose stack with Dockerfiles and documentation.

## Narration and sequence

### 0:00–0:15 — Purpose and architecture
- Open the repository README or a browser tab showing the repo page.
- Say: this is a full-stack gold-loan intake demo with a React borrower portal,
  a validated Express API, PostgreSQL persistence, exact quote calculations,
  and a Groq-powered assistant that calls backend tools and requires explicit
  confirmation before an application is submitted.
- Point out the architecture doc and the API route list in the README.

### 0:15–0:40 — Guided gold details and backend-calculated quote
- In the borrower portal, enter net weight 45g, gross weight 50g, karat 22,
  and select the Monthly EMI plan.
- Show the indicative quote: 41.25g pure gold, ₹288,750 gold value, ₹216,562
  eligible loan.
- Say the quote is computed by the backend calculator using the configured mock
  rate of ₹7,000/g and the scheme rules, not by the browser.

### 0:40–1:00 — AI quote and explicit confirmation boundary
- Open the assistant widget and ask for a gold loan quote for the same details.
- Show that the assistant uses the backend tools and returns the same indicative
  estimate.
- Show that preparing the application does not create a lead; the review card
  and confirmation token appear, and a separate explicit confirmation action is
  required.

### 1:00–1:25 — Duplicate protection and admin status workflow
- Submit the application and show the application reference.
- Submit a second application for the same mobile number within seven days and
  show the duplicate-application response.
- Show PATCH /api/v1/leads/:id/status moving a lead from SUBMITTED to
  UNDER_REVIEW and mention the append-only audit history.

### 1:25–1:40 — Gold-rate endpoint and mock-rate label
- Open the gold-rate endpoint response or its API documentation.
- Point out the cached mock rate, the 5-minute TTL metadata, and that it is mock
  data, not a live market feed.

### 1:40–1:55 — Docker setup, rate limiting, tests, and CI
- Show the Compose file and Dockerfiles, or the Compose documentation.
- Say the stack is optional and uses an isolated PostgreSQL container with a
  healthcheck; no credentials are embedded.
- Show or mention POST /api/v1/leads rate limiting: configurable limits, HTTP 429
  JSON with Retry-After, scoped to lead creation, and not bypassing idempotency
  or duplicate protection.
- Mention `npm test`, `npm run build`, `npm run lint`, and the GitHub Actions CI
  workflow.

### 1:55–2:00 — Close
- Show the repository URL and the final HEAD.
- Summarize the key implementation points: backend-calculated quotes, explicit
  AI confirmation, duplicate protection, status workflow with audit history,
  cached mock gold rate, rate limiting, and the optional Docker Compose stack.

## Recording checklist

- [ ] Use synthetic demo information only.
- [ ] Do not show real applicant data, mobile numbers, API keys, or `.env` files.
- [ ] Do not show console output that contains secrets.
- [ ] Show the quote endpoint returning the same figures the guided form uses.
- [ ] Show the assistant preparing but not submitting the application.
- [ ] Show the duplicate-application response for the same mobile number.
- [ ] Show or mention the status workflow and audit history.
- [ ] Mention the mock gold rate and the 5-minute cache.
- [ ] Mention rate limiting and the Compose stack without exposing credentials.
- [ ] End on the repository URL and final HEAD.
- [ ] If recording, save the video to the workspace and note the file path here.

## If recording is not possible from this environment

Provide this script and the README/AI_LOG/AI_EVALUATIONS/DOCKER_COMPOSE sources
to whoever records the video. The script is designed to be followed directly.
