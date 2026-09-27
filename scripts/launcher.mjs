import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { chmod } from 'node:fs/promises';

export async function buildLauncher() {
  const native = process.platform === 'linux' && process.arch === 'x64';
  const compiler = native ? 'cc' : 'zig';
  const target = native ? [] : ['cc', '-target', 'x86_64-linux-musl'];
  try {
    await promisify(execFile)(compiler, [
      ...target, '-static', '-Os', '-std=c11', '-Wall', '-Wextra', '-Werror',
      'scripts/launcher.c', 'scripts/launcher.S', '-o', 'dist/server',
    ], { maxBuffer: 1024 * 1024 });
  } catch (error) {
    throw new Error(`Linux x86_64 启动器构建失败。Linux 需要 C 编译器，其他平台需要 Zig。${error.message}`);
  }
  await chmod('dist/server', 0o755);
}
