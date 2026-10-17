import { ArrowRight, Eye, EyeOff, Lock, Mail } from "lucide-react";
import { useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { AuthLayout } from "../../components/AuthLayout";
import { Button, Field, Input } from "../../components/ui";
import { useAuth } from "../../context/AuthContext";
import { useToast } from "../../context/ToastContext";
import { errorMessage } from "../../lib/api";

const DEMO_ACCOUNTS = [
  { role: "Procurement Officer", email: "procurement@vendorbridge.dev", password: "Procure@123" },
  { role: "Manager/Approver", email: "manager@vendorbridge.dev", password: "Manager@123" },
  { role: "Vendor", email: "vendor@vendorbridge.dev", password: "Vendor@123" },
  { role: "Admin", email: "admin@vendorbridge.dev", password: "Admin@123" },
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
    <AuthLayout footer="© 2026 VendorBridge · Built for the Kagnus procurement programme">
      <div className="mb-6">
        <p className="eyebrow mb-2">Welcome back</p>
        <h1 className="text-[24px] font-semibold tracking-[-0.02em] text-ink">Sign in to VendorBridge</h1>
        <p className="mt-1 text-[13px] text-muted">
          Access your procurement workspace, vendors and approvals.
        </p>
      </div>

      <form onSubmit={onSubmit} noValidate className="card p-4 sm:p-5">
        {error ? (
          <div className="mb-4 border border-danger/30 border-l-4 border-l-danger bg-danger-soft px-3 py-2 text-[12px] text-danger" role="alert">
            {error}
          </div>
        ) : null}

        <div className="space-y-4">
          <Field label="Work email" htmlFor="email" error={fieldErrors.email} required>
            <div className="relative">
              <Mail size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" aria-hidden />
              <Input
                id="email"
                type="email"
                autoComplete="email"
                placeholder="you@company.com"
                className="pl-8"
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
              <Lock size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" aria-hidden />
              <Input
                id="password"
                type={showPassword ? "text" : "password"}
                autoComplete="current-password"
                placeholder="Enter your password"
                className="pl-8 pr-10"
                value={password}
                invalid={Boolean(fieldErrors.password)}
                onChange={(event) => setPassword(event.target.value)}
              />
              <button
                type="button"
                onClick={() => setShowPassword((value) => !value)}
                className="absolute right-2 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-card text-muted hover:text-ink"
                aria-label={showPassword ? "Hide password" : "Show password"}
              >
                {showPassword ? <EyeOff size={14} /> : <Eye size={14} />}
              </button>
            </div>
          </Field>
        </div>

        <div className="mt-3 flex items-center justify-between">
          <span className="text-[11px] text-muted">Sessions expire after 8 hours.</span>
          <Link to="/forgot-password" className="link text-[12px]">
            Forgot password?
          </Link>
        </div>

        <Button type="submit" className="mt-4 w-full" loading={loading} icon={<ArrowRight size={14} />}>
          {loading ? "Signing in" : "Sign in"}
        </Button>

        <p className="mt-4 text-center text-[12px] text-muted">
          New to VendorBridge?{" "}
          <Link to="/register" className="link">
            Create an account
          </Link>
        </p>
      </form>

      <div className="mt-4">
        <button
          type="button"
          className="flex w-full items-center justify-between rounded-card border border-line bg-surface px-3 py-2 text-[11px] font-semibold text-ink-soft transition-colors hover:border-brand-300 hover:text-brand-700"
          onClick={() => setShowDemo((value) => !value)}
          aria-expanded={showDemo}
        >
          <span>Demo accounts for review</span>
          <span className="text-[10px] font-medium text-muted">{showDemo ? "Hide" : "Show"}</span>
        </button>
        {showDemo ? (
          <div className="mt-2 grid gap-1.5">
            {DEMO_ACCOUNTS.map((account) => (
              <button
                key={account.email}
                type="button"
                onClick={() => {
                  setEmail(account.email);
                  setPassword(account.password);
                  setFieldErrors({});
                  setError(null);
                }}
                className="flex items-center justify-between gap-2 rounded-card border border-line bg-surface px-3 py-2 text-left transition-colors hover:border-brand-300 hover:bg-brand-50"
              >
                <span className="min-w-0">
                  <span className="block text-[11px] font-semibold text-ink">{account.role}</span>
                  <span className="block truncate text-[10px] text-muted">{account.email}</span>
                </span>
                <span className="shrink-0 rounded-chip bg-surface-muted px-1.5 py-0.5 font-mono text-[10px] text-ink-soft">
                  {account.password}
                </span>
              </button>
            ))}
            <p className="px-1 text-[10px] leading-relaxed text-muted">
              Click any account to prefill the form. Credentials are seeded for local evaluation only.
            </p>
          </div>
        ) : null}
      </div>
    </AuthLayout>
  );
}
