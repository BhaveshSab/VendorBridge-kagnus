import { Building2, LayoutDashboard, UserRound } from "lucide-react";
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
    ],
  },
];

export const PROFILE_NAV: NavItem = { label: "My profile", to: "/profile", icon: UserRound };
