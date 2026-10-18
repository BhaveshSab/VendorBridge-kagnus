import { Building2, FileText, MapPin, User } from "lucide-react";
import { useEffect, useState } from "react";
import { useToast } from "../context/ToastContext";
import { api, ApiError, errorMessage } from "../lib/api";
import { COUNTRIES, VENDOR_CATEGORIES } from "../lib/constants";
import type { Vendor } from "../lib/types";
import { useApiMutation } from "../lib/useApi";
import { Button, Field, Input, Modal, Select, Textarea } from "./ui";

interface VendorForm {
  name: string;
  category: string;
  gstin: string;
  email: string;
  phone: string;
  contactName: string;
  address: string;
  city: string;
  country: string;
  status: Vendor["status"];
  rating: string;
  notes: string;
}

const emptyForm: VendorForm = {
  name: "",
  category: "IT Equipment",
  gstin: "",
  email: "",
  phone: "",
  contactName: "",
  address: "",
  city: "",
  country: "India",
  status: "Pending",
  rating: "0",
  notes: "",
};

interface VendorPayload {
  name: string;
  category: string;
  gstin: string;
  email: string;
  phone: string;
  contactName: string;
  address: string;
  city: string;
  country: string;
  status: Vendor["status"];
  rating: number;
  notes: string;
}

