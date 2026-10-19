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
const stored = new Map(); // storage path -> { bytes, type }
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

    // --- PostgREST: simple table reads (select + eq filters) --------------
    const table = path.match(/^\/rest\/v1\/([a-z_]+)$/);
    if (table && req.method === "GET") {
      const cols = (url.searchParams.get("select") ?? "*").split(",").map((c) => c.trim());
      if (!cols.every((c) => c === "*" || IDENT.test(c))) return send(res, 400, { message: "bad select" });
      const where = [];
      const values = [];
      for (const [k, v] of url.searchParams) {
        if (k === "select" || k === "limit") continue;
        if (!IDENT.test(k) || !v.startsWith("eq.")) return send(res, 400, { message: `unsupported filter ${k}` });
        values.push(v.slice(3));
        where.push(`${k} = $${values.length}`);
      }
      try {
        const result = await asCaller(claims, (tx) =>
          tx.query(
            `select ${cols.join(", ")} from public.${table[1]} ${where.length ? `where ${where.join(" and ")}` : ""}`,
            values
          )
        );
        if ((req.headers.accept ?? "").includes("vnd.pgrst.object")) {
          if (result.rows.length !== 1) return send(res, 406, { code: "PGRST116", message: "not one row" });
          return send(res, 200, result.rows[0]);
        }
        return send(res, 200, result.rows);
      } catch (error) {
        return pgError(res, error, claims);
      }
    }

    // --- Storage ------------------------------------------------------------
    const pub = path.match(/^\/storage\/v1\/object\/public\/generations\/(.+)$/);
    if (pub && req.method === "GET") {
      const key = decodeURIComponent(pub[1]);
      const file = stored.get(key) ?? (images.has(key) ? { bytes: images.get(key), type: "image/png" } : null);
      if (!file) return send(res, 404, { message: "Object not found" });
      return send(res, 200, file.bytes, { "Content-Type": file.type });
    }
    const upload = path.match(/^\/storage\/v1\/object\/generations\/(.+)$/);
    if (upload && req.method === "POST") {
      const key = decodeURIComponent(upload[1]);
      const bytes = await readBody(req);
      try {
        await asCaller(claims, (tx) =>
          tx.query(`insert into storage.objects (bucket_id, name, owner) values ('generations', $1, auth.uid())`, [key])
        );
      } catch (error) {
        return send(res, 403, { statusCode: "403", error: "Unauthorized", message: error.message });
      }
      stored.set(key, { bytes, type: req.headers["content-type"] ?? "application/octet-stream" });
      return send(res, 200, { Key: `generations/${key}`, Id: key });
    }
    if (path === "/storage/v1/object/generations" && req.method === "DELETE") {
      const { prefixes = [] } = JSON.parse((await readBody(req)).toString() || "{}");
      const result = await asCaller(claims, (tx) =>
        tx.query(`delete from storage.objects where bucket_id = 'generations' and name = any($1::text[]) returning name`, [
          prefixes,
        ])
      );
      for (const { name } of result.rows) {
        stored.delete(name);
        images.delete(name);
        deletedPaths.push(name);
      }
      return send(res, 200, result.rows.map(({ name }) => ({ name })));
    }

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
