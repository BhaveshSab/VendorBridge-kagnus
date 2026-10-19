import { AlertCircle, CalendarClock, Check, ClipboardList, Plus, Trash2, Users } from "lucide-react";
import { useMemo, useState } from "react";
import { RFQ_CURRENCIES, RFQ_UNITS } from "../lib/constants";
import { formatDateTime } from "../lib/format";
import type { RfqDetail, Vendor } from "../lib/types";
import { useApi } from "../lib/useApi";
import {
  newRfqForm,
  newRfqItem,
  rfqFormFromDetail,
  validateRfqForm,
  type RfqFormValues,
} from "../lib/rfq";
import { Badge, Button, Card, ConfirmDialog, Field, Input, SearchInput, Select, Textarea } from "./ui";

interface VendorListResponse {
  items: Vendor[];
  total: number;
}

export function RfqForm({
  initial,
  mode,
  saving = false,
  submitError,
  fieldErrors,
  onSubmit,
  onCancel,
}: {
  initial?: RfqDetail | null;
  mode: "create" | "edit";
  saving?: boolean;
  submitError?: string | null;
  fieldErrors?: Record<string, string>;
  onSubmit: (values: RfqFormValues, intent: "draft" | "publish") => void;
  onCancel?: () => void;
}) {
  const [values, setValues] = useState<RfqFormValues>(() =>
    initial ? rfqFormFromDetail(initial) : newRfqForm(),
  );
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [vendorSearch, setVendorSearch] = useState("");
  const [confirmOpen, setConfirmOpen] = useState(false);

  const vendors = useApi<VendorListResponse>("/vendors", { pageSize: 100, sort: "name", status: "all" });

  const errorFor = (key: string) => errors[key] || fieldErrors?.[key];

  function update<K extends keyof RfqFormValues>(key: K, value: RfqFormValues[K]) {
    setValues((current) => ({ ...current, [key]: value }));
    setErrors((current) => ({ ...current, [key]: "" }));
  }

  function updateItem(index: number, patch: Partial<RfqFormValues["items"][number]>) {
    setValues((current) => ({
      ...current,
      items: current.items.map((item, position) => (position === index ? { ...item, ...patch } : item)),
    }));
    setErrors((current) => {
      const next = { ...current };
      for (const key of Object.keys(patch)) delete next[`items.${index}.${key}`];
      return next;
    });
  }

  function addItem() {
    setValues((current) => ({ ...current, items: [...current.items, newRfqItem()] }));
  }

  function removeItem(index: number) {
    setValues((current) => ({ ...current, items: current.items.filter((_, position) => position !== index) }));
    setErrors((current) => {
      const next = { ...current };
      for (const key of Object.keys(next)) {
        if (key.startsWith(`items.${index}.`)) delete next[key];
      }
      return next;
    });
  }

  function toggleVendor(vendorId: number) {
    setValues((current) => ({
      ...current,
      vendorIds: current.vendorIds.includes(vendorId)
        ? current.vendorIds.filter((id) => id !== vendorId)
        : [...current.vendorIds, vendorId],
    }));
    setErrors((current) => ({ ...current, vendorIds: "" }));
  }

  const selectedVendors = useMemo(
    () => (vendors.data?.items ?? []).filter((vendor) => values.vendorIds.includes(vendor.id)),
    [vendors.data, values.vendorIds],
  );

  const visibleVendors = useMemo(() => {
    const term = vendorSearch.trim().toLowerCase();
    const items = vendors.data?.items ?? [];
    if (!term) return items;
    return items.filter((vendor) =>
      [vendor.name, vendor.code, vendor.category, vendor.city].some((value) =>
        String(value ?? "").toLowerCase().includes(term),
      ),
    );
  }, [vendors.data, vendorSearch]);

  const totalUnits = values.items.reduce((sum, item) => sum + (Number(item.quantity) || 0), 0);

  function handleSubmit(intent: "draft" | "publish") {
    const next = validateRfqForm(values);
    if (intent === "publish" && values.vendorIds.length === 0) {
      next.vendorIds = "Assign at least one vendor before publishing.";
    }
    setErrors(next);
    if (Object.keys(next).length > 0) {
      document.getElementById("rfq-form-errors")?.scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }
    if (intent === "publish") {
      setConfirmOpen(true);
      return;
    }
    onSubmit(values, "draft");
  }

  const errorCount = Object.keys(errors).filter((key) => errors[key]).length;

  return (
    <div className="space-y-5">
      {(submitError || errorCount > 0) && (
        <div
          id="rfq-form-errors"
          role="alert"
          className="rounded-xl border border-danger/30 border-l-4 border-l-danger bg-danger-soft px-4 py-3"
        >
          <p className="flex items-center gap-2 text-[12px] font-bold text-danger">
            <AlertCircle size={14} aria-hidden />
            {submitError ?? `Please fix ${errorCount} field${errorCount === 1 ? "" : "s"} before continuing.`}
          </p>
          {submitError && errorCount > 0 ? (
            <p className="mt-1 text-[11px] text-danger/90">{errorCount} field(s) also need attention.</p>
          ) : null}
        </div>
      )}

      <div className="grid gap-5 lg:grid-cols-3">
        <div className="min-w-0 space-y-5 lg:col-span-2">
      {/* 1 — RFQ details */}
      <Card className="overflow-hidden">
        <div className="border-b border-line bg-slate-50/50 px-5 py-3.5">
          <h2 className="flex items-center gap-2 text-[13px] font-bold text-ink">
            <ClipboardList size={15} className="text-brand-600" /> RFQ details
          </h2>
          <p className="text-[11px] text-muted">Identify the requirement, the currency and the submission window.</p>
        </div>
        <div className="grid gap-4 p-5 sm:grid-cols-2">
          <Field label="RFQ title" htmlFor="rfq-title" required error={errorFor("title")} className="sm:col-span-2">
            <Input
              id="rfq-title"
              value={values.title}
              onChange={(event) => update("title", event.target.value)}
              invalid={Boolean(errorFor("title"))}
              placeholder="e.g. Q4 office laptop refresh — 40 units"
              maxLength={140}
            />
          </Field>
          <Field
            label="Description / requirements"
            htmlFor="rfq-description"
            error={errorFor("description")}
            hint="Scope, delivery expectations and any commercial conditions."
            className="sm:col-span-2"
          >
            <Textarea
              id="rfq-description"
              value={values.description}
              onChange={(event) => update("description", event.target.value)}
              placeholder="Describe the requirement, delivery location, warranty and evaluation notes…"
              rows={4}
              maxLength={3000}
            />
          </Field>
          <Field label="Currency" htmlFor="rfq-currency" required error={errorFor("currency")}>
            <Select
              id="rfq-currency"
              value={values.currency}
              onChange={(event) => update("currency", event.target.value)}
              invalid={Boolean(errorFor("currency"))}
            >
              {RFQ_CURRENCIES.map((currency) => (
                <option key={currency.value} value={currency.value}>
                  {currency.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field
            label="Submission deadline"
            htmlFor="rfq-deadline"
            required
            error={errorFor("deadline")}
            hint="Stored in UTC. Vendors cannot submit after this moment."
          >
            <Input
              id="rfq-deadline"
              type="datetime-local"
              value={values.deadlineLocal}
              onChange={(event) => update("deadlineLocal", event.target.value)}
              invalid={Boolean(errorFor("deadline"))}
            />
          </Field>
        </div>
      </Card>

      {/* 2 — Requested items */}
      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-line bg-slate-50/50 px-5 py-3.5">
          <div>
            <h2 className="text-[13px] font-bold text-ink">Requested line items</h2>
            <p className="text-[11px] text-muted">
              Vendors price every line exactly once. Quantities must be greater than zero.
            </p>
          </div>
          <Button size="sm" variant="ghost" icon={<Plus size={14} />} onClick={addItem} type="button">
            Add item
          </Button>
        </div>
        <div className="space-y-3 p-5">
          {errorFor("items") ? (
            <p className="field-error" role="alert">
              {errorFor("items")}
            </p>
          ) : null}
          {values.items.map((item, index) => (
            <div key={item.key} className="rounded-xl border border-slate-200/90 bg-slate-50/30 p-3.5">
              <div className="mb-2 flex items-center justify-between gap-2">
                <span className="text-[10px] font-bold uppercase tracking-[0.08em] text-muted">Item {index + 1}</span>
                <button
                  type="button"
                  onClick={() => removeItem(index)}
                  disabled={values.items.length === 1}
                  className="inline-flex items-center gap-1 text-[11px] font-bold text-danger hover:text-rose-700 disabled:cursor-not-allowed disabled:opacity-40"
                  aria-label={`Remove item ${index + 1}`}
                >
                  <Trash2 size={12} /> Remove
                </button>
              </div>
              <div className="grid gap-3 md:grid-cols-12">
                <Field
                  label="Description"
                  htmlFor={`item-${item.key}-description`}
                  error={errorFor(`items.${index}.description`)}
                  required
                  className="md:col-span-5"
                >
                  <Input
                    id={`item-${item.key}-description`}
                    value={item.description}
                    onChange={(event) => updateItem(index, { description: event.target.value })}
                    invalid={Boolean(errorFor(`items.${index}.description`))}
                    placeholder="e.g. 14-inch business laptop, i5, 16 GB RAM"
                    maxLength={240}
                  />
                </Field>
                <Field
                  label="Quantity"
                  htmlFor={`item-${item.key}-quantity`}
                  error={errorFor(`items.${index}.quantity`)}
                  required
                  className="md:col-span-2"
                >
                  <Input
                    id={`item-${item.key}-quantity`}
                    inputMode="decimal"
                    value={item.quantity}
                    onChange={(event) => updateItem(index, { quantity: event.target.value })}
                    invalid={Boolean(errorFor(`items.${index}.quantity`))}
                    placeholder="1"
                  />
                </Field>
                <Field label="Unit" htmlFor={`item-${item.key}-unit`} required error={errorFor(`items.${index}.unit`)} className="md:col-span-2">
                  <Select
                    id={`item-${item.key}-unit`}
                    value={item.unit}
                    onChange={(event) => updateItem(index, { unit: event.target.value })}
                    invalid={Boolean(errorFor(`items.${index}.unit`))}
                  >
                    {RFQ_UNITS.map((unit) => (
                      <option key={unit.value} value={unit.value}>
                        {unit.label}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field
                  label="Specifications"
                  htmlFor={`item-${item.key}-specifications`}
                  error={errorFor(`items.${index}.specifications`)}
                  className="md:col-span-3"
                >
                  <Input
                    id={`item-${item.key}-specifications`}
                    value={item.specifications}
                    onChange={(event) => updateItem(index, { specifications: event.target.value })}
                    placeholder="Model, warranty, colour…"
                    maxLength={500}
                  />
                </Field>
              </div>
            </div>
          ))}
          <p className="text-[11px] text-muted">
            {values.items.length} line item{values.items.length === 1 ? "" : "s"} ·{" "}
            {totalUnits > 0 ? `${totalUnits.toLocaleString("en-IN")} total units` : "quantities pending"}
          </p>
        </div>
      </Card>

        </div>

        <div className="min-w-0 space-y-5">
      {/* 3 — Vendors */}
      <Card className="overflow-hidden">
        <div className="border-b border-line bg-slate-50/50 px-5 py-3.5">
          <h2 className="flex items-center gap-2 text-[13px] font-bold text-ink">
            <Users size={15} className="text-brand-600" /> Assign vendors
          </h2>
          <p className="text-[11px] text-muted">
            Only the vendors selected here will see this RFQ and be able to submit a quotation.
          </p>
        </div>
        <div className="space-y-4 p-5">
          {errorFor("vendorIds") ? (
            <p className="field-error" role="alert">
              {errorFor("vendorIds")}
            </p>
          ) : null}

          {selectedVendors.length > 0 ? (
            <div className="flex flex-wrap gap-2" aria-label="Selected vendors">
              {selectedVendors.map((vendor) => (
                <span
                  key={vendor.id}
                  className="inline-flex items-center gap-2 rounded-full border border-brand-200 bg-brand-50 px-3 py-1 text-[11px] font-semibold text-brand-800"
                >
                  <Check size={12} aria-hidden /> {vendor.name}
                  <button
                    type="button"
                    onClick={() => toggleVendor(vendor.id)}
                    className="text-brand-600 hover:text-brand-900"
                    aria-label={`Remove ${vendor.name}`}
                  >
                    ×
                  </button>
                </span>
              ))}
            </div>
          ) : (
            <p className="text-[12px] text-muted">No vendors selected yet.</p>
          )}

          <SearchInput value={vendorSearch} onChange={setVendorSearch} placeholder="Search the vendor register…" />

          {vendors.loading ? (
            <p className="py-6 text-center text-[12px] text-muted" role="status">
              Loading vendors…
            </p>
          ) : vendors.error ? (
            <p className="text-[12px] font-medium text-danger" role="alert">
              {vendors.error.message}
            </p>
          ) : visibleVendors.length === 0 ? (
            <p className="py-6 text-center text-[12px] text-muted">
              {vendors.data?.items.length === 0
                ? "No vendors exist yet. Add suppliers to the register first."
                : "No vendors match that search."}
            </p>
          ) : (
            <ul className="grid max-h-72 grid-cols-1 gap-2 overflow-y-auto pr-1">
              {visibleVendors.map((vendor) => {
                const selected = values.vendorIds.includes(vendor.id);
                return (
                  <li key={vendor.id}>
                    <label
                      className={`flex cursor-pointer items-start gap-2.5 rounded-xl border px-3 py-2.5 transition-colors ${
                        selected ? "border-brand-300 bg-brand-50/60" : "border-slate-200 bg-white hover:border-brand-200 hover:bg-slate-50"
                      }`}
                    >
                      <input
                        type="checkbox"
                        className="mt-0.5 h-4 w-4 accent-blue-600"
                        checked={selected}
                        onChange={() => toggleVendor(vendor.id)}
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[12px] font-bold text-ink">{vendor.name}</span>
                        <span className="mt-1 flex items-center gap-2">
                          <span className="min-w-0 flex-1 truncate text-[11px] text-muted">
                            <span className="font-mono">{vendor.code}</span> · {vendor.category} · {vendor.city || "—"}
                          </span>
                          <Badge status={vendor.status} className="shrink-0 text-[10px]" />
                        </span>
                      </span>
                    </label>
                  </li>
                );
              })}
            </ul>
          )}
          <p className="text-[11px] text-muted">
            {values.vendorIds.length} vendor{values.vendorIds.length === 1 ? "" : "s"} selected
            {values.vendorIds.length === 0 ? " — publishing requires at least one." : "."}
          </p>
        </div>
      </Card>

      <Card className="p-4">
        <p className="flex items-center gap-1.5 text-[12px] font-bold text-ink">
          <CalendarClock size={14} className="text-brand-600" /> Deadline enforcement
        </p>
        <p className="mt-1.5 text-[11px] leading-relaxed text-muted">
          The API enforces this deadline in UTC on every submission. Publishing grants the selected vendors access; saving a
          draft does not notify anyone.
        </p>
        {values.deadlineLocal ? (
          <p className="mt-2 text-[11px] font-semibold text-ink-soft">
            Closes {formatDateTime(new Date(values.deadlineLocal).toISOString())}
          </p>
        ) : null}
      </Card>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="text-[11px] text-muted">
          {mode === "edit"
            ? "Editing a draft · line items can still change until the RFQ is published."
            : "Draft saves are private. Publishing notifies only the assigned vendors."}
        </div>
        <div className="flex flex-wrap items-center gap-2.5">
          {onCancel ? (
            <Button variant="ghost" size="sm" onClick={onCancel} disabled={saving} type="button">
              Cancel
            </Button>
          ) : null}
          <Button variant="ghost" size="sm" onClick={() => handleSubmit("draft")} loading={saving} type="button">
            Save draft
          </Button>
          <Button
            size="sm"
            onClick={() => handleSubmit("publish")}
            loading={saving}
            type="button"
            icon={<Check size={13} />}
          >
            {mode === "edit" ? "Save & publish" : "Review & publish"}
          </Button>
        </div>
      </div>

      <ConfirmDialog
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        onConfirm={() => {
          setConfirmOpen(false);
          onSubmit(values, "publish");
        }}
        loading={saving}
        tone="primary"
        title="Publish this RFQ?"
        confirmLabel="Publish RFQ"
        message={`Publishing makes “${values.title || "this RFQ"}” visible to ${values.vendorIds.length} assigned vendor${
          values.vendorIds.length === 1 ? "" : "s"
        } until ${formatDateTime(
          values.deadlineLocal ? new Date(values.deadlineLocal).toISOString() : null,
        )}. Vendors can then submit one quotation each (revised until the deadline). Draft edits are no longer possible after publishing.`}
      />
    </div>
  );
}
