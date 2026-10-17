import { ArrowRight, CheckCircle2, ShieldAlert } from "lucide-react";
import { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { AuthLayout } from "../../components/AuthLayout";
import { Button, Field, Input } from "../../components/ui";
import { api, errorMessage } from "../../lib/api";

export default function ResetPassword() {
  const [params] = useSearchParams();
  const token = params.get("token") || "";
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);

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
      await api.post("/auth/reset-password", { token, password });
      setDone(true);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }

  if (!token) {
    return (
      <AuthLayout>
        <div className="card p-5 text-center">
          <span className="mx-auto flex h-10 w-10 items-center justify-center rounded-card bg-danger-soft text-danger">
            <ShieldAlert size={18} />
          </span>
          <h1 className="mt-3 text-[16px] font-semibold text-ink">Reset link missing</h1>
          <p className="mt-1 text-[12px] text-muted">
            Open the reset link from your email, or request a new one.
          </p>
          <Link to="/forgot-password" className="btn btn-primary btn-sm mt-4">
            Request a new link
          </Link>
        </div>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout footer="Passwords must contain at least one letter and one number.">
      <div className="mb-6">
        <p className="eyebrow mb-2">Account recovery</p>
        <h1 className="text-[24px] font-semibold tracking-[-0.02em] text-ink">Choose a new password</h1>
      </div>

      {done ? (
        <div className="card p-5">
          <span className="flex h-10 w-10 items-center justify-center rounded-card bg-success-soft text-success">
            <CheckCircle2 size={18} />
          </span>
          <h2 className="mt-3 text-[15px] font-semibold text-ink">Password updated</h2>
          <p className="mt-1 text-[12px] text-muted">Your new password is active. Sign in to continue.</p>
          <Link to="/login" className="btn btn-primary btn-sm mt-4">
            Go to sign in
            <ArrowRight size={13} />
          </Link>
        </div>
      ) : (
        <form onSubmit={onSubmit} className="card p-4 sm:p-5" noValidate>
          {error ? (
            <div
              className="mb-4 border border-danger/30 border-l-4 border-l-danger bg-danger-soft px-3 py-2 text-[12px] text-danger"
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
          <Button type="submit" className="mt-4 w-full" loading={loading}>
            Update password
          </Button>
        </form>
      )}
    </AuthLayout>
  );
}
