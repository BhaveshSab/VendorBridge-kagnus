import { ArrowLeft, ArrowRight, Check, Copy, ExternalLink, KeyRound, MailCheck } from "lucide-react";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { AuthLayout } from "../../components/AuthLayout";
import { useAuth } from "../../context/AuthContext";
import { Button, Field, Input } from "../../components/ui";
import { api, ApiError, errorMessage } from "../../lib/api";

interface ForgotResponse {
  message: string;
}

export default function ForgotPassword() {
  const { user } = useAuth();
  const [email, setEmail] = useState("");
  useEffect(() => {
    if (user?.email) setEmail((current) => current || user.email);
  }, [user?.email]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<ForgotResponse | null>(null);
  const [devResetUrl, setDevResetUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

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
      try {
        const dev = await api.get<{ resetUrl: string }>(
          "/auth/dev-reset-link",
          { email: email.trim() }
        );
        if (dev?.resetUrl) {
          setDevResetUrl(dev.resetUrl);
        }
      } catch {
        // If external email provider is active or lookup failed, continue gracefully
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : errorMessage(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthLayout footer="Password resets expire after 30 minutes for enterprise security.">
      <div className="mb-6">
        <p className="eyebrow mb-2">Account recovery</p>
        <h1 className="text-[26px] font-black tracking-[-0.03em] text-ink sm:text-[30px]">Reset your password</h1>
        <p className="mt-1.5 text-[13px] text-muted">
          Enter the email linked to your VendorBridge account and we will dispatch a secure reset link.
        </p>
      </div>

      {result ? (
        <div className="card p-6 sm:p-7 shadow-lg border-slate-200/90 text-center">
          <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-emerald-50 text-emerald-600 border border-emerald-200 shadow-xs">
            <MailCheck size={22} aria-hidden />
          </span>
          <h2 className="mt-4 text-[17px] font-bold text-ink">Check your inbox</h2>
          <p className="mt-1.5 text-[13px] leading-relaxed text-muted">{result.message}</p>

          {devResetUrl ? (
            <div className="mt-5 rounded-2xl border border-blue-200 bg-gradient-to-br from-blue-50/90 to-indigo-50/70 p-4 text-left shadow-xs">
              <div className="flex items-center gap-2 text-[12px] font-bold text-blue-950">
                <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-blue-600 text-white shadow-xs">
                  <KeyRound size={13} />
                </span>
                <span>Direct Reset Link (Local Development)</span>
              </div>
              <p className="mt-2 text-[12px] leading-relaxed text-blue-800">
                Because email delivery is running in local development mode without an external mail provider, you can open your reset link directly below:
              </p>
              <div className="mt-3.5 flex flex-col gap-2 sm:flex-row">
                <a
                  href={devResetUrl}
                  className="btn btn-primary btn-sm flex-1 justify-center shadow-xs inline-flex items-center gap-1.5"
                >
                  <span>Reset password now</span>
                  <ExternalLink size={13} />
                </a>
                <button
                  type="button"
                  onClick={() => {
                    navigator.clipboard.writeText(devResetUrl);
                    setCopied(true);
                    setTimeout(() => setCopied(false), 2000);
                  }}
                  className="btn btn-ghost btn-sm justify-center inline-flex items-center gap-1.5"
                >
                  {copied ? <Check size={13} className="text-emerald-600" /> : <Copy size={13} />}
                  <span>{copied ? "Copied!" : "Copy URL"}</span>
                </button>
              </div>
            </div>
          ) : (
            <p className="mt-3 text-[11px] leading-relaxed text-muted bg-slate-50 p-3 rounded-xl border border-slate-100">
              The reset link expires after 30 minutes and can only be used once. If you don't see the email, check your spam folder or verify your registered email address.
            </p>
          )}

          <Link to="/login" className="btn btn-ghost btn-sm mt-5 inline-flex items-center gap-1.5">
            <ArrowLeft size={13} />
            Back to sign in
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
          <Button type="submit" className="mt-5 w-full btn-lg justify-center shadow-md" loading={loading} icon={<ArrowRight size={15} />}>
            Send password reset link
          </Button>
          <div className="mt-4 text-center">
            <Link to="/login" className="link inline-flex items-center gap-1.5 text-[12px]">
              <ArrowLeft size={13} />
              Return to sign in
            </Link>
          </div>
        </form>
      )}
    </AuthLayout>
  );
}
