import { ArrowRight, Check, Eye, EyeOff, Lock, Mail, ShieldCheck, Sparkles } from "lucide-react";
import { useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { AuthLayout } from "../../components/AuthLayout";
import { Button, Field, Input } from "../../components/ui";
import { useAuth } from "../../context/AuthContext";
import { useToast } from "../../context/ToastContext";
import { errorMessage } from "../../lib/api";

const DEMO_ACCOUNTS = [
  { role: "Procurement Officer", email: "procurement@vendorbridge.dev", password: "Procure@123", badge: "bg-blue-50 text-blue-700 border-blue-200" },
  { role: "Manager/Approver", email: "manager@vendorbridge.dev", password: "Manager@123", badge: "bg-indigo-50 text-indigo-700 border-indigo-200" },
  { role: "Vendor", email: "vendor@vendorbridge.dev", password: "Vendor@123", badge: "bg-amber-50 text-amber-700 border-amber-200" },
  { role: "Admin", email: "admin@vendorbridge.dev", password: "Admin@123", badge: "bg-purple-50 text-purple-700 border-purple-200" },
];

export default function Login() {
  const { login } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const location = useLocation();
  const from = (location.state as { from?: string } | null)?.from;
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [showDemo, setShowDemo] = useState(true);
  const [selectedDemo, setSelectedDemo] = useState<string | null>(null);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    const errors: Record<string, string> = {};
    if (!email.trim()) errors.email = "Enter your email address.";
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) errors.email = "Enter a valid email address.";
    if (!password) errors.password = "Enter your password.";
    setFieldErrors(errors);
    if (Object.keys(errors).length > 0) return;

    setLoading(true);
    try {
      await login(email.trim(), password);
      toast.success("Welcome back", "You are signed in to VendorBridge.");
      navigate(from && from !== "/login" ? from : "/dashboard", { replace: true });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthLayout footer="© 2026 VendorBridge · Enterprise Procurement Platform">
      <div className="mb-6">
        <p className="eyebrow mb-2">Welcome back</p>
        <h1 className="text-[26px] font-black tracking-[-0.03em] text-ink sm:text-[30px]">Sign in to VendorBridge</h1>
        <p className="mt-1.5 text-[13px] text-muted leading-relaxed">
          Access your procurement workspace, vendor register and approval queues.
        </p>
      </div>

      <form onSubmit={onSubmit} noValidate className="card p-5 sm:p-7 shadow-lg border-slate-200/90">
        {error ? (
          <div className="mb-4 rounded-xl border border-danger/30 border-l-4 border-l-danger bg-danger-soft px-4 py-3 text-[12px] text-danger font-medium" role="alert">
            {error}
          </div>
        ) : null}

        <div className="space-y-4">
          <Field label="Work email" htmlFor="email" error={fieldErrors.email} required>
            <div className="relative">
              <Mail size={15} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-muted" aria-hidden />
              <Input
                id="email"
                type="email"
                autoComplete="email"
                placeholder="you@company.com"
                className="pl-9"
                value={email}
                invalid={Boolean(fieldErrors.email)}
                onChange={(event) => setEmail(event.target.value)}
              />
            </div>
          </Field>

          <Field
            label="Password"
            htmlFor="password"
            error={fieldErrors.password}
            required
          >
            <div className="relative">
              <Lock size={15} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-muted" aria-hidden />
              <Input
                id="password"
                type={showPassword ? "text" : "password"}
                autoComplete="current-password"
                placeholder="Enter your password"
                className="pl-9 pr-10"
                value={password}
                invalid={Boolean(fieldErrors.password)}
                onChange={(event) => setPassword(event.target.value)}
              />
              <button
                type="button"
                onClick={() => setShowPassword((value) => !value)}
                className="absolute right-2.5 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-lg text-muted hover:text-ink hover:bg-slate-100 transition-colors"
                aria-label={showPassword ? "Hide password" : "Show password"}
              >
                {showPassword ? <EyeOff size={15} /> : <Eye size={15} />}
              </button>
            </div>
          </Field>
        </div>

        <div className="mt-4 flex items-center justify-between">
          <span className="text-[11px] text-muted flex items-center gap-1">
            <ShieldCheck size={12} className="text-emerald-500" />
            8h secure session
          </span>
          <Link to="/forgot-password" className="link text-[12px]">
            Forgot password?
          </Link>
        </div>

        <Button type="submit" className="mt-5 w-full btn-lg justify-center shadow-md" loading={loading} icon={<ArrowRight size={15} />}>
          {loading ? "Signing in…" : "Sign in to workspace"}
        </Button>

        <p className="mt-5 text-center text-[12px] text-muted">
          New to VendorBridge?{" "}
          <Link to="/register" className="link">
            Create an account
          </Link>
        </p>
      </form>

      {/* Demo Credentials Helper */}
      <div className="mt-5">
        <button
          type="button"
          className="flex w-full items-center justify-between rounded-xl border border-slate-200/80 bg-white/80 backdrop-blur-sm px-4 py-2.5 text-[12px] font-bold text-ink-soft transition-all hover:border-blue-300 hover:text-brand-700 shadow-xs"
          onClick={() => setShowDemo((value) => !value)}
          aria-expanded={showDemo}
        >
          <span className="flex items-center gap-2">
            <Sparkles size={14} className="text-amber-500" />
            Quick Demo Accounts
          </span>
          <span className="text-[11px] font-semibold text-muted">{showDemo ? "Hide shortcuts" : "Show shortcuts"}</span>
        </button>

        {showDemo ? (
          <div className="mt-2.5 grid gap-2">
            {DEMO_ACCOUNTS.map((account) => {
              const isSelected = selectedDemo === account.role;
              return (
                <button
                  key={account.email}
                  type="button"
                  onClick={() => {
                    setEmail(account.email);
                    setPassword(account.password);
                    setSelectedDemo(account.role);
                    setFieldErrors({});
                    setError(null);
                  }}
                  className={`flex items-center justify-between gap-3 rounded-xl border p-3 text-left transition-all ${
                    isSelected
                      ? "border-brand-500 bg-brand-50/70 shadow-xs ring-2 ring-brand-500/20"
                      : "border-slate-200/80 bg-white hover:border-slate-300 hover:bg-slate-50/60"
                  }`}
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-bold border ${account.badge}`}>
                        {account.role}
                      </span>
                      {isSelected ? <span className="text-[10px] font-bold text-brand-600 flex items-center gap-0.5"><Check size={11} /> Selected</span> : null}
                    </div>
                    <span className="mt-1 block truncate text-[11px] font-medium text-muted">{account.email}</span>
                  </div>
                  <span className="shrink-0 rounded-lg bg-slate-100 px-2 py-1 font-mono text-[10px] font-bold text-slate-700 border border-slate-200">
                    {account.password}
                  </span>
                </button>
              );
            })}
            <p className="px-1 text-[11px] leading-relaxed text-muted">
              Click any role card to prefill the login form instantly.
            </p>
          </div>
        ) : null}
      </div>
    </AuthLayout>
  );
}
