/**
 * Stripe: the salon's subscription. Filled in with the Stripe connection;
 * until then nothing is billed and every change is only Kikai's record.
 */

export async function syncSubscription(_organizationId: string): Promise<{ ok: true } | { ok: false; error: string }> {
  return { ok: true };
}
