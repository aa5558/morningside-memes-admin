// Only same-site paths are allowed as a post-login destination, so a crafted
// ?next= link can't bounce an admin to another site.
export function safeNext(next: unknown): string {
  if (typeof next !== "string" || !next.startsWith("/") || next.startsWith("//") || next.includes("\\")) {
    return "/";
  }
  return next;
}
