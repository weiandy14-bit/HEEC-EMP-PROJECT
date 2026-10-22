import { HttpStatus, Injectable } from '@nestjs/common';
import { DomainError } from '../common/errors';
import { decodeJwt, validateClaims, verifySignature, supportedAlg, type Jwk, type JwtClaims } from './jwt';

/**
 * 企業 OIDC 存取令牌驗證（§2、§8）。
 * 以 issuer discovery 取得 JWKS，於記憶體快取並以 kid 查找；
 * 遇未知 kid 會刷新一次（處理金鑰輪替）。不發出金鑰外的任何外部請求。
 *
 * 設計為「DB 權威」：本服務僅負責「驗證此令牌確實由設定之 IdP 簽發且有效」，
 * 不決定組織歸屬與角色——那一律由 IdentityService 以 (issuer, subject) 查 DB 決定。
 */

interface OidcConfig {
  issuer: string;
  audience: string;
  jwksUri?: string;
  clockSkewSec: number;
  jwksTtlMs: number;
}

interface JwksCache {
  keys: Map<string, Jwk>;
  fetchedAt: number;
}

export function oidcConfigured(): boolean {
  return Boolean(process.env.OIDC_ISSUER && process.env.OIDC_AUDIENCE);
}

@Injectable()
export class OidcService {
  private cache: JwksCache | null = null;
  private jwksUriResolved: string | undefined;
  private inflight: Promise<void> | null = null;

  private config(): OidcConfig {
    const issuer = process.env.OIDC_ISSUER;
    const audience = process.env.OIDC_AUDIENCE;
    if (!issuer || !audience) {
      throw new DomainError(
        'infrastructure',
        'oidc_unconfigured',
        'OIDC 未設定（需要 OIDC_ISSUER 與 OIDC_AUDIENCE）',
      );
    }
    return {
      issuer,
      audience,
      jwksUri: process.env.OIDC_JWKS_URI,
      clockSkewSec: Number(process.env.OIDC_CLOCK_SKEW ?? 60),
      jwksTtlMs: Number(process.env.OIDC_JWKS_TTL_MS ?? 10 * 60 * 1000),
    };
  }

  /** 驗證 Bearer 令牌並回傳已驗證之 claims。任何失敗皆為 401。 */
  async verify(token: string): Promise<JwtClaims> {
    const cfg = this.config();
    const { header, claims, signingInput, signature } = decodeJwt(token);
    if (!supportedAlg(header.alg)) {
      throw new DomainError('authorization', 'invalid_token', `不支援的簽章演算法 ${header.alg}`, undefined, HttpStatus.UNAUTHORIZED);
    }
    // 先驗 claims 之 issuer，避免對任意來源令牌去抓 JWKS。
    validateClaims(claims, { issuer: cfg.issuer, audience: cfg.audience, clockSkewSec: cfg.clockSkewSec });

    let jwk = await this.key(cfg, header.kid);
    if (!jwk && header.kid) {
      // 可能金鑰已輪替：強制刷新一次再試。
      await this.refresh(cfg, true);
      jwk = await this.key(cfg, header.kid);
    }
    if (!jwk) {
      throw new DomainError('authorization', 'invalid_token', '找不到對應之簽章金鑰', undefined, HttpStatus.UNAUTHORIZED);
    }
    if (!verifySignature(header, signingInput, signature, jwk)) {
      throw new DomainError('authorization', 'invalid_token', '簽章驗證失敗', undefined, HttpStatus.UNAUTHORIZED);
    }
    return claims;
  }

  private async key(cfg: OidcConfig, kid?: string): Promise<Jwk | null> {
    if (!this.cache || Date.now() - this.cache.fetchedAt > cfg.jwksTtlMs) {
      await this.refresh(cfg, false);
    }
    const keys = this.cache?.keys;
    if (!keys || keys.size === 0) return null;
    if (kid) return keys.get(kid) ?? null;
    // 無 kid：唯一一把才可確定使用，否則拒絕（避免歧義）。
    return keys.size === 1 ? keys.values().next().value ?? null : null;
  }

  private async refresh(cfg: OidcConfig, force: boolean): Promise<void> {
    if (!force && this.cache && Date.now() - this.cache.fetchedAt <= cfg.jwksTtlMs) return;
    // 合併並行刷新，避免重複抓取。
    if (this.inflight) return this.inflight;
    this.inflight = this.doRefresh(cfg).finally(() => {
      this.inflight = null;
    });
    return this.inflight;
  }

  private async doRefresh(cfg: OidcConfig): Promise<void> {
    const uri = await this.resolveJwksUri(cfg);
    const jwks = await this.fetchJson(uri);
    const list = Array.isArray((jwks as { keys?: unknown }).keys) ? (jwks as { keys: Jwk[] }).keys : [];
    const map = new Map<string, Jwk>();
    for (const k of list) {
      if (k && (k.kty === 'RSA' || k.kty === 'EC') && (!k.use || k.use === 'sig')) {
        map.set(k.kid ?? `${k.kty}:${k.n ?? k.x ?? ''}`, k);
      }
    }
    if (map.size === 0) {
      throw new DomainError('infrastructure', 'jwks_unavailable', '無法取得簽章金鑰', undefined, HttpStatus.SERVICE_UNAVAILABLE);
    }
    this.cache = { keys: map, fetchedAt: Date.now() };
  }

  private async resolveJwksUri(cfg: OidcConfig): Promise<string> {
    if (cfg.jwksUri) return cfg.jwksUri;
    if (this.jwksUriResolved) return this.jwksUriResolved;
    const discoveryUrl = `${cfg.issuer.replace(/\/$/, '')}/.well-known/openid-configuration`;
    const doc = await this.fetchJson(discoveryUrl);
    const uri = (doc as { jwks_uri?: string }).jwks_uri;
    if (typeof uri !== 'string') {
      throw new DomainError('infrastructure', 'jwks_unavailable', 'discovery 文件缺少 jwks_uri', undefined, HttpStatus.SERVICE_UNAVAILABLE);
    }
    this.jwksUriResolved = uri;
    return uri;
  }

  private async fetchJson(url: string): Promise<unknown> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), Number(process.env.OIDC_HTTP_TIMEOUT_MS ?? 5000));
    try {
      const res = await fetch(url, { signal: controller.signal, headers: { accept: 'application/json' } });
      if (!res.ok) {
        throw new DomainError('infrastructure', 'jwks_unavailable', `OIDC 端點回應 ${res.status}`, undefined, HttpStatus.SERVICE_UNAVAILABLE);
      }
      return await res.json();
    } catch (e) {
      if (e instanceof DomainError) throw e;
      throw new DomainError('infrastructure', 'jwks_unavailable', 'OIDC 端點不可用，請稍後重試', undefined, HttpStatus.SERVICE_UNAVAILABLE);
    } finally {
      clearTimeout(timeout);
    }
  }
}
