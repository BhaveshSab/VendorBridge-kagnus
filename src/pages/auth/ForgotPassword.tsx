import { ArrowLeft, ArrowRight, MailCheck } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";
import { AuthLayout } from "../../components/AuthLayout";
import { Button, Field, Input } from "../../components/ui";
import { api, ApiError, errorMessage } from "../../lib/api";

interface ForgotResponse {
  message: string;
  resetToken?: string;
  resetUrl?: string;
  expiresInMinutes?: number;
}

export default function ForgotPassword() {
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<ForgotResponse | null>(null);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      setError("Enter a valid email address.");
      return;
    }
    setLoading(true);
    try {
      const response = await api.post<ForgotResponse>("/auth/forgot-password", { email: email.trim() });
      setResult(response);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : errorMessage(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthLayout footer="Password resets expire after 30 minutes.">
      <div className="mb-6">
        <p className="eyebrow mb-2">Account recovery</p>
        <h1 className="text-[24px] font-semibold tracking-[-0.02em] text-ink">Reset your password</h1>
        <p className="mt-1 text-[13px] text-muted">
          Enter the email linked to your VendorBridge account and we will send a reset link.
        </p>
      </div>

      {result ? (
        <div className="card p-4 sm:p-5">
          <span className="flex h-10 w-10 items-center justify-center rounded-card bg-success-soft text-success">
            <MailCheck size={18} aria-hidden />
          </span>
          <h2 className="mt-3 text-[15px] font-semibold text-ink">Check your inbox</h2>
          <p className="mt-1 text-[12px] leading-relaxed text-muted">{result.message}</p>

          {result.resetUrl ? (
            <div className="mt-4 border border-brand-200 bg-brand-50 p-3">
              <p className="text-[11px] font-semibold text-brand-800">Local demo mode</p>
              <p className="mt-1 text-[11px] leading-relaxed text-brand-800/90">
                No mail transport is configured for this assignment build, so the reset link is shown here.
                In production this would be delivered by email.
              </p>
              <Link to={result.resetUrl} className="btn btn-primary btn-sm mt-3">
                Continue to reset password
                <ArrowRight size={13} />
              </Link>
            </div>
          ) : null}

          <Link to="/login" className="link mt-4 inline-flex items-center gap-1 text-[12px]">
            <ArrowLeft size={12} />
            Back to sign in
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
          <Field label="Work email" htmlFor="forgotEmail" required>
            <Input
              id="forgotEmail"
              type="email"
              autoComplete="email"
              placeholder="you@company.com"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
          </Field>
          <Button type="submit" className="mt-4 w-full" loading={loading} icon={<ArrowRight size={14} />}>
            Send reset link
          </Button>
          <Link to="/login" className="link mt-4 inline-flex items-center gap-1 text-[12px]">
            <ArrowLeft size={12} />
            Back to sign in
          </Link>
        </form>
      )}
    </AuthLayout>
  );
}
