import { Building2, Check, KeyRound, LogOut, Mail, MapPin, Minus, Phone, ShieldCheck, UserRound } from "lucide-react";
import { Link, useNavigate } from "react-router-dom";
import { Page } from "../components/guards";
import { Avatar, Badge, Button, Card, PageHeader } from "../components/ui";
import { useAuth } from "../context/AuthContext";
import { useToast } from "../context/ToastContext";
import { formatDate } from "../lib/format";

const PERMISSION_LABELS: { key: keyof NonNullable<ReturnType<typeof useAuth>["permissions"]>; label: string }[] = [
  { key: "manageVendors", label: "Create, update and delete vendor records" },
];

export default function Profile() {
  const { user, vendor, permissions, roleLabel, logout } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();

  return (
    <Page>
      <div className="page-shell">
        <PageHeader
          eyebrow="My Account"
          title="Profile & security"
          description="Your user credentials, role permissions and session security parameters."
        />

        <div className="grid gap-5 lg:grid-cols-3">
          <Card className="lg:col-span-2 overflow-hidden">
            <div className="flex flex-wrap items-center gap-4 border-b border-line bg-gradient-to-r from-blue-50/40 to-white px-6 py-5">
              <Avatar name={user?.name ?? "VendorBridge"} size="lg" />
              <div className="min-w-0 flex-1">
                <h2 className="text-[17px] font-bold text-ink">{user?.name}</h2>
                <p className="text-[12px] font-medium text-muted">{user?.email}</p>
              </div>
              <span className="badge badge-open">{roleLabel}</span>
            </div>
            <dl className="grid gap-5 px-6 py-6 sm:grid-cols-2">
              <div className="rounded-xl border border-slate-200/80 p-3.5 bg-slate-50/40">
                <dt className="text-[10px] font-bold uppercase tracking-[0.08em] text-muted">Email address</dt>
                <dd className="mt-1 flex items-center gap-1.5 text-[13px] font-bold text-ink">
                  <Mail size={13} className="text-slate-400" />
                  {user?.email}
                </dd>
              </div>
              <div className="rounded-xl border border-slate-200/80 p-3.5 bg-slate-50/40">
                <dt className="text-[10px] font-bold uppercase tracking-[0.08em] text-muted">Phone contact</dt>
                <dd className="mt-1 flex items-center gap-1.5 text-[13px] font-bold text-ink">
                  <Phone size={13} className="text-slate-400" />
                  {user?.phone || "Not provided"}
                </dd>
              </div>
              <div className="rounded-xl border border-slate-200/80 p-3.5 bg-slate-50/40">
                <dt className="text-[10px] font-bold uppercase tracking-[0.08em] text-muted">Country / region</dt>
                <dd className="mt-1 flex items-center gap-1.5 text-[13px] font-semibold text-ink">
                  <MapPin size={13} className="text-slate-400" />
                  {user?.country || "—"}
                </dd>
              </div>
              <div className="rounded-xl border border-slate-200/80 p-3.5 bg-slate-50/40">
                <dt className="text-[10px] font-bold uppercase tracking-[0.08em] text-muted">Member since</dt>
                <dd className="mt-1 text-[13px] font-semibold text-ink">{formatDate(user?.createdAt)}</dd>
              </div>
              {user?.additionalInfo ? (
                <div className="sm:col-span-2 rounded-xl border border-slate-200/80 p-3.5 bg-slate-50/40">
                  <dt className="text-[10px] font-bold uppercase tracking-[0.08em] text-muted">
                    Additional company details
                  </dt>
                  <dd className="mt-1 text-[13px] text-ink-soft leading-relaxed">{user.additionalInfo}</dd>
                </div>
              ) : null}
            </dl>
          </Card>

          <Card className="p-5 flex flex-col justify-between">
            <div>
              <h2 className="flex items-center gap-2 text-[14px] font-bold text-ink">
                <ShieldCheck size={16} className="text-brand-600" />
                Access Permissions
              </h2>
              <ul className="mt-3.5 space-y-2.5">
                {PERMISSION_LABELS.map((permission) => {
                  const allowed = Boolean(permissions?.[permission.key]);
                  return (
                    <li key={permission.key} className="flex items-start gap-2.5 text-[12px] p-2 rounded-lg bg-slate-50 border border-slate-100">
                      <span
                        className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full ${
                          allowed ? "bg-emerald-100 text-emerald-700" : "bg-slate-200 text-slate-500"
                        }`}
                      >
                        {allowed ? <Check size={11} /> : <Minus size={11} />}
                      </span>
                      <span className={allowed ? "font-semibold text-ink" : "text-muted"}>{permission.label}</span>
                    </li>
                  );
                })}
              </ul>
            </div>
            <p className="mt-4 border-t border-line pt-3.5 text-[11px] leading-relaxed text-muted">
              Role permissions are strictly verified server-side on every API call.
            </p>
          </Card>

          {vendor ? (
            <Card className="p-5 lg:col-span-2 overflow-hidden border-blue-100 bg-gradient-to-r from-blue-50/30 to-white">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line pb-3">
                <h2 className="flex items-center gap-2 text-[14px] font-bold text-ink">
                  <Building2 size={16} className="text-brand-600" />
                  Linked Vendor Record
                </h2>
                <Link to="/vendors" className="link text-[12px] font-bold">
                  Open full profile →
                </Link>
              </div>
              <div className="mt-4 flex flex-wrap items-center gap-3.5">
                <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-tr from-brand-600 to-indigo-600 text-[14px] font-bold text-white shadow-xs">
                  {vendor.name.slice(0, 2).toUpperCase()}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-[14px] font-bold text-ink">{vendor.name}</p>
                  <p className="text-[12px] text-muted">
                    <span className="font-mono bg-slate-100 px-1.5 py-0.5 rounded text-[10px] font-semibold text-slate-700 mr-1.5">{vendor.code}</span>
                    {vendor.category} · {vendor.city || vendor.country || "—"}
                  </p>
                </div>
                <Badge status={vendor.status} />
              </div>
            </Card>
          ) : null}

          <Card className="p-5">
            <h2 className="flex items-center gap-2 text-[14px] font-bold text-ink">
              <KeyRound size={16} className="text-brand-600" />
              Security &amp; Session
            </h2>
            <p className="mt-2 text-[12px] leading-relaxed text-muted">
              Sessions are signed JWTs in an httpOnly cookie with 8-hour lifetime.
            </p>
            <div className="mt-4 space-y-2.5">
              <Link to="/forgot-password" className="btn btn-ghost btn-sm w-full justify-center">
                Reset password
              </Link>
              <Button
                variant="danger-ghost"
                size="sm"
                className="w-full justify-center"
                icon={<LogOut size={13} />}
                onClick={async () => {
                  await logout();
                  toast.info("Signed out", "Your session has ended.");
                  navigate("/login", { replace: true });
                }}
              >
                Sign out
              </Button>
            </div>
            <p className="mt-4 flex items-center gap-1.5 border-t border-line pt-3.5 text-[11px] text-muted">
              <UserRound size={12} />
              Signed in as {user?.email}
            </p>
          </Card>
        </div>
      </div>
    </Page>
  );
}
