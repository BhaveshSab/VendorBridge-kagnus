export function roleLabel(role) {
  return (
    {
      admin: "Admin",
      procurement: "Procurement Officer",
      manager: "Manager/Approver",
      vendor: "Vendor",
    }[role] || role
  );
}

export function vendorOut(vendor) {
  if (!vendor) return null;
  return {
    id: vendor.id,
    code: vendor.code,
    name: vendor.name,
    category: vendor.category,
    gstin: vendor.gstin,
    email: vendor.email,
    phone: vendor.phone,
    address: vendor.address,
    city: vendor.city,
    country: vendor.country,
    contactName: vendor.contactName,
    status: vendor.status,
    rating: vendor.rating,
    notes: vendor.notes,
    userId: vendor.userId,
    createdAt: vendor.createdAt.toISOString(),
    updatedAt: vendor.updatedAt.toISOString(),
  };
}

export const PERMISSIONS = {
  admin: { manageVendors: true },
  procurement: { manageVendors: true },
  manager: { manageVendors: false },
  vendor: { manageVendors: false },
};
