# Contract Lens

**Understand the change before you ship it.** A browser-local OpenAPI 3.0 compatibility workbench, started November 13, 2026 for GenHacks. It compares old and new contracts, traces affected operations, finds checked counterexamples in a supported schema subset, and exports migration notes.

## Why this exists

A textual diff tells you that an enum changed. It does not explain why widening a *request* enum usually helps callers while widening a *response* enum can surprise them. Contract Lens makes that direction visible, along with the limits of its analysis.

- Requests: values accepted by the old contract should still be accepted by the new contract (`old ⊆ new`).
- Responses: values allowed by the new contract should stay within the old contract's guarantees (`new ⊆ old`).
- A local reference shared by two operations is checked in both contexts. The impact map shows the affected operation, not just the changed component.
- Witnesses are checked against both supported schemas. They are **not** live API tests or proof of completeness.

## Run

Node 20+ and Python 3 are sufficient for engine/build/serving. Browser tests also need Playwright Chromium.

```sh
npm ci
npm test
npm run build
npm run serve
# Open http://localhost:8080
```

The committed `app.bundle.js` is ready to serve, so end users do not need Node. It bundles the YAML parser; the app has no CDN, telemetry, backend, credentials or API-key dependency. The app works without outside network access after its local static files are loaded. It is not an installable PWA and does not promise offline reload on a hosted site.

```sh
npx playwright install chromium
npm run test:ui
node ui-review.test.js
```

UI tests start their own temporary local server and stop it on completion. They cover all three fixtures, operation filtering, editing and validating a witness, JSON export, invalid input, scope dialog, 390px and 320px overflow checks, console errors and external network requests. Screenshots and the test export are written under `/downloads` in the build environment; change those paths for a different machine.

## Walkthrough

1. Start with the breaking Dispatch API example. Baseline 1.4.0 has three operations. Candidate 2.0.0 adds a required warehouse, lowers the maximum order quantity, expands a response enum, and removes health.
2. Click **Analyze release** after editing or importing files. Reports are invalidated when an input changes so stale exports cannot be mistaken for fresh analysis.
3. The fixture yields four findings: one grouped request-schema impact, two response-schema impacts from a shared component, and one removed operation. Three have checked payload witnesses.
4. Select `POST /orders` in the impact map. Expand **Test or edit this payload**. Run the validator to see source acceptance and target rejection.
5. Inspect the resolved schemas. Request source is old and target is new. Response source is new and target is old.
6. Switch to the additive release: wider accepted request bounds and one new endpoint. No findings in the checked subset, not a compatibility certificate.
7. Switch to needs-review: patterns and composed schemas produce explicit review entries rather than a safe verdict.
8. Export JSON for processing or Markdown migration notes for a pull request. Reports can contain your schemas and payloads; review them before sharing.

## Release review workflow

After analysis, each finding and each manual-review item can get a decision: `accepted-risk`, `will-migrate` or `false-positive`, plus a note. A release gate summarizes the result under a policy you choose (block on breaking changes, on breaking plus potential risks, or on everything including manual review).

- A blocking item counts as decided only when it has a status **and** a non-empty note. The gate is OPEN until all of them do.
- A decision is a human note. `accepted-risk` and `will-migrate` are waivers or plans, not evidence that a migration happened or that the API is compatible. The gate says "PASS (acknowledged, not fixed)", never "compatible".
- **Save review session** downloads a JSON file with decisions only. Specs are not included, but it carries a SHA-256 fingerprint of the exact parsed baseline and candidate pair. **Load review session** restores the decisions only if the analyzed pair has the same fingerprint. A session from a different pair, or without a fingerprint, is rejected whole, so waivers never transfer between releases that happen to produce similarly worded findings. Editing either spec and re-analyzing clears decisions made for the old pair.
- Nothing is stored in the browser between visits. Reload clears decisions unless you saved a file.
- The Markdown migration report includes decisions and gate state.

### CLI for CI

```sh
node cli.js baseline.yaml candidate.yaml --fail-on breaking --decisions session.json --format text
```

If the session file was saved for a different baseline/candidate pair, has no fingerprint, or has decisions that match no finding, the CLI exits 2 instead of carrying them over. Exit code 0 means every blocking item is acknowledged (not fixed), 1 means it is open, 2 means an input or session-file error. `--format` is `text`, `json` or `md`. It uses the same engine as the browser, so the same supported-subset limits apply.

