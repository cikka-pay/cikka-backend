---
name: api-doc-updater
description: Updates the specs/api-contract.yaml file whenever API routes or controllers change.
---

# API Doc Updater Skill

Keeps `specs/api-contract.yaml` and `specs/API.md` in sync with the Express backend.

## When to Use

- You modified files in `src/routes/` or `src/controllers/`
- You were asked to "update the API docs"
- You are **not** doing a PR review (for PR reviews, use the `pr-review` skill instead, which also runs a git diff and produces an audit summary)

## Instructions

1. Inspect the changed routes and controllers to identify new, deleted, or modified endpoints.
2. Open `specs/api-contract.yaml` — it is a complete OpenAPI 3.1.0 document.
3. Make **targeted, surgical edits** to the affected `paths:` entries only. Do not rewrite the entire file.
4. For each changed endpoint, update:
   - Request body schema (sourced from Zod schemas in the route file)
   - Response schema (sourced from `res.json(...)` in the controller)
   - Query parameters
   - Path parameters
   - Auth (`security: [BearerAuth: []]`) — present only if `requireAuth` middleware is used
   - HTTP status codes
5. Apply the same changes to `specs/API.md` — the human-readable reference doc.
6. Use `references/route-to-openapi-mapping.md` in the `pr-review` skill for Zod → OpenAPI translation rules.

## Key Rules

- Money fields (`Decimal` in Prisma) → `type: number` in OpenAPI, never `type: string`
- Paginated responses use the shared `PaginationMeta` component schema
- All path params from Express `:id` syntax → OpenAPI `{id}` syntax with `in: path, required: true`
- Do not invent endpoints that don't exist in the source code
