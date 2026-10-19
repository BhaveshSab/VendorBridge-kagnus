import { Building2, ClipboardList, LayoutDashboard, UserRound } from "lucide-react";
import type { Role } from "./types";

export const VENDOR_CATEGORIES = [
  "IT Equipment",
  "Software",
  "Office Supplies",
  "Stationery",
  "Furniture",
  "Logistics",
  "Facilities",
  "Catering",
  "Professional Services",
  "General",
];

export const COUNTRIES = ["India", "United Arab Emirates", "Singapore", "United Kingdom", "United States", "Australia"];

export const RFQ_CURRENCIES = [
  { value: "INR", label: "INR — Indian Rupee" },
  { value: "USD", label: "USD — US Dollar" },
  { value: "AED", label: "AED — UAE Dirham" },
  { value: "EUR", label: "EUR — Euro" },
  { value: "GBP", label: "GBP — Pound Sterling" },
  { value: "SGD", label: "SGD — Singapore Dollar" },
];

// Mirrors the server-side closed list in server/routes/rfqs.js.
export const RFQ_UNITS = [
  { value: "unit", label: "Unit" },
  { value: "pcs", label: "Pieces (pcs)" },
  { value: "box", label: "Box" },
  { value: "pack", label: "Pack" },
  { value: "set", label: "Set" },
  { value: "kg", label: "Kilogram (kg)" },
  { value: "litre", label: "Litre" },
  { value: "metre", label: "Metre" },
  { value: "sheet", label: "Sheet" },
  { value: "hour", label: "Hour" },
  { value: "day", label: "Day" },
];

export const RFQ_STATUS_TABS = [
  { value: "all", label: "All" },
  { value: "open", label: "Open" },
  { value: "expired", label: "Expired" },
  { value: "draft", label: "Draft" },
  { value: "closed", label: "Closed" },
  { value: "cancelled", label: "Cancelled" },
];

export const ROLE_OPTIONS: { value: "procurement" | "manager" | "vendor"; label: string; hint: string }[] = [
  { value: "procurement", label: "Procurement Officer", hint: "Manage the vendor register and supplier onboarding" },
  { value: "manager", label: "Manager/Approver", hint: "Review vendor records and procurement activity" },
  { value: "vendor", label: "Vendor", hint: "Maintain your supplier profile and compliance details" },
];

export interface NavItem {
  label: string;
  to: string;
  icon: typeof LayoutDashboard;
  roles?: Role[];
  end?: boolean;
}

export const NAV_SECTIONS: { title: string; items: NavItem[] }[] = [
  {
    title: "Overview",
    items: [
      { label: "Dashboard", to: "/dashboard", icon: LayoutDashboard },
      { label: "Vendors", to: "/vendors", icon: Building2 },
      { label: "RFQs & quotations", to: "/rfqs", icon: ClipboardList },
    ],
  },
];

export const PROFILE_NAV: NavItem = { label: "My profile", to: "/profile", icon: UserRound };
