import { fromDateTimeLocal, toDateTimeLocal } from "./format";
import type { RfqDetail } from "./types";

export interface RfqFormItem {
  key: string;
  description: string;
  quantity: string;
  unit: string;
  specifications: string;
}

export interface RfqFormValues {
  title: string;
  description: string;
  currency: string;
  deadlineLocal: string;
  items: RfqFormItem[];
  vendorIds: number[];
}

export interface RfqPayload {
  title: string;
  description: string;
  currency: string;
  deadline: string;
  items: { description: string; quantity: string; unit: string; specifications: string }[];
}

function newKey() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `item-${Math.random().toString(36).slice(2)}`;
}

export function newRfqItem(unit = "unit"): RfqFormItem {
  return { key: newKey(), description: "", quantity: "1", unit, specifications: "" };
}

export function defaultDeadlineLocal() {
  const date = new Date();
  date.setDate(date.getDate() + 14);
  date.setHours(17, 0, 0, 0);
  return toDateTimeLocal(date.toISOString());
}

export function newRfqForm(): RfqFormValues {
  return {
    title: "",
    description: "",
    currency: "INR",
    deadlineLocal: defaultDeadlineLocal(),
    items: [newRfqItem()],
    vendorIds: [],
  };
}

export function rfqFormFromDetail(rfq: RfqDetail): RfqFormValues {
  return {
    title: rfq.title,
    description: rfq.description ?? "",
    currency: rfq.currency,
    deadlineLocal: toDateTimeLocal(rfq.deadline),
    items: (rfq.items ?? []).map((item) => ({
      key: `item-${item.id}`,
      description: item.description,
      quantity: item.quantity,
      unit: item.unit,
      specifications: item.specifications ?? "",
    })),
    vendorIds: (rfq.assignments ?? []).map((assignment) => assignment.vendorId),
  };
}

export function validateRfqForm(values: RfqFormValues): Record<string, string> {
  const errors: Record<string, string> = {};

  if (values.title.trim().length < 3) errors.title = "Enter an RFQ title (at least 3 characters).";
  if (values.title.trim().length > 140) errors.title = "Keep the title under 140 characters.";
  if (!values.currency) errors.currency = "Choose a currency.";
  if (!values.deadlineLocal) {
    errors.deadline = "Choose a submission deadline.";
  } else {
    const iso = fromDateTimeLocal(values.deadlineLocal);
    if (!iso) errors.deadline = "Enter a valid deadline.";
    else if (new Date(iso).getTime() <= Date.now()) errors.deadline = "The deadline must be in the future.";
  }

  if (values.items.length === 0) errors.items = "Add at least one requested item.";

  values.items.forEach((item, index) => {
    if (item.description.trim().length < 3) {
      errors[`items.${index}.description`] = "Describe the item (at least 3 characters).";
    }
    const quantity = Number(item.quantity);
    if (item.quantity.trim() === "" || !Number.isFinite(quantity)) {
      errors[`items.${index}.quantity`] = "Enter a quantity.";
    } else if (quantity <= 0) {
      errors[`items.${index}.quantity`] = "Quantity must be greater than zero.";
    } else if (Number(item.quantity) > 1_000_000) {
      errors[`items.${index}.quantity`] = "Quantity is too large.";
    } else if (/\.\d{4,}$/.test(item.quantity)) {
      errors[`items.${index}.quantity`] = "Use at most 3 decimal places.";
    }
    if (!item.unit) errors[`items.${index}.unit`] = "Choose a unit.";
  });

  return errors;
}

export function rfqFormPayload(values: RfqFormValues): RfqPayload {
  return {
    title: values.title.trim(),
    description: values.description.trim(),
    currency: values.currency,
    deadline: fromDateTimeLocal(values.deadlineLocal) ?? "",
    items: values.items.map((item) => ({
      description: item.description.trim(),
      quantity: item.quantity.trim(),
      unit: item.unit,
      specifications: item.specifications.trim(),
    })),
  };
}

export function isDraft(rfq: RfqDetail | null | undefined) {
  return rfq?.status === "draft";
}
