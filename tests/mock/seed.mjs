// Deterministic fixture data for the mock Supabase: students, photos,
// Gemini + human captions, and votes spread over the last ~45 days.

import { deflateSync } from "node:zlib";

export const ADMIN_ID = "a0000000-0000-4000-8000-000000000001";
export const REGULAR_ID = "a0000000-0000-4000-8000-000000000002";

const NAMES = [
  ["Ada", "Admin"],
  ["Riley", "Regular"],
  ["Maya", "Chen"],
  ["Jordan", "Okafor"],
  ["Priya", "Raman"],
  ["Leo", "Martinez"],
  ["Sofia", "Rossi"],
  ["Ethan", "Kim"],
  ["Zara", "Haddad"],
  ["Noah", "Goldberg"],
  ["Ava", "Nguyen"],
  ["Sam", "Patel"],
  [null, null], // a user who never filled in their profile
];

export const USERS = NAMES.map(([first, last], i) => ({
  id: i < 2 ? [ADMIN_ID, REGULAR_ID][i] : `b0000000-0000-4000-8000-${String(i).padStart(12, "0")}`,
  first,
  last,
  email: `${(first ?? "anon").toLowerCase()}.${(last ?? `user${i}`).toLowerCase()}@example.edu`,
}));

const AI_LINES = [
  "Butler at 3am hits different when the WiFi is also crying",
  "POV: you said you'd only stay for one Lit Hum reading",
  "Ope, just gonna squeeze past this existential crisis",
  "Rent is due and so is my will to live",
  "This is the most nature I've seen since moving to Morningside",
  "Me pretending the 1 train is a personality trait",
  "John Jay dining said 'chef's kiss' and meant it as a threat",
  "Low Steps: where ambition goes to sunbathe",
  "When the bodega cat has a better sleep schedule than you",
  "Back home this would be a whole festival",
  "the vibes are immaculate and so is my procrastination",
  "Core Curriculum? More like Core Crisis-iculum",
];
const HUMAN_LINES = [
  "this is just Ferris at noon and I refuse to elaborate",
  "my roommate when I say 'quick question'",
  "Alma Mater has seen things. terrible things.",
  "the pigeon has a CS minor",
  "I paid $9 for this latte and I'd do it again",
  "Barnard girlies stay winning",
  "the 1 train smell is a flavor now",
  "midterm season starter pack",
];
const VIBES = ["midwest", "online", "columbia", "newyorker"];
const PROMPTS = ["Butler at an unreasonable hour", "Low Steps on a sunny day", "Your subway car right now", "A coffee that cost way too much"];

function rng(seed) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

