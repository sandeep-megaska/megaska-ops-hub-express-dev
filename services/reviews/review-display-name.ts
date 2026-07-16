export function defaultReviewDisplayName(customer: { firstName?: string | null; lastName?: string | null } | null | undefined): string {
  const firstName = customer?.firstName?.trim();
  const lastInitial = customer?.lastName?.trim().slice(0, 1);
  if (firstName && lastInitial) return `${firstName} ${lastInitial}.`;
  if (firstName) return firstName;
  return "Verified buyer";
}
