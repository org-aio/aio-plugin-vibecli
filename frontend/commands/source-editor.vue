<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { Redo2, Search, Undo2, WrapText } from 'lucide-vue-next';
import { basicSetup } from 'codemirror';
import { autocompletion, closeCompletion } from '@codemirror/autocomplete';
import { indentWithTab, redo, redoDepth, undo, undoDepth } from '@codemirror/commands';
import { javascript } from '@codemirror/lang-javascript';
import { linter, lintGutter } from '@codemirror/lint';
import { openSearchPanel, search } from '@codemirror/search';
import { Compartment, EditorState } from '@codemirror/state';
import { EditorView, keymap } from '@codemirror/view';
import type { CommandDefinition } from '../../shared/commands/model';
import { completeSource, sourceDiagnostics } from './source-support';
import { editorPhrases, text as t } from './text';

const props = defineProps<{ command: CommandDefinition; disabled: boolean }>();
const emit = defineEmits<{ 'update:source': [source: string] }>();
const container = ref<HTMLElement>();
const canUndo = ref(false);
const canRedo = ref(false);
const wrap = ref(true);
const readOnly = new Compartment();
const wrapping = new Compartment();
let view: EditorView | undefined;

function editability() {
  return [EditorState.readOnly.of(props.disabled), EditorView.editable.of(!props.disabled)];
}

function updateHistory() {
  canUndo.value = Boolean(view && undoDepth(view.state));
  canRedo.value = Boolean(view && redoDepth(view.state));
}

function createState() {
  return EditorState.create({
    doc: props.command.source,
    extensions: [
      basicSetup,
      javascript(),
      autocompletion({ override: [context => completeSource(context, props.command.options)] }),
      keymap.of([indentWithTab]),
      linter(editor => sourceDiagnostics(editor.state.doc.toString()), { delay: 250 }),
      lintGutter(),
      search({ top: true }),
      EditorState.phrases.of(editorPhrases),
      readOnly.of(editability()),
      EditorState.changeFilter.of(transaction => !transaction.startState.readOnly),
      wrapping.of(wrap.value ? EditorView.lineWrapping : []),
      EditorView.contentAttributes.of({ 'aria-label': t.source, 'aria-multiline': 'true', spellcheck: 'false', autocapitalize: 'off' }),
      EditorView.updateListener.of(update => {
        updateHistory();
        if (update.docChanged) {
          emit('update:source', update.state.doc.toString());
        }
      }),
    ],
  });
}

onMounted(() => {
  view = new EditorView({ state: createState(), parent: container.value });
  updateHistory();
});

// 保存回填相同逻辑时保留历史；外部替换逻辑时重新创建编辑状态。
watch(() => props.command.source, source => {
  if (view && view.state.doc.toString() !== source) {
    view.setState(createState());
    updateHistory();
  }
});

watch(() => props.disabled, () => {
  if (view && props.disabled) {
    closeCompletion(view);
  }
  view?.dispatch({ effects: readOnly.reconfigure(editability()) });
});

function undoSource() {
  if (view && !props.disabled) {
    undo(view);
    view.focus();
  }
}

function redoSource() {
  if (view && !props.disabled) {
    redo(view);
    view.focus();
  }
}

function findSource() {
  if (view) {
    openSearchPanel(view);
  }
}

function toggleWrap() {
  wrap.value = !wrap.value;
  view?.dispatch({ effects: wrapping.reconfigure(wrap.value ? EditorView.lineWrapping : []) });
}

onBeforeUnmount(() => view?.destroy());
</script>

<template>
  <div class="source-editor" :class="{ 'source-readonly': disabled }">
    <div class="source-toolbar" role="toolbar" :aria-label="t.source">
      <span class="metadata">{{ t.sourceLanguage }}</span>
      <div class="actions">
        <button type="button" class="icon-button small" :title="t.undo" :aria-label="t.undo" :disabled="disabled || !canUndo" @click="undoSource"><Undo2 :size="15" /></button>
        <button type="button" class="icon-button small" :title="t.redo" :aria-label="t.redo" :disabled="disabled || !canRedo" @click="redoSource"><Redo2 :size="15" /></button>
        <button type="button" class="icon-button small" :title="t.find" :aria-label="t.find" @click="findSource"><Search :size="15" /></button>
        <button type="button" class="icon-button small" :title="t.wrap" :aria-label="t.wrap" :aria-pressed="wrap" @click="toggleWrap"><WrapText :size="15" /></button>
      </div>
    </div>
    <div ref="container" class="source-code" />
  </div>
</template>
