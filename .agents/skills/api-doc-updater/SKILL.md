---
name: api-doc-updater
description: Updates the specs/api-contract.yaml file whenever API routes or controllers change.
---

# API Doc Updater Skill

You are responsible for keeping `specs/api-contract.yaml` in sync with the Express backend implementation.

## Triggers
Run this skill whenever you modify files in `src/routes/` or `src/controllers/`, or when asked to "update the api docs".

## Instructions
1. Inspect the routes and controllers to identify new endpoints, deleted endpoints, or changes to request/response schemas.
2. Open `specs/api-contract.yaml`.
3. Ensure it follows OpenAPI 3.1.0 specifications.
4. Add or update the endpoints. For every endpoint, include:
   - Request body schemas (if applicable)
   - Response schemas
   - Query parameters
   - Path parameters
5. Save the updated `api-contract.yaml` file.
