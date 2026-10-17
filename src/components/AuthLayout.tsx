import { BadgeCheck, Building2, ClipboardCheck, ShieldCheck } from "lucide-react";
import { Link } from "react-router-dom";

const highlights = [
  {
    icon: Building2,
    title: "One vendor register",
    text: "Onboard, verify and govern every supplier from a single source of truth.",
  },
  {
    icon: ClipboardCheck,
    title: "Structured procurement",
    text: "RFQs, side-by-side quotations and approvals that follow policy.",
  },
  {
    icon: BadgeCheck,
    title: "Audit-ready by default",
    text: "Every award and purchase order is logged with the person behind it.",
  },
];

export function AuthLayout({
  children,
  footer,
  wide = false,
}: {
  children: React.ReactNode;
  footer?: React.ReactNode;
  wide?: boolean;
}) {
  return (
    <div className="min-h-screen bg-canvas lg:grid lg:grid-cols-[minmax(0,44%)_minmax(0,1fr)]">
      <aside className="relative hidden flex-col justify-between bg-brand-800 p-10 lg:flex">
        <Link to="/login" className="flex items-center gap-2.5">
          <span className="flex h-9 w-9 items-center justify-center rounded-card bg-white text-[13px] font-bold text-brand-800">
            VB
          </span>
          <span>
            <span className="block text-[15px] font-semibold leading-tight text-white">VendorBridge</span>
            <span className="block text-[10px] uppercase tracking-[0.14em] text-brand-200">
              Procurement suite
            </span>
          </span>
        </Link>

        <div className="max-w-sm">
          <p className="mb-4 inline-flex items-center gap-2 rounded-chip border border-brand-600 px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.1em] text-brand-100">
            <ShieldCheck size={12} aria-hidden />
            Kagnus Week 1
          </p>
          <h1 className="text-[30px] font-semibold leading-[1.15] tracking-[-0.02em] text-white">
            Procurement, without the paperwork.
          </h1>
          <p className="mt-3 text-[13px] leading-relaxed text-brand-200">
            VendorBridge brings vendor onboarding, sourcing, approvals and purchase orders into one governed
            workspace.
          </p>

          <ul className="mt-8 space-y-5">
            {highlights.map(({ icon: Icon, title, text }) => (
              <li key={title} className="flex gap-3">
                <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-card border border-brand-600 bg-brand-700 text-brand-100">
                  <Icon size={15} aria-hidden />
                </span>
                <span>
                  <span className="block text-[12px] font-semibold text-white">{title}</span>
                  <span className="mt-0.5 block text-[11px] leading-relaxed text-brand-200">{text}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>

        <div className="flex items-center justify-between border-t border-brand-700 pt-4 text-[10px] text-brand-300">
          <span>Secure role-based access</span>
          <span>v1.0 · Foundation release</span>
        </div>
      </aside>

      <main className="flex min-h-screen flex-col">
        <div className="flex items-center justify-between border-b border-line bg-surface px-4 py-3 lg:hidden">
          <Link to="/login" className="flex items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-card bg-brand-700 text-[11px] font-bold text-white">
              VB
            </span>
            <span className="text-[13px] font-semibold text-ink">VendorBridge</span>
          </Link>
          <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-muted">Kagnus</span>
        </div>

        <div className="flex flex-1 items-center justify-center px-4 py-8 sm:px-8">
          <div className={`w-full ${wide ? "max-w-[600px]" : "max-w-[440px]"}`}>{children}</div>
        </div>

        {footer ? <div className="border-t border-line px-4 py-4 text-center text-[11px] text-muted">{footer}</div> : null}
      </main>
    </div>
  );
}