export function VendorFormModal({
  open,
  vendor,
  categories,
  onClose,
  onSaved,
}: {
  open: boolean;
  vendor: Vendor | null;
  categories: string[];
  onClose: () => void;
  onSaved?: () => void;
}) {
  const toast = useToast();
  const [form, setForm] = useState<VendorForm>(emptyForm);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const saveVendor = useApiMutation(
    (payload: VendorPayload) =>
      vendor ? api.put(`/vendors/${vendor.id}`, payload) : api.post("/vendors", payload),
    { invalidate: ["/vendors"] },
  );

  useEffect(() => {
    if (!open) return;
    setErrors({});
    setError(null);
    if (vendor) {
      setForm({
        name: vendor.name,
        category: vendor.category,
        gstin: vendor.gstin ?? "",
        email: vendor.email,
        phone: vendor.phone ?? "",
        contactName: vendor.contactName ?? "",
        address: vendor.address ?? "",
        city: vendor.city ?? "",
        country: vendor.country ?? "India",
        status: vendor.status,
        rating: String(vendor.rating ?? 0),
        notes: vendor.notes ?? "",
      });
    } else {
      setForm(emptyForm);
    }
  }, [open, vendor]);

  function update<K extends keyof VendorForm>(key: K, value: VendorForm[K]) {
    setForm((current) => ({ ...current, [key]: value }));
    setErrors((current) => ({ ...current, [key]: "" }));
  }

  function validate() {
    const next: Record<string, string> = {};
    if (form.name.trim().length < 2) next.name = "Enter the vendor name.";
    if (!form.category) next.category = "Choose a category.";
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) next.email = "Enter a valid email address.";
    if (form.phone.replace(/\D/g, "").length < 7) next.phone = "Enter a valid phone number.";
    if (form.gstin.trim() && !/^[0-9A-Za-z]{15}$/.test(form.gstin.trim()))
      next.gstin = "GSTIN must be exactly 15 letters or digits.";
    const rating = Number(form.rating);
    if (Number.isNaN(rating) || rating < 0 || rating > 5) next.rating = "Rating must be between 0 and 5.";
    setErrors(next);
    return Object.keys(next).length === 0;
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    if (!validate()) return;
    setSaving(true);
    try {
      const payload: VendorPayload = {
        name: form.name.trim(),
        category: form.category,
        gstin: form.gstin.trim().toUpperCase(),
        email: form.email.trim(),
        phone: form.phone.trim(),
        contactName: form.contactName.trim(),
        address: form.address.trim(),
        city: form.city.trim(),
        country: form.country,
        status: form.status,
        rating: Number(form.rating),
        notes: form.notes.trim(),
      };
      await saveVendor.mutateAsync(payload);
      if (vendor) {
        toast.success("Vendor updated", `${payload.name} has been saved.`);
      } else {
        toast.success("Vendor added", `${payload.name} is now in the register.`);
      }
      onSaved?.();
      onClose();
    } catch (err) {
      if (err instanceof ApiError && err.fields) setErrors(err.fields);
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  const categoryOptions = Array.from(new Set([...VENDOR_CATEGORIES, ...categories, form.category])).filter(Boolean);

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title={vendor ? `Edit ${vendor.name}` : "Add New Supplier"}
      description={
        vendor
          ? `Record ${vendor.code} · All changes will be saved to the database`
          : "Onboard a supplier into the centralized procurement vendor register."
      }
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button size="sm" onClick={submit} loading={saving} icon={<Building2 size={15} />}>
            {vendor ? "Save changes" : "Create supplier"}
          </Button>
        </>
      }
    >
      <form onSubmit={submit} noValidate className="space-y-5">
        {error ? (
          <div
            className="rounded-xl border border-danger/30 border-l-4 border-l-danger bg-danger-soft px-4 py-3 text-[12px] text-danger font-medium"
            role="alert"
          >
            {error}
          </div>
        ) : null}

        {/* Section 1: Company Profile */}
        <div className="rounded-xl border border-slate-200/90 p-4 bg-slate-50/30 space-y-3.5">
          <p className="text-[12px] font-bold text-ink flex items-center gap-1.5">
            <Building2 size={15} className="text-brand-600" />
            Company Identity
          </p>
          <div className="grid gap-3.5 sm:grid-cols-2">
            <Field label="Vendor / Company name" htmlFor="vendorName" error={errors.name} required className="sm:col-span-2">
              <Input
                id="vendorName"
                value={form.name}
                onChange={(event) => update("name", event.target.value)}
                invalid={Boolean(errors.name)}
                placeholder="e.g. Apex Office Supplies Pvt Ltd"
                autoFocus
              />
            </Field>
            <Field label="Category" htmlFor="vendorCategory" error={errors.category} required>
              <Select
                id="vendorCategory"
                value={form.category}
                onChange={(event) => update("category", event.target.value)}
                invalid={Boolean(errors.category)}
              >
                {categoryOptions.map((category) => (
                  <option key={category} value={category}>
                    {category}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Status" htmlFor="vendorStatus" error={errors.status}>
              <Select
                id="vendorStatus"
                value={form.status}
                onChange={(event) => update("status", event.target.value as Vendor["status"])}
              >
                {["Active", "Pending", "Inactive", "Blocked"].map((status) => (
                  <option key={status} value={status}>
                    {status}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
        </div>

        {/* Section 2: Contact Information */}
        <div className="rounded-xl border border-slate-200/90 p-4 bg-slate-50/30 space-y-3.5">
          <p className="text-[12px] font-bold text-ink flex items-center gap-1.5">
            <User size={15} className="text-brand-600" />
            Key Contact Details
          </p>
          <div className="grid gap-3.5 sm:grid-cols-2">
            <Field label="Contact person" htmlFor="contactName" error={errors.contactName} className="sm:col-span-2">
              <Input
                id="contactName"
                value={form.contactName}
                onChange={(event) => update("contactName", event.target.value)}
                placeholder="e.g. Rahul Sharma"
              />
            </Field>
            <Field label="Work email" htmlFor="vendorEmail" error={errors.email} required>
              <Input
                id="vendorEmail"
                type="email"
                value={form.email}
                onChange={(event) => update("email", event.target.value)}
                invalid={Boolean(errors.email)}
                placeholder="sales@supplier.com"
              />
            </Field>
            <Field label="Phone number" htmlFor="vendorPhone" error={errors.phone} required>
              <Input
                id="vendorPhone"
                value={form.phone}
                onChange={(event) => update("phone", event.target.value)}
                invalid={Boolean(errors.phone)}
                placeholder="+91 98200 12345"
              />
            </Field>
          </div>
        </div>

        {/* Section 3: Tax, Rating & Address */}
        <div className="rounded-xl border border-slate-200/90 p-4 bg-slate-50/30 space-y-3.5">
          <p className="text-[12px] font-bold text-ink flex items-center gap-1.5">
            <MapPin size={15} className="text-brand-600" />
            Tax, Rating &amp; Location
          </p>
          <div className="grid gap-3.5 sm:grid-cols-2">
            <Field
              label="GSTIN"
              htmlFor="gstin"
              error={errors.gstin}
              hint="15-character GST identification number."
            >
              <Input
                id="gstin"
                value={form.gstin}
                onChange={(event) => update("gstin", event.target.value.toUpperCase())}
                invalid={Boolean(errors.gstin)}
                placeholder="29AABCN1234F1Z5"
                maxLength={15}
                className="font-mono uppercase font-semibold"
              />
            </Field>
            <Field label="Initial Rating (0.0 – 5.0)" htmlFor="rating" error={errors.rating}>
              <Input
                id="rating"
                type="number"
                min={0}
                max={5}
                step={0.1}
                value={form.rating}
                onChange={(event) => update("rating", event.target.value)}
                invalid={Boolean(errors.rating)}
              />
            </Field>
            <Field label="City" htmlFor="vendorCity" error={errors.city}>
              <Input
                id="vendorCity"
                value={form.city}
                onChange={(event) => update("city", event.target.value)}
                placeholder="Bengaluru"
              />
            </Field>
            <Field label="Country" htmlFor="vendorCountry" error={errors.country}>
              <Select
                id="vendorCountry"
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
            <Field label="Street address" htmlFor="vendorAddress" error={errors.address} className="sm:col-span-2">
              <Input
                id="vendorAddress"
                value={form.address}
                onChange={(event) => update("address", event.target.value)}
                placeholder="Building, street, tech park or industrial area"
              />
            </Field>
          </div>
        </div>

        {/* Section 4: Notes */}
        <div className="rounded-xl border border-slate-200/90 p-4 bg-slate-50/30 space-y-2">
          <p className="text-[12px] font-bold text-ink flex items-center gap-1.5">
            <FileText size={15} className="text-brand-600" />
            Internal Procurement Notes
          </p>
          <Field
            htmlFor="vendorNotes"
            error={errors.notes}
            hint="Visible strictly to internal procurement and management officers."
          >
            <Textarea
              id="vendorNotes"
              value={form.notes}
              onChange={(event) => update("notes", event.target.value)}
              placeholder="Commercial payment terms, delivery SLAs, special supplier arrangements…"
              rows={3}
            />
          </Field>
        </div>
      </form>
    </Modal>
  );
}
