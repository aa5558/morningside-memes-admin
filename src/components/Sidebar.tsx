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
    <nav aria-label="Admin" className="flex flex-col gap-0.5">
      {NAV.map((item) => (
        <Link
          key={item.href}
          href={item.href}
          onClick={() => setOpen(false)}
          aria-current={isActive(item.href) ? "page" : undefined}
          className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition ${
            isActive(item.href)
              ? "bg-white/12 text-white shadow-[inset_2px_0_0_#b9d9eb]"
              : "text-white/65 hover:bg-white/6 hover:text-white"
          }`}
        >
          <Icon d={item.icon} />
          {item.label}
        </Link>
      ))}
    </nav>
  );

  const footer = (
    <div className="mt-auto space-y-3 border-t border-white/10 pt-4">
      <a
        href={mainAppUrl}
        target="_blank"
        rel="noreferrer"
        className="flex items-center gap-2 px-3 text-xs text-white/55 hover:text-white"
      >
        Open Morningside Memes ↗
      </a>
      <div className="flex items-center gap-3 rounded-lg bg-white/5 p-2.5">
        {avatarUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={avatarUrl} alt="" className="h-8 w-8 rounded-full object-cover" />
        ) : (
          <span className="flex h-8 w-8 items-center justify-center rounded-full bg-columbia text-xs font-bold text-navy">
            {name.slice(0, 1).toUpperCase()}
          </span>
        )}
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-white">{name}</p>
          <p className="truncate text-xs text-white/50">{email}</p>
        </div>
      </div>
      <form action={signOutAction}>
        <button type="submit" className="w-full rounded-lg px-3 py-1.5 text-left text-xs font-medium text-white/60 hover:bg-white/6 hover:text-white">
          Sign out
        </button>
      </form>
    </div>
  );

  const brand = (
    <Link href="/" className="flex items-center gap-2.5">
      <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-columbia text-sm font-bold text-navy">MM</span>
      <span className="leading-tight">
        <span className="block text-sm font-semibold text-white">Morningside Memes</span>
        <span className="block text-[11px] font-medium uppercase tracking-[0.14em] text-columbia/80">Admin</span>
      </span>
    </Link>
  );

  return (
    <>
      {/* Desktop */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-60 flex-col gap-6 bg-navy-deep px-3 py-5 lg:flex">
        <div className="px-2">{brand}</div>
        {nav}
        {footer}
      </aside>

      {/* Mobile top bar + drawer */}
      <header className="sticky top-0 z-30 flex items-center justify-between bg-navy-deep px-4 py-3 lg:hidden">
        {brand}
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-controls="mobile-nav"
          className="rounded-lg p-2 text-white hover:bg-white/10"
        >
          <span className="sr-only">Menu</span>
          <svg aria-hidden viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
            {open ? <path d="M6 6l12 12M18 6L6 18" /> : <path d="M4 7h16M4 12h16M4 17h16" />}
          </svg>
        </button>
      </header>
      {open && (
        <div id="mobile-nav" className="fixed inset-x-0 top-[60px] bottom-0 z-30 flex flex-col gap-6 overflow-y-auto bg-navy-deep px-3 pb-6 pt-2 lg:hidden">
          {nav}
          {footer}
        </div>
      )}
    </>
  );
}
