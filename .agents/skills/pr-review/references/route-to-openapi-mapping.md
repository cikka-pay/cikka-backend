# Express/Zod to OpenAPI Mapping Guide

When updating `specs/api-contract.yaml` based on code changes, follow these mapping rules:

## 1. Routes to Paths
Express routes use colon syntax for path parameters. OpenAPI uses curly braces.
- **Express**: `router.get("/:id/variants/:variantId")`
- **OpenAPI**: `/products/{id}/variants/{variantId}` (assuming mounted at `/products`)

You MUST define each parameter under the operation:
```yaml
parameters:
  - in: path
    name: id
    required: true
    schema:
      type: string
```

## 2. Zod to OpenAPI Schemas
Zod schemas translate directly to OpenAPI 3.1 properties:
- `z.string()` -> `type: string`
- `z.number()` -> `type: number`
- `z.number().int()` -> `type: integer`
- `z.boolean()` -> `type: boolean`
- `z.enum(["A", "B"])` -> `type: string, enum: [A, B]`
- `z.array(z.string())` -> `type: array, items: { type: string }`

If a Zod field is NOT `.optional()`, it MUST be listed in the `required: [...]` array of the schema object.

## 3. Auth
If an Express route uses the `requireAuth` middleware (either on the specific route or globally on the router via `router.use(requireAuth)`), it must have `security: - BearerAuth: []` in OpenAPI (or implicitly inherit it from the root). 
If a route is public, explicitly disable security:
```yaml
security: []
```
