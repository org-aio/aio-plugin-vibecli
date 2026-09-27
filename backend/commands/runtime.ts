import { createHash } from 'node:crypto';
import { Argument, Command, CommanderError, InvalidArgumentError, Option, type OutputConfiguration } from 'commander';
import { getQuickJS } from 'quickjs-emscripten';
import { bundleSchema, type CommandBundle, type CommandDefinition, type ExecutionResult, type VerificationReport } from '../../shared/commands/model';

const outputLimit = 65536;

export function fingerprint(bundle: CommandBundle): string {
  return createHash('sha256').update(JSON.stringify(bundleSchema.parse(bundle))).digest('hex');
}

function parseNumber(value: string): number {
  if (value.trim() === '') { throw new InvalidArgumentError('参数必须为数字'); }
  const number = Number(value);
  if (!Number.isFinite(number)) { throw new InvalidArgumentError('参数必须为有限数字'); }
  return number;
}

function parser(bundle: CommandBundle, select: (definition: CommandDefinition, input: Record<string, unknown>) => void, output: ExecutionResult): Command {
  const writers = {
    writeOut: value => { output.stdout += value; },
    writeErr: value => { output.stderr += value; },
  } satisfies OutputConfiguration;
  const program = new Command('aio').description(bundle.title).exitOverride().configureOutput(writers);
  const nodes = new Map<string, Command>([['', program]]);
  for (const definition of bundle.commands) {
    let parent = program;
    for (let index = 0; index < definition.path.length; index++) {
      const key = definition.path.slice(0, index + 1).join(' ');
      let node = nodes.get(key);
      if (!node) {
        node = new Command(definition.path[index]!).exitOverride().configureOutput(writers);
        parent.addCommand(node);
        nodes.set(key, node);
      }
      parent = node;
    }
    parent.description(definition.description);
    const keys = new Map<string, string>();
    for (const parameter of definition.options) {
      if (parameter.positional) {
        const argument = new Argument(parameter.required ? `<${parameter.name}>` : `[${parameter.name}]`, parameter.description);
        if (parameter.type === 'number') { argument.argParser(parseNumber); }
        if (parameter.default !== undefined) { argument.default(parameter.default); }
        parent.addArgument(argument);
        continue;
      }
      const option = new Option(`--${parameter.name}${parameter.type === 'boolean' ? '' : ` <${parameter.type}>`}`, parameter.description);
      option.makeOptionMandatory(parameter.required);
      if (parameter.type === 'number') { option.argParser(parseNumber); }
      if (parameter.default !== undefined) { option.default(parameter.default); }
      parent.addOption(option);
      keys.set(parameter.name, option.attributeName());
    }
    parent.action(() => {
      const options = parent.opts();
      const input: Record<string, unknown> = {};
      let positional = 0;
      for (const parameter of definition.options) {
        const value = parameter.positional ? parent.processedArgs[positional++] : options[keys.get(parameter.name)!];
        if (value !== undefined) { input[parameter.name] = value; }
      }
      select(definition, input);
    });
  }
  return program;
}

// 用户逻辑只得到 JSON 参数，在有时间和内存限制的独立 QuickJS 堆中执行。
async function runScript(definition: CommandDefinition, input: Record<string, unknown>): Promise<ExecutionResult> {
  const quickjs = await getQuickJS();
  const runtime = quickjs.newRuntime();
  runtime.setMemoryLimit(16 * 1024 * 1024);
  runtime.setMaxStackSize(512 * 1024);
  const deadline = performance.now() + 500;
  runtime.setInterruptHandler(() => performance.now() > deadline);
  const context = runtime.newContext();
  try {
    const serializedInput = JSON.stringify(JSON.stringify(input));
    const source = `(function() { const value = (function(input) { "use strict";\n${definition.source}\n})(JSON.parse(${serializedInput})); if (value && typeof value.then === "function") { throw new Error("命令逻辑必须同步返回结果"); } return JSON.stringify(value); })()`;
    const result = context.evalCode(source, `${definition.path.join('-')}.js`);
    if (result.error) {
      const error = context.dump(result.error) as { message?: string };
      result.error.dispose();
      return { stdout: '', stderr: `${String(error?.message ?? '执行失败').slice(0, outputLimit)}\n`, exit_code: 1 };
    }
    const text = context.dump(result.value) as string | undefined;
    result.value.dispose();
    if (typeof text !== 'string' || text.length > outputLimit) {
      return { stdout: '', stderr: '命令必须返回可序列化结果，且输出不能超过 64 KiB\n', exit_code: 1 };
    }
    const value: unknown = JSON.parse(text);
    const stdout = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
    return { stdout: `${stdout}\n`, stderr: '', exit_code: 0 };
  } finally {
    context.dispose();
    runtime.dispose();
  }
}

async function executeInvocation(rawBundle: CommandBundle, argv: string[]): Promise<{ output: ExecutionResult; command_path?: string }> {
  const bundle = bundleSchema.parse(rawBundle);
  if (!Array.isArray(argv) || argv.length > 128 || argv.some(value => typeof value !== 'string' || value.length > 4096)) {
    throw new Error('命令参数超过限制');
  }
  const output: ExecutionResult = { stdout: '', stderr: '', exit_code: 0 };
  let selection: { definition: CommandDefinition; input: Record<string, unknown> } | undefined;
  const program = parser(bundle, (definition, input) => { selection = { definition, input }; }, output);
  try {
    program.parse(argv, { from: 'user' });
  } catch (error) {
    if (error instanceof CommanderError) {
      return { output: { ...output, exit_code: error.exitCode } };
    }
    throw error;
  }
  if (!selection) { return { output }; }
  return { output: await runScript(selection.definition, selection.input), command_path: selection.definition.path.join(' ') };
}

export async function execute(rawBundle: CommandBundle, argv: string[]): Promise<ExecutionResult> {
  return (await executeInvocation(rawBundle, argv)).output;
}

export async function verify(rawBundle: CommandBundle): Promise<VerificationReport> {
  const bundle = bundleSchema.parse(rawBundle);
  const results: VerificationReport['results'] = [];
  // 发布前逐例执行，整批配额避免大量慢脚本阻塞服务。
  const deadline = performance.now() + 10000;
  for (const command of bundle.commands) {
    for (const example of command.examples) {
      const argv = [...command.path, ...example.argv];
      const invocation = performance.now() > deadline
        ? { output: { stdout: '', stderr: '验证总时间超过 10 秒\n', exit_code: 1 }, command_path: undefined }
        : await executeInvocation(bundle, argv);
      const actual = invocation.output;
      const implementationRan = invocation.command_path === command.path.join(' ');
      if (example.expected_exit_code === 0 && !implementationRan) {
        actual.stderr += '成功示例必须执行命令逻辑，帮助输出不能作为成功示例\n';
      }
      const passed = actual.stdout === example.expected_stdout && actual.exit_code === example.expected_exit_code
        && (example.expected_exit_code !== 0 || implementationRan);
      results.push({ command_path: command.path.join(' '), argv, expected_stdout: example.expected_stdout, expected_exit_code: example.expected_exit_code, actual, passed });
    }
  }
  return { passed: results.every(result => result.passed), results, fingerprint: fingerprint(bundle) };
}
