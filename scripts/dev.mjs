import { spawn } from 'node:child_process';

// 开发代理使用 loopback TCP，让服务端可以验证真实连接地址。
const child = spawn(process.execPath, ['node_modules/nuxt/bin/nuxt.mjs', 'dev', ...process.argv.slice(2)], {
  stdio: 'inherit', env: { ...process.env, NITRO_NO_UNIX_SOCKET: '1' },
});
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => child.kill(signal));
}
child.on('exit', (code, signal) => { process.exitCode = signal ? 0 : (code ?? 1); });
