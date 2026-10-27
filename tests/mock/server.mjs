// A local stand-in for the Supabase API (auth, PostgREST, storage), backed
// by PGlite running the real migrations, for end-to-end tests of the admin
// app as a superadmin and as a regular user without a Google login.
//
// Every request runs inside a transaction as the `authenticated` (or `anon`)
// role with the caller's JWT claims, exactly like PostgREST, so RLS, column
// grants and the admin functions' own is_superadmin checks all apply.
//
//   node tests/mock/server.mjs            # listens on :54399
//
// Sessions: tokens are unsigned JWT-shaped strings ("mock.<base64 json>.x");
// see tests/mock/session.mjs. Never point a real deployment at this.

import { PGlite } from "@electric-sql/pglite";
import { createServer } from "node:http";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { seed, USERS } from "./seed.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = join(here, "../..");
const MAIN_MIGRATIONS =
  process.env.MAIN_MIGRATIONS ?? join(ROOT, "../hello-world-nextjs/supabase/migrations");
const PORT = Number(process.env.MOCK_PORT ?? 54399);

const SUPABASE_STUB = `
create role anon nologin;
create role authenticated nologin;
create role service_role nologin;
grant anon, authenticated, service_role to current_user;
grant usage on schema public to anon, authenticated;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
create schema auth;
grant usage on schema auth to anon, authenticated;
create table auth.users (
  id uuid primary key, email varchar(255), created_at timestamptz, last_sign_in_at timestamptz,
  raw_app_meta_data jsonb default '{"provider":"google"}', aud varchar(255), role varchar(255)
);
create function auth.uid() returns uuid language sql stable as $$
  select nullif(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub', '')::uuid
$$;
grant execute on function auth.uid() to anon, authenticated;
create schema storage;
grant usage on schema storage to anon, authenticated;
create table storage.buckets (id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text, owner uuid, unique (bucket_id, name));
alter table storage.objects enable row level security;
grant all on storage.objects to anon, authenticated;
create function storage.foldername(name text) returns text[] language sql immutable as $$
  select (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'), 1) - 1]
$$;
`;

const db = new PGlite({
  parsers: {
    20: (v) => Number(v), // bigint
    1082: (v) => v, // date stays "YYYY-MM-DD", like PostgREST
    1184: (v) => new Date(v).toISOString(), // timestamptz
    1700: (v) => Number(v), // numeric
  },
});

await db.exec(SUPABASE_STUB);
for (const f of [
  "20260928000000_profiles.sql",
  "20261005000000_captions_votes_rls.sql",
  "20261012000000_human_vs_ai_battles.sql",
]) {
  const path = join(MAIN_MIGRATIONS, f);
  if (!existsSync(path)) throw new Error(`Missing main-app migration: ${path}`);
  await db.exec(readFileSync(path, "utf8"));
}
await db.exec(readFileSync(join(ROOT, "supabase/migrations/20261019000000_admin_dashboard.sql"), "utf8"));
await db.exec(readFileSync(join(ROOT, "supabase/migrations/20261026000000_ai_studio_access_images.sql"), "utf8"));
const images = await seed(db);

// PGlite is a single connection, so requests run one at a time.
let queue = Promise.resolve();
const serial = (fn) => {
  const run = queue.then(fn, fn);
  queue = run.catch(() => {});
  return run;
};

function claimsFrom(req) {
  const auth = req.headers.authorization ?? "";
  const token = auth.replace(/^Bearer\s+/i, "");
  const parts = token.split(".");
  if (parts.length === 3 && parts[0] === "mock") {
    try {
      const claims = JSON.parse(Buffer.from(parts[1], "base64url").toString());
      if (USERS.some((u) => u.id === claims.sub)) return claims;
    } catch {}
  }
  return null;
}

async function asCaller(claims, fn) {
  return serial(async () => {
    return db.transaction(async (tx) => {
      await tx.query(`select set_config('request.jwt.claims', $1, true)`, [
        JSON.stringify(claims ?? { role: "anon" }),
      ]);
      await tx.exec(`set local role ${claims ? "authenticated" : "anon"}`);
      return fn(tx);
    });
  });
}

