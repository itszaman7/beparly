import * as Crypto from 'expo-crypto';
import { canonicalPayload, type CheckoutCommand, type CheckoutPayload } from './checkout-command';

export function preparedCommand(businessId: number, userId: number, payload: CheckoutPayload): CheckoutCommand {
  return { id: Crypto.randomUUID(), businessId, userId, payload, fingerprint: canonicalPayload(payload),
    createdAt: new Date().toISOString(), state: 'prepared', saleId: null,
    lastError: null, attempts: 0, lastAttemptAt: null };
}

export const commandHash = (command: CheckoutCommand) =>
  Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, command.fingerprint);
