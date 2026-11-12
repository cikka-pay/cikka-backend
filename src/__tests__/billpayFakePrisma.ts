/**
 * Minimal in-memory stand-in for the Prisma models the BillPay webhook/history code uses.
 * Only equality `where` clauses (incl. null) and `orderBy: { createdAt }` are supported.
 */

type Row = Record<string, any>;

function matches(row: Row, where: Row = {}): boolean {
  return Object.entries(where).every(([k, v]) => (v === null ? row[k] == null : row[k] === v));
}

function uniqueError(field: string) {
  return Object.assign(new Error(`Unique constraint failed on ${field}`), { code: "P2002" });
}

let seq = 0;
function nextId(prefix: string) {
  seq += 1;
  return `${prefix}-${seq}`;
}
let clock = Date.parse("2026-11-01T00:00:00Z");
function now() {
  clock += 1000;
  return new Date(clock);
}

function sortRows(rows: Row[], orderBy?: Row): Row[] {
  if (!orderBy?.createdAt) return rows;
  const dir = orderBy.createdAt === "desc" ? -1 : 1;
  return [...rows].sort((a, b) => (a.createdAt.getTime() - b.createdAt.getTime()) * dir);
}

export function createFakePrisma() {
  const db = {
    events: [] as Row[],
    txns: [] as Row[],
    users: [] as Row[],
    ledger: [] as Row[],
  };

  const prisma = {
    bbpsWebhookEvent: {
      async create({ data }: { data: Row }) {
        if (db.events.some((e) => e.dedupeKey === data.dedupeKey)) throw uniqueError("dedupeKey");
        const row = { id: nextId("evt"), receivedAt: now(), processedAt: null, error: null, ...data };
        db.events.push(row);
        return { ...row };
      },
      async findUnique({ where }: { where: Row }) {
        const r = db.events.find((e) => matches(e, where));
        return r ? { ...r } : null;
      },
      async update({ where, data }: { where: Row; data: Row }) {
        const r = db.events.find((e) => matches(e, where));
        if (!r) throw new Error("event not found");
        Object.assign(r, data);
        return { ...r };
      },
    },
    bbpsTransaction: {
      async findUnique({ where }: { where: Row }) {
        const r = db.txns.find((t) => matches(t, where));
        return r ? { ...r } : null;
      },
      async findFirst({ where, orderBy }: { where: Row; orderBy?: Row }) {
        const r = sortRows(db.txns.filter((t) => matches(t, where)), orderBy)[0];
        return r ? { ...r } : null;
      },
      async findMany({ where, orderBy, take }: { where: Row; orderBy?: Row; take?: number }) {
        return sortRows(db.txns.filter((t) => matches(t, where)), orderBy)
          .slice(0, take ?? Infinity)
          .map((r) => ({ ...r }));
      },
      async create({ data }: { data: Row }) {
        if (data.setuOrderId && db.txns.some((t) => t.setuOrderId === data.setuOrderId)) {
          throw uniqueError("setuOrderId");
        }
        const ts = now();
        const row: Row = {
          id: nextId("txn"),
          setuOrderId: null, bbpsTxnId: null, refId: null, sessionId: null, userId: null,
          mobileNumber: null, billerId: null, billerName: null, category: null,
          billAmount: null, amountPaid: null, status: "PENDING", paidOn: null,
          errorCode: null, errorMessage: null, disputeRefId: null, disputeStatus: null,
          rawPayload: null, createdAt: ts, updatedAt: ts,
          ...data,
        };
        db.txns.push(row);
        return { ...row };
      },
      async updateMany({ where, data }: { where: Row; data: Row }) {
        const rows = db.txns.filter((t) => matches(t, where));
        rows.forEach((r) => Object.assign(r, data, { updatedAt: now() }));
        return { count: rows.length };
      },
      async update({ where, data }: { where: Row; data: Row }) {
        const r = db.txns.find((t) => matches(t, where));
        if (!r) throw new Error("txn not found");
        Object.assign(r, data, { updatedAt: now() });
        return { ...r };
      },
    },
    user: {
      async findUnique({ where }: { where: Row }) {
        const r = db.users.find((u) => u.id === where.id);
        return r ? { id: r.id } : null;
      },
    },
    loyaltyLedger: {
      async findUnique({ where }: { where: Row }) {
        const r = db.ledger.find((l) => l.idempotencyKey === where.idempotencyKey);
        return r ? { ...r } : null;
      },
    },
  };

  function reset() {
    db.events.length = 0;
    db.txns.length = 0;
    db.users.length = 0;
    db.ledger.length = 0;
  }

  return { prisma, db, reset };
}

/** Shared instance: vi.mock factories and tests import the same one. */
export const fakePrisma = createFakePrisma();
