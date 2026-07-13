import "dotenv/config";
import cors from "cors";
import express from "express";
import helmet from "helmet";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createToken, hashPassword, makeSalt, requireAdminAuth, requireAgentAuth, verifyPassword } from "./auth.js";
import { query, withTransaction } from "./db.js";
import { readWorkbookRows } from "./excel.js";
import { readGoogleSheetRows } from "./sheets.js";
import { brandName, digitsOnly, normalizeRecord, normalizeText } from "./normalize.js";
import { seedAgentAccounts } from "./seed-agents.js";

const app = express();
const port = Number(process.env.PORT || 4000);
const corsOrigins = (process.env.CORS_ORIGIN || "*").split(",").map((item) => item.trim());
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const autoSyncIntervalMs = Math.max(1, Number(process.env.AUTO_SYNC_INTERVAL_MINUTES || 5)) * 60 * 1000;
let autoSyncRunning = false;
let lastAutoSyncAt = 0;
const uploadSessions = new Map();

app.use(helmet());
const corsOptions = {
  origin: corsOrigins.includes("*") ? "*" : corsOrigins,
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization", "X-File-Name", "X-Upload-Id", "X-Chunk-Index", "X-Chunk-Total"],
  maxAge: 86400,
};
app.use(cors(corsOptions));
app.options("*", cors(corsOptions));
app.use(express.json({ limit: "250mb" }));

app.get("/health", (_req, res) => {
  res.json({ ok: true, service: "Back Tracking API" });
});

app.post("/api/auth/register", async (req, res, next) => {
  try {
    const username = String(req.body.username || "").trim().toLowerCase();
    const password = String(req.body.password || "");
    if (!/^[a-z0-9._-]{3,40}$/.test(username)) {
      return res.status(400).json({ error: "Username must be 3-40 characters: letters, numbers, dot, dash, or underscore only." });
    }
    if (password.length < 6) return res.status(400).json({ error: "Password must be at least 6 characters." });

    const salt = makeSalt();
    const passwordHash = hashPassword(password, salt);
    const result = await query(
      `insert into agent_accounts (username, password_hash, salt, role, active)
       values ($1, $2, $3, 'agent', false)
       returning id, username, role, active, created_at`,
      [username, passwordHash, salt]
    );
    res.status(201).json({ user: result.rows[0] });
  } catch (error) {
    if (error.code === "23505") return res.status(409).json({ error: "Username already exists." });
    next(error);
  }
});

app.post("/api/auth/login", async (req, res, next) => {
  try {
    const username = String(req.body.username || "").trim().toLowerCase();
    const password = String(req.body.password || "");
    if (!username || !password) return res.status(400).json({ error: "Username and password are required." });

    const result = await query("select * from agent_accounts where username = $1", [username]);
    const user = result.rows[0];
    if (!user || !verifyPassword(password, user.salt, user.password_hash)) {
      return res.status(401).json({ error: "Invalid username or password." });
    }
    if (!user.active) {
      return res.status(403).json({ error: "Account is waiting for admin approval." });
    }

    await recordLoginEvent(req, user);

    res.json({
      token: createToken(user),
      user: { id: user.id, username: user.username, role: user.role },
    });
  } catch (error) {
    next(error);
  }
});

app.get("/api/agents", requireAdminAuth, async (_req, res, next) => {
  try {
    const result = await query(
      `select
        a.id,
        a.username,
        a.role,
        a.active,
        a.created_at,
        max(e.logged_in_at) last_login,
        count(e.id)::int login_count
       from agent_accounts a
       left join agent_login_events e on e.agent_id = a.id
       group by a.id
       order by a.role desc, a.username asc`
    );
    res.json({ agents: result.rows });
  } catch (error) {
    next(error);
  }
});

app.get("/api/login-activity", requireAdminAuth, async (_req, res, next) => {
  try {
    const result = await query(
      `select id, agent_id, username, role, ip_address, user_agent, logged_in_at
       from agent_login_events
       order by logged_in_at desc
       limit 100`
    );
    res.json({ events: result.rows });
  } catch (error) {
    next(error);
  }
});

