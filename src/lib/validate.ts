// Parsing for anything that arrives from the browser: URL search params,
// form fields, and server action arguments. Each returns a safe value or
// null, so bad input becomes "no filter" instead of reaching the database.

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export type SearchParams = Record<string, string | string[] | undefined>;

export function param(params: SearchParams, key: string): string | undefined {
  const value = params[key];
  return typeof value === "string" ? value : undefined;
}

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

export function uuidOrNull(value: unknown): string | null {
  return isUuid(value) ? value : null;
}

export function dateOrNull(value: unknown): string | null {
  if (typeof value !== "string" || !DATE_PATTERN.test(value)) return null;
  return Number.isNaN(Date.parse(value)) ? null : value;
}

export function textOrNull(value: unknown, max = 100): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim().replace(/\s+/g, " ").slice(0, max);
  return trimmed || null;
}

export function oneOf<T extends string>(value: unknown, options: readonly T[], fallback: T): T {
  return options.includes(value as T) ? (value as T) : fallback;
}

export function pageNumber(value: unknown): number {
  const n = Number(value);
  return Number.isInteger(n) && n >= 1 && n <= 10_000 ? n : 1;
}
