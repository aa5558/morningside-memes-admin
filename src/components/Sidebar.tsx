"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";

const NAV = [
  { href: "/", label: "Overview", icon: "M3 12l9-8 9 8M5 10v10h5v-6h4v6h5V10" },
  { href: "/analytics", label: "Analytics", icon: "M4 20V10M10 20V4M16 20v-7M22 20H2" },
  { href: "/users", label: "Users", icon: "M16 19v-1a4 4 0 00-4-4H6a4 4 0 00-4 4v1M9 10a3 3 0 100-6 3 3 0 000 6M22 19v-1a4 4 0 00-3-3.9M16 4.1a3 3 0 010 5.8" },
  { href: "/media", label: "Media", icon: "M4 5h16v14H4zM4 15l4-4 4 4 3-3 5 5M15 9.5a1.5 1.5 0 100-3 1.5 1.5 0 000 3" },
  { href: "/votes", label: "Votes", icon: "M7 11l5-6 5 6M7 13l5 6 5-6" },
  { href: "/audit", label: "Audit log", icon: "M9 4h6M8 4H6v16h12V4h-2M9 10h6M9 14h6M9 18h3" },
];

function Icon({ d }: { d: string }) {
  return (
    <svg aria-hidden viewBox="0 0 24 24" className="h-[18px] w-[18px] shrink-0" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
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

  const isActive = (href: string) => (href === "/" ? pathname === "/" : pathname.startsWith(href));

  const nav = (
    <nav aria-label="Admin" className="flex flex-col gap-1">
      {NAV.map((item) => (
        <Link
          key={item.href}
          href={item.href}
          onClick={() => setOpen(false)}
          aria-current={isActive(item.href) ? "page" : undefined}
          className={`flex items-center gap-3 rounded-full px-3.5 py-2.5 text-sm font-medium transition ${
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
      <aside className="glass fixed inset-y-3 left-3 z-30 hidden w-60 flex-col gap-7 rounded-[30px] px-3 py-5 lg:flex">
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
            <svg aria-hidden viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
              {open ? <path d="M6 6l12 12M18 6L6 18" /> : <path d="M4 8h16M4 16h16" />}
            </svg>
          </button>
        </div>
      </header>
      {open && (
        <div id="mobile-nav" className="glass fixed inset-x-3 bottom-3 top-[76px] z-30 flex flex-col gap-6 overflow-y-auto rounded-[30px] !bg-white/95 px-3 py-4 lg:hidden">
          {nav}
          {footer}
        </div>
      )}
    </>
  );
}
