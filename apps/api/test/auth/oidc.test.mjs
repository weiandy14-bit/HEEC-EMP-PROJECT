// Phase 6 B1 — OIDC 存取令牌驗證（零相依 JWT + JWKS）單元測試。
// 以本機 HTTP 伺服器提供 discovery 與 JWKS，實測 RS256/ES256 簽章、
// 時效、aud/iss 比對、kid 輪替刷新與 alg=none 拒絕。需先 build 出 dist。
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {generateKeyPairSync, sign as cryptoSign, randomUUID} from 'node:crypto';
import {createRequire} from 'node:module';
const require = createRequire(import.meta.url);
const {OidcService} = require('../../dist/auth/oidc.service.js');

const b64u = (buf) => Buffer.from(buf).toString('base64').replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
const jsonSeg = (o) => b64u(JSON.stringify(o));

function rsaKey(kid){
  const {publicKey,privateKey}=generateKeyPairSync('rsa',{modulusLength:2048});
  const jwk={...publicKey.export({format:'jwk'}),kid,alg:'RS256',use:'sig'};
  return {kid,jwk,privateKey,alg:'RS256'};
}
function ecKey(kid){
  const {publicKey,privateKey}=generateKeyPairSync('ec',{namedCurve:'P-256'});
  const jwk={...publicKey.export({format:'jwk'}),kid,alg:'ES256',use:'sig'};
  return {kid,jwk,privateKey,alg:'ES256'};
}
function signJwt(key,claims,{alg=key.alg,kid=key.kid}={}){
  const header={alg,kid,typ:'JWT'};
  const input=`${jsonSeg(header)}.${jsonSeg(claims)}`;
  let sig;
  if(alg==='none'){sig='';}
  else if(alg.startsWith('ES')){sig=b64u(cryptoSign('sha256',Buffer.from(input),{key:key.privateKey,dsaEncoding:'ieee-p1363'}));}
  else{sig=b64u(cryptoSign('RSA-SHA256',Buffer.from(input),key.privateKey));}
  return `${input}.${sig}`;
}

// 本機 IdP：discovery + JWKS。keysRef 可於測試中變更以模擬金鑰輪替。
function startIdp(keysRef){
  const server=http.createServer((req,res)=>{
    if(req.url.startsWith('/.well-known/openid-configuration')){
      res.setHeader('content-type','application/json');
      res.end(JSON.stringify({issuer:base,jwks_uri:`${base}/jwks`}));
    }else if(req.url.startsWith('/jwks')){
      res.setHeader('content-type','application/json');
      res.end(JSON.stringify({keys:keysRef.keys.map(k=>k.jwk)}));
    }else{res.statusCode=404;res.end('no');}
  });
  let base;
  return new Promise((resolve)=>{
    server.listen(0,'127.0.0.1',()=>{const {port}=server.address();base=`http://127.0.0.1:${port}`;resolve({server,base:()=>base});});
  });
}

function baseClaims(iss,extra={}){
  const now=Math.floor(Date.now()/1000);
  return {iss,sub:'user-'+randomUUID(),aud:'heec-api',iat:now,nbf:now-5,exp:now+300,email:'u@example.com',...extra};
}

async function withIdp(fn){
  const keysRef={keys:[rsaKey('k-rsa-1')]};
  const {server,base}=await startIdp(keysRef);
  const iss=base();
  const prev={ISS:process.env.OIDC_ISSUER,AUD:process.env.OIDC_AUDIENCE,JWKS:process.env.OIDC_JWKS_URI};
  process.env.OIDC_ISSUER=iss;process.env.OIDC_AUDIENCE='heec-api';delete process.env.OIDC_JWKS_URI;
  try{await fn({keysRef,iss,base});}
  finally{
    await new Promise(r=>server.close(r));
    process.env.OIDC_ISSUER=prev.ISS;process.env.OIDC_AUDIENCE=prev.AUD;if(prev.JWKS)process.env.OIDC_JWKS_URI=prev.JWKS;else delete process.env.OIDC_JWKS_URI;
  }
}

test('RS256 有效令牌：以 discovery 取 JWKS 並通過驗證', async()=>{
  await withIdp(async({keysRef,iss})=>{
    const svc=new OidcService();
    const claims=await svc.verify(signJwt(keysRef.keys[0],baseClaims(iss)));
    assert.equal(claims.iss,iss);assert.equal(claims.aud,'heec-api');assert.ok(claims.sub);
  });
});

test('ES256 有效令牌通過驗證', async()=>{
  await withIdp(async({keysRef,iss})=>{
    const ec=ecKey('k-ec-1');keysRef.keys.push(ec);
    const svc=new OidcService();
    const claims=await svc.verify(signJwt(ec,baseClaims(iss)));
    assert.ok(claims.sub);
  });
});

test('過期令牌被拒（token_expired）', async()=>{
  await withIdp(async({keysRef,iss})=>{
    const svc=new OidcService();
    const now=Math.floor(Date.now()/1000);
    await assert.rejects(()=>svc.verify(signJwt(keysRef.keys[0],baseClaims(iss,{exp:now-120,iat:now-200,nbf:now-200}))),/過期|token_expired|expired/);
  });
});

test('audience 不符被拒', async()=>{
  await withIdp(async({keysRef,iss})=>{
    const svc=new OidcService();
    await assert.rejects(()=>svc.verify(signJwt(keysRef.keys[0],baseClaims(iss,{aud:'other-api'}))),/audience/);
  });
});

test('issuer 不符被拒', async()=>{
  await withIdp(async({keysRef})=>{
    const svc=new OidcService();
    await assert.rejects(()=>svc.verify(signJwt(keysRef.keys[0],baseClaims('https://evil.example'))),/issuer/);
  });
});

test('簽章竄改被拒', async()=>{
  await withIdp(async({keysRef,iss})=>{
    const svc=new OidcService();
    const t=signJwt(keysRef.keys[0],baseClaims(iss));
    const bad=t.slice(0,-3)+(t.endsWith('AAA')?'BBB':'AAA');
    await assert.rejects(()=>svc.verify(bad),/簽章|invalid_token/);
  });
});

test('alg=none 被拒（防演算法混淆）', async()=>{
  await withIdp(async({keysRef,iss})=>{
    const svc=new OidcService();
    await assert.rejects(()=>svc.verify(signJwt(keysRef.keys[0],baseClaims(iss),{alg:'none'})),/不支援|invalid_token/);
  });
});

test('未知 kid 觸發 JWKS 刷新一次後通過（金鑰輪替）', async()=>{
  await withIdp(async({keysRef,iss})=>{
    const svc=new OidcService();
    // 先以現有金鑰暖身，建立快取
    await svc.verify(signJwt(keysRef.keys[0],baseClaims(iss)));
    // IdP 輪替出新金鑰，簽發帶新 kid 的令牌
    const rotated=rsaKey('k-rsa-2');keysRef.keys=[rotated];
    const claims=await svc.verify(signJwt(rotated,baseClaims(iss)));
    assert.ok(claims.sub);
  });
});

test('未知 kid 且刷新後仍無對應金鑰 → 拒', async()=>{
  await withIdp(async({keysRef,iss})=>{
    const svc=new OidcService();
    const orphan=rsaKey('k-orphan'); // 不加入 IdP 的 JWKS
    await assert.rejects(()=>svc.verify(signJwt(orphan,baseClaims(iss))),/找不到|簽章|invalid_token/);
  });
});
