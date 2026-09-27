import { z } from 'zod';

export const reservedRoots = new Set(['init', 'plugin', 'tool', 'helper', 'open', 'vibecli', 'help', 'space', 'memory']);
const identifier = z.string().regex(/^[a-z][a-z0-9-]{0,47}$/);

export const optionSchema = z.object({
  name: identifier,
  description: z.string().max(500),
  type: z.enum(['string', 'number', 'boolean']),
  positional: z.boolean(),
  required: z.boolean(),
  default: z.union([z.string(), z.number().finite(), z.boolean()]).optional(),
}).strict();

export const exampleSchema = z.object({
  argv: z.array(z.string().max(4096)).max(64),
  expected_stdout: z.string().max(65536),
  expected_exit_code: z.number().int().min(0).max(255).default(0),
}).strict();

export const commandSchema = z.object({
  path: z.array(identifier).min(1).max(4),
  description: z.string().min(1).max(1000),
  options: z.array(optionSchema).max(32),
  source: z.string().min(1).max(65536),
  examples: z.array(exampleSchema).min(1).max(16),
}).strict().superRefine((command, context) => {
  if (!command.examples.some(example => example.expected_exit_code === 0)) {
    context.addIssue({ code: 'custom', message: '每个命令至少需要一个成功示例', path: ['examples'] });
  }
  if (reservedRoots.has(command.path[0]!)) {
    context.addIssue({ code: 'custom', message: '命令与 aio 内置入口冲突', path: ['path'] });
  }
  const names = new Set<string>();
  let optionalPositional = false;
  for (const [index, option] of command.options.entries()) {
    if (names.has(option.name) || ['help', 'version'].includes(option.name)) {
      context.addIssue({ code: 'custom', message: '参数名称重复或被保留', path: ['options', index, 'name'] });
    }
    names.add(option.name);
    if (!option.positional && option.type === 'boolean' && option.name.startsWith('no-')) {
      context.addIssue({ code: 'custom', message: '布尔参数名称不能以 no- 开头，以免与否定选项语义冲突', path: ['options', index, 'name'] });
    }
    if (option.positional && (option.type === 'boolean' || (optionalPositional && option.required))) {
      context.addIssue({ code: 'custom', message: '位置参数不能为布尔值，必填位置参数必须在可选参数之前', path: ['options', index] });
    }
    if (option.positional && !option.required) { optionalPositional = true; }
    if (option.default !== undefined && typeof option.default !== option.type) {
      context.addIssue({ code: 'custom', message: '默认值与参数类型不一致', path: ['options', index, 'default'] });
    }
  }
});

export const bundleSchema = z.object({
  schema_version: z.literal(1),
  title: z.string().min(1).max(120),
  commands: z.array(commandSchema).min(1).max(64),
}).strict().superRefine((bundle, context) => {
  const paths = bundle.commands.map(command => command.path.join(' '));
  for (const [index, path] of paths.entries()) {
    if (paths.some((other, otherIndex) => otherIndex !== index && (other === path || other.startsWith(`${path} `)))) {
      context.addIssue({ code: 'custom', message: '命令路径重复，或可执行命令同时作为其他命令的父节点', path: ['commands', index, 'path'] });
    }
  }
});

export type CommandBundle = z.infer<typeof bundleSchema>;
export type CommandDefinition = z.infer<typeof commandSchema>;
export interface ExecutionResult { stdout: string; stderr: string; exit_code: number; revision?: string }
export interface VerificationResult {
  command_path: string; argv: string[]; expected_stdout: string; expected_exit_code: number;
  actual: ExecutionResult; passed: boolean;
}
export interface VerificationReport { passed: boolean; results: VerificationResult[]; fingerprint: string }
export interface Revision { id: string; created_at: string; bundle: CommandBundle; documentation: string; report: VerificationReport }
export interface Project {
  id: string; title: string; draft: CommandBundle; active_revision: string | null;
  revisions: Revision[]; updated_at: string;
}
export interface Workspace { projects: Project[]; development: boolean; ai_configured: boolean }

export function initialBundle(title = '我的命令集'): CommandBundle {
  return {
    schema_version: 1, title,
    commands: [{
      path: ['greet'], description: '生成问候语',
      options: [{ name: 'name', description: '称呼', type: 'string', positional: false, required: true }],
      source: 'return "Hello, " + input.name + "!";',
      examples: [{ argv: ['--name', 'Ada'], expected_stdout: 'Hello, Ada!\n', expected_exit_code: 0 }],
    }],
  };
}
