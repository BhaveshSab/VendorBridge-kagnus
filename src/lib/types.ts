export type Role = "admin" | "procurement" | "manager" | "vendor";

export interface User {
  id: number;
  firstName: string;
  lastName: string;
  name: string;
  email: string;
  phone: string | null;
  country: string | null;
  role: Role;
  additionalInfo: string | null;
  createdAt: string;
}

export interface Permissions {
  manageVendors: boolean;
}

export interface Session {
  user: User;
  vendor: Vendor | null;
  permissions: Permissions;
  roleLabel: string;
}

export interface Vendor {
  id: number;
  code: string;
  name: string;
  category: string;
  gstin: string | null;
  email: string;
  phone: string | null;
  address: string | null;
  city: string | null;
  country: string | null;
  contactName: string | null;
  status: "Active" | "Pending" | "Inactive" | "Blocked";
  rating: number;
  notes: string | null;
  userId: number | null;
  createdAt: string;
  updatedAt: string;
}
