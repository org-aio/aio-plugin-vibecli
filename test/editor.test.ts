import assert from 'node:assert/strict';
import { test } from 'node:test';
import { execute } from '../backend/commands/runtime';
import { sourceDiagnostics } from '../frontend/commands/source-support';
import { initialBundle } from '../shared/commands/model';

test('编辑器语法诊断与 QuickJS 的严格模式函数体一致', async () => {
  const cases = [
    { source: 'return input.name;', valid: true },
    { source: 'return new.target === undefined;', valid: true },
    { source: 'var input = 1; return input;', valid: true },
    { source: 'const input = 1; return input;', valid: false },
    { source: 'with (input) { return name; }', valid: false },
    { source: 'return (;', valid: false },
  ];
  for (const { source, valid } of cases) {
    const bundle = initialBundle();
    bundle.commands[0]!.source = source;
    const result = await execute(bundle, ['greet', '--name', 'Ada']);
    assert.equal(result.exit_code === 0, valid, source);
    const diagnostics = sourceDiagnostics(source);
    assert.equal(diagnostics.length === 0, valid, source);
    for (const diagnostic of diagnostics) {
      assert.ok(diagnostic.from >= 0 && diagnostic.to <= source.length, source);
    }
  }
});
