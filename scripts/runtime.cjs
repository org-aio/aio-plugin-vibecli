#!/usr/bin/env node
const { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync, chmodSync, watch } = require('node:fs');
const { tmpdir } = require('node:os');
const { join, dirname, resolve, sep } = require('node:path');
const { brotliDecompressSync } = require('node:zlib');
const { pathToFileURL } = require('node:url');
const payload = __ARCHIVE__;
process.env.VIBECLI_DATA_DIR ||= resolve(process.cwd(), '.data');
const directory = mkdtempSync(join(tmpdir(), 'aio-service-'));
process.on('exit', () => rmSync(directory, { recursive: true, force: true }));
for (const [name, data] of Object.entries(payload.files)) {
  const target = resolve(directory, name);
  if (!target.startsWith(directory + sep)) throw new Error('服务端归档路径无效');
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, brotliDecompressSync(Buffer.from(data, 'base64')));
}
for (const [name, link] of Object.entries(payload.links)) {
  const target = resolve(directory, name);
  if (!target.startsWith(directory + sep) || !resolve(dirname(target), link).startsWith(directory + sep)) {
    throw new Error('服务端依赖路径无效');
  }
  mkdirSync(dirname(target), { recursive: true });
  symlinkSync(link, target);
}
process.env.NODE_ENV = 'production';
process.env.PORT = process.env.AIO_PLUGIN_PORT || process.env.PORT || '8080';
process.env.HOSTNAME = process.env.VIBECLI_ACCESS_TOKEN ? '0.0.0.0' : '127.0.0.1';
process.env.HOST = process.env.HOSTNAME;
process.env.NITRO_HOST = process.env.HOST;
process.env.NITRO_PORT = process.env.PORT;
if (process.env.AIO_PLUGIN_SOCKET) {
  process.env.NITRO_UNIX_SOCKET = process.env.AIO_PLUGIN_SOCKET;
  const socket = process.env.AIO_PLUGIN_SOCKET;
  const monitor = watch(dirname(socket), () => {
    try { chmodSync(socket, 0o666); monitor.close(); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  });
  monitor.unref();
  process.on('exit', () => monitor.close());
}
process.chdir(directory);
import(pathToFileURL(join(directory, payload.entry)).href).catch(error => {
  console.error(error);
  process.exit(1);
});
