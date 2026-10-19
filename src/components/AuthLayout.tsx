import { motion, type Variants } from "framer-motion";
import { BadgeCheck, Building2, ClipboardCheck, ShieldCheck, Sparkles } from "lucide-react";
import { Link } from "react-router-dom";

const highlights = [
  {
    icon: Building2,
    title: "Unified vendor register",
    text: "Onboard, verify and govern every supplier from a single compliant source of truth.",
  },
  {
    icon: ClipboardCheck,
    title: "Structured procurement",
    text: "RFQs, side-by-side quotations and award approvals following organizational policy.",
  },
  {
    icon: BadgeCheck,
    title: "Audit-ready governance",
    text: "Every vendor modification, status change and procurement award is tracked.",
  },
];

const highlightListVariants: Variants = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.1, delayChildren: 0.08 } },
};

const highlightCardVariants: Variants = {
  hidden: { opacity: 0, y: 10 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.35, ease: "easeOut" } },
};

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
    <div className="min-h-screen bg-canvas lg:grid lg:grid-cols-[minmax(0,45%)_minmax(0,1fr)]">
      {/* Brand Side Panel */}
      <aside className="relative hidden flex-col bg-gradient-to-br from-slate-950 via-slate-900 to-indigo-950 p-10 xl:p-12 text-white lg:flex overflow-hidden">
        {/* Subtle decorative glow circles */}
        <div className="pointer-events-none absolute -right-20 -top-20 h-80 w-80 rounded-full bg-blue-600/15 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-20 -left-20 h-80 w-80 rounded-full bg-indigo-600/15 blur-3xl" />

        <Link to="/login" className="relative z-10 flex items-center gap-3 w-fit">
          <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-tr from-blue-600 to-indigo-600 text-[15px] font-black tracking-tight text-white shadow-lg shadow-blue-500/30">
            VB
          </span>
          <span>
            <span className="block text-[18px] font-extrabold leading-tight tracking-tight text-white">VendorBridge</span>
            <span className="block text-[10px] font-bold uppercase tracking-[0.16em] text-blue-300">
              Procurement &amp; ERP
            </span>
          </span>
        </Link>

        {/* Hero Section shifted upward into the visual focal zone */}
        <div className="relative z-10 max-w-lg mt-10 xl:mt-14 mb-auto">
          <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-sky-400/30 bg-sky-500/10 px-3.5 py-1 text-[11px] font-semibold tracking-wide text-sky-200 backdrop-blur-md shadow-xs shadow-sky-500/10">
            <Sparkles size={12} className="text-sky-300" aria-hidden />
            <span>Enterprise Procurement Platform</span>
          </div>

          <h1 className="text-[32px] sm:text-[36px] xl:text-[40px] font-black leading-[1.14] tracking-[-0.035em] text-white">
            Procurement,{" "}
            <span className="bg-gradient-to-r from-blue-300 via-sky-200 to-indigo-200 bg-clip-text text-transparent">
              without the paperwork.
            </span>
          </h1>

          <p className="mt-3.5 text-[14.5px] leading-relaxed text-slate-300/90 font-normal">
            VendorBridge brings supplier onboarding, compliance verification, and vendor management into one governed workspace.
          </p>

          <motion.ul
            className="mt-8 space-y-3"
            variants={highlightListVariants}
            initial="hidden"
            animate="visible"
          >
            {highlights.map(({ icon: Icon, title, text }) => (
              <motion.li
                key={title}
                variants={highlightCardVariants}
                className="flex items-start gap-3.5 p-3.5 rounded-2xl bg-white/[0.04] border border-white/[0.08] hover:bg-white/[0.08] hover:border-blue-400/30 transition-all duration-200 group"
              >
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-blue-500/20 to-indigo-500/20 border border-blue-400/25 text-blue-300 group-hover:scale-105 group-hover:text-white group-hover:bg-blue-600 transition-all shadow-xs">
                  <Icon size={17} aria-hidden />
                </span>
                <div className="min-w-0 flex-1">
                  <span className="block text-[13.5px] font-semibold text-white tracking-tight">{title}</span>
                  <span className="mt-0.5 block text-[12px] leading-relaxed text-slate-300/80">{text}</span>
                </div>
              </motion.li>
            ))}
          </motion.ul>
        </div>

        <div className="relative z-10 mt-8 flex items-center justify-between border-t border-slate-800/80 pt-5 text-[11px] text-slate-400">
          <span className="flex items-center gap-1.5">
            <ShieldCheck size={13} className="text-emerald-400" />
            Secure role-based access
          </span>
          <span>Enterprise edition · Active</span>
        </div>
      </aside>

      {/* Main Auth Form Container */}
      <main className="flex min-h-screen flex-col">
        <div className="flex items-center justify-between border-b border-line bg-white px-5 py-3.5 lg:hidden">
          <Link to="/login" className="flex items-center gap-2.5">
            <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-gradient-to-tr from-blue-600 to-indigo-600 text-[12px] font-bold text-white">
              VB
            </span>
            <span className="text-[14px] font-bold text-ink">VendorBridge</span>
          </Link>
          <span className="text-[10px] font-bold uppercase tracking-[0.08em] text-muted">Enterprise</span>
        </div>

        <div className="flex flex-1 items-center justify-center px-4 py-10 sm:px-8">
          <div className={`w-full ${wide ? "max-w-[620px]" : "max-w-[460px]"}`}>{children}</div>
        </div>

        {footer ? <div className="border-t border-line/80 px-4 py-4 text-center text-[11px] text-muted bg-white/50">{footer}</div> : null}
      </main>
    </div>
  );
}
