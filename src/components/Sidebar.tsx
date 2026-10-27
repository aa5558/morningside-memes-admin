"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";

const I = {
  home: "M3 12l9-8 9 8M5 10v10h5v-6h4v6h5V10",
  chart: "M4 20V10M10 20V4M16 20v-7M22 20H2",
  users:
    "M16 19v-1a4 4 0 00-4-4H6a4 4 0 00-4 4v1M9 10a3 3 0 100-6 3 3 0 000 6M22 19v-1a4 4 0 00-3-3.9M16 4.1a3 3 0 010 5.8",
  media: "M4 5h16v14H4zM4 15l4-4 4 4 3-3 5 5M15 9.5a1.5 1.5 0 100-3 1.5 1.5 0 000 3",
  votes: "M7 11l5-6 5 6M7 13l5 6 5-6",
  audit: "M9 4h6M8 4H6v16h12V4h-2M9 10h6M9 14h6M9 18h3",
  chain: "M9 7H7a4 4 0 000 8h2M15 7h2a4 4 0 010 8h-2M8 11h8",
  pulse: "M3 12h4l3-8 4 16 3-8h4",
  terminal: "M4 5h16v14H4zM8 10l2 2-2 2M12 14h4",
  spark: "M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z",
  chip: "M7 7h10v10H7zM9 3v4M15 3v4M9 17v4M15 17v4M3 9h4M3 15h4M17 9h4M17 15h4",
  image: "M4 4h16v16H4zM4 14l4-4 5 5 3-3 4 4M14.5 8.5h.01",
  book: "M5 4h11a3 3 0 013 3v13H8a3 3 0 01-3-3zM5 17a3 3 0 013-3h11",
  lock: "M6 11h12v9H6zM8 11V7a4 4 0 018 0v4",
};

const NAV: { group: string; items: { href: string; label: string; icon: string }[] }[] = [
  { group: "", items: [{ href: "/", label: "Overview", icon: I.home }] },
  {
    group: "AI Studio",
    items: [
      { href: "/studio", label: "Prompt chains", icon: I.chain },
      { href: "/studio/requests", label: "Generation runs", icon: I.pulse },
      { href: "/studio/responses", label: "LLM responses", icon: I.terminal },
      { href: "/studio/examples", label: "Examples", icon: I.spark },
    ],
  },
  { group: "Models", items: [{ href: "/models", label: "Models & providers", icon: I.chip }] },
  {
    group: "Content",
    items: [
      { href: "/media", label: "Posts & AI media", icon: I.media },
      { href: "/images", label: "Image library", icon: I.image },
      { href: "/terms", label: "Terms", icon: I.book },
    ],
  },
  {
    group: "People & access",
    items: [
      { href: "/users", label: "Users", icon: I.users },
      { href: "/access", label: "Signup access", icon: I.lock },
    ],
  },
  {
    group: "Insights",
    items: [
      { href: "/analytics", label: "Analytics", icon: I.chart },
      { href: "/votes", label: "Votes", icon: I.votes },
      { href: "/audit", label: "Audit log", icon: I.audit },
    ],
  },
];

function Icon({ d }: { d: string }) {
  return (
    <svg
      aria-hidden
      viewBox="0 0 24 24"
      className="h-[18px] w-[18px] shrink-0"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d={d} />
    </svg>
  );
}