## Supported checks

- Exact path + HTTP method matching, existing operation removal, additive operation list.
- Inherited path parameters with operation overrides; new required parameters; optional-to-required changes; changed serialization settings sent to manual review.
- Required request bodies and request media type removal.
- Local JSON Pointer `$ref` resolution, including `~1` and `~0`, with cycle/depth boundaries.
- Typed scalar/object/array schemas: enum, nullable, required properties, additional-property closure/schema, nested properties, array items, inclusive/exclusive numeric bounds, string length and array item bounds.
- Response schemas checked in the reverse direction. New statuses and new response media are potential risks, not automatic proof of breakage.
- Deterministic, bounded candidate generation with a validator-gated witness classification.

## Honest limits

This is a focused prototype, not an OpenAPI validator, full JSON Schema solver or replacement for contract/integration tests. No-findings is not proof of compatibility. Unsupported features are reported when encountered in compared schema locations; the whole OpenAPI document is not exhaustively linted.

- OpenAPI 3.0.x only, not 2.0/3.1. Exact path matching, no rename inference.
- External refs are never fetched. Recursive refs and `$ref` siblings need review.
- `allOf`, `oneOf`, `anyOf`, `not`, formats, regex patterns, unknown schema keywords and readOnly/writeOnly projections require review.
- Authentication, authorization, parameter serialization semantics, response headers, actual status frequencies, server behavior, business rules and performance are not modeled.
- Removed statuses, missing response bodies, deleted parameters and some content/header changes are not exhaustive checks. Server defaults and consumer-specific tolerance can change real-world outcomes.
- Bounded witnesses can miss a counterexample. Candidate search caps lengths, array sizes, depth and candidate count; it is not a minimality guarantee.
- Related schema changes in the same location are grouped, so a verified witness may demonstrate one reason rather than all reasons listed.
- Malformed schemas are not fully validated. Use a dedicated OpenAPI linter first.
- 1 MiB per input, 20,000 parsed nodes, depth 40, reference chain 24, schema expansion depth 24. YAML aliases and prototype-sensitive keys are rejected. Limits reduce risk, not a security audit. Do not use hostile untrusted specs in a sensitive browser context.

## Architecture

`engine.js` owns parsing, local refs, supported-schema validation, directional comparison and Markdown generation. It has no DOM dependency. `fixtures.js` holds synthetic specs. `review.js` owns decisions, the release gate and session files (no DOM). `cli.js` is the command-line entry. `app.js` owns UI state, text-only DOM rendering, file import, filters, witness interaction and downloads. `style.css` is responsive custom styling. `index.html` contains the static structure and scope dialog. `app.bundle.js` is generated by esbuild and includes the YAML parser. `engine.test.js` is the reproducible Node test suite; `ui.test.js` is the browser acceptance suite.

Analysis stays in tab memory. Reload clears edits. Nothing is stored in localStorage, IndexedDB or cookies by the application. The hosting provider still sees normal static asset requests. DOM output uses `textContent`, not raw spec HTML insertion. No specs are uploaded, but exports intentionally contain schema/payload evidence.

## Build and tool disclosure

Built with AI assistance for design, code generation, debugging, automated testing and demo production, under M J Anthony's direction. The implementation and automated checks were AI-assisted; this is not a claim that the entrant personally hand-wrote or manually tested every part.

Tools/libraries: JavaScript, HTML, CSS, YAML package (ISC), esbuild (MIT, build tool), Node.js test runner, Playwright (Apache-2.0, browser testing/recording), Python (document/media tooling), FFmpeg (video assembly) and AI-generated narration/captions. There is no runtime LLM or paid service. Synthetic sample data, no real customer data. See `THIRD_PARTY_LICENSES.txt` and `package-lock.json` for dependency details.

## Next steps, not implemented claims

A stronger version could add independent JSON Schema validation, semantic OpenAPI linting, full reference provenance, readOnly/writeOnly projections, composed schemas with a real solver, consumer contract import, and a packaged CI action. (A basic CLI exists; see above.) Those are future work, not features hidden behind the current UI.

MIT licensed. No promise of winning or of production readiness.
