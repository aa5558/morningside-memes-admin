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
    images.set(path, png(g + 7));
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

  return images;
}