export function Sidebar({
  name,
  email,
  avatarUrl,
  mainAppUrl,
  signOutAction,
}: {
  name: string;
  email: string;
  avatarUrl: string | null;
  mainAppUrl: string;
  signOutAction: () => Promise<void>;
}) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  // The longest matching link wins, so /studio/requests doesn't also light up /studio.
  const hrefs = NAV.flatMap((g) => g.items.map((i) => i.href));
  const current = hrefs
    .filter((href) => (href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`)))
    .sort((a, b) => b.length - a.length)[0];
  const isActive = (href: string) => href === current;

  const nav = (
    <nav aria-label="Admin" className="flex flex-col gap-3">
      {NAV.map(({ group, items }) => (
        <div key={group || "home"} className="flex flex-col gap-0.5">
          {group && (
            <p className="px-3.5 pb-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-subtle">{group}</p>
          )}
          {items.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              onClick={() => setOpen(false)}
              aria-current={isActive(item.href) ? "page" : undefined}
              className={`flex items-center gap-3 rounded-full px-3 py-1.5 text-sm font-medium transition ${
                isActive(item.href)
                  ? "bg-white text-ink shadow-[0_4px_14px_-6px_rgba(22,38,61,0.25)] ring-1 ring-line"
                  : "text-muted hover:bg-white/60 hover:text-ink"
              }`}
            >
              <span
                className={`flex h-7 w-7 items-center justify-center rounded-full ${isActive(item.href) ? "orb text-ink" : ""}`}
              >
                <Icon d={item.icon} />
              </span>
              {item.label}
            </Link>
          ))}
        </div>
      ))}
    </nav>
  );

  const footer = (
    <div className="mt-auto space-y-3">
      <a
        href={mainAppUrl}
        target="_blank"
        rel="noreferrer"
        className="flex items-center gap-2 px-3 text-xs font-medium text-muted hover:text-ink"
      >
        Open Morningside Memes ↗
      </a>
      <div className="flex items-center gap-3 rounded-[20px] bg-white p-2.5 ring-1 ring-line">
        {avatarUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={avatarUrl} alt="" className="h-9 w-9 rounded-full object-cover" />
        ) : (
          <span className="orb flex h-9 w-9 items-center justify-center rounded-full text-xs font-bold text-ink">
            {name.slice(0, 1).toUpperCase()}
          </span>
        )}
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-ink">{name}</p>
          <p className="truncate text-xs text-subtle">{email}</p>
        </div>
      </div>
      <form action={signOutAction}>
        <button type="submit" className="btn btn-ghost btn-sm w-full">
          Sign out
        </button>
      </form>
    </div>
  );

  const brand = (
    <Link href="/" className="group flex items-center gap-2.5">
      <span className="orb flex h-9 w-9 items-center justify-center rounded-full transition-transform group-hover:-rotate-6">
        <span className="display text-[15px] text-ink">mm</span>
      </span>
      <span className="leading-tight">
        <span className="display block text-[16px] text-ink">
          morningside memes<span className="text-sky">.</span>
        </span>
        <span className="block text-[10px] font-semibold uppercase tracking-[0.18em] text-muted">admin console</span>
      </span>
    </Link>
  );

  return (
    <>
      {/* Desktop */}
      <aside className="glass fixed inset-y-3 left-3 z-30 hidden w-60 flex-col gap-5 overflow-y-auto rounded-[30px] px-3 py-5 lg:flex">
        <div className="px-2">{brand}</div>
        {nav}
        {footer}
      </aside>

      {/* Mobile top bar + drawer */}
      <header className="sticky top-0 z-30 px-3 pt-3 lg:hidden">
        <div className="glass flex items-center justify-between rounded-full py-2 pl-3 pr-2">
          {brand}
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            aria-controls="mobile-nav"
            className="flex h-10 w-10 items-center justify-center rounded-full bg-powder text-ink"
          >
            <span className="sr-only">Menu</span>
            <svg
              aria-hidden
              viewBox="0 0 24 24"
              className="h-5 w-5"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              strokeLinecap="round"
            >
              {open ? <path d="M6 6l12 12M18 6L6 18" /> : <path d="M4 8h16M4 16h16" />}
            </svg>
          </button>
        </div>
      </header>
      {open && (
        <div
          id="mobile-nav"
          className="glass fixed inset-x-3 bottom-3 top-[76px] z-30 flex flex-col gap-6 overflow-y-auto rounded-[30px] !bg-white/95 px-3 py-4 lg:hidden"
        >
          {nav}
          {footer}
        </div>
      )}
    </>
  );
}
