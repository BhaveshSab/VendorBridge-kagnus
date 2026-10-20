import { lazy, Suspense } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { AppLayout } from "./components/AppLayout";
import { PublicOnly, RequireAuth, RequireRole } from "./components/guards";
import { Spinner } from "./components/ui";

// Route-level code splitting: each page is its own chunk and is only
// downloaded when the user navigates to it.
const Login = lazy(() => import("./pages/auth/Login"));
const Register = lazy(() => import("./pages/auth/Register"));
const ForgotPassword = lazy(() => import("./pages/auth/ForgotPassword"));
const ResetPassword = lazy(() => import("./pages/auth/ResetPassword"));
const Dashboard = lazy(() => import("./pages/Dashboard"));
const Vendors = lazy(() => import("./pages/Vendors"));
const RfqList = lazy(() => import("./pages/RfqList"));
const RfqCreate = lazy(() => import("./pages/RfqCreate"));
const RfqDetail = lazy(() => import("./pages/RfqDetail"));
const RfqQuotation = lazy(() => import("./pages/RfqQuotation"));
const RfqQuotations = lazy(() => import("./pages/RfqQuotations"));
const RfqComparison = lazy(() => import("./pages/RfqComparison"));
const Approvals = lazy(() => import("./pages/Approvals"));
const PurchaseOrders = lazy(() => import("./pages/PurchaseOrders"));
const PurchaseOrderDetail = lazy(() => import("./pages/PurchaseOrderDetail"));
const Invoices = lazy(() => import("./pages/Invoices"));
const InvoiceDetail = lazy(() => import("./pages/InvoiceDetail"));
const InvoicePrint = lazy(() => import("./pages/InvoicePrint"));
const Reports = lazy(() => import("./pages/Reports"));
const Activity = lazy(() => import("./pages/Activity"));
const Profile = lazy(() => import("./pages/Profile"));
const NotFound = lazy(() => import("./pages/NotFound"));

function FullScreenLoader() {
  return (
    <div className="flex min-h-screen items-center justify-center">
      <Spinner label="Loading page" />
    </div>
  );
}

export default function App() {
  return (
    <Suspense fallback={<FullScreenLoader />}>
      <Routes>
        <Route
          path="/login"
          element={
            <PublicOnly>
              <Login />
            </PublicOnly>
          }
        />
        <Route
          path="/register"
          element={
            <PublicOnly>
              <Register />
            </PublicOnly>
          }
        />
        {/* Password recovery must also work from Profile for signed-in users. */}
        <Route path="/forgot-password" element={<ForgotPassword />} />
        <Route path="/reset-password" element={<ResetPassword />} />

        <Route element={<RequireAuth />}>
          {/* Print view deliberately sits outside the app shell. */}
          <Route path="/invoices/:id/print" element={<InvoicePrint />} />

          <Route element={<AppLayout />}>
            <Route path="/" element={<Navigate to="/dashboard" replace />} />
            <Route path="/dashboard" element={<Dashboard />} />
            <Route path="/vendors" element={<Vendors />} />
            <Route path="/rfqs" element={<RfqList />} />
            <Route
              path="/rfqs/new"
              element={
                <RequireRole roles={["admin", "procurement"]}>
                  <RfqCreate />
                </RequireRole>
              }
            />
            <Route path="/rfqs/:id" element={<RfqDetail />} />
            <Route
              path="/rfqs/:id/edit"
              element={
                <RequireRole roles={["admin", "procurement"]}>
                  <RfqCreate />
                </RequireRole>
              }
            />
            <Route
              path="/rfqs/:id/quotation"
              element={
                <RequireRole roles={["vendor"]}>
                  <RfqQuotation />
                </RequireRole>
              }
            />
            <Route
              path="/rfqs/:id/quotations"
              element={
                <RequireRole roles={["admin", "procurement", "manager"]}>
                  <RfqQuotations />
                </RequireRole>
              }
            />
            <Route
              path="/rfqs/:id/compare"
              element={
                <RequireRole roles={["admin", "procurement", "manager"]}>
                  <RfqComparison />
                </RequireRole>
              }
            />
            <Route
              path="/approvals"
              element={
                <RequireRole roles={["admin", "procurement", "manager"]}>
                  <Approvals />
                </RequireRole>
              }
            />
            <Route
              path="/approvals/:id"
              element={
                <RequireRole roles={["admin", "procurement", "manager"]}>
                  <Approvals />
                </RequireRole>
              }
            />
            <Route
              path="/purchase-orders"
              element={
                <RequireRole roles={["admin", "procurement", "manager", "vendor"]}>
                  <PurchaseOrders />
                </RequireRole>
              }
            />
            <Route
              path="/purchase-orders/:id"
              element={
                <RequireRole roles={["admin", "procurement", "manager", "vendor"]}>
                  <PurchaseOrderDetail />
                </RequireRole>
              }
            />
            <Route
              path="/invoices"
              element={
                <RequireRole roles={["admin", "procurement", "manager", "vendor"]}>
                  <Invoices />
                </RequireRole>
              }
            />
            <Route
              path="/invoices/:id"
              element={
                <RequireRole roles={["admin", "procurement", "manager", "vendor"]}>
                  <InvoiceDetail />
                </RequireRole>
              }
            />
            <Route
              path="/reports"
              element={
                <RequireRole roles={["admin", "procurement", "manager"]}>
                  <Reports />
                </RequireRole>
              }
            />
            <Route
              path="/activity"
              element={
                <RequireRole roles={["admin", "procurement", "manager"]}>
                  <Activity />
                </RequireRole>
              }
            />
            <Route path="/profile" element={<Profile />} />
            <Route path="*" element={<NotFound />} />
          </Route>
        </Route>
      </Routes>
    </Suspense>
  );
}