app.patch("/api/agents/:id", requireAdminAuth, async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const active = Boolean(req.body.active);
    const result = await query(
      `update agent_accounts
       set active = $1, updated_at = now()
       where id = $2 and role = 'agent'
       returning id, username, role, active, created_at, updated_at`,
      [active, id]
    );
    if (!result.rows[0]) return res.status(404).json({ error: "Agent account not found." });
    res.json({ agent: result.rows[0] });
  } catch (error) {
    next(error);
  }
});

app.get("/api/sheets/:year", requireAdminAuth, async (req, res, next) => {
  try {
    const year = Number(req.params.year);
    const result = await query("select * from sheet_links where year = $1 order by month", [year]);
    res.json({ year, months: result.rows });
  } catch (error) {
    next(error);
  }
});

app.put("/api/sheets/:year/:month", requireAdminAuth, async (req, res, next) => {
  try {
    const year = Number(req.params.year);
    const month = Number(req.params.month);
    const url = String(req.body.url || "").trim();
    if (!url) return res.status(400).json({ error: "Google Sheet URL is required." });

    const result = await query(
      `insert into sheet_links (year, month, url, status, updated_at)
       values ($1, $2, $3, 'Saved', now())
       on conflict (year, month)
       do update set url = excluded.url, status = 'Saved', updated_at = now()
       returning *`,
      [year, month, url]
    );

    res.json(result.rows[0]);
  } catch (error) {
    next(error);
  }
});

