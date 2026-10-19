import { ArrowRight, Eye, EyeOff, Lock, Mail, ShieldCheck } from "lucide-react";
import { useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { AuthLayout } from "../../components/AuthLayout";
import { Button, Field, Input } from "../../components/ui";
import { useAuth } from "../../context/AuthContext";
import { useToast } from "../../context/ToastContext";
import { errorMessage } from "../../lib/api";

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

    </AuthLayout>
  );
}
