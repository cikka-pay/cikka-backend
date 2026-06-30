# Spec 001 — Seller Dashboard Overview

## Goal

Implement the dashboard overview screen matching the reference design: settlement banner,
4 stat cards, settlement breakdown, inventory alerts, recent orders.

## Data needed (all scoped to `req.seller.id`)

| Widget | Source | Notes |
|---|---|---|
| Settlement cycle banner | Static config for v1 (`T+7`) + next `Settlement` row with `status=PENDING`, soonest `payoutDate` | Not a DB-backed "cycle" entity yet — hardcode the cycle type string, derive the date |
| Net Payout (Pending) | `SUM(Settlement.netPayable) WHERE status='PENDING' AND sellerId=:id` | |
| Gross Sales (This Week) | `SUM(Order.totalAmount) WHERE createdAt BETWEEN startOfWeek AND now` | Mon–Sun week, see open question in PRD |
| Gross Sales WoW % | Compare to same query for previous week | `((thisWeek - lastWeek) / lastWeek) * 100`, guard divide-by-zero |
| Active Orders (To Pack) | `COUNT(Order) WHERE status='PENDING'` | |
| Low Stock SKUs | `COUNT(Product) WHERE stockQty <= lowStockThreshold` | |
| Settlement Breakdown | `Settlement` rows within selected period, summed: grossSales, commissionAmount, shippingGstAmount, netPayable | Period selector: `week` \| `month`, default `week` |
| Inventory Alerts | `Product WHERE stockQty <= lowStockThreshold ORDER BY stockQty ASC LIMIT 5` | |
| Recent Orders | `Order` (tab=all/pending) or `Return` joined to `Order`+`Product` (tab=returns), `ORDER BY createdAt DESC LIMIT 10` | |

## Endpoints (implemented)

- `GET /api/dashboard/summary`
- `GET /api/dashboard/settlement-breakdown?period=week|month`
- `GET /api/inventory/alerts?limit=5`
- `GET /api/orders?status=all|pending|returns&limit=10`

## Acceptance criteria

- [ ] All four endpoints return only the authenticated seller's data.
- [ ] `settlement-breakdown` re-fetches when the period dropdown changes, no full reload.
- [ ] Empty states: zero pending settlements / zero low-stock items render a calm "nothing
      to see" state, not a blank card or a console error.
- [ ] Currency formatted as `₹` with thousands separators on the frontend, raw `Decimal`
      (as string) returned by the API — don't format currency server-side.
