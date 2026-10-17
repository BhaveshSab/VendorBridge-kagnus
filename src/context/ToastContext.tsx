import { AnimatePresence, motion } from "framer-motion";
import { AlertTriangle, CheckCircle2, Info, X } from "lucide-react";
import { createContext, useCallback, useContext, useMemo, useRef, useState } from "react";

type ToastTone = "success" | "error" | "info";

interface ToastItem {
  id: number;
  tone: ToastTone;
  title: string;
  description?: string;
}

interface ToastValue {
  push: (tone: ToastTone, title: string, description?: string) => void;
  success: (title: string, description?: string) => void;
  error: (title: string, description?: string) => void;
  info: (title: string, description?: string) => void;
}

const ToastContext = createContext<ToastValue | null>(null);

const toneStyles: Record<ToastTone, { border: string; icon: typeof Info; iconColor: string }> = {
  success: { border: "border-l-success", icon: CheckCircle2, iconColor: "text-success" },
  error: { border: "border-l-danger", icon: AlertTriangle, iconColor: "text-danger" },
  info: { border: "border-l-brand-600", icon: Info, iconColor: "text-brand-600" },
};

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const nextId = useRef(1);

  const remove = useCallback((id: number) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const push = useCallback(
    (tone: ToastTone, title: string, description?: string) => {
      const id = nextId.current++;
      setToasts((current) => [...current.slice(-3), { id, tone, title, description }]);
      window.setTimeout(() => remove(id), 5000);
    },
    [remove],
  );

  const value = useMemo<ToastValue>(
    () => ({
      push,
      success: (title, description) => push("success", title, description),
      error: (title, description) => push("error", title, description),
      info: (title, description) => push("info", title, description),
    }),
    [push],
  );

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        className="pointer-events-none fixed bottom-16 right-4 z-50 flex w-[calc(100vw-32px)] max-w-sm flex-col gap-2 sm:bottom-6"
        aria-live="polite"
        role="status"
      >
        <AnimatePresence initial={false}>
          {toasts.map((toast) => {
            const style = toneStyles[toast.tone];
            const Icon = style.icon;
            return (
              <motion.div
                key={toast.id}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 8 }}
                transition={{ duration: 0.2, ease: "easeOut" }}
                className={`pointer-events-auto flex items-start gap-2 border border-line ${style.border} border-l-4 bg-surface p-3`}
                style={{ borderRadius: "5px" }}
              >
                <Icon size={16} className={`mt-1 shrink-0 ${style.iconColor}`} aria-hidden />
                <div className="min-w-0 flex-1">
                  <p className="text-[13px] font-semibold text-ink">{toast.title}</p>
                  {toast.description ? (
                    <p className="mt-1 text-xs leading-relaxed text-muted">{toast.description}</p>
                  ) : null}
                </div>
                <button
                  type="button"
                  className="icon-btn -mr-4 -mt-4 h-6 w-6"
                  onClick={() => remove(toast.id)}
                  aria-label="Dismiss notification"
                >
                  <X size={12} />
                </button>
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const context = useContext(ToastContext);
  if (!context) throw new Error("useToast must be used inside ToastProvider");
  return context;
}
