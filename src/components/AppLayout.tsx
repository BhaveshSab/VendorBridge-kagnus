import { AnimatePresence, motion } from "framer-motion";
import { ChevronDown, LifeBuoy, LogOut, Menu, ShieldCheck, UserRound, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Link, NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { NAV_SECTIONS, PROFILE_NAV, type NavItem } from "../lib/constants";
import { initials } from "../lib/format";
import { Avatar, cn, IconButton } from "./ui";
import { NotificationBell } from "./NotificationBell";

function visible(item: NavItem, role: string | undefined) {
  if (!item.roles) return true;
  return role ? item.roles.includes(role as never) : false;
}

function SidebarContent({ onNavigate }: { onNavigate?: () => void }) {
  const { user, vendor, roleLabel, logout } = useAuth();
  const navigate = useNavigate();

  return (
    <div className="flex h-full flex-col">
      <nav className="scrollbar-thin flex-1 overflow-y-auto px-3.5 py-5" aria-label="Main navigation">
        {NAV_SECTIONS.map((section) => {
          const items = section.items.filter((item) => visible(item, user?.role));
          if (items.length === 0) return null;
          return (
            <div key={section.title} className="mb-5">
              <p className="mb-1.5 px-2.5 text-[10px] font-bold uppercase tracking-[0.1em] text-slate-400">
                {section.title}
              </p>
              <ul className="space-y-1">
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
                        <Icon size={17} className="nav-icon shrink-0" aria-hidden />
                        <span className="truncate">{item.label}</span>
                      </NavLink>
                    </li>
                  );
                })}
              </ul>
            </div>
          );
        })}

        <div className="mb-5">
          <p className="mb-1.5 px-2.5 text-[10px] font-bold uppercase tracking-[0.1em] text-slate-400">Account</p>
          <NavLink
            to={PROFILE_NAV.to}
            onClick={onNavigate}
            className={({ isActive }) => cn("nav-link", isActive && "active")}
          >
            <UserRound size={17} className="nav-icon shrink-0" aria-hidden />
            <span>{vendor ? "My vendor profile" : "My profile"}</span>
          </NavLink>
        </div>

        <div className="rounded-xl border border-blue-100 bg-gradient-to-br from-blue-50/80 to-indigo-50/50 p-3.5 shadow-xs">
          <p className="flex items-center gap-1.5 text-[12px] font-bold text-slate-900">
            <LifeBuoy size={14} className="text-brand-600" aria-hidden />
            VendorBridge ERP
          </p>
          <p className="mt-1 text-[11px] leading-relaxed text-slate-600">
            Enterprise supplier governance and procurement operating system.
          </p>
          <span className="badge badge-open mt-2 text-[10px]">Active workspace</span>
        </div>
      </nav>

      <div className="border-t border-slate-200/80 bg-slate-50/50 p-3.5">
        <div className="flex items-center gap-2.5">
          <Avatar name={user?.name ?? "VendorBridge"} size="sm" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-[12px] font-bold text-ink">{user?.name}</p>
            <p className="truncate text-[10px] font-medium text-muted">{roleLabel}</p>
          </div>
          <IconButton
            label="Sign out"
            onClick={async () => {
              await logout();
              navigate("/login", { replace: true });
            }}
            className="hover:bg-rose-50 hover:text-rose-600"
          >
            <LogOut size={15} />
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
    <header className="fixed inset-x-0 top-0 z-40 flex h-16 items-center gap-3.5 border-b border-slate-800 bg-slate-900 px-4 sm:px-6 shadow-sm">
      <button
        type="button"
        className="flex h-9 w-9 items-center justify-center rounded-lg text-slate-300 hover:bg-slate-800 hover:text-white lg:hidden transition-colors"
        onClick={onMenu}
        aria-label="Open navigation"
      >
        <Menu size={18} />
      </button>

      <Link to="/dashboard" className="flex min-w-0 items-center gap-2.5">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-tr from-blue-600 to-indigo-600 text-[13px] font-extrabold tracking-tight text-white shadow-md shadow-blue-500/25">
          VB
        </span>
        <span className="min-w-0">
          <span className="block truncate text-[15px] font-bold leading-tight text-white tracking-tight">VendorBridge</span>
          <span className="hidden text-[11px] leading-tight text-slate-400 sm:block">
            Procurement &amp; Vendor ERP
          </span>
        </span>
      </Link>

      <span className="ml-3 hidden items-center gap-1.5 border-l border-slate-700/80 pl-3.5 text-[11px] font-medium text-slate-300 md:flex">
        <ShieldCheck size={14} className="text-emerald-400" aria-hidden />
        Secure Enterprise Workspace
      </span>

      <div className="ml-auto flex items-center gap-2">
        <NotificationBell />
        <div className="relative" ref={menuRef}>
          <button
            type="button"
            onClick={() => setMenuOpen((open) => !open)}
            className="flex items-center gap-2.5 rounded-xl px-2 py-1.5 text-left hover:bg-slate-800/80 transition-colors"
            aria-expanded={menuOpen}
            aria-haspopup="menu"
          >
            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-tr from-blue-500 to-indigo-500 text-[11px] font-bold text-white shadow-xs">
              {initials(user?.name)}
            </span>
            <span className="hidden min-w-0 sm:block">
              <span className="block max-w-[150px] truncate text-[12px] font-bold leading-tight text-white">
                {user?.name}
              </span>
              <span className="block text-[11px] leading-tight text-slate-400">{roleLabel}</span>
            </span>
            <ChevronDown size={14} className="hidden text-slate-400 sm:block" aria-hidden />
          </button>

          <AnimatePresence>
            {menuOpen ? (
              <motion.div
                role="menu"
                initial={{ opacity: 0, scale: 0.96, y: -4 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.96, y: -4 }}
                transition={{ duration: 0.15 }}
                className="absolute right-0 top-[calc(100%+8px)] w-60 overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-xl"
              >
                <div className="border-b border-slate-100 bg-slate-50/70 px-4 py-3.5">
                  <p className="truncate text-[13px] font-bold text-ink">{user?.name}</p>
                  <p className="truncate text-[11px] text-muted">{user?.email}</p>
                  <span className="badge badge-open mt-2 text-[10px]">{roleLabel}</span>
                </div>
                <div className="p-1.5">
                  <Link
                    to="/profile"
                    role="menuitem"
                    className="flex items-center gap-2.5 rounded-lg px-3 py-2 text-[12px] font-medium text-ink-soft hover:bg-brand-50 hover:text-brand-700 transition-colors"
                  >
                    <UserRound size={15} aria-hidden />
                    Profile &amp; security
                  </Link>
                  <button
                    type="button"
                    role="menuitem"
                    onClick={async () => {
                      await logout();
                      navigate("/login", { replace: true });
                    }}
                    className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-[12px] font-medium text-danger hover:bg-danger-soft transition-colors"
                  >
                    <LogOut size={15} aria-hidden />
                    Sign out
                  </button>
                </div>
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

      <aside className="fixed bottom-0 left-0 top-16 z-30 hidden w-[248px] border-r border-slate-200/80 bg-white/85 backdrop-blur-md lg:block">
        <SidebarContent />
      </aside>

      <AnimatePresence>
        {mobileOpen ? (
          <div className="fixed inset-0 z-50 lg:hidden">
            <motion.div
              className="absolute inset-0 bg-slate-950/50 backdrop-blur-xs"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.15 }}
              onClick={() => setMobileOpen(false)}
            />
            <motion.div
              initial={{ x: -280 }}
              animate={{ x: 0 }}
              exit={{ x: -280 }}
              transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
              className="relative flex h-full w-[280px] flex-col border-r border-slate-200 bg-white shadow-2xl"
              role="dialog"
              aria-modal="true"
              aria-label="Navigation menu"
            >
              <div className="flex h-16 items-center justify-between border-b border-slate-100 px-4 bg-slate-900 text-white">
                <span className="flex items-center gap-2.5">
                  <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-gradient-to-tr from-blue-600 to-indigo-600 text-[12px] font-bold text-white">
                    VB
                  </span>
                  <span className="text-[14px] font-bold text-white">VendorBridge</span>
                </span>
                <IconButton label="Close navigation" onClick={() => setMobileOpen(false)} className="text-slate-300 hover:text-white hover:bg-slate-800">
                  <X size={18} />
                </IconButton>
              </div>
              <div className="min-h-0 flex-1">
                <SidebarContent onNavigate={() => setMobileOpen(false)} />
              </div>
            </motion.div>
          </div>
        ) : null}
      </AnimatePresence>

      <main className="min-h-screen pt-16 lg:pl-[248px]">
        <Outlet />
      </main>
    </div>
  );
}
