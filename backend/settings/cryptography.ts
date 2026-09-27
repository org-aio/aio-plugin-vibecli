import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { request } from 'node:http';
import { resolve } from 'node:path';
import type { Scope } from '../hosting/authentication';
import type { Configuration } from '../hosting/configuration';

export interface SecretCipher { seal(scope: Scope, value: string): Promise<string>; open(scope: Scope, value: string): Promise<string> }

function base64(value: string): Buffer {
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) {
    throw new Error('加密密钥或载荷不是合法 Base64');
  }
  return Buffer.from(value, 'base64');
}

export class LocalCipher implements SecretCipher {
  constructor(private readonly key: Buffer) {
    if (key.length !== 32) { throw new Error('加密密钥必须是 32 字节'); }
  }
  async seal(scope: Scope, value: string): Promise<string> {
    const nonce = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, nonce);
    cipher.setAAD(Buffer.from(JSON.stringify([scope.tenant, scope.user])));
    const data = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
    return Buffer.concat([nonce, cipher.getAuthTag(), data]).toString('base64');
  }
  async open(scope: Scope, value: string): Promise<string> {
    const packed = base64(value);
    if (packed.length < 28) { throw new Error('加密载荷无效'); }
    const decipher = createDecipheriv('aes-256-gcm', this.key, packed.subarray(0, 12));
    decipher.setAuthTag(packed.subarray(12, 28));
    decipher.setAAD(Buffer.from(JSON.stringify([scope.tenant, scope.user])));
    return Buffer.concat([decipher.update(packed.subarray(28)), decipher.final()]).toString('utf8');
  }
}

export class HostCipher implements SecretCipher {
  constructor(private readonly config: Configuration) {}
  private cryptography(scope: Scope, value: string, operation: 'seal' | 'open'): Promise<string> {
    const payload = Buffer.from(JSON.stringify({ purpose: `vibecli-ai:${scope.user}`, value }));
    return new Promise((resolve, reject) => {
      const call = request(`http://localhost/cryptography/${operation}`, {
        method: 'POST', socketPath: this.config.brokerSocket,
        headers: { 'content-type': 'application/json', 'content-length': String(payload.length), 'x-aio-token': this.config.ingressToken || '' },
      }, response => {
        const chunks: Buffer[] = []; let size = 0;
        response.on('data', (chunk: Buffer) => {
          size += chunk.length;
          if (size > 65536) { call.destroy(new Error('宿主加密响应超过配额')); return; }
          chunks.push(chunk);
        });
        response.on('error', error => { clearTimeout(timer); reject(error); });
        response.on('end', () => {
          clearTimeout(timer);
          if (response.statusCode !== 200) { reject(new Error('宿主拒绝加密操作')); return; }
          try {
            const result = JSON.parse(Buffer.concat(chunks).toString('utf8'));
            if (typeof result.value !== 'string') { throw new Error('宿主加密响应无效'); }
            base64(result.value);
            resolve(result.value);
          } catch (error) { reject(error); }
        });
        response.on('close', () => {
          if (!response.complete) { call.destroy(new Error('宿主加密响应提前关闭')); }
        });
      });
      const timer = setTimeout(() => call.destroy(new Error('宿主加密操作超时')), 10000);
      call.on('error', error => { clearTimeout(timer); reject(error); });
      call.end(payload);
    });
  }
  seal(scope: Scope, value: string): Promise<string> {
    return this.cryptography(scope, Buffer.from(value).toString('base64'), 'seal');
  }
  async open(scope: Scope, value: string): Promise<string> {
    const clear = await this.cryptography(scope, value, 'open');
    return base64(clear).toString('utf8');
  }
}

export async function secretCipher(config: Configuration): Promise<SecretCipher> {
  if (config.hosted) { return new HostCipher(config); }
  if (process.env.VIBECLI_ENCRYPTION_KEY) { return new LocalCipher(base64(process.env.VIBECLI_ENCRYPTION_KEY)); }
  if (!config.development) { throw new Error('正式独立运行保存密钥必须配置 VIBECLI_ENCRYPTION_KEY'); }
  const path = resolve(process.env.VIBECLI_DATA_DIR || '.data', 'encryption.key');
  await mkdir(resolve(path, '..'), { recursive: true, mode: 0o700 });
  try { return new LocalCipher(base64((await readFile(path, 'utf8')).trim())); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') { throw error; }
  }
  try { await writeFile(path, randomBytes(32).toString('base64'), { flag: 'wx', mode: 0o600 }); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') { throw error; }
  }
  return new LocalCipher(base64((await readFile(path, 'utf8')).trim()));
}
