# AI-assisted development log

This log records representative prompts, a concrete generated-code issue and its correction, and verification evidence for the TGlobal Gold Loan Portal take-home.

## Tools used

- ChatGPT for architecture review, debugging, test design, documentation, and implementation suggestions.
- Groq-hosted openai/gpt-oss-20b through the OpenAI-compatible API for the in-product loan assistant.
- GitHub and GitHub Actions for version control and CI.

## Prompt used for validation

> Implement strict server-side validation for the gold-loan application API. Validate applicant name, Indian mobile number, net and gross gold weights, supported karat values, and loan scheme ID. Reject net weight greater than gross weight. Return structured field-level validation errors, and recalculate the eligible loan on the server rather than trusting client-supplied amounts.

## Prompt used for agent tools

> Build a tool-using gold-loan assistant with tools to retrieve current loan schemes, calculate a quote through the backend calculator, and prepare an application for review. The model must not perform financial arithmetic itself. Preparing an application must not create a database record; require a separate explicit confirmation before submission, and enforce duplicate protection on the server.

## Concrete generated-code issue found and corrected

An initial assistant-confirmation test assumed the preparation result exposed a token property and that duplicate results used existingLeadId. The implementation actually returns confirmationToken and existingApplicationId. As a result, the test suite reported failures before the confirmation logic was reached.

The test was corrected to use the actual service contract. Regression tests cover token preparation without writes, declined confirmation, successful explicit confirmation, token replay, duplicate detection, unknown schemes, and invalid weights. A later natural-language eligibility regression also exposed that “What documents are required?” was not classified as an eligibility question. The pattern was corrected and a regression test now covers that phrasing.

## Verification evidence

- Calculator tests cover the reference Monthly EMI, Bullet Repayment, 18K calculations and invalid weight boundaries.
- Assistant-confirmation tests cover the explicit-confirmation side-effect boundary, declined confirmation, token replay, duplicate detection, unknown schemes and invalid weights.
- HTTP tests cover health, seeded schemes, pure quote calculation, invalid weights, unknown schemes, lead creation, duplicate conflict, masked/newest-first lead listing, assistant payload validation, and sanitized not-found responses.
- **Latest local verification (2026-10-10):** npm ci completed; npm test passed **36/36 tests across four test files**; npm run build passed for both API TypeScript and frontend TypeScript/Vite production build.
- **GitHub Actions:** [Run #34](https://github.com/Sanjayram3269/tglobal-gold-loan-portal/actions/runs/38037015978) succeeded for commit a31e7f27d49a14c018e26ab1aa0660edfc334962.
- Manual live assistant observations for the five required conversation scenarios and four bonus checks are recorded in [docs/AI_EVALUATIONS.md](docs/AI_EVALUATIONS.md). These are not automated live-model tests and are not run by CI.

## Limitations and follow-up

- The Groq-backed conversation requires a valid server-side GROQ_API_KEY; tests/build do not require a live model key.
- The latest dependency installation reported five high-severity npm audit findings. The affected dependency paths have not been fully investigated. Do not apply a forced breaking upgrade as a shortcut; review advisories and test compatible upgrades separately.
- Confirmation tokens are held in process memory, expire after ten minutes, and are lost on API restart; they are not durable across multiple API instances.
- The demo applications view and leads endpoint are not protected by authentication/authorization. Do not use with real applicant data until access controls, rate limiting, and privacy controls are implemented.
- The gold price is a mock reference rate, not a live market feed. The quote endpoint does not calculate repayment schedules.
- Prompt-injection, Hinglish, change-mind, and repeated-confirmation conversation checks were performed manually; they are not part of the automated live-model CI suite.
- Optional items not implemented include Idempotency-Key support, a durable lead status workflow/audit log, cached rate endpoint, fourth existing-application tool, streaming/tool-status UI, image extraction, rate limiting, admin authentication, and a demo video.
