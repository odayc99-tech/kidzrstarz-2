/**
 * Get the S3 storage namespace prefix for an order.
 * Uses userId for logged-in users, or "guest-{orderId}" for guest orders.
 */
export function getStorageNamespace(userId: number | null, orderId: number): string {
  if (userId) {
    return `${userId}`;
  }
  return `guest-${orderId}`;
}
