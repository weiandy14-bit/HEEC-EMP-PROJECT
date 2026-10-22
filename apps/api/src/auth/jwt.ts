import { createPublicKey, verify as cryptoVerify, type JsonWebKey, type KeyObject } from 'node:crypto';
import { HttpStatus } from '@nestjs/common';
import { DomainError } from '../common/errors';

/**
 * 零相依 JWT（JWS Compact）驗證核心。
 * 僅支援非對稱簽章（RSASSA-PKCS1、RSASSA-PSS、ECDSA），金鑰來自 OIDC 供應商之 JWKS。
 * 不接受 alg=none、HMAC 或任何對稱金鑰，避免 alg 混淆攻擊。
 */

export interface Jwk {
  kty: string;
  kid?: string;
  alg?: string;
  use?: string;
  n?: string;
  e?: string;
  crv?: string;
  x?: string;
  y?: string;
}

export interface JwtHeader {
  alg: string;
  kid?: string;
  typ?: string;
}

export interface JwtClaims {
  iss?: string;
  sub?: string;
  aud?: string | string[];
  exp?: number;
  nbf?: number;
  iat?: number;
  email?: string;
  email_verified?: boolean;
  name?: string;
  [k: string]: unknown;
}

const unauthorized = (code: string, message: string) =>
  new DomainError('authorization', code, message, undefined, HttpStatus.UNAUTHORIZED);

const fromB64Url = (s: string): Buffer =>
  Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64');

/** alg → Node 摘要演算法；EC 需以 IEEE P1363（r‖s 定寬）解讀 JWS 簽章。 */
const ALGS: Record<string, { hash: string; ec?: boolean; pss?: boolean }> = {
  RS256: { hash: 'RSA-SHA256' },
  RS384: { hash: 'RSA-SHA384' },
  RS512: { hash: 'RSA-SHA512' },
  PS256: { hash: 'RSA-SHA256', pss: true },
  PS384: { hash: 'RSA-SHA384', pss: true },
  PS512: { hash: 'RSA-SHA512', pss: true },
  ES256: { hash: 'sha256', ec: true },
  ES384: { hash: 'sha384', ec: true },
  ES512: { hash: 'sha512', ec: true },
};

export function supportedAlg(alg: string): boolean {
  return Object.prototype.hasOwnProperty.call(ALGS, alg);
}

/** 拆解 compact JWT；不驗章、不驗時效。 */
export function decodeJwt(token: string): {
  header: JwtHeader;
  claims: JwtClaims;
  signingInput: Buffer;
  signature: Buffer;
} {
  const parts = token.split('.');
  if (parts.length !== 3) throw unauthorized('invalid_token', 'JWT 格式錯誤');
  let header: JwtHeader;
  let claims: JwtClaims;
  try {
    header = JSON.parse(fromB64Url(parts[0]).toString('utf8'));
    claims = JSON.parse(fromB64Url(parts[1]).toString('utf8'));
  } catch {
    throw unauthorized('invalid_token', 'JWT 無法解碼');
  }
  if (!header || typeof header.alg !== 'string') throw unauthorized('invalid_token', 'JWT 標頭缺少 alg');
  return {
    header,
    claims,
    signingInput: Buffer.from(`${parts[0]}.${parts[1]}`),
    signature: fromB64Url(parts[2]),
  };
}

/** 以 JWK 公鑰驗證簽章。回傳是否通過；金鑰或演算法不合法即視為驗證失敗。 */
export function verifySignature(
  header: JwtHeader,
  signingInput: Buffer,
  signature: Buffer,
  jwk: Jwk,
): boolean {
  const spec = ALGS[header.alg];
  if (!spec) throw unauthorized('invalid_token', `不支援的簽章演算法 ${header.alg}`);
  if (jwk.alg && jwk.alg !== header.alg) return false; // JWK 自我宣告演算法須一致
  let key: KeyObject;
  try {
    key = createPublicKey({ key: jwk as unknown as JsonWebKey, format: 'jwk' });
  } catch {
    throw unauthorized('invalid_token', '金鑰無法解析');
  }
  const options: Record<string, unknown> = {};
  if (spec.ec) options.dsaEncoding = 'ieee-p1363';
  if (spec.pss) options.padding = 6; // RSA_PKCS1_PSS_PADDING
  try {
    return cryptoVerify(spec.hash, signingInput, { key, ...options } as never, signature);
  } catch {
    return false;
  }
}

/** 驗證標準 claims：iss/aud/exp/nbf/sub，允許設定時鐘偏差。 */
export function validateClaims(
  claims: JwtClaims,
  opts: { issuer: string; audience: string; clockSkewSec: number; now?: number },
): void {
  const now = opts.now ?? Math.floor(Date.now() / 1000);
  const skew = Math.max(0, opts.clockSkewSec);
  if (claims.iss !== opts.issuer) throw unauthorized('invalid_token', 'issuer 不符');
  const aud = Array.isArray(claims.aud) ? claims.aud : claims.aud ? [claims.aud] : [];
  if (!aud.includes(opts.audience)) throw unauthorized('invalid_token', 'audience 不符');
  if (typeof claims.exp !== 'number' || now > claims.exp + skew)
    throw unauthorized('token_expired', 'token 已過期');
  if (typeof claims.nbf === 'number' && now + skew < claims.nbf)
    throw unauthorized('invalid_token', 'token 尚未生效');
  if (typeof claims.sub !== 'string' || claims.sub.length === 0)
    throw unauthorized('invalid_token', '缺少 subject');
}
