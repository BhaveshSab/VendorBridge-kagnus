import { AnimatePresence, motion } from "framer-motion";
import { ChevronDown, LifeBuoy, LogOut, Menu, ShieldCheck, UserRound, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Link, NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { NAV_SECTIONS, PROFILE_NAV, type NavItem } from "../lib/constants";
import { initials } from "../lib/format";
import { Avatar, cn, IconButton } from "./ui";

function visible(item: NavItem, role: string | undefined) {
  if (!item.roles) return true;
  return role ? item.roles.includes(role as never) : false;
}

function SidebarContent({ onNavigate }: { onNavigate?: () => void }) {
  const { user, vendor, roleLabel, logout } = useAuth();
  const navigate = useNavigate();

  return (
    <div className="flex h-full flex-col">
      <nav className="scrollbar-thin flex-1 overflow-y-auto px-3 py-4" aria-label="Main navigation">
        {NAV_SECTIONS.map((section) => {
          const items = section.items.filter((item) => visible(item, user?.role));
          if (items.length === 0) return null;
          return (
            <div key={section.title} className="mb-4">
              <p className="mb-1 px-2 text-[10px] font-semibold uppercase tracking-[0.09em] text-muted">
                {section.title}
              </p>
              <ul className="space-y-0.5">
                {items.map((item) => {
                  const Icon = item.icon;
                  return (
                    <li key={item.to}>
                      <NavLink
                        to={item.to}
                        end={item.end}
                        onClick={onNavigate}
                        className={({ isActive }) => cn("nav-link", isActive && "active")}
                      >
                        <Icon size={16} className="nav-icon shrink-0" aria-hidden />
                        <span className="truncate">{item.label}</span>
                      </NavLink>
                    </li>
                  );
                })}
              </ul>
            </div>
          );
        })}

        <div className="mb-4">
          <p className="mb-1 px-2 text-[10px] font-semibold uppercase tracking-[0.09em] text-muted">Account</p>
          <NavLink
            to={PROFILE_NAV.to}
            onClick={onNavigate}
            className={({ isActive }) => cn("nav-link", isActive && "active")}
          >
            <UserRound size={16} className="nav-icon shrink-0" aria-hidden />
            <span>{vendor ? "My vendor profile" : "My profile"}</span>
          </NavLink>
        </div>

        <div className="card mx-1 mt-2 bg-surface-muted p-3">
          <p className="flex items-center gap-1.5 text-[11px] font-semibold text-ink">
            <LifeBuoy size={13} className="text-brand-600" aria-hidden />
            Need a hand?
          </p>
          <p className="mt-1 text-[11px] leading-relaxed text-muted">
            Week 1 covers the foundation, authentication and vendor management.
          </p>
          <span className="badge badge-open mt-2">Kagnus programme</span>
        </div>
      </nav>

      <div className="border-t border-line p-3">
        <div className="flex items-center gap-2">
          <Avatar name={user?.name ?? "VendorBridge"} />
          <div className="min-w-0 flex-1">
            <p className="truncate text-[12px] font-semibold text-ink">{user?.name}</p>
            <p className="truncate text-[10px] text-muted">{roleLabel}</p>
          </div>
          <IconButton
            label="Sign out"
            onClick={async () => {
              await logout();
              navigate("/login", { replace: true });
            }}
          >
            <LogOut size={14} />
          </IconButton>
        </div>
      </div>
    </div>
  );
}

function Header({ onMenu }: { onMenu: () => void }) {
  const { user, roleLabel, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setMenuOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    if (!menuOpen) return;
    const onClick = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) setMenuOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [menuOpen]);

  return (
    <header className="fixed inset-x-0 top-0 z-40 flex h-14 items-center gap-3 border-b border-brand-800 bg-brand-700 px-3 sm:px-4">
      <button
        type="button"
        className="flex h-9 w-9 items-center justify-center rounded-card text-brand-100 hover:bg-brand-800 hover:text-white lg:hidden"
        onClick={onMenu}
        aria-label="Open navigation"
      >
        <Menu size={18} />
      </button>

      <Link to="/dashboard" className="flex min-w-0 items-center gap-2">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-card bg-white text-[12px] font-bold tracking-tight text-brand-800">
          VB
        </span>
        <span className="min-w-0">
          <span className="block truncate text-[14px] font-semibold leading-tight text-white">VendorBridge</span>
          <span className="hidden text-[10px] leading-tight text-brand-200 sm:block">
            Procurement &amp; vendor management
          </span>
        </span>
      </Link>

      <span className="ml-2 hidden items-center gap-1.5 border-l border-brand-600 pl-3 text-[11px] text-brand-100 md:flex">
        <ShieldCheck size={13} aria-hidden />
        Kagnus workspace
      </span>

      <div className="ml-auto flex items-center gap-1 sm:gap-2">
        <div className="relative" ref={menuRef}>
          <button
            type="button"
            onClick={() => setMenuOpen((open) => !open)}
            className="flex items-center gap-2 rounded-card px-1.5 py-1 text-left hover:bg-brand-800 sm:px-2"
            aria-expanded={menuOpen}
            aria-haspopup="menu"
          >
            <span className="flex h-7 w-7 items-center justify-center rounded-full bg-brand-100 text-[10px] font-bold text-brand-800">
              {initials(user?.name)}
            </span>
            <span className="hidden min-w-0 sm:block">
              <span className="block max-w-[140px] truncate text-[11px] font-semibold leading-tight text-white">
                {user?.name}
              </span>
              <span className="block text-[10px] leading-tight text-brand-200">{roleLabel}</span>
            </span>
            <ChevronDown size={13} className="hidden text-brand-200 sm:block" aria-hidden />
          </button>

          <AnimatePresence>
            {menuOpen ? (
              <motion.div
                role="menu"
                initial={{ opacity: 0, y: -4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                transition={{ duration: 0.15 }}
                className="absolute right-0 top-[calc(100%+8px)] w-56 overflow-hidden rounded-card border border-line-strong bg-surface"
              >
                <div className="border-b border-line px-3 py-3">
                  <p className="truncate text-[12px] font-semibold text-ink">{user?.name}</p>
                  <p className="truncate text-[11px] text-muted">{user?.email}</p>
                  <span className="badge badge-open mt-2">{roleLabel}</span>
                </div>
                <Link
                  to="/profile"
                  role="menuitem"
                  className="flex items-center gap-2 px-3 py-2.5 text-[12px] text-ink-soft hover:bg-brand-50 hover:text-brand-700"
                >
                  <UserRound size={14} aria-hidden />
                  Profile &amp; security
                </Link>
                <button
                  type="button"
                  role="menuitem"
                  onClick={async () => {
                    await logout();
                    navigate("/login", { replace: true });
                  }}
                  className="flex w-full items-center gap-2 border-t border-line px-3 py-2.5 text-left text-[12px] text-danger hover:bg-danger-soft"
                >
                  <LogOut size={14} aria-hidden />
                  Sign out
                </button>
              </motion.div>
            ) : null}
          </AnimatePresence>
        </div>
      </div>
    </header>
  );
}

export function AppLayout() {
  const [mobileOpen, setMobileOpen] = useState(false);
  const location = useLocation();

  useEffect(() => {
    setMobileOpen(false);
  }, [location.pathname]);

  return (
    <div className="min-h-screen bg-canvas">
      <Header onMenu={() => setMobileOpen(true)} />

      <aside className="fixed bottom-0 left-0 top-14 z-30 hidden w-[236px] border-r border-line bg-surface lg:block">
        <SidebarContent />
      </aside>

      <AnimatePresence>
        {mobileOpen ? (
          <div className="fixed inset-0 z-50 lg:hidden">
            <motion.div
              className="absolute inset-0 bg-black/60"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.15 }}
              onClick={() => setMobileOpen(false)}
            />
            <motion.div
              initial={{ x: -260 }}
              animate={{ x: 0 }}
              exit={{ x: -260 }}
              transition={{ duration: 0.22, ease: "easeOut" }}
              className="relative flex h-full w-[264px] flex-col border-r border-line bg-surface"
              role="dialog"
              aria-modal="true"
              aria-label="Navigation menu"
            >
              <div className="flex h-14 items-center justify-between border-b border-line px-3">
                <span className="flex items-center gap-2">
                  <span className="flex h-8 w-8 items-center justify-center rounded-card bg-brand-700 text-[12px] font-bold text-white">
                    VB
                  </span>
                  <span className="text-[13px] font-semibold text-ink">VendorBridge</span>
                </span>
                <IconButton label="Close navigation" onClick={() => setMobileOpen(false)}>
                  <X size={16} />
                </IconButton>
              </div>
              <div className="min-h-0 flex-1">
                <SidebarContent onNavigate={() => setMobileOpen(false)} />
              </div>
            </motion.div>
          </div>
        ) : null}
      </AnimatePresence>

      <main className="min-h-screen pt-14 lg:pl-[236px]">
        <Outlet />
      </main>
    </div>
  );
}
