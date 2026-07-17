import { neon } from "@neondatabase/serverless";

let schemaReady;

const PRODUCT_FIELDS = [
  "goldCircles",
  "silverCircles",
  "mamaNecklaces",
  "armyTags",
  "eyeTags",
  "bracelets"
];

function getDatabase() {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL nije postavljen.");
  }

  return neon(process.env.DATABASE_URL);
}

async function ensureSchema(sql) {
  if (!schemaReady) {
    schemaReady = Promise.all([
      sql`
        CREATE TABLE IF NOT EXISTS starlight_settings (
          id SMALLINT PRIMARY KEY CHECK (id = 1),
          opening_balance NUMERIC(14, 2) NOT NULL DEFAULT 0,
          stock JSONB NOT NULL DEFAULT '{}'::jsonb,
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `,
      sql`
        CREATE TABLE IF NOT EXISTS starlight_entries (
          id TEXT PRIMARY KEY,
          entry_date DATE NOT NULL,
          kind TEXT NOT NULL CHECK (kind IN ('daily', 'quick', 'debt')),
          created_at BIGINT NOT NULL,
          payload JSONB NOT NULL,
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `
    ]).then(() => sql`
      ALTER TABLE starlight_settings
      ADD COLUMN IF NOT EXISTS stock JSONB NOT NULL DEFAULT '{}'::jsonb
    `).then(() => sql`
      DO $$
      BEGIN
        IF EXISTS (
          SELECT 1
          FROM pg_constraint
          WHERE conrelid = 'starlight_entries'::regclass
            AND conname = 'starlight_entries_kind_check'
            AND pg_get_constraintdef(oid) NOT LIKE '%debt%'
        ) THEN
          ALTER TABLE starlight_entries DROP CONSTRAINT starlight_entries_kind_check;
        END IF;

        IF NOT EXISTS (
          SELECT 1
          FROM pg_constraint
          WHERE conrelid = 'starlight_entries'::regclass
            AND conname = 'starlight_entries_kind_check'
        ) THEN
          ALTER TABLE starlight_entries
          ADD CONSTRAINT starlight_entries_kind_check CHECK (kind IN ('daily', 'quick', 'debt'));
        END IF;
      END $$;
    `).then(() => sql`
      INSERT INTO starlight_settings (id, opening_balance, stock)
      VALUES (1, 0, '{}'::jsonb)
      ON CONFLICT (id) DO NOTHING
    `).catch((error) => {
      schemaReady = undefined;
      throw error;
    });
  }

  await schemaReady;
}

function normalizeEntry(entry) {
  if (!entry || typeof entry !== "object") {
    throw new Error("Neispravan unos.");
  }

  const allowedKinds = ["daily", "quick", "debt"];
  const kind = allowedKinds.includes(entry.kind) ? entry.kind : "daily";
  const date = String(entry.date || "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new Error("Datum nije ispravan.");
  }

  return {
    ...entry,
    id: String(entry.id || crypto.randomUUID()),
    kind,
    date,
    createdAt: Number(entry.createdAt) || Date.now()
  };
}

function normalizeStock(stock = {}) {
  return PRODUCT_FIELDS.reduce((normalized, field) => {
    normalized[field] = Math.max(0, Number(stock[field]) || 0);
    return normalized;
  }, {});
}

function soldItems(entry = {}) {
  if (entry.kind !== "daily") {
    return normalizeStock();
  }

  return PRODUCT_FIELDS.reduce((items, field) => {
    items[field] = Math.max(0, Number(entry[field]) || 0);
    return items;
  }, {});
}

function adjustStock(stock, previousEntry, nextEntry) {
  const current = normalizeStock(stock);
  const previousSold = soldItems(previousEntry);
  const nextSold = soldItems(nextEntry);

  return PRODUCT_FIELDS.reduce((adjusted, field) => {
    adjusted[field] = Math.max(0, current[field] + previousSold[field] - nextSold[field]);
    return adjusted;
  }, {});
}

async function readState(sql) {
  const [settings, entries] = await Promise.all([
    sql`SELECT opening_balance, stock FROM starlight_settings WHERE id = 1`,
    sql`
      SELECT payload
      FROM starlight_entries
      ORDER BY entry_date ASC, created_at ASC
    `
  ]);

  return {
    openingBalance: Number(settings[0]?.opening_balance || 0),
    stock: normalizeStock(settings[0]?.stock || {}),
    entries: entries.map((row) => row.payload)
  };
}

export default async function handler(request, response) {
  response.setHeader("Cache-Control", "no-store");

  try {
    const sql = getDatabase();
    await ensureSchema(sql);

    if (request.method === "GET") {
      return response.status(200).json(await readState(sql));
    }

    if (request.method !== "POST") {
      response.setHeader("Allow", "GET, POST");
      return response.status(405).json({ error: "Metoda nije dozvoljena." });
    }

    const body = request.body || {};

    if (body.action === "setOpeningBalance") {
      const openingBalance = Number(body.openingBalance);
      if (!Number.isFinite(openingBalance)) {
        return response.status(400).json({ error: "Početno stanje nije ispravno." });
      }

      await sql`
        UPDATE starlight_settings
        SET opening_balance = ${openingBalance}, updated_at = NOW()
        WHERE id = 1
      `;
    } else if (body.action === "setStock") {
      const stock = normalizeStock(body.stock);
      await sql`
        UPDATE starlight_settings
        SET stock = ${JSON.stringify(stock)}::jsonb, updated_at = NOW()
        WHERE id = 1
      `;
    } else if (body.action === "saveEntry") {
      const entry = normalizeEntry(body.entry);
      const [settings, existing] = await Promise.all([
        sql`SELECT stock FROM starlight_settings WHERE id = 1`,
        sql`SELECT payload FROM starlight_entries WHERE id = ${entry.id}`
      ]);
      const nextStock = adjustStock(settings[0]?.stock || {}, existing[0]?.payload, entry);

      await sql`
        INSERT INTO starlight_entries (id, entry_date, kind, created_at, payload)
        VALUES (${entry.id}, ${entry.date}, ${entry.kind}, ${entry.createdAt}, ${JSON.stringify(entry)}::jsonb)
        ON CONFLICT (id) DO UPDATE SET
          entry_date = EXCLUDED.entry_date,
          kind = EXCLUDED.kind,
          payload = EXCLUDED.payload,
          updated_at = NOW()
      `;
      await sql`
        UPDATE starlight_settings
        SET stock = ${JSON.stringify(nextStock)}::jsonb, updated_at = NOW()
        WHERE id = 1
      `;
    } else if (body.action === "deleteEntry") {
      const id = String(body.id || "");
      if (!id) {
        return response.status(400).json({ error: "Nedostaje ID unosa." });
      }
      const [settings, existing] = await Promise.all([
        sql`SELECT stock FROM starlight_settings WHERE id = 1`,
        sql`SELECT payload FROM starlight_entries WHERE id = ${id}`
      ]);
      if (existing[0]?.payload) {
        const nextStock = adjustStock(settings[0]?.stock || {}, existing[0].payload, undefined);
        await sql`
          UPDATE starlight_settings
          SET stock = ${JSON.stringify(nextStock)}::jsonb, updated_at = NOW()
          WHERE id = 1
        `;
      }
      await sql`DELETE FROM starlight_entries WHERE id = ${id}`;
    } else {
      return response.status(400).json({ error: "Nepoznata akcija." });
    }

    return response.status(200).json(await readState(sql));
  } catch (error) {
    console.error("STAR LIGHT API error:", error);
    return response.status(500).json({
      error: "Baza trenutno nije dostupna. Pokušajte ponovo."
    });
  }
}
