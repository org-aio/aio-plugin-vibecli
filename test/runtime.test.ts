import assert from 'node:assert/strict';
import { test } from 'node:test';
import { execute, verify } from '../backend/commands/runtime';
import { bundleSchema, initialBundle } from '../shared/commands/model';
import { documentation } from '../shared/commands/documentation';

test('定义同时驱动参数解析、帮助、逻辑、文档和示例验收', async () => {
  const bundle = initialBundle();
  assert.deepEqual(await execute(bundle, ['greet', '--name', 'Ada']), { stdout: 'Hello, Ada!\n', stderr: '', exit_code: 0 });
  assert.equal((await verify(bundle)).passed, true);
  const help = await execute(bundle, ['greet', '--help']);
  assert.equal(help.exit_code, 0);
  assert.match(help.stdout, /--name/);
  assert.match(documentation(bundle), /aio greet --name/);
  assert.equal((await execute(bundle, ['greet'])).exit_code, 1);
  assert.equal((await execute(bundle, ['greet', '--unknown'])).exit_code, 1);
});

test('嵌套命令、数字、布尔、位置参数和带连字符参数名称', async () => {
  const bundle = initialBundle();
  bundle.commands = [{ path: ['math', 'add'], description: '加法', source: 'return input.left + input["right-number"] + (input.double ? 100 : 0);', options: [
    { name: 'left', description: '', type: 'number', positional: true, required: true },
    { name: 'right-number', description: '', type: 'number', positional: false, required: false, default: 2 },
    { name: 'double', description: '', type: 'boolean', positional: false, required: false },
  ], examples: [{ argv: ['40'], expected_stdout: '42\n', expected_exit_code: 0 }] }];
  assert.equal((await verify(bundle)).passed, true);
  assert.equal((await execute(bundle, ['math', 'add', '1', '--right-number', '4', '--double'])).stdout, '105\n');
  assert.equal((await execute(bundle, ['math', 'add', 'NaN'])).exit_code, 1);
});

test('QuickJS 不暴露宿主、限制无限循环和输出大小，失败后后续执行可恢复', async () => {
  const bundle = initialBundle();
  bundle.commands[0]!.source = 'return typeof process + ":" + typeof require + ":" + typeof fetch;';
  assert.equal((await execute(bundle, ['greet', '--name', 'Ada'])).stdout, 'undefined:undefined:undefined\n');
  bundle.commands[0]!.source = 'while (true) {}';
  assert.equal((await execute(bundle, ['greet', '--name', 'Ada'])).exit_code, 1);
  bundle.commands[0]!.source = 'return "x".repeat(100000);';
  assert.equal((await execute(bundle, ['greet', '--name', 'Ada'])).exit_code, 1);
  assert.equal((await execute(initialBundle(), ['greet', '--name', 'Ada'])).exit_code, 0);
});

test('失败示例阻止验证通过，命令冲突和默认值类型错误被拒绝', async () => {
  const bundle = initialBundle();
  bundle.commands[0]!.examples[0]!.expected_stdout = 'wrong\n';
  assert.equal((await verify(bundle)).passed, false);
  const conflict = initialBundle();
  conflict.commands.push({ ...conflict.commands[0]! });
  assert.equal(bundleSchema.safeParse(conflict).success, false);
  const reserved = initialBundle();
  reserved.commands[0]!.path = ['plugin'];
  assert.equal(bundleSchema.safeParse(reserved).success, false);
  const invalid = initialBundle();
  invalid.commands[0]!.options[0]!.default = 42;
  assert.equal(bundleSchema.safeParse(invalid).success, false);
  const negated = initialBundle();
  negated.commands[0]!.options.push({ name: 'no-cache', description: '', type: 'boolean', positional: false, required: false });
  assert.equal(bundleSchema.safeParse(negated).success, false);
});

test('帮助文本不能绕过实际命令逻辑的发布验收', async () => {
  const bundle = initialBundle();
  bundle.commands[0]!.source = 'return ( ;';
  const help = await execute(bundle, ['greet', '--help']);
  bundle.commands[0]!.examples = [{ argv: ['--help'], expected_stdout: help.stdout, expected_exit_code: 0 }];
  const report = await verify(bundle);
  assert.equal(report.passed, false);
  assert.match(report.results[0]!.actual.stderr, /必须执行命令逻辑/);
});
