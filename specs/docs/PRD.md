# PRD — Cikka Seller Dashboard (v1)

## Problem

Sellers on the Cikka marketplace (D2C cosmetics/personal-care sellers, based on the
reference design) need a single screen to answer: *How much am I owed, what do I need to
pack today, and what's about to go out of stock?*

## Users

- **Primary:** a seller's operations person, checking the dashboard daily, mobile-first
  habits but using desktop during work hours.
- **Out of scope for v1:** platform admins, multi-user seller accounts (one login per
  seller business for now).

## v1 Scope

1. **Login** with platform-issued `loginId` + password (no self-signup).
2. **Dashboard Overview** showing:
   - Settlement cycle banner (e.g. "T+7 Active", next payout date).
   - Four stat cards: Net Payout (Pending), Gross Sales (This Week, with WoW % change),
     Active Orders (To Pack), Low Stock SKUs (flagged "Action Needed" if > 0).
   - Settlement Breakdown for a selectable period (This Week / This Month): gross sales →
     minus commission → minus shipping & GST → net payable to bank, shown as a stacked bar
     plus a line-item list.
   - Inventory Alerts: lowest-stock products, SKU, units left.
   - Recent Orders: tabs for All / Pending / Returns.
3. **Acceptance criteria:**
   - Every number on the dashboard is scoped to the logged-in seller only.
   - Settlement breakdown period selector re-fetches and re-renders without a full page
     reload.
   - Low stock threshold is configurable per product (not a hardcoded global number).

## Explicitly out of scope for v1

- Editing settlement records from the UI (read-only; they're written by a payout job).
- Multi-currency. Single currency (₹) assumed throughout.
- Notifications/email digests.
- Admin-side seller management UI (CLI script is enough for v1).

## Open questions

- Is "This Week" Mon–Sun or a rolling 7 days? (Currently implemented as Mon–Sun in
  `dashboard.service.js` — revisit if the business defines it differently.)
- Does commission rate vary per product category, or is it a flat seller-level rate?
  (Currently modeled per-`Settlement` row so it *can* vary — confirm with finance.)
