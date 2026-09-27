import type { CompletionContext, CompletionResult } from '@codemirror/autocomplete';
import { completionPath, localCompletionSource, snippets } from '@codemirror/lang-javascript';
import type { Diagnostic } from '@codemirror/lint';
import { parse } from 'acorn';
import type { CommandDefinition } from '../../shared/commands/model';
import { text as t } from './text';

const commandSnippets = snippets.filter(snippet => snippet.label !== 'import');

export function completeSource(context: CompletionContext, parameters: CommandDefinition['options']): CompletionResult | null {
  const bracket = context.matchBefore(/input\[(["'])[a-z0-9-]*$/);
  if (bracket) {
    const quote = bracket.text[6]!;
    return {
      from: bracket.from + 7,
      options: parameters.filter(parameter => parameter.name).map(parameter => ({
        label: parameter.name,
        type: 'property',
        detail: parameter.type,
        info: parameter.description,
        apply(view, _completion, from, to) {
          if (view.state.readOnly) {
            return;
          }
          const suffix = `${quote}]`;
          const closing = view.state.sliceDoc(to, view.state.doc.lineAt(to).to);
          const existing = closing.match(new RegExp(`^[a-z0-9-]*${quote}?\\s*\\]`));
          const end = to + (existing ? existing[0].length : closing.startsWith(quote) ? 1 : 0);
          view.dispatch({ changes: { from, to: end, insert: parameter.name + suffix }, selection: { anchor: from + parameter.name.length + 2 } });
        },
      })),
      validFor: /^[a-z0-9-]*$/,
    };
  }
  const path = completionPath(context);
  if (path?.path.length === 1 && path.path[0] === 'input') {
    return {
      from: context.matchBefore(/[a-z0-9]*$/)?.from ?? context.pos,
      options: parameters.filter(parameter => /^[a-z][a-z0-9]*$/.test(parameter.name)).map(parameter => ({
        label: parameter.name, type: 'property', detail: parameter.type, info: parameter.description,
      })),
      validFor: /^[a-z0-9]*$/,
    };
  }
  if (!path || path.path.length) {
    return null;
  }
  const local = localCompletionSource(context);
  return {
    from: context.matchBefore(/[\w$]*$/)?.from ?? context.pos,
    options: [{ label: 'input', type: 'variable', detail: t.parameters }, ...commandSnippets, ...(local?.options || [])],
    validFor: /^\w*$/,
  };
}

export function sourceDiagnostics(source: string): Diagnostic[] {
  // 与运行时函数体一致，包含 input 形参、严格模式和函数内 return。
  const prefix = '(function(input) { "use strict";\n';
  try {
    parse(prefix + source + '\n})', { ecmaVersion: 'latest' });
    return [];
  } catch (error) {
    if (!(error instanceof SyntaxError)) {
      throw error;
    }
    const position = (error as SyntaxError & { pos: number }).pos - prefix.length;
    const from = Math.max(0, Math.min(position, source.length));
    return [{ from, to: Math.min(from + 1, source.length), severity: 'error', message: `${t.syntaxError}: ${error.message.replace(/ \(\d+:\d+\)$/, '')}` }];
  }
}