function send(res, status, body, headers = {}) {
  const payload =
    body === undefined ? "" : typeof body === "string" || Buffer.isBuffer(body) ? body : JSON.stringify(body);
  res.writeHead(status, { "Content-Type": "application/json", ...headers });
  res.end(payload);
}

function pgError(res, error, claims) {
  const code = error.code ?? "XX000";
  const status = code === "42501" ? (claims ? 403 : 401) : code === "P0002" ? 404 : 400;
  send(res, status, { code, message: error.message, details: null, hint: null });
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return Buffer.concat(chunks);
}

const IDENT = /^[a-z_][a-z0-9_]*$/;

// --- A small PostgREST subset -------------------------------------------------
// Enough for the main app and the admin app: select lists with one level of
// embedding (generations -> captions, captions -> generations!inner),
// eq/neq/gt/gte/lt/lte/in/is filters (also on an embedded table), order,
// limit, and insert/upsert/update/delete with return=representation.

const RELATIONS = {
  "generations.captions": { many: true, table: "captions", on: (p, c) => `${c}.generation_id = ${p}.id` },
  "captions.generations": { many: false, table: "generations", on: (p, c) => `${c}.id = ${p}.generation_id` },
};

function splitTop(list) {
  const out = [];
  let depth = 0;
  let cur = "";
  for (const ch of list) {
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (ch === "," && depth === 0) {
      out.push(cur.trim());
      cur = "";
    } else cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

function parseSelect(select) {
  const cols = [];
  const embeds = [];
  for (const item of splitTop(select ?? "*")) {
    const m = item.match(/^([a-z_]+)(!inner)?\((.*)\)$/);
    if (m) embeds.push({ name: m[1], inner: !!m[2], cols: splitTop(m[3]) });
    else {
      if (item !== "*" && !IDENT.test(item)) throw new Error(`bad select ${item}`);
      cols.push(item);
    }
  }
  return { cols, embeds };
}

function parseValue(op, raw, values) {
  if (op === "in") {
    const items = raw.replace(/^\(|\)$/g, "").split(",").map((v) => v.replace(/^"|"$/g, ""));
    values.push(items);
    return `= any($${values.length})`;
  }
  if (op === "is") {
    if (!["null", "true", "false"].includes(raw)) throw new Error("bad is");
    return `is ${raw}`;
  }
  const sqlOp = { eq: "=", neq: "<>", gt: ">", gte: ">=", lt: "<", lte: "<=" }[op];
  if (!sqlOp) throw new Error(`unsupported op ${op}`);
  values.push(raw);
  return `${sqlOp} $${values.length}`;
}

function buildWhere(params, alias, tableName, values) {
  const where = [];
  const embedFilters = {};
  for (const [key, val] of params) {
    if (["select", "order", "limit", "offset", "on_conflict", "columns"].includes(key)) continue;
    const dot = val.indexOf(".");
    const op = val.slice(0, dot);
    const raw = val.slice(dot + 1);
    if (key.includes(".")) {
      const [rel, col] = key.split(".");
      if (!IDENT.test(rel) || !IDENT.test(col)) throw new Error("bad filter");
      (embedFilters[rel] ??= []).push({ col, op, raw });
      continue;
    }
    if (!IDENT.test(key)) throw new Error("bad filter");
    where.push(`${alias}.${key} ${parseValue(op, raw, values)}`);
  }
  return { where, embedFilters };
}

async function handleTable(req, res, name, url, claims) {
  if (!IDENT.test(name)) return send(res, 400, { message: "bad table" });
  const params = [...url.searchParams];
  const prefer = req.headers.prefer ?? "";
  const wantsObject = (req.headers.accept ?? "").includes("vnd.pgrst.object");
  const select = url.searchParams.get("select");

  const finish = (rows) => {
    if (wantsObject) {
      if (rows.length !== 1) return send(res, 406, { code: "PGRST116", message: "JSON object requested, multiple (or no) rows returned" });
      return send(res, 200, JSON.stringify(rows[0]));
    }
    return send(res, 200, JSON.stringify(rows));
  };

  if (req.method === "GET" || req.method === "HEAD") {
    const values = [];
    const { cols, embeds } = parseSelect(select);
    const { where, embedFilters } = buildWhere(params, "t", name, values);
    const parts = cols.map((c) => (c === "*" ? "t.*" : `t.${c}`));
    embeds.forEach((e, i) => {
      const rel = RELATIONS[`${name}.${e.name}`];
      if (!rel) throw new Error(`no relation ${name}.${e.name}`);
      const a = `e${i}`;
      for (const c of e.cols) if (!IDENT.test(c)) throw new Error("bad embed col");
      const obj = `json_build_object(${e.cols.map((c) => `'${c}', ${a}.${c}`).join(", ")})`;
      const filters = (embedFilters[e.name] ?? []).map((f) => `${a}.${f.col} ${parseValue(f.op, f.raw, values)}`);
      const cond = [rel.on("t", a), ...filters].join(" and ");
      parts.push(
        rel.many
          ? `(select coalesce(json_agg(${obj}), '[]'::json) from public.${rel.table} ${a} where ${cond}) as ${e.name}`
          : `(select ${obj} from public.${rel.table} ${a} where ${cond}) as ${e.name}`
      );
      if (e.inner || filters.length) where.push(`exists (select 1 from public.${rel.table} ${a} where ${cond})`);
    });
    let sql = `select ${parts.join(", ")} from public.${name} t`;
    if (where.length) sql += ` where ${where.join(" and ")}`;
    const order = url.searchParams.get("order");
    if (order) {
      sql += " order by " + order.split(",").map((o) => {
        const [col, dir = "asc", nulls] = o.split(".");
        if (!IDENT.test(col) || !["asc", "desc"].includes(dir)) throw new Error("bad order");
        return `t.${col} ${dir}${nulls === "nullslast" ? " nulls last" : nulls === "nullsfirst" ? " nulls first" : ""}`;
      }).join(", ");
    }
    const limit = Number(url.searchParams.get("limit"));
    if (limit > 0) sql += ` limit ${Math.min(limit, 1000)}`;
    const result = await asCaller(claims, (tx) => tx.query(sql, values));
    if (prefer.includes("count=exact")) {
      const n = result.rows.length;
      res.setHeader("Content-Range", `${n ? `0-${n - 1}` : "*"}/${n}`);
      if (req.method === "HEAD") return send(res, 200);
    }
    return finish(result.rows);
  }

  const returning = prefer.includes("return=representation") ? ` returning ${select ? parseSelect(select).cols.join(", ") : "*"}` : "";

  if (req.method === "POST") {
    const body = JSON.parse((await readBody(req)).toString() || "[]");
    const rows = Array.isArray(body) ? body : [body];
    const keys = [...new Set(rows.flatMap((r) => Object.keys(r)))];
    if (!keys.every((k) => IDENT.test(k))) throw new Error("bad column");
    const values = [];
    const tuples = rows.map((r) => `(${keys.map((k) => { values.push(r[k] ?? null); return `$${values.length}`; }).join(", ")})`);
    let sql = `insert into public.${name} (${keys.join(", ")}) values ${tuples.join(", ")}`;
    if (prefer.includes("resolution=merge-duplicates")) {
      const conflict = (url.searchParams.get("on_conflict") ?? "id").split(",");
      if (!conflict.every((k) => IDENT.test(k))) throw new Error("bad on_conflict");
      const updates = keys.filter((k) => !conflict.includes(k)).map((k) => `${k} = excluded.${k}`);
      sql += ` on conflict (${conflict.join(", ")}) do ${updates.length ? `update set ${updates.join(", ")}` : "nothing"}`;
    }
    const result = await asCaller(claims, (tx) => tx.query(sql + returning, values));
    if (!returning) return send(res, 201);
    return finish(result.rows);
  }

  if (req.method === "PATCH" || req.method === "DELETE") {
    const values = [];
    let sql;
    if (req.method === "PATCH") {
      const body = JSON.parse((await readBody(req)).toString() || "{}");
      const keys = Object.keys(body);
      if (!keys.every((k) => IDENT.test(k))) throw new Error("bad column");
      const sets = keys.map((k) => { values.push(body[k]); return `${k} = $${values.length}`; });
      sql = `update public.${name} t set ${sets.join(", ")}`;
    } else {
      sql = `delete from public.${name} t`;
    }
    const { where } = buildWhere(params, "t", name, values);
    if (where.length) sql += ` where ${where.join(" and ")}`;
    const result = await asCaller(claims, (tx) => tx.query(sql + returning, values));
    if (!returning) return send(res, 204);
    return finish(result.rows);
  }

  return send(res, 405, { message: "method not allowed" });
}
const stored = new Map(); // storage path -> { bytes, type }

// A stand-in for the Gemini API (GEMINI_API_BASE=http://localhost:54399/gemini/models).
// Tests switch its behaviour with POST /__debug/gemini {"mode": "ok" | "quota" | "overloaded"}
// and read every prompt it received from GET /__debug/gemini-calls.
let geminiMode = "ok";
const geminiCalls = [];
function geminiReply(body) {
  if (geminiMode === "quota") {
    return [429, { error: { code: 429, status: "RESOURCE_EXHAUSTED", message: "You exceeded your current quota, please check your plan and billing details." } }];
  }
  if (geminiMode === "overloaded") {
    return [503, { error: { code: 503, status: "UNAVAILABLE", message: "This model is currently experiencing high demand." } }];
  }
  const prompt = body.contents?.[0]?.parts?.find((p) => p.text)?.text ?? "";
  const json = body.generationConfig?.responseMimeType === "application/json";
  const n = /JSON array of 8/.test(prompt) ? 8 : 4;
  const text = json
    ? JSON.stringify(Array.from({ length: n }, (_, i) => `mock caption ${i + 1} (${Date.now() % 100000})`))
    : "1. a laptop\n2. a coffee cup\n3. someone asleep";
  return [200, {
    candidates: [{ content: { parts: [{ text }] } }],
    modelVersion: "mock-gemini",
    usageMetadata: { promptTokenCount: 120, candidatesTokenCount: 40 },
  }];
}
const deletedPaths = [];

createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const path = url.pathname;
  const claims = claimsFrom(req);

  try {
    // --- Auth -------------------------------------------------------------
    if (path === "/auth/v1/user" && req.method === "GET") {
      if (!claims) return send(res, 401, { code: 401, error_code: "bad_jwt", msg: "invalid JWT" });
      const u = USERS.find((x) => x.id === claims.sub);
      return send(res, 200, {
        id: u.id,
        aud: "authenticated",
        role: "authenticated",
        email: u.email,
        app_metadata: { provider: "google" },
        user_metadata: { full_name: `${u.first} ${u.last}` },
        created_at: new Date().toISOString(),
      });
    }
    if (path === "/auth/v1/logout") return send(res, 204);

    // --- PostgREST: RPC ---------------------------------------------------
    const rpc = path.match(/^\/rest\/v1\/rpc\/([a-z_0-9]+)$/);
    if (rpc && req.method === "POST") {
      const fn = rpc[1];
      const raw = (await readBody(req)).toString();
      const args = raw ? JSON.parse(raw) : {};
      const names = Object.keys(args);
      if (!names.every((n) => IDENT.test(n))) return send(res, 400, { message: "bad args" });
      const meta = await serial(() =>
        db.query(
          `select p.proretset, t.typname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           join pg_type t on t.oid = p.prorettype where n.nspname = 'public' and p.proname = $1 limit 1`,
          [fn]
        )
      );
      if (!meta.rows.length) return send(res, 404, { code: "PGRST202", message: `function ${fn} not found` });
      const call = `public.${fn}(${names.map((n, i) => `${n} => $${i + 1}`).join(", ")})`;
      const values = names.map((n) => args[n]);
      const { proretset } = meta.rows[0];
      try {
        const result = await asCaller(claims, (tx) =>
          tx.query(proretset ? `select * from ${call}` : `select ${call} as r`, values)
        );
        // JSON-encode explicitly: scalar text/uuid results are JSON strings in PostgREST.
        return send(res, 200, JSON.stringify(proretset ? result.rows : (result.rows[0]?.r ?? null)));
      } catch (error) {
        return pgError(res, error, claims);
      }
    }

    // --- PostgREST: tables (select with embeds, filters, order, limit; writes)
    const table = path.match(/^\/rest\/v1\/([a-z_]+)$/);
    if (table) {
      try {
        return await handleTable(req, res, table[1], url, claims);
      } catch (error) {
        if (error.code) return pgError(res, error, claims);
        return send(res, 400, { message: String(error.message ?? error) });
      }
    }

    // --- Storage ------------------------------------------------------------
    const pub = path.match(/^\/storage\/v1\/object\/public\/(generations|images)\/(.+)$/);
    if (pub && req.method === "GET") {
      const key = `${pub[1]}/${decodeURIComponent(pub[2])}`;
      const file = stored.get(key) ?? (images.has(key) ? { bytes: images.get(key), type: "image/png" } : null);
      if (!file) return send(res, 404, { message: "Object not found" });
      return send(res, 200, file.bytes, { "Content-Type": file.type });
    }
    const upload = path.match(/^\/storage\/v1\/object\/(generations|images)\/(.+)$/);
    if (upload && req.method === "POST") {
      const [bucket, name] = [upload[1], decodeURIComponent(upload[2])];
      const bytes = await readBody(req);
      try {
        await asCaller(claims, (tx) =>
          tx.query(`insert into storage.objects (bucket_id, name, owner) values ($1, $2, auth.uid())`, [bucket, name])
        );
      } catch (error) {
        return send(res, 403, { statusCode: "403", error: "Unauthorized", message: error.message });
      }
      stored.set(`${bucket}/${name}`, { bytes, type: req.headers["content-type"] ?? "application/octet-stream" });
      return send(res, 200, { Key: `${bucket}/${name}`, Id: name });
    }
    const remove = path.match(/^\/storage\/v1\/object\/(generations|images)$/);
    if (remove && req.method === "DELETE") {
      const bucket = remove[1];
      const { prefixes = [] } = JSON.parse((await readBody(req)).toString() || "{}");
      const result = await asCaller(claims, (tx) =>
        tx.query(`delete from storage.objects where bucket_id = $1 and name = any($2::text[]) returning name`, [
          bucket,
          prefixes,
        ])
      );
      for (const { name } of result.rows) {
        stored.delete(`${bucket}/${name}`);
        images.delete(`${bucket}/${name}`);
        deletedPaths.push(bucket === "generations" ? name : `${bucket}/${name}`);
      }
      return send(res, 200, result.rows.map(({ name }) => ({ name })));
    }

    // --- Gemini stand-in ------------------------------------------------------
    const gem = path.match(/^\/gemini\/models\/([A-Za-z0-9._-]+):generateContent$/);
    if (gem && req.method === "POST") {
      const body = JSON.parse((await readBody(req)).toString() || "{}");
      const parts = body.contents?.[0]?.parts ?? [];
      geminiCalls.push({
        model: gem[1],
        key: req.headers["x-goog-api-key"] ?? null,
        prompt: parts.find((p) => p.text)?.text ?? "",
        image: parts.some((p) => p.inline_data),
        config: body.generationConfig ?? {},
        mode: geminiMode,
      });
      const [status, reply] = geminiReply(body);
      return send(res, status, reply);
    }
    if (path === "/__debug/gemini" && req.method === "POST") {
      geminiMode = JSON.parse((await readBody(req)).toString()).mode;
      return send(res, 200, { mode: geminiMode });
    }
    if (path === "/__debug/gemini-calls") return send(res, 200, geminiCalls);

    // --- Test introspection (owner access; local only) ----------------------
    if (path === "/__debug/query" && req.method === "POST") {
      const { sql, params = [] } = JSON.parse((await readBody(req)).toString());
      const result = await serial(() => db.query(sql, params));
      return send(res, 200, result.rows);
    }
    if (path === "/__debug/deleted-files") return send(res, 200, deletedPaths);

    return send(res, 404, { message: `mock: no route for ${req.method} ${path}` });
  } catch (error) {
    console.error(error);
    return send(res, 500, { message: String(error) });
  }
}).listen(PORT, () => console.log(`mock supabase listening on http://localhost:${PORT}`));
