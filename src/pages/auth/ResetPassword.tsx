import { ArrowRight, CheckCircle2, ShieldAlert } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { AuthLayout } from "../../components/AuthLayout";
import { Button, Field, Input } from "../../components/ui";
import { api, errorMessage } from "../../lib/api";

export default function ResetPassword() {
  const [params, setParams] = useSearchParams();
  const tokenParam = params.get("token") || "";
  const [activeToken, setActiveToken] = useState(tokenParam);
  const [lookupEmail, setLookupEmail] = useState("");
  const [lookupLoading, setLookupLoading] = useState(false);
  const [lookupError, setLookupError] = useState<string | null>(null);
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);
  const [devHelpersEnabled, setDevHelpersEnabled] = useState(false);

  // Only offer the local-development token lookup when the server enables it.
  useEffect(() => {
    api
      .get<{ devResetLink: boolean }>("/auth/capabilities")
      .then((caps) => setDevHelpersEnabled(Boolean(caps?.devResetLink)))
      .catch(() => setDevHelpersEnabled(false));
  }, []);

  async function handleLookup(event: React.FormEvent) {
    event.preventDefault();
    setLookupError(null);
    if (!lookupEmail.trim()) {
      setLookupError("Please enter your account email.");
      return;
    }
    setLookupLoading(true);
    try {
      const res = await api.get<{ token: string }>(
        "/auth/dev-reset-link",
        { email: lookupEmail.trim() }
      );
      if (res?.token) {
        setActiveToken(res.token);
        setParams({ token: res.token });
      }
    } catch {
      setLookupError("No active reset token found. Request a new link first.");
    } finally {
      setLookupLoading(false);
    }
  }

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    const next: Record<string, string> = {};
    if (password.length < 8) next.password = "Use at least 8 characters.";
    else if (!/[A-Za-z]/.test(password) || !/[0-9]/.test(password))
      next.password = "Include at least one letter and one number.";
    if (password !== confirmPassword) next.confirmPassword = "Passwords do not match.";
    setErrors(next);
    if (Object.keys(next).length > 0) return;

    setLoading(true);
    try {
      await api.post("/auth/reset-password", { token: activeToken, password });
      setDone(true);
      setParams({}, { replace: true });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }

  if (!activeToken) {
    return (
      <AuthLayout>
        <div className="card p-6 sm:p-7 shadow-lg text-center">
          <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-amber-50 text-amber-600 border border-amber-200 shadow-xs">
            <ShieldAlert size={22} />
          </span>
          <h1 className="mt-4 text-[17px] font-bold text-ink">Reset token required</h1>
          <p className="mt-1.5 text-[13px] text-muted leading-relaxed">
            {devHelpersEnabled
              ? "Please use the secure link delivered to your email, or load your active development reset token below:"
              : "Please use the secure link delivered to your email. Reset links expire after 30 minutes and can only be used once."}
          </p>

          {devHelpersEnabled ? (
          <form onSubmit={handleLookup} className="mt-5 text-left bg-slate-50 p-4 rounded-xl border border-slate-200">
            {lookupError ? (
              <div className="mb-3 rounded-lg bg-danger-soft px-3 py-2 text-[11.5px] text-danger font-medium border border-danger/20">
                {lookupError}
              </div>
            ) : null}
            <Field label="Registered work email" htmlFor="lookupEmail">
              <Input
                id="lookupEmail"
                type="email"
                placeholder="you@company.com"
                value={lookupEmail}
                onChange={(e) => setLookupEmail(e.target.value)}
              />
            </Field>
            <Button type="submit" className="mt-3 w-full btn-sm justify-center" loading={lookupLoading}>
              Retrieve active reset token
            </Button>
          </form>
          ) : null}

          <div className="mt-4 pt-3 border-t border-slate-100 flex items-center justify-center gap-3">
            <Link to="/forgot-password" className="btn btn-primary btn-sm inline-flex items-center gap-1.5">
              Request a new reset link
            </Link>
            <Link to="/login" className="btn btn-ghost btn-sm">
              Return to sign in
            </Link>
          </div>
        </div>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout footer="Passwords must contain at least 8 characters with letters and numbers.">
      <div className="mb-6">
        <p className="eyebrow mb-2">Account recovery</p>
        <h1 className="text-[26px] font-black tracking-[-0.03em] text-ink sm:text-[30px]">Choose a new password</h1>
      </div>

      {done ? (
        <div className="card p-6 sm:p-7 shadow-lg border-slate-200/90 text-center">
          <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-emerald-50 text-emerald-600 border border-emerald-200 shadow-xs">
            <CheckCircle2 size={22} />
          </span>
          <h2 className="mt-4 text-[16px] font-bold text-ink">Password updated successfully</h2>
          <p className="mt-1.5 text-[13px] text-muted">Your new credentials are now active. Sign in to access your workspace.</p>
          <Link to="/login" className="btn btn-primary btn-lg mt-5 w-full justify-center shadow-md inline-flex items-center gap-2">
            Go to sign in
            <ArrowRight size={15} />
          </Link>
        </div>
      ) : (
        <form onSubmit={onSubmit} className="card p-6 sm:p-7 shadow-lg border-slate-200/90" noValidate>
          {error ? (
            <div
              className="mb-4 rounded-xl border border-danger/30 border-l-4 border-l-danger bg-danger-soft px-4 py-3 text-[12px] text-danger font-medium"
              role="alert"
            >
              {error}
            </div>
          ) : null}
          <div className="space-y-4">
            <Field label="New password" htmlFor="newPassword" error={errors.password} required>
              <Input
                id="newPassword"
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                autoComplete="new-password"
                invalid={Boolean(errors.password)}
                placeholder="At least 8 characters"
              />
            </Field>
            <Field label="Confirm new password" htmlFor="confirmNewPassword" error={errors.confirmPassword} required>
              <Input
                id="confirmNewPassword"
                type="password"
                value={confirmPassword}
                onChange={(event) => setConfirmPassword(event.target.value)}
                autoComplete="new-password"
                invalid={Boolean(errors.confirmPassword)}
                placeholder="Repeat your new password"
              />
            </Field>
          </div>
          <Button type="submit" className="mt-5 w-full btn-lg justify-center shadow-md" loading={loading}>
            Update password
          </Button>
        </form>
      )}
    </AuthLayout>
  );
}
