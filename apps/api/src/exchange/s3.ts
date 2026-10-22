import { createHash, createHmac } from 'node:crypto';

/**
 * 依賴最少的 AWS Signature V4 S3 相容用戶端（支援 AWS S3、Cloudflare R2、MinIO）。
 * 僅實作私有物件所需的 PUT / GET / DELETE，簽章涵蓋 payload 雜湊（非 UNSIGNED）。
 * 無第三方 SDK；以 node:crypto 與全域 fetch 完成。
 */

export interface S3Config {
  endpoint: string; // e.g. https://s3.us-east-1.amazonaws.com | https://<acct>.r2.cloudflarestorage.com | http://localhost:9000
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  forcePathStyle: boolean; // true: endpoint/bucket/key（MinIO/R2 友善）；false: 虛擬主機式
  prefix?: string; // 物件鍵前綴（選用）
}

const sha256hex = (data: Buffer | string) => createHash('sha256').update(data).digest('hex');
const hmac = (key: Buffer | string, data: string) => createHmac('sha256', key).update(data).digest();

/** RFC3986 URI 編碼；encodeSlash=false 時保留路徑分隔的斜線。 */
export function uriEncode(str: string, encodeSlash = true): string {
  let out = '';
  for (const ch of Buffer.from(str, 'utf8').toString('latin1')) {
    if (/[A-Za-z0-9\-._~]/.test(ch)) out += ch;
    else if (ch === '/' && !encodeSlash) out += ch;
    else out += '%' + ch.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0');
  }
  return out;
}

/** SigV4 簽章金鑰推導（可獨立測試：對應 AWS 文件已知測試向量）。 */
export function signingKey(secret: string, dateStamp: string, region: string, service: string): Buffer {
  const kDate = hmac('AWS4' + secret, dateStamp);
  const kRegion = hmac(kDate, region);
  const kService = hmac(kRegion, service);
  return hmac(kService, 'aws4_request');
}

export interface SignedRequest {
  url: string;
  headers: Record<string, string>;
}

/** 組出帶 SigV4 Authorization 標頭的請求（service 固定 s3）。 */
export function signS3Request(
  cfg: S3Config,
  method: 'GET' | 'PUT' | 'DELETE',
  objectKey: string,
  payload: Buffer,
  now: Date = new Date(),
): SignedRequest {
  const service = 's3';
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, ''); // YYYYMMDDTHHMMSSZ
  const dateStamp = amzDate.slice(0, 8);
  const ep = new URL(cfg.endpoint);
  const fullKey = (cfg.prefix ? cfg.prefix.replace(/\/$/, '') + '/' : '') + objectKey;

  let host: string;
  let canonicalUri: string;
  if (cfg.forcePathStyle) {
    host = ep.host;
    canonicalUri = `/${cfg.bucket}/${uriEncode(fullKey, false)}`;
  } else {
    host = `${cfg.bucket}.${ep.host}`;
    canonicalUri = `/${uriEncode(fullKey, false)}`;
  }
  const url = `${ep.protocol}//${host}${canonicalUri}`;

  const payloadHash = sha256hex(payload);
  const headers: Record<string, string> = {
    host,
    'x-amz-content-sha256': payloadHash,
    'x-amz-date': amzDate,
  };
  if (method === 'PUT') headers['content-length'] = String(payload.length);

  // Canonical request（簽章標頭：host;x-amz-content-sha256;x-amz-date）。
  const signedHeaderNames = ['host', 'x-amz-content-sha256', 'x-amz-date'];
  const canonicalHeaders = signedHeaderNames.map((h) => `${h}:${headers[h].trim()}\n`).join('');
  const signedHeaders = signedHeaderNames.join(';');
  const canonicalRequest = [method, canonicalUri, '', canonicalHeaders, signedHeaders, payloadHash].join('\n');

  const scope = `${dateStamp}/${cfg.region}/${service}/aws4_request`;
  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256hex(canonicalRequest)].join('\n');
  const signature = createHmac('sha256', signingKey(cfg.secretAccessKey, dateStamp, cfg.region, service))
    .update(stringToSign)
    .digest('hex');

  headers['authorization'] =
    `AWS4-HMAC-SHA256 Credential=${cfg.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
  return { url, headers };
}

export function s3ConfigFromEnv(): S3Config | null {
  const endpoint = process.env.S3_ENDPOINT;
  const bucket = process.env.S3_BUCKET;
  const accessKeyId = process.env.S3_ACCESS_KEY_ID;
  const secretAccessKey = process.env.S3_SECRET_ACCESS_KEY;
  if (!endpoint || !bucket || !accessKeyId || !secretAccessKey) return null;
  return {
    endpoint,
    bucket,
    accessKeyId,
    secretAccessKey,
    region: process.env.S3_REGION ?? 'auto',
    forcePathStyle: process.env.S3_FORCE_PATH_STYLE !== 'false',
    prefix: process.env.S3_PREFIX,
  };
}

export class S3Client {
  constructor(private readonly cfg: S3Config) {}

  private async send(method: 'GET' | 'PUT' | 'DELETE', key: string, body: Buffer): Promise<Response> {
    const { url, headers } = signS3Request(this.cfg, method, key, body);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), Number(process.env.S3_HTTP_TIMEOUT_MS ?? 15000));
    try {
      return await fetch(url, {
        method,
        headers,
        body: method === 'PUT' ? new Uint8Array(body) : undefined,
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeout);
    }
  }

  async put(key: string, bytes: Buffer): Promise<void> {
    const res = await this.send('PUT', key, bytes);
    if (!res.ok) throw new Error(`S3 PUT ${res.status}`);
  }

  /** 回傳物件 bytes；404 回傳 null（供清理冪等判斷）。 */
  async get(key: string): Promise<Buffer | null> {
    const res = await this.send('GET', key, Buffer.alloc(0));
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`S3 GET ${res.status}`);
    return Buffer.from(await res.arrayBuffer());
  }

  async del(key: string): Promise<void> {
    const res = await this.send('DELETE', key, Buffer.alloc(0));
    if (!res.ok && res.status !== 404) throw new Error(`S3 DELETE ${res.status}`);
  }
}
