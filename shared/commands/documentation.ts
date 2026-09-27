import type { CommandBundle, CommandDefinition } from './model';

function literal(value: unknown): string { return `\`${String(value).replaceAll('`', '\\`').replaceAll('\n', ' ')}\``; }

export function usage(command: CommandDefinition): string {
  const parameters = command.options.map(option => {
    const name = option.positional ? option.name : `--${option.name}${option.type === 'boolean' ? '' : ` <${option.type}>`}`;
    return option.required ? (option.positional ? `<${name}>` : name) : `[${name}]`;
  });
  return ['aio', ...command.path, ...parameters].join(' ');
}

export function documentation(bundle: CommandBundle): string {
  const sections = bundle.commands.map(command => {
    const options = command.options.map(option =>
      `| ${literal(option.positional ? option.name : `--${option.name}`)} | ${option.type} | ${option.required ? '是' : '否'} | ${option.description.replaceAll('|', '\\|').replaceAll('\n', ' ')} | ${option.default === undefined ? '' : literal(option.default)} |`,
    ).join('\n');
    const examples = command.examples.map(example => {
      const argv = example.argv.map(argument => /[^a-zA-Z0-9_./=-]/.test(argument) ? `'${argument.replaceAll("'", "'\\''")}'` : argument);
      return `\`\`\`sh\naio ${[...command.path, ...argv].join(' ')}\n\`\`\`\n\n预期退出码：${example.expected_exit_code}\n\n\`\`\`text\n${example.expected_stdout.replaceAll('```', '` ` `')}\`\`\``;
    }).join('\n\n');
    return `## ${command.path.join(' ')}\n\n${command.description}\n\n\`\`\`text\n${usage(command)}\n\`\`\`\n\n| 参数 | 类型 | 必填 | 说明 | 默认值 |\n| --- | --- | --- | --- | --- |\n${options}\n\n### 示例\n\n${examples}`;
  });
  return `# ${bundle.title}\n\n${sections.join('\n\n')}\n`;
}
