import 'server-only';

import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

import { env } from './env';

/**
 * AES-256-GCM 加解密，供資料庫內的 AI 金鑰與 SMTP 密碼使用。
 *
 * 金鑰來自 `env.encryptionKey`（32 位元組 base64），啟動時
 * `assertEnvConsistency()` 已驗證長度，這裡不重複檢查。
 *
 * 密文格式：`v1.<iv base64>.<authTag base64>.<密文 base64>`，
 * 前綴 `v1` 保留未來換算法時可辨識版本。
 */

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;
const FORMAT_PREFIX = 'v1';

function getKey(): Buffer {
  return Buffer.from(env.encryptionKey, 'base64');
}

/**
 * 加密明文字串。
 *
 * 允許空字串（會產生一段有效密文，解密仍還原為空字串），
 * 藉此與「未設定」（呼叫端存 null）區分。
 */
export function encrypt(plain: string): string {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, getKey(), iv);
  const encrypted = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return [
    FORMAT_PREFIX,
    iv.toString('base64'),
    authTag.toString('base64'),
    encrypted.toString('base64'),
  ].join('.');
}

/**
 * 解密密文字串，還原為原本的明文。
 *
 * 格式錯誤或驗證失敗（金鑰不對、密文被竄改）一律拋出可讀的中文錯誤，
 * 不安靜回傳空字串，避免呼叫端誤把解密失敗當成「原文就是空字串」。
 */
export function decrypt(cipherText: string): string {
  const parts = cipherText.split('.');
  if (parts.length !== 4 || parts[0] !== FORMAT_PREFIX) {
    throw new Error('密文格式不正確，無法解密（版本前綴或欄位數不符）。');
  }

  const [, ivPart, authTagPart, dataPart] = parts;

  let iv: Buffer;
  let authTag: Buffer;
  let data: Buffer;
  try {
    iv = Buffer.from(ivPart, 'base64');
    authTag = Buffer.from(authTagPart, 'base64');
    data = Buffer.from(dataPart, 'base64');
  } catch {
    throw new Error('密文格式不正確，base64 解碼失敗。');
  }

  if (iv.length !== IV_LENGTH) {
    throw new Error(`密文格式不正確，iv 長度應為 ${IV_LENGTH} 位元組。`);
  }

  try {
    const decipher = createDecipheriv(ALGORITHM, getKey(), iv);
    decipher.setAuthTag(authTag);
    const decrypted = Buffer.concat([decipher.update(data), decipher.final()]);
    return decrypted.toString('utf8');
  } catch {
    throw new Error(
      '解密失敗，可能是 APP_ENCRYPTION_KEY 與加密時不同，或密文已被竄改。',
    );
  }
}
