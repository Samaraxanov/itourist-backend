import crypto from 'node:crypto';
import { ApiError } from './apiError.js';

export interface TelegramUser {
  id: number;
  first_name?: string;
  last_name?: string;
  username?: string;
  photo_url?: string;
  language_code?: string;
}

// Verify a Telegram Mini App `initData` string and return the embedded user.
//
// Per Telegram's spec:
//   secret_key = HMAC_SHA256(key="WebAppData", msg=bot_token)
//   expected   = HMAC_SHA256(key=secret_key, msg=data_check_string) as hex
// where data_check_string is every field except `hash`, as "k=v" lines sorted
// by key and joined with "\n". A mismatch means the data wasn't signed by our bot.
export function verifyInitData(initData: string, botToken: string, maxAgeSeconds = 86400): TelegramUser {
  const params = new URLSearchParams(initData);
  const hash = params.get('hash');
  if (!hash) throw ApiError.unauthorized('Telegram: missing hash');
  params.delete('hash');

  const dataCheckString = [...params.entries()]
    .map(([k, v]) => `${k}=${v}`)
    .sort()
    .join('\n');

  const secretKey = crypto.createHmac('sha256', 'WebAppData').update(botToken).digest();
  const expected = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex');

  // Constant-time compare.
  const ok =
    expected.length === hash.length &&
    crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(hash));
  if (!ok) throw ApiError.unauthorized('Telegram: invalid signature');

  const authDate = Number(params.get('auth_date'));
  if (authDate && Date.now() / 1000 - authDate > maxAgeSeconds) {
    throw ApiError.unauthorized('Telegram: initData expired');
  }

  const userRaw = params.get('user');
  if (!userRaw) throw ApiError.unauthorized('Telegram: no user in initData');
  try {
    return JSON.parse(userRaw) as TelegramUser;
  } catch {
    throw ApiError.unauthorized('Telegram: malformed user');
  }
}
