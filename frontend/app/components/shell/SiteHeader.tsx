"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useId, useRef, useState } from "react";

import { useSiteStaffAccess } from "@/app/hooks/useSiteStaffAccess";
import { getAccount } from "@/lib/account/api";
import { isStaffRole } from "@/lib/admin/api";

const staticLinks = [
  { href: "/", label: "Home" },
  { href: "/map", label: "Map" },
  { href: "/skins", label: "Skins" },
  { href: "/drinks", label: "Drinks" },
  { href: "/profile", label: "Profile" },
  { href: "/account", label: "Account" },
  { href: "/wiki", label: "Guide" },
  { href: "/updates", label: "Updates" },
] as const;

const staffLinks = [
  { href: "/precedent", label: "Precedent" },
  { href: "/inspect", label: "Inspect" },
] as const;

const adminLink = { href: "/admin", label: "Admin" } as const;

// Matches Tailwind's `lg` breakpoint, where the inline links replace the menu button.
const DESKTOP_QUERY = "(min-width: 64rem)";

function isActive(pathname: string, href: string) {
  return href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);
}

export default function SiteHeader() {
  const { state } = useSiteStaffAccess({ enabled: true });
  // Only a hint for showing the link: the panel and its API check the role.
  const [isAdmin, setIsAdmin] = useState(false);
  const links = [
    ...staticLinks,
    ...(state === "staff" ? staffLinks : []),
    ...(isAdmin ? [adminLink] : []),
  ];
  const pathname = usePathname() ?? "";
  const [open, setOpen] = useState(false);
  const menuId = useId();
  const toggleRef = useRef<HTMLButtonElement>(null);
  const logoRef = useRef<HTMLAnchorElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let active = true;
    getAccount()
      .then((account) => {
        if (active) setIsAdmin(isStaffRole(account?.user.role));
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);

  // The closed menu is inert, so hand focus to whichever header control is showing first.
  const closeMenu = useCallback(() => {
    if (menuRef.current?.contains(document.activeElement)) {
      const desktop = window.matchMedia(DESKTOP_QUERY).matches;
      (desktop ? logoRef.current : toggleRef.current)?.focus({ preventScroll: true });
    }
    setOpen(false);
  }, []);

  useEffect(() => setOpen(false), [pathname]);

  useEffect(() => {
    if (!open) return;
    const root = document.documentElement;
    root.classList.add("overflow-hidden");
    menuRef.current?.querySelector<HTMLElement>("a[href]")?.focus({ preventScroll: true });

    // Widening past the breakpoint hides the menu, so drop its scroll lock with it.
    const desktop = window.matchMedia(DESKTOP_QUERY);
    const closeOnDesktop = () => {
      if (desktop.matches) closeMenu();
    };
    desktop.addEventListener("change", closeOnDesktop);
    return () => {
      root.classList.remove("overflow-hidden");
      desktop.removeEventListener("change", closeOnDesktop);
    };
  }, [open, closeMenu]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      if (event.key === "Escape") {
        closeMenu();
        toggleRef.current?.focus();
        return;
      }
      // Keep Tab cycling through the menu rather than the page behind the backdrop.
      if (event.key !== "Tab") return;
      const items = menuRef.current?.querySelectorAll<HTMLElement>("a[href]");
      if (!items?.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      const inside = menuRef.current?.contains(document.activeElement);
      if (event.shiftKey && (document.activeElement === first || !inside)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (document.activeElement === last || !inside)) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, closeMenu]);

  return (
    <>
      <header
        className="sticky top-0 z-[100] grid h-14 grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center border-b border-[color-mix(in_srgb,var(--tfmc-cream)_12%,transparent)] bg-[color-mix(in_srgb,var(--tfmc-forest-deep)_92%,transparent)] px-2 backdrop-blur-md lg:flex lg:px-6"
        style={{ height: "var(--tfmc-header-h)" }}
      >
        <button
          ref={toggleRef}
          type="button"
          aria-label="Menu"
          aria-expanded={open}
          aria-controls={menuId}
          aria-haspopup="dialog"
          onClick={() => setOpen((value) => !value)}
          className="flex h-10 w-12 items-center justify-center justify-self-start rounded-md text-[var(--tfmc-cream)] transition-colors hover:bg-[color-mix(in_srgb,var(--tfmc-cream)_10%,transparent)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--tfmc-accent)] lg:hidden"
        >
          <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="h-7 w-7">
            <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5" />
          </svg>
        </button>
        <Link
          ref={logoRef}
          href="/"
          className="shrink-0 font-[family-name:var(--font-fraunces)] text-lg tracking-wide text-[var(--tfmc-cream)] transition-opacity hover:opacity-80 lg:mr-4"
        >
          TFMC
        </Link>
        <nav className="ml-auto hidden items-center gap-8 whitespace-nowrap lg:flex" aria-label="Main">
          {links.map(({ href, label }) => {
            const active = isActive(pathname, href);
            return (
              <Link
                key={href}
                href={href}
                aria-current={active ? "page" : undefined}
                className={`text-sm font-medium transition-colors hover:text-[var(--tfmc-cream)] ${active ? "text-[var(--tfmc-cream)]" : "text-[var(--tfmc-stone)]"}`}
              >
                {label}
              </Link>
            );
          })}
        </nav>
      </header>

      {/* Outside the header: its backdrop blur would otherwise pin these fixed layers to the bar. */}
      <div
        aria-hidden="true"
        onClick={closeMenu}
        className={`fixed inset-0 z-[110] bg-black/60 transition-opacity duration-500 lg:hidden ${open ? "opacity-100" : "pointer-events-none opacity-0"}`}
      />
      <div
        ref={menuRef}
        id={menuId}
        role="dialog"
        aria-modal="true"
        aria-label="Menu"
        inert={!open}
        onClick={(event) => {
          if ((event.target as HTMLElement).closest("a[href]")) closeMenu();
        }}
        className={`fixed inset-y-0 left-0 z-[120] flex w-[70%] max-w-xs flex-col overflow-y-auto overscroll-contain border-r border-[color-mix(in_srgb,var(--tfmc-cream)_10%,transparent)] bg-[color-mix(in_srgb,var(--tfmc-forest-deep)_88%,transparent)] px-5 pb-[max(1rem,env(safe-area-inset-bottom))] pt-[max(1rem,env(safe-area-inset-top))] backdrop-blur-xl transition-transform duration-500 ease-out lg:hidden ${open ? "translate-x-0" : "-translate-x-full"}`}
      >
        <Link
          href="/"
          className="mb-6 self-center font-[family-name:var(--font-fraunces)] text-3xl tracking-wide text-[var(--tfmc-cream)]"
        >
          TFMC
        </Link>
        <nav aria-label="Main" className="flex flex-col">
          {links.map(({ href, label }) => {
            const active = isActive(pathname, href);
            return (
              <Link
                key={href}
                href={href}
                aria-current={active ? "page" : undefined}
                className={`block py-[clamp(0.35rem,1vh,0.75rem)] text-[clamp(1.125rem,2.8vh,1.5rem)] font-bold uppercase tracking-[0.05em] transition-[color,translate] duration-200 hover:translate-x-2.5 hover:text-[var(--tfmc-cream)] focus-visible:outline-none focus-visible:translate-x-2.5 focus-visible:text-[var(--tfmc-cream)] ${active ? "translate-x-2.5 text-[var(--tfmc-accent)]" : "text-[color-mix(in_srgb,var(--tfmc-stone)_75%,transparent)]"}`}
              >
                {label}
              </Link>
            );
          })}
        </nav>
      </div>
    </>
  );
}
