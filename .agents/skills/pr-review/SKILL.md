---
name: PR Review (API Doc Sync)
description: Analyzes PR diffs (or specific git commits) for API changes in routes/controllers and automatically updates specs/api-contract.yaml and specs/API.md to match. Trigger when asked to "review PR" or "sync API docs".
---

# PR Review (API Doc Sync) Skill

You are responsible for keeping the API documentation in sync with code changes during PR reviews. 
When triggered, follow these exact steps:

## Step 1: Detect API Changes
Run a `git diff` against the main branch (e.g., `git diff main...HEAD -- src/routes/ src/controllers/`) to detect:
1. **New endpoints:** Added `router.get|post|patch|delete` lines in `src/routes/`.
2. **Deleted endpoints:** Removed route lines.
3. **Modified requests:** Changes to Zod schemas (e.g., `createProductSchema`) in `src/routes/`.
4. **Modified responses:** Changes to what is returned (e.g., `res.json(...)`) in `src/controllers/`.

## Step 2: Update `specs/api-contract.yaml`
For any detected change:
- Modify `specs/api-contract.yaml` to reflect the new state.
- Refer to `references/route-to-openapi-mapping.md` (read it via `view_file`) for how to translate Express/Zod syntax into OpenAPI YAML.
- Use `npx @redocly/cli lint specs/api-contract.yaml` to validate the YAML structure after your edits.

## Step 3: Update `specs/API.md`
Update the human-readable Markdown file to stay in sync with the OpenAPI spec. Ensure tables, HTTP methods, and required auth badges reflect the truth.

## Step 4: Run Pre-merge Checks (Optional, if requested)
If the user asks for a full PR review check, also run:
- `npm run build` (tsc compilation)
- `npx vitest run` (tests)
Report any failures.

## Step 5: Report
Produce a short summary of:
1. What API changes were found (e.g. "Detected new endpoint: POST /products").
2. What doc changes were made.
3. Any validation or build errors found.
