export class OwnerAccessError extends Error {}

export function assertOwnerEmail(sessionEmail: string, ownerEmail: string): string {
  const normalizedSession = sessionEmail.trim().toLowerCase();
  const normalizedOwner = ownerEmail.trim().toLowerCase();
  if (normalizedSession !== normalizedOwner) {
    throw new OwnerAccessError("Account is not the configured owner");
  }
  return normalizedSession;
}
