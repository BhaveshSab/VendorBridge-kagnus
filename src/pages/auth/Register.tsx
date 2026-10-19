import { ArrowRight, Eye, EyeOff } from "lucide-react";
import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { AuthLayout } from "../../components/AuthLayout";
import { Button, Field, Input, Select, Textarea } from "../../components/ui";
import { useAuth } from "../../context/AuthContext";
import { useToast } from "../../context/ToastContext";
import { ApiError, errorMessage } from "../../lib/api";
import { COUNTRIES, VENDOR_CATEGORIES } from "../../lib/constants";

type FormState = {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  role: "vendor";
  country: string;
  companyName: string;
  category: string;
  additionalInfo: string;
  password: string;
  confirmPassword: string;
};

const initialForm: FormState = {
  firstName: "",
  lastName: "",
  email: "",
  phone: "",
  role: "vendor",
  country: "India",
  companyName: "",
  category: "IT Equipment",
  additionalInfo: "",
  password: "",
  confirmPassword: "",
};

export default function Register() {
  const { register } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const [form, setForm] = useState<FormState>(initialForm);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((current) => ({ ...current, [key]: value }));
    setErrors((current) => ({ ...current, [key]: "" }));
  }

  function validate() {
    const next: Record<string, string> = {};
    if (form.firstName.trim().length < 2) next.firstName = "Enter your first name.";
    if (form.lastName.trim().length < 2) next.lastName = "Enter your last name.";
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) next.email = "Enter a valid email address.";
    if (form.phone.replace(/\D/g, "").length < 7) next.phone = "Enter a valid phone number.";
    if (!form.country) next.country = "Choose your country.";
    if (form.password.length < 8) next.password = "Use at least 8 characters.";
    else if (!/[A-Za-z]/.test(form.password) || !/[0-9]/.test(form.password))
      next.password = "Include at least one letter and one number.";
    if (form.password !== form.confirmPassword) next.confirmPassword = "Passwords do not match.";
    if (form.role === "vendor" && form.companyName.trim().length < 2)
      next.companyName = "Enter your company name.";
    setErrors(next);
    return Object.keys(next).length === 0;
  }

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    if (!validate()) return;
    setLoading(true);
    try {
      await register({
        firstName: form.firstName.trim(),
        lastName: form.lastName.trim(),
        email: form.email.trim(),
        phone: form.phone.trim(),
        role: form.role,
        country: form.country,
        additionalInfo: form.additionalInfo.trim(),
        password: form.password,
        companyName: form.companyName.trim(),
        category: form.category,
      });
      toast.success("Account created", "Your vendor profile is pending verification.");
      navigate("/dashboard", { replace: true });
    } catch (err) {
      if (err instanceof ApiError && err.fields) setErrors(err.fields);
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthLayout
      wide
      footer="By creating an account you agree to procurement governance and compliance policies."
    >
      <div className="mb-6">
        <p className="eyebrow mb-2">Get started</p>
        <h1 className="text-[26px] font-black tracking-[-0.03em] text-ink sm:text-[30px]">Create your VendorBridge account</h1>
        <p className="mt-1.5 text-[13px] text-muted">
          Create a vendor account to submit your company for onboarding. Staff roles are assigned by an administrator.
        </p>
      </div>

      <form onSubmit={onSubmit} noValidate className="card p-6 sm:p-8 shadow-lg border-slate-200/90">
        {error ? (
          <div
            className="mb-5 rounded-xl border border-danger/30 border-l-4 border-l-danger bg-danger-soft px-4 py-3 text-[12px] text-danger font-medium"
            role="alert"
          >
            {error}
          </div>
        ) : null}

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="First name" htmlFor="firstName" error={errors.firstName} required>
            <Input
              id="firstName"
              value={form.firstName}
              onChange={(event) => update("firstName", event.target.value)}
              invalid={Boolean(errors.firstName)}
              autoComplete="given-name"
              placeholder="e.g. Rahul"
            />
          </Field>
          <Field label="Last name" htmlFor="lastName" error={errors.lastName} required>
            <Input
              id="lastName"
              value={form.lastName}
              onChange={(event) => update("lastName", event.target.value)}
              invalid={Boolean(errors.lastName)}
              autoComplete="family-name"
              placeholder="e.g. Mehta"
            />
          </Field>
          <Field label="Work email" htmlFor="regEmail" error={errors.email} required>
            <Input
              id="regEmail"
              type="email"
              value={form.email}
              onChange={(event) => update("email", event.target.value)}
              invalid={Boolean(errors.email)}
              autoComplete="email"
              placeholder="you@company.com"
            />
          </Field>
          <Field label="Phone number" htmlFor="phone" error={errors.phone} required>
            <Input
              id="phone"
              value={form.phone}
              onChange={(event) => update("phone", event.target.value)}
              invalid={Boolean(errors.phone)}
              autoComplete="tel"
              placeholder="+91 98765 43210"
            />
          </Field>
          <Field label="Account type" htmlFor="role" required>
            <Input id="role" value="Vendor" readOnly />
          </Field>
          <Field label="Country" htmlFor="country" error={errors.country} required>
            <Select
              id="country"
              value={form.country}
              onChange={(event) => update("country", event.target.value)}
            >
              {COUNTRIES.map((country) => (
                <option key={country} value={country}>
                  {country}
                </option>
              ))}
            </Select>
          </Field>

          <Field label="Company / Entity name" htmlFor="companyName" error={errors.companyName} required>
            <Input
              id="companyName"
              value={form.companyName}
              onChange={(event) => update("companyName", event.target.value)}
              invalid={Boolean(errors.companyName)}
              placeholder="e.g. Nova Office Supplies Pvt Ltd"
            />
          </Field>
          <Field label="Supply category" htmlFor="category" error={errors.category}>
            <Select
              id="category"
              value={form.category}
              onChange={(event) => update("category", event.target.value)}
            >
              {VENDOR_CATEGORIES.map((category) => (
                <option key={category} value={category}>
                  {category}
                </option>
              ))}
            </Select>
          </Field>

          <Field
            label="Password"
            htmlFor="regPassword"
            error={errors.password}
            hint="Minimum 8 characters with at least one letter and one number."
            required
            className="sm:col-span-1"
          >
            <div className="relative">
              <Input
                id="regPassword"
                type={showPassword ? "text" : "password"}
                value={form.password}
                onChange={(event) => update("password", event.target.value)}
                invalid={Boolean(errors.password)}
                autoComplete="new-password"
                placeholder="Create a password"
                className="pr-10"
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
          <Field label="Confirm password" htmlFor="confirmPassword" error={errors.confirmPassword} required>
            <Input
              id="confirmPassword"
              type="password"
              value={form.confirmPassword}
              onChange={(event) => update("confirmPassword", event.target.value)}
              invalid={Boolean(errors.confirmPassword)}
              autoComplete="new-password"
              placeholder="Repeat your password"
            />
          </Field>

          <Field
            label="Additional information"
            htmlFor="additionalInfo"
            error={errors.additionalInfo}
            hint="Optional notes for the onboarding administrator."
            className="sm:col-span-2"
          >
            <Textarea
              id="additionalInfo"
              value={form.additionalInfo}
              onChange={(event) => update("additionalInfo", event.target.value)}
              placeholder="Team division, specializations, or region context…"
              rows={2}
            />
          </Field>
        </div>

        <Button type="submit" className="mt-6 w-full btn-lg justify-center shadow-md" loading={loading} icon={<ArrowRight size={15} />}>
          {loading ? "Creating account…" : "Register as enterprise vendor"}
        </Button>

        <p className="mt-5 text-center text-[12px] text-muted">
          Already have an account?{" "}
          <Link to="/login" className="link">
            Sign in
          </Link>
        </p>
      </form>
    </AuthLayout>
  );
}
