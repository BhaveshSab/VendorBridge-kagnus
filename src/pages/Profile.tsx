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
          eyebrow="Account"
          title="Profile & security"
          description="Your account details and the permissions enforced by the API."
        />

        <div className="grid gap-4 lg:grid-cols-3">
          <Card className="lg:col-span-2">
            <div className="flex flex-wrap items-center gap-3 border-b border-line px-4 py-4">
              <Avatar name={user?.name ?? "VendorBridge"} size="lg" />
              <div className="min-w-0 flex-1">
                <h2 className="text-[15px] font-semibold text-ink">{user?.name}</h2>
                <p className="text-[11px] text-muted">{roleLabel}</p>
              </div>
              <span className="badge badge-open">{roleLabel}</span>
            </div>
            <dl className="grid gap-4 px-4 py-4 sm:grid-cols-2">
              <div>
                <dt className="text-[10px] font-semibold uppercase tracking-[0.06em] text-muted">Email</dt>
                <dd className="mt-1 flex items-center gap-1.5 text-[12px] text-ink">
                  <Mail size={12} className="text-muted" />
                  {user?.email}
                </dd>
              </div>
              <div>
                <dt className="text-[10px] font-semibold uppercase tracking-[0.06em] text-muted">Phone</dt>
                <dd className="mt-1 flex items-center gap-1.5 text-[12px] text-ink">
                  <Phone size={12} className="text-muted" />
                  {user?.phone || "Not provided"}
                </dd>
              </div>
              <div>
                <dt className="text-[10px] font-semibold uppercase tracking-[0.06em] text-muted">Country</dt>
                <dd className="mt-1 flex items-center gap-1.5 text-[12px] text-ink">
                  <MapPin size={12} className="text-muted" />
                  {user?.country || "—"}
                </dd>
              </div>
              <div>
                <dt className="text-[10px] font-semibold uppercase tracking-[0.06em] text-muted">Member since</dt>
                <dd className="mt-1 text-[12px] text-ink">{formatDate(user?.createdAt)}</dd>
              </div>
              {user?.additionalInfo ? (
                <div className="sm:col-span-2">
                  <dt className="text-[10px] font-semibold uppercase tracking-[0.06em] text-muted">
                    Additional information
                  </dt>
                  <dd className="mt-1 text-[12px] text-ink-soft">{user.additionalInfo}</dd>
                </div>
              ) : null}
            </dl>
          </Card>

          <Card className="p-4">
            <h2 className="flex items-center gap-1.5 text-[13px] font-semibold text-ink">
              <ShieldCheck size={14} className="text-brand-600" />
              Access
            </h2>
            <ul className="mt-3 space-y-2">
              {PERMISSION_LABELS.map((permission) => {
                const allowed = Boolean(permissions?.[permission.key]);
                return (
                  <li key={permission.key} className="flex items-start gap-2 text-[11px]">
                    <span
                      className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-chip ${
                        allowed ? "bg-success-soft text-success" : "bg-neutral-soft text-muted"
                      }`}
                    >
                      {allowed ? <Check size={10} /> : <Minus size={10} />}
                    </span>
                    <span className={allowed ? "text-ink-soft" : "text-muted"}>{permission.label}</span>
                  </li>
                );
              })}
            </ul>
            <p className="mt-3 border-t border-line pt-3 text-[10px] leading-relaxed text-muted">
              Permissions are enforced by the API, not just hidden in the interface.
            </p>
          </Card>

          {vendor ? (
            <Card className="p-4 lg:col-span-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="flex items-center gap-1.5 text-[13px] font-semibold text-ink">
                  <Building2 size={14} className="text-brand-600" />
                  Vendor record
                </h2>
                <Link to="/vendors" className="link text-[11px]">
                  Open vendor profile
                </Link>
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-3">
                <span className="flex h-10 w-10 items-center justify-center rounded-card bg-brand-50 text-[13px] font-bold text-brand-700">
                  {vendor.name.slice(0, 2).toUpperCase()}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-[12px] font-semibold text-ink">{vendor.name}</p>
                  <p className="text-[11px] text-muted">
                    {vendor.code} · {vendor.category} · {vendor.city || vendor.country || "—"}
                  </p>
                </div>
                <Badge status={vendor.status} />
              </div>
            </Card>
          ) : null}

          <Card className="p-4">
            <h2 className="flex items-center gap-1.5 text-[13px] font-semibold text-ink">
              <KeyRound size={14} className="text-brand-600" />
              Security
            </h2>
            <p className="mt-2 text-[11px] leading-relaxed text-muted">
              Sessions are signed JWTs stored in an httpOnly cookie and expire after 8 hours. Passwords are hashed
              with bcrypt and never returned to the browser.
            </p>
            <div className="mt-3 space-y-2">
              <Link to="/forgot-password" className="btn btn-ghost btn-sm w-full">
                Change password
              </Link>
              <Button
                variant="danger-ghost"
                size="sm"
                className="w-full"
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
            <p className="mt-3 flex items-center gap-1.5 border-t border-line pt-3 text-[10px] text-muted">
              <UserRound size={11} />
              Signed in as {user?.email}
            </p>
          </Card>
        </div>
      </div>
    </Page>
  );
}
