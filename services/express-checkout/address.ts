export type ExpressCheckoutAddressInput = {
  name: string | null;
  phone: string | null;
  email?: string | null;
  address1: string | null;
  address2?: string | null;
  city: string | null;
  province: string | null;
  country: string | null;
  zip: string | null;
};

type AddressSnapshotRecord = {
  id: string;
  shopId: string;
  intentId: string;
  customerProfileId: string | null;
  name: string;
  phone: string;
  email: string | null;
  address1: string;
  address2: string | null;
  city: string;
  province: string;
  country: string;
  zip: string;
  createdAt: Date;
  updatedAt: Date;
};

type PrismaLike = {
  customerProfile: {
    updateMany(args: object): Promise<unknown>;
  };
  expressCheckoutAddressSnapshot: {
    findFirst(args: object): Promise<AddressSnapshotRecord | null>;
    update(args: object): Promise<AddressSnapshotRecord>;
    create(args: object): Promise<AddressSnapshotRecord>;
  };
};

function clean(value: unknown) {
  const normalized = typeof value === "string" ? value.trim() : "";
  return normalized || null;
}

function splitName(fullName: string | null) {
  const parts = clean(fullName)?.split(/\s+/).filter(Boolean) || [];
  if (!parts.length) return { firstName: null, lastName: null };
  return { firstName: parts[0] || null, lastName: parts.length > 1 ? parts.slice(1).join(" ") : null };
}

export function isCompleteExpressCheckoutAddress(address: Partial<ExpressCheckoutAddressInput> | null | undefined) {
  return Boolean(
    clean(address?.name) &&
      clean(address?.phone) &&
      clean(address?.address1) &&
      clean(address?.city) &&
      clean(address?.province) &&
      clean(address?.zip) &&
      clean(address?.country)
  );
}

export function customerProfileToExpressAddress(customer: {
  fullName?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  phoneE164?: string | null;
  email?: string | null;
  addressLine1?: string | null;
  addressLine2?: string | null;
  city?: string | null;
  stateProvince?: string | null;
  postalCode?: string | null;
  countryRegion?: string | null;
}): ExpressCheckoutAddressInput | null {
  const name = clean(customer.fullName) || clean([customer.firstName, customer.lastName].filter(Boolean).join(" "));
  const address = {
    name,
    phone: clean(customer.phoneE164),
    email: clean(customer.email),
    address1: clean(customer.addressLine1),
    address2: clean(customer.addressLine2),
    city: clean(customer.city),
    province: clean(customer.stateProvince),
    country: clean(customer.countryRegion),
    zip: clean(customer.postalCode),
  };

  return isCompleteExpressCheckoutAddress(address) ? address : null;
}

export async function saveCustomerProfileAddress(
  db: PrismaLike,
  input: { shopId: string; customerProfileId: string; address: ExpressCheckoutAddressInput }
) {
  const name = clean(input.address.name);
  const { firstName, lastName } = splitName(name);
  const profileCompletedAt = isCompleteExpressCheckoutAddress(input.address) ? new Date() : undefined;

  await db.customerProfile.updateMany({
    where: { id: input.customerProfileId, shopId: input.shopId },
    data: {
      fullName: name,
      firstName,
      lastName,
      phoneE164: clean(input.address.phone),
      email: clean(input.address.email),
      addressLine1: clean(input.address.address1),
      addressLine2: clean(input.address.address2),
      city: clean(input.address.city),
      stateProvince: clean(input.address.province),
      postalCode: clean(input.address.zip),
      countryRegion: clean(input.address.country),
      ...(profileCompletedAt ? { profileCompletedAt } : {}),
    },
  });
}

export async function attachAddressSnapshotToIntent(
  db: PrismaLike,
  input: { shopId: string; intentId: string; customerProfileId: string; address: ExpressCheckoutAddressInput }
) {
  const existing = await db.expressCheckoutAddressSnapshot.findFirst({
    where: { shopId: input.shopId, intentId: input.intentId, customerProfileId: input.customerProfileId },
    orderBy: { createdAt: "desc" },
  });
  const data = {
    shopId: input.shopId,
    intentId: input.intentId,
    customerProfileId: input.customerProfileId,
    name: clean(input.address.name) || "",
    phone: clean(input.address.phone) || "",
    email: clean(input.address.email),
    address1: clean(input.address.address1) || "",
    address2: clean(input.address.address2),
    city: clean(input.address.city) || "",
    province: clean(input.address.province) || "",
    country: clean(input.address.country) || "India",
    zip: clean(input.address.zip) || "",
  };

  return existing
    ? db.expressCheckoutAddressSnapshot.update({ where: { id: existing.id }, data })
    : db.expressCheckoutAddressSnapshot.create({ data });
}

export async function latestCustomerAddressSnapshot(
  db: PrismaLike,
  input: { shopId: string; customerProfileId: string }
) {
  const snapshot = await db.expressCheckoutAddressSnapshot.findFirst({
    where: { shopId: input.shopId, customerProfileId: input.customerProfileId },
    orderBy: { createdAt: "desc" },
  });
  if (!snapshot) return null;
  const address = {
    name: snapshot.name,
    phone: snapshot.phone,
    email: snapshot.email,
    address1: snapshot.address1,
    address2: snapshot.address2,
    city: snapshot.city,
    province: snapshot.province,
    country: snapshot.country,
    zip: snapshot.zip,
  };
  return isCompleteExpressCheckoutAddress(address) ? address : null;
}