app.delete("/api/sheets/:year/:month", requireAdminAuth, async (req, res, next) => {
  try {
    const year = Number(req.params.year);
    const month = Number(req.params.month);
    const sheetKey = makeSheetKey(year, month);
    await withTransaction(async (client) => {
      await client.query("delete from delivery_records where sheet_key = $1", [sheetKey]);
      await client.query("delete from sheet_links where year = $1 and month = $2", [year, month]);
    });
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

app.post("/api/sync/:year/:month", requireAdminAuth, async (req, res, next) => {
  try {
    const year = Number(req.params.year);
    const month = Number(req.params.month);
    const linkResult = await query("select * from sheet_links where year = $1 and month = $2", [year, month]);
    const link = linkResult.rows[0];
    if (!link?.url) return res.status(404).json({ error: "No Google Sheet link saved for this month." });

    const syncResult = await syncMonth(year, month, link.url);
    res.json(syncResult);
  } catch (error) {
    next(error);
  }
});

app.post("/api/sync/:year", requireAdminAuth, async (req, res, next) => {
  try {
    const year = Number(req.params.year);
    const links = await query("select * from sheet_links where year = $1 and url <> '' order by month", [year]);
    const results = [];
    for (const link of links.rows) {
      results.push(await syncMonth(year, link.month, link.url));
    }
    res.json({ year, results });
  } catch (error) {
    next(error);
  }
});

app.post("/api/import/:year/:month", requireAdminAuth, async (req, res, next) => {
  try {
    const year = Number(req.params.year);
    const month = Number(req.params.month);
    const filename = String(req.body.filename || `month-${month}.xlsx`).slice(0, 180);
    const contentBase64 = String(req.body.contentBase64 || "");
    if (!year || !month || month < 1 || month > 12) return res.status(400).json({ error: "Valid year and month are required." });
    if (!contentBase64) return res.status(400).json({ error: "Excel file is required." });

    const buffer = Buffer.from(contentBase64, "base64");
    const { sheetName, rows } = readWorkbookRows(buffer, filename);
    const result = await importRows(year, month, rows, { sheetName, filename });
    res.json(result);
  } catch (error) {
    next(error);
  }
});

app.post("/api/import-rows/:year/:month", requireAdminAuth, async (req, res, next) => {
  try {
    const year = Number(req.params.year);
    const month = Number(req.params.month);
    const rows = Array.isArray(req.body.rows) ? req.body.rows : [];
    const source = String(req.body.source || `browser-google:${year}-${month}`).slice(0, 400);
    const sheetName = String(req.body.sheetName || "Google Sheet").slice(0, 180);
    if (!year || !month || month < 1 || month > 12) return res.status(400).json({ error: "Valid year and month are required." });
    if (!rows.length) return res.status(400).json({ error: "No readable rows were received." });

    const result = await importRows(year, month, rows, {
      source,
      sheetName,
      status: "Synced",
      filename: sheetName,
    });
    res.json(result);
  } catch (error) {
    next(error);
  }
});

app.post("/api/import-file/:year/:month", requireAdminAuth, express.raw({ type: "application/octet-stream", limit: "250mb" }), async (req, res, next) => {
  try {
    const year = Number(req.params.year);
    const month = Number(req.params.month);
    const filename = decodeURIComponent(String(req.headers["x-file-name"] || `month-${month}.xlsx`)).slice(0, 180);
    if (!year || !month || month < 1 || month > 12) return res.status(400).json({ error: "Valid year and month are required." });
    if (!Buffer.isBuffer(req.body) || !req.body.length) return res.status(400).json({ error: "Excel file is required." });

    const { sheetName, rows } = readWorkbookRows(req.body, filename);
    const result = await importRows(year, month, rows, { sheetName, filename });
    res.json(result);
  } catch (error) {
    next(error);
  }
});

app.post("/api/import-chunk/:year/:month", requireAdminAuth, express.raw({ type: "application/octet-stream", limit: "12mb" }), async (req, res, next) => {
  try {
    const year = Number(req.params.year);
    const month = Number(req.params.month);
    const uploadId = String(req.headers["x-upload-id"] || "");
    const filename = decodeURIComponent(String(req.headers["x-file-name"] || `month-${month}.xlsx`)).slice(0, 180);
    const chunkIndex = Number(req.headers["x-chunk-index"]);
    const chunkTotal = Number(req.headers["x-chunk-total"]);
    if (!year || !month || month < 1 || month > 12) return res.status(400).json({ error: "Valid year and month are required." });
    if (!uploadId || !Number.isInteger(chunkIndex) || !Number.isInteger(chunkTotal) || chunkTotal < 1) {
      return res.status(400).json({ error: "Valid upload chunk headers are required." });
    }
    if (!Buffer.isBuffer(req.body) || !req.body.length) return res.status(400).json({ error: "Excel chunk is required." });

    const key = `${req.user.id}:${year}:${month}:${uploadId}`;
    const session = uploadSessions.get(key) || {
      filename,
      chunks: new Array(chunkTotal),
      chunkTotal,
      createdAt: Date.now(),
    };
    session.chunks[chunkIndex] = req.body;
    uploadSessions.set(key, session);

    const received = session.chunks.filter(Boolean).length;
    if (received < chunkTotal) return res.json({ received, complete: false });

    const buffer = Buffer.concat(session.chunks);
    uploadSessions.delete(key);
    cleanupUploadSessions();
    const { sheetName, rows } = readWorkbookRows(buffer, filename);
    const result = await importRows(year, month, rows, { sheetName, filename });
    res.json({ ...result, received, complete: true });
  } catch (error) {
    next(error);
  }
});

app.get("/api/search", requireAgentAuth, async (req, res, next) => {
  try {
    await autoSyncIfDue();
    const terms = searchTerms(String(req.query.q || ""));
    if (!terms.length) return res.json({ total: 0, summary: emptySummary(), rows: [] });
    const clauses = [];
    const params = [];
    terms.slice(0, 50).forEach((term) => {
      params.push(`%${term.text}%`);
      const textIndex = params.length;
      params.push(term.digits.length >= 2 ? `%${term.digits}%` : "");
      const digitIndex = params.length;
      clauses.push(`(search_text like $${textIndex} or ($${digitIndex} <> '' and search_digits like $${digitIndex}))`);
    });
    const where = clauses.join(" or ");

    const rows = await query(
      `select * from delivery_records
       where ${where}
       order by year desc, month desc, row_number asc
       limit 500`,
      params
    );

    const summaryResult = await query(
      `select
        count(*)::int total,
        count(*) filter (where normalized_status = 'delivered')::int delivered,
       count(*) filter (where normalized_status in ('return', 'for-return'))::int rts,
       coalesce(sum(amount), 0)::numeric amount
       from delivery_records
       where ${where}`,
      params
    );

    res.json({ rows: rows.rows, summary: makeSummary(summaryResult.rows[0]) });
  } catch (error) {
    next(error);
  }
});

app.get("/api/dashboard", requireAdminAuth, async (req, res, next) => {
  try {
    const year = Number(req.query.year || new Date().getFullYear());
    await autoSyncIfDue(year);
    const month = Number(req.query.month || 0);
    const status = String(req.query.status || "");
    const filters = ["year = $1"];
    const params = [year];
    if (month) {
      params.push(month);
      filters.push(`month = $${params.length}`);
    }
    if (status) {
      params.push(status);
      filters.push(`normalized_status = $${params.length}`);
    }
    const where = filters.join(" and ");
    const summary = await query(
      `select
        count(*)::int total,
        count(*) filter (where normalized_status = 'delivered')::int delivered,
        count(*) filter (where normalized_status in ('return', 'for-return'))::int rts,
        coalesce(sum(amount), 0)::numeric amount
       from delivery_records where ${where}`,
      params
    );
    const monthly = await query(
      `select month, count(*)::int total from delivery_records where year = $1 group by month order by month`,
      [year]
    );
    const statusCounts = await query(
      `select normalized_status status, count(*)::int total
       from delivery_records where ${where}
       group by normalized_status`,
      params
    );
    const recent = await query(
      `select * from delivery_records
       where ${where}
       order by order_date desc nulls last, synced_at desc, row_number desc
       limit 80`,
      params
    );
    res.json({
      year,
      summary: makeSummary(summary.rows[0]),
      monthly: monthly.rows,
      statusCounts: statusCounts.rows,
      recent: recent.rows,
      autoSync: { intervalMinutes: Math.round(autoSyncIntervalMs / 60000), lastAutoSyncAt },
    });
  } catch (error) {
    next(error);
  }
});

app.get("/api/products", requireAdminAuth, async (_req, res, next) => {
  try {
    await autoSyncIfDue();
    const result = await query("select remarks, normalized_status, amount from delivery_records");
    const map = new Map();
    for (const row of result.rows) {
      const key = brandName(row.remarks);
      if (!map.has(key)) map.set(key, { brandName: key, orders: 0, delivered: 0, returned: 0, totalAmount: 0 });
      const item = map.get(key);
      item.orders += 1;
      item.totalAmount += Number(row.amount) || 0;
      if (row.normalized_status === "delivered") item.delivered += 1;
      if (row.normalized_status === "return" || row.normalized_status === "for-return") item.returned += 1;
    }
    const products = [...map.values()].sort((a, b) => b.orders - a.orders).slice(0, 500);
    res.json({ total: products.length, products });
  } catch (error) {
    next(error);
  }
});

app.use((error, _req, res, _next) => {
  console.error(error);
  res.status(500).json({ error: error.message || "Server error" });
});

ensureRuntimeSchema()
  .then(() => {
    app.listen(port, () => {
      console.log(`Back Tracking API running on http://localhost:${port}`);
    });
  })
  .catch((error) => {
    console.error("Runtime schema check failed", error);
    process.exit(1);
  });

async function ensureRuntimeSchema() {
  const schema = await fs.readFile(path.resolve(__dirname, "../schema.sql"), "utf8");
  await query(schema);
  await seedAgentAccounts();
}

async function recordLoginEvent(req, user) {
  await query(
    `insert into agent_login_events (agent_id, username, role, ip_address, user_agent)
     values ($1, $2, $3, $4, $5)`,
    [
      user.id,
      user.username,
      user.role,
      String(req.headers["x-forwarded-for"] || req.socket.remoteAddress || "").split(",")[0].trim(),
      String(req.headers["user-agent"] || "").slice(0, 300),
    ]
  );
}

function cleanupUploadSessions() {
  const cutoff = Date.now() - 20 * 60 * 1000;
  for (const [key, session] of uploadSessions.entries()) {
    if (session.createdAt < cutoff) uploadSessions.delete(key);
  }
}

async function autoSyncIfDue(year = 0) {
  const now = Date.now();
  if (autoSyncRunning || now - lastAutoSyncAt < autoSyncIntervalMs) return;
  autoSyncRunning = true;
  lastAutoSyncAt = now;
  try {
    const params = [];
    const filters = ["url like 'http%'"];
    if (year) {
      params.push(year);
      filters.push(`year = $${params.length}`);
    }
    const links = await query(
      `select year, month, url
       from sheet_links
       where ${filters.join(" and ")}
       order by year desc, month asc
       limit 36`,
      params
    );
    for (const link of links.rows) {
      try {
        await syncMonth(link.year, link.month, link.url);
      } catch (error) {
        await query(
          `update sheet_links
           set status = $3, updated_at = now()
           where year = $1 and month = $2`,
          [link.year, link.month, `Auto-sync failed: ${String(error.message || error).slice(0, 180)}`]
        );
      }
    }
  } finally {
    autoSyncRunning = false;
  }
}

async function syncMonth(year, month, url) {
  const sheetKey = makeSheetKey(year, month);
  const rows = await readGoogleSheetRows(url);
  const records = rows
    .map((row, index) => normalizeRecord(row, { year, month, sheetKey, rowNumber: index + 2 }))
    .filter(Boolean);

  await persistMonthRecords(year, month, records, {
    status: "Synced",
    source: url,
    sheetName: "Google Sheet",
  });

  return { year, month, sheetKey, importedRecords: records.length };
}

async function importRows(year, month, rows, meta) {
  const sheetKey = makeSheetKey(year, month);
  const records = rows
    .map((row, index) => normalizeRecord(row, { year, month, sheetKey, rowNumber: index + 2 }))
    .filter(Boolean);

  await persistMonthRecords(year, month, records, {
    status: meta.status || "Imported",
    source: meta.source || `excel:${meta.filename}`,
    sheetName: meta.sheetName || meta.filename,
  });

  return { year, month, sheetKey, importedRecords: records.length, sheetName: meta.sheetName };
}

async function persistMonthRecords(year, month, records, meta) {
  const sheetKey = makeSheetKey(year, month);
  await withTransaction(async (client) => {
    await client.query("delete from delivery_records where sheet_key = $1", [sheetKey]);
    for (const record of records) {
      await client.query(
        `insert into delivery_records (
          id, year, month, sheet_key, row_number, creator_code, waybill_number, order_status,
          signing_time, receiver, receiver_cellphone, submission_time, remarks, sender_name,
          normalized_status, order_date, amount, search_text, search_digits, raw
        ) values (
          $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20
        )`,
        [
          record.id,
          record.year,
          record.month,
          record.sheetKey,
          record.rowNumber,
          record.creatorCode,
          record.waybillNumber,
          record.orderStatus,
          record.signingTime,
          record.receiver,
          record.receiverCellphone,
          record.submissionTime,
          record.remarks,
          record.senderName,
          record.normalizedStatus,
          record.orderDate,
          record.amount,
          record.searchText,
          record.searchDigits,
          record.raw,
        ]
      );
    }
    await client.query(
      `insert into sheet_links (year, month, url, sheet_name, status, last_sync, imported_records, updated_at)
       values ($1, $2, $3, $4, $5, now(), $6, now())
       on conflict (year, month)
       do update set
        url = excluded.url,
        sheet_name = excluded.sheet_name,
        status = excluded.status,
        last_sync = now(),
        imported_records = excluded.imported_records,
        updated_at = now()`,
      [year, month, meta.source, meta.sheetName, meta.status, records.length]
    );
  });
}

function makeSheetKey(year, month) {
  return `${year}-${String(month).padStart(2, "0")}`;
}

function emptySummary() {
  return { total: 0, delivered: 0, rts: 0, amount: 0, deliveryRate: 0, rtsRate: 0 };
}

function makeSummary(row) {
  const total = Number(row?.total) || 0;
  const delivered = Number(row?.delivered) || 0;
  const rts = Number(row?.rts) || 0;
  return {
    total,
    delivered,
    rts,
    amount: Number(row?.amount) || 0,
    deliveryRate: total ? Math.round((delivered / total) * 100) : 0,
    rtsRate: total ? Math.round((rts / total) * 100) : 0,
  };
}

function searchTerms(value) {
  const normalized = String(value || "")
    .split(/[\s,;|]+/)
    .map((term) => term.trim())
    .filter(Boolean);
  const terms = normalized.length ? normalized : [String(value || "").trim()].filter(Boolean);
  const unique = new Map();
  terms.forEach((term) => {
    const text = normalizeText(term);
    const digits = digitsOnly(term);
    if (text.length >= 2 || digits.length >= 2) unique.set(text || digits, { text, digits });
  });
  return [...unique.values()];
}