// A small solid-gradient PNG so photos render without real images.
function png(seed) {
  const r = rng(seed);
  const size = 96;
  const [a, b] = [0, 1].map(() => [r() * 255, r() * 255, r() * 255]);
  const raw = Buffer.alloc((size * 3 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 3 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      const t = (x + y) / (2 * size);
      for (let c = 0; c < 3; c++) raw[y * (size * 3 + 1) + 1 + x * 3 + c] = a[c] * (1 - t) + b[c] * t;
    }
  }
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (buf) => {
    let c = 0xffffffff;
    for (const byte of buf) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const c = Buffer.alloc(4);
    c.writeUInt32BE(crc(td));
    return Buffer.concat([len, td, c]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

const uuid = (prefix, n) => `${prefix}-0000-4000-8000-${String(n).padStart(12, "0")}`;

export async function seed(db) {
  const r = rng(42);
  const pick = (arr) => arr[Math.floor(r() * arr.length)];
  const now = Date.now();
  const daysAgo = (d, hours = 12) => new Date(now - d * 86_400_000 - hours * 3_600_000 + r() * 3_600_000).toISOString();
  const images = new Map();

  for (const [i, u] of USERS.entries()) {
    await db.query(
      `insert into auth.users (id, email, created_at, last_sign_in_at, aud, role) values ($1, $2, $3, $4, 'authenticated', 'authenticated')`,
      [u.id, u.email, daysAgo(i < 2 ? 60 : 50 - i * 3.5), daysAgo(Math.floor(r() * 6))]
    );
    await db.query(`update public.profiles set first_name = $2, last_name = $3, is_superadmin = $4 where id = $1`, [
      u.id,
      u.first,
      u.last,
      u.id === ADMIN_ID,
    ]);
  }

  let captionN = 0;
  const captionIds = [];
  for (let g = 0; g < 30; g++) {
    const owner = USERS[2 + (g % (USERS.length - 2))];
    const id = uuid("c0000000", g + 1);
    const path = `${owner.id}/${uuid("d0000000", g + 1)}.png`;
    const created = daysAgo(Math.floor((g / 30) * 44) + (g % 3));
    images.set(`generations/${path}`, png(g + 7));
    await db.query(`insert into storage.objects (bucket_id, name, owner) values ('generations', $1, $2)`, [path, owner.id]);
    await db.query(
      `insert into public.generations (id, user_id, image_path, context, vibe, daily_prompt, model, prompt, created_at, challenge_date)
       values ($1, $2, $3, $4, $5, $6, 'gemini-2.5-flash', $7, $8, ($8::timestamptz at time zone 'America/New_York')::date)`,
      [
        id,
        owner.id,
        path,
        g % 4 === 0 ? null : pick(["midterms are winning", "found this outside Pupin", "the line at Joe again", "first snow on campus"]),
        pick(VIBES),
        pick(PROMPTS),
        `You write captions for photos posted by Columbia University students... (fixture prompt #${g + 1})`,
        created,
      ]
    );
    for (let c = 0; c < 4; c++) {
      const cid = uuid("e0000000", ++captionN);
      captionIds.push(cid);
      await db.query(
        `insert into public.captions (id, generation_id, user_id, author_type, text, created_at) values ($1, $2, $3, 'ai', $4, $5)`,
        [cid, id, owner.id, `${pick(AI_LINES)} #${captionN}`, created]
      );
    }
    const humans = g % 5 === 4 ? 0 : 1 + Math.floor(r() * 3);
    for (let h = 0; h < humans; h++) {
      const author = USERS[2 + Math.floor(r() * (USERS.length - 3))];
      const cid = uuid("e0000000", ++captionN);
      captionIds.push(cid);
      await db.query(
        `insert into public.captions (id, generation_id, user_id, author_type, text, created_at) values ($1, $2, $3, 'human', $4, $5::timestamptz + interval '3 hours')`,
        [cid, id, author.id, `${pick(HUMAN_LINES)} #${captionN}`, created]
      );
    }
  }

  // Votes: each non-admin user votes on a random subset; humans skew up.
  const caps = (await db.query(`select c.id, c.author_type, c.user_id, c.created_at from public.captions c`)).rows;
  for (const u of USERS.slice(1)) {
    for (const c of caps) {
      if (c.user_id === u.id && c.author_type === "human") continue;
      if (r() > 0.32) continue;
      const up = r() < (c.author_type === "human" ? 0.72 : 0.58);
      const cast = new Date(Math.min(now - 60_000, new Date(c.created_at).getTime() + r() * 4 * 86_400_000)).toISOString();
      await db.query(
        `insert into public.caption_votes (user_id, caption_id, vote, created_at, updated_at) values ($1, $2, $3, $4, $4)`,
        [u.id, c.id, up ? 1 : -1, cast]
      );
    }
  }

  // Image library: today's Daily Drop, a past one, an undated one, and a
  // drop scheduled for tomorrow (which only admins may see).
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date());
  const shift = (d) => new Date(Date.parse(today) + d * 86_400_000).toISOString().slice(0, 10);
  const library = [
    ["Low Steps, first snow", "Students sitting on snowy Low Steps in puffer jackets", ["campus", "snow"], today],
    ["Bodega cat on duty", "An orange cat asleep on a stack of newspapers by a register", ["nyc", "cats"], shift(-2)],
    ["Butler at 2am", "Rows of students at laptops in a library reading room late at night", ["campus", "finals"], null],
    ["Tomorrow's surprise", "A pigeon standing on a subway bench", ["nyc"], shift(1)],
  ];
  for (const [i, [title, alt, tags, day]] of library.entries()) {
    const id = uuid("f0000000", i + 1);
    const file = `${uuid("f1000000", i + 1)}.png`;
    images.set(`images/${file}`, png(100 + i));
    await db.query(`insert into storage.objects (bucket_id, name) values ('images', $1)`, [file]);
    await db.query(
      `insert into public.images (id, storage_path, title, alt_text, tags, mime_type, byte_size, featured_on, uploaded_by)
       values ($1, $2, $3, $4, $5, 'image/png', 2048, $6, $7)`,
      [id, file, title, alt, tags, day, ADMIN_ID]
    );
  }

  // Logged pipeline runs for the most recent posts, as if each had been
  // captioned by a chain.
  const recent = (await db.query(`select id, user_id, vibe, created_at from public.generations order by created_at desc limit 12`)).rows;
  const chains = (await db.query(`select c.id, c.slug, array_agg(s.id order by s.position) steps from public.prompt_chains c join public.prompt_chain_steps s on s.chain_id = c.id group by c.id order by c.slug`)).rows;
  for (const [i, g] of recent.entries()) {
    const chain = chains[i % chains.length];
    const failed = i === 5;
    const started = new Date(new Date(g.created_at).getTime() - 9000).toISOString();
    const req = (
      await db.query(
        `insert into public.generation_requests (user_id, source, status, chain_id, chain_slug, vibe, generation_id, caption_ids, error_message, started_at, finished_at)
         values ($1, 'main_app', $2, $3, $4, $5, $6,
                 case when $2 = 'succeeded' then (select coalesce(array_agg(id), '{}') from public.captions where generation_id = $6 and author_type = 'ai') else '{}' end,
                 $7, $8, $8::timestamptz + interval '8 seconds') returning id`,
        [g.user_id, failed ? "failed" : "succeeded", chain.id, chain.slug, g.vibe, failed ? null : g.id, failed ? "Step 1 (Write captions) failed: The model is overloaded." : null, started]
      )
    ).rows[0].id;
    for (const [n, step] of chain.steps.entries()) {
      const last = n === chain.steps.length - 1;
      await db.query(
        `insert into public.llm_responses (request_id, step_id, step_position, step_name, model_id, model_key, provider_slug, prompt_text, response_text, status, http_status, error_message, latency_ms, input_tokens, output_tokens, created_at)
         select $1, s.id, s.position, s.name, m.id, m.model_key, 'google-gemini', s.instructions, $2, $3, $4, $5, $6, 1290, $7, $8::timestamptz
         from public.prompt_chain_steps s join public.llm_models m on m.id = s.model_id where s.id = $9`,
        [
          req,
          failed ? null : last ? JSON.stringify(AI_LINES.slice(0, 4)) : "1. Laptop glow\n2. Empty coffee cups\n3. Someone asleep",
          failed ? "error" : "ok",
          failed ? 503 : 200,
          failed ? "The model is overloaded." : null,
          2400 + n * 1800 + i * 37,
          failed ? 0 : 310 + n * 40,
          new Date(new Date(started).getTime() + (n + 1) * 2500).toISOString(),
          step,
        ]
      );
      if (failed) break;
    }
  }

  return images;
}
