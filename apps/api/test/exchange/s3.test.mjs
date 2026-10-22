// Phase 6 B3 — S3 相容私有儲存（SigV4）單元測試。
// 1) 簽章金鑰對 AWS 官方文件已知向量（KAT）；2) 請求簽章結構；
// 3) 以 mock S3 伺服器做 PUT→GET→DELETE 往返；4) ExchangeStorage facade 以 s3 驅動分派。
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {createRequire} from 'node:module';
const require = createRequire(import.meta.url);
const {signingKey, signS3Request, uriEncode, S3Client} = require('../../dist/exchange/s3.js');
const {ExchangeStorage} = require('../../dist/exchange/storage.js');

test('signingKey 對應 AWS 官方 KAT', () => {
  // https://docs.aws.amazon.com/.../signature-v4-examples (derive signing key)
  const key = signingKey('wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY', '20150830', 'us-east-1', 'iam');
  assert.equal(key.toString('hex'), 'c4afb1cc5771d871763a393e44b703571b55cc28424d1a5e86da6ed3c154a4b9');
});

test('uriEncode 保留未保留字元、編碼斜線可切換', () => {
  assert.equal(uriEncode('a b/c'), 'a%20b%2Fc');
  assert.equal(uriEncode('a b/c', false), 'a%20b/c');
  assert.equal(uriEncode('AZ-az-09-_.~'), 'AZ-az-09-_.~');
});

const cfg = () => ({endpoint:'http://127.0.0.1:1/', region:'us-east-1', bucket:'b', accessKeyId:'AKID', secretAccessKey:'SEKRET', forcePathStyle:true});

test('簽章請求結構正確且具決定性', () => {
  const now = new Date('2015-08-30T12:36:00Z');
  const a = signS3Request(cfg(), 'PUT', '00000000-0000-4000-8000-000000000000', Buffer.from('hello'), now);
  assert.match(a.headers.authorization, /^AWS4-HMAC-SHA256 Credential=AKID\/20150830\/us-east-1\/s3\/aws4_request, SignedHeaders=host;x-amz-content-sha256;x-amz-date, Signature=[0-9a-f]{64}$/);
  assert.equal(a.headers['x-amz-date'], '20150830T123600Z');
  assert.equal(a.headers['x-amz-content-sha256'], require('node:crypto').createHash('sha256').update('hello').digest('hex'));
  assert.ok(a.url.endsWith('/b/00000000-0000-4000-8000-000000000000'));
  // 決定性：相同輸入 → 相同簽章
  const b = signS3Request(cfg(), 'PUT', '00000000-0000-4000-8000-000000000000', Buffer.from('hello'), now);
  assert.equal(a.headers.authorization, b.headers.authorization);
  // payload 改變 → 簽章改變
  const c = signS3Request(cfg(), 'PUT', '00000000-0000-4000-8000-000000000000', Buffer.from('world'), now);
  assert.notEqual(a.headers.authorization, c.headers.authorization);
});

// --- mock S3：以記憶體 map 儲存，檢查簽章標頭存在 ---
function startMockS3(store){
  const server = http.createServer((req,res)=>{
    if(!/^AWS4-HMAC-SHA256 /.test(req.headers.authorization||'')){res.statusCode=403;return res.end('no sig');}
    const chunks=[];req.on('data',d=>chunks.push(d));req.on('end',()=>{
      const body=Buffer.concat(chunks);
      if(req.method==='PUT'){store.set(req.url,body);res.statusCode=200;res.end();}
      else if(req.method==='GET'){const b=store.get(req.url);if(!b){res.statusCode=404;res.end();}else{res.statusCode=200;res.end(b);}}
      else if(req.method==='DELETE'){store.delete(req.url);res.statusCode=204;res.end();}
      else{res.statusCode=405;res.end();}
    });
  });
  return new Promise(r=>server.listen(0,'127.0.0.1',()=>r({server,port:server.address().port})));
}

test('S3Client PUT→GET→DELETE 往返（mock）', async()=>{
  const store=new Map();const {server,port}=await startMockS3(store);
  try{
    const client=new S3Client({endpoint:`http://127.0.0.1:${port}`,region:'auto',bucket:'bkt',accessKeyId:'AKID',secretAccessKey:'S',forcePathStyle:true});
    const key='11111111-1111-4111-8111-111111111111';
    await client.put(key,Buffer.from('payload-αβ','utf8'));
    const got=await client.get(key);
    assert.equal(got.toString('utf8'),'payload-αβ');
    await client.del(key);
    assert.equal(await client.get(key),null);
  }finally{await new Promise(r=>server.close(r));}
});

test('ExchangeStorage facade：STORAGE_DRIVER=s3 時以 S3 往返', async()=>{
  const store=new Map();const {server,port}=await startMockS3(store);
  const prev={...process.env};
  try{
    process.env.STORAGE_DRIVER='s3';
    process.env.S3_ENDPOINT=`http://127.0.0.1:${port}`;
    process.env.S3_BUCKET='bkt';process.env.S3_ACCESS_KEY_ID='AKID';process.env.S3_SECRET_ACCESS_KEY='S';
    process.env.S3_REGION='auto';process.env.S3_FORCE_PATH_STYLE='true';
    const storage=new ExchangeStorage();
    const key=await storage.write(Buffer.from('file-bytes'));
    assert.match(key,/^[0-9a-f-]{36}$/);
    assert.equal((await storage.read(key)).toString(),'file-bytes');
    await storage.remove(key);
    await assert.rejects(()=>storage.read(key),/不存在|not_found|storage/);
  }finally{
    await new Promise(r=>server.close(r));
    for(const k of ['STORAGE_DRIVER','S3_ENDPOINT','S3_BUCKET','S3_ACCESS_KEY_ID','S3_SECRET_ACCESS_KEY','S3_REGION','S3_FORCE_PATH_STYLE']){if(prev[k]===undefined)delete process.env[k];else process.env[k]=prev[k];}
  }
});
