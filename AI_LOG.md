# AI-assisted development log

This log records representative prompts, a concrete correction, and the checks used for this take-home project.

## Tools used

- ChatGPT for architecture review, debugging, test design, documentation, and implementation suggestions.
- Groq-hosted `openai/gpt-oss-20b` through the OpenAI-compatible API for the in-product loan assistant.
- GitHub for version control and automated CI.

## Prompt used for validation

> Implement strict server-side validation for the gold-loan application API. Validate applicant name, Indian mobile number, net and gross gold weights, supported karat values, and loan scheme ID. Reject net weight greater than gross weight. Return structured field-level validation errors, and recalculate the eligible loan on the server rather than trusting client-supplied amounts.

## Prompt used for agent tools

> Build a tool-using gold-loan assistant with tools to retrieve current loan schemes, calculate a quote through the backend calculator, and prepare an application for review. The model must not perform financial arithmetic itself. Preparing an application must not create a database record; require a separate explicit confirmation before submission, and enforce duplicate protection on the server.

## Concrete generated-code issue found and corrected

An initial assistant-confirmation test assumed the preparation result exposed a `token` property and that duplicate results used `existingLeadId`. The implementation actually returns `confirmationToken` and `existingApplicationId`. As a result, the test suite reported failures before the confirmation logic was reached.

The test was corrected to use the actual service contract. Regression tests now cover token preparation without writes, declined confirmation, successful explicit confirmation, token replay, duplicate detection, unknown schemes, and invalid weights.

## Verification evidence

- Loan-calculator unit tests cover the reference EMI, bullet, and 18K calculations and invalid weight boundaries.
- Assistant-confirmation unit tests use mocked persistence to verify the confirmation side-effect boundary.
- The developer reported 15/15 unit tests passing and successful API/frontend production builds before the latest admin-dashboard and formatting changes.
- GitHub Actions runs the API tests and production build on pushes and pull requests. Run #17 passed on commit `106767e`: 25 tests passed across three Vitest files, followed by successful API and frontend production builds.

## Limitations

- The Groq-backed conversation still requires a valid server-side `GROQ_API_KEY`.
- `npm ci` reported five high-severity dependency advisories. Their affected packages and fixes have not yet been individually audited; review the audit report before production deployment.
- Confirmation tokens are stored in process memory, expire after ten minutes, and are lost on API restart; they are not session-bound or durable across multiple API instances.
- The demo admin view and leads endpoint are not protected by authentication/authorization. Do not deploy with real applicant data until access control, rate limiting, and privacy controls are implemented.
- The gold price is a mock reference rate, not a live market feed. Repayment schedules are not calculated by the quote endpoint.
- Model-dependent prompt-injection and multilingual evaluations are not part of the current automated test suite.
