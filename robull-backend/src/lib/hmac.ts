import { createHmac, createHash } from 'crypto';

const AIM_KEY_SECRET = process.env.AIM_KEY_SECRET;

export function hmacHash(apiKey: string): string {
  if (AIM_KEY_SECRET) {
    return createHmac('sha256', AIM_KEY_SECRET).update(apiKey).digest('hex');
  }
  // Fallback for local dev without secret configured
  return createHash('sha256').update(apiKey).digest('hex');
}
