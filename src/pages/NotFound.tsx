import { ArrowLeft, Compass } from "lucide-react";
import { Link } from "react-router-dom";
import { Card } from "../components/ui";

export default function NotFound() {
  return (
    <div className="page-shell flex min-h-[70vh] items-center justify-center">
      <Card className="w-full max-w-md p-6 text-center">
        <span className="mx-auto flex h-11 w-11 items-center justify-center rounded-card bg-brand-50 text-brand-700">
          <Compass size={20} />
        </span>
        <p className="mt-3 text-[10px] font-semibold uppercase tracking-[0.1em] text-muted">Error 404</p>
        <h1 className="mt-1 text-[20px] font-semibold text-ink">This page is off the register</h1>
        <p className="mt-1 text-[12px] leading-relaxed text-muted">
          The page you are looking for does not exist or you do not have access to it.
        </p>
        <Link to="/dashboard" className="btn btn-primary btn-sm mt-4">
          <ArrowLeft size={13} />
          Back to dashboard
        </Link>
      </Card>
    </div>
  );
}
