<script setup lang="ts">
import { Plus, Trash2 } from 'lucide-vue-next';
import { defineAsyncComponent } from 'vue';
import type { CommandDefinition } from '../../shared/commands/model';
import { usage } from '../../shared/commands/documentation';
import Arguments from './arguments.vue';
import { text as t } from './text';

const props = defineProps<{ command: CommandDefinition; disabled: boolean }>();
const SourceEditor = defineAsyncComponent(() => import('./source-editor.vue'));

function setPath(value: string) {
  props.command.path = value.trim().split(/\s+/).filter(Boolean);
}

function addParameter() {
  props.command.options.push({ name: '', type: 'string', required: false, positional: false, description: '' });
}

function setDefault(index: number, value: string) {
  const option = props.command.options[index];
  if (!option) {
    return;
  }
  if (value === '') {
    delete option.default;
    return;
  }
  const converters = {
    string: () => value,
    number: () => Number(value),
    boolean: () => value === 'true',
  };
  option.default = converters[option.type]();
}

function changeType(index: number) {
  const option = props.command.options[index];
  if (option) {
    delete option.default;
    if (option.type === 'boolean') {
      option.positional = false;
    }
  }
}
</script>

<template>
  <div class="command-editor">
    <section class="definition-section">
      <div class="definition-fields">
        <label class="field"><span>{{ t.path }}</span>
          <input :value="command.path.join(' ')" class="mono" :disabled="disabled" :placeholder="t.pathPlaceholder"
            @change="setPath(($event.target as HTMLInputElement).value)">
        </label>
        <label class="field"><span>{{ t.description }}</span>
          <input v-model="command.description" :disabled="disabled" :placeholder="t.descriptionPlaceholder">
        </label>
      </div>
      <div class="usage-line"><span>{{ t.usage }}</span><code>{{ usage(command) }}</code></div>
    </section>

    <section class="editor-section">
      <header class="section-header"><h2>{{ t.parameters }} <span class="count">{{ command.options.length }}</span></h2>
        <button type="button" class="button subtle small" :disabled="disabled || command.options.length >= 32" @click="addParameter"><Plus :size="14" />{{ t.addParameter }}</button>
      </header>
      <div v-if="command.options.length" class="table-scroll">
        <table class="parameter-table">
          <thead><tr><th>{{ t.parameterName }}</th><th>{{ t.parameterType }}</th><th>{{ t.required }}</th><th>{{ t.positional }}</th><th>{{ t.parameterDescription }}</th><th>{{ t.defaultValue }}</th><th /></tr></thead>
          <tbody>
            <tr v-for="(option, index) in command.options" :key="index">
              <td><input v-model="option.name" class="mono" :aria-label="t.parameterName" :disabled="disabled"></td>
              <td><select v-model="option.type" :aria-label="t.parameterType" :disabled="disabled" @change="changeType(index)"><option value="string">{{ t.stringType }}</option><option value="number">{{ t.numberType }}</option><option value="boolean">{{ t.booleanType }}</option></select></td>
              <td class="checkbox-cell"><input v-model="option.required" type="checkbox" :aria-label="t.required" :disabled="disabled"></td>
              <td class="checkbox-cell"><input v-model="option.positional" type="checkbox" :aria-label="t.positional" :disabled="disabled || option.type === 'boolean'"></td>
              <td><input v-model="option.description" :aria-label="t.parameterDescription" :disabled="disabled"></td>
              <td><select v-if="option.type === 'boolean'" :value="option.default === undefined ? '' : String(option.default)" :aria-label="t.defaultValue" :disabled="disabled" @change="setDefault(index, ($event.target as HTMLSelectElement).value)"><option value="">{{ t.none }}</option><option value="true">true</option><option value="false">false</option></select>
                <input v-else :value="option.default" :type="option.type === 'number' ? 'number' : 'text'" :aria-label="t.defaultValue" :disabled="disabled" @input="setDefault(index, ($event.target as HTMLInputElement).value)"></td>
              <td><button type="button" class="icon-button danger small" :title="t.removeParameter" :aria-label="t.removeParameter" :disabled="disabled" @click="command.options.splice(index, 1)"><Trash2 :size="14" /></button></td>
            </tr>
          </tbody>
        </table>
      </div>
      <p v-else class="muted section-empty">{{ t.none }}</p>
    </section>

    <section class="editor-section source-section">
      <header class="section-header"><h2>{{ t.source }}</h2></header>
      <SourceEditor :command="command" :disabled="disabled" @update:source="command.source = $event" />
    </section>

    <section class="editor-section examples-section">
      <header class="section-header"><h2>{{ t.examples }} <span class="count">{{ command.examples.length }}</span></h2>
        <button type="button" class="button subtle small" :disabled="disabled || command.examples.length >= 16"
          @click="command.examples.push({ argv: [], expected_stdout: '', expected_exit_code: 0 })"><Plus :size="14" />{{ t.addExample }}</button>
      </header>
      <div class="examples-list">
        <div v-for="(example, index) in command.examples" :key="index" class="example-item">
          <header class="example-header"><h3>{{ t.exampleNumber(index) }}</h3>
            <button type="button" class="icon-button danger small" :title="t.removeExample" :aria-label="t.removeExample" :disabled="disabled" @click="command.examples.splice(index, 1)"><Trash2 :size="14" /></button>
          </header>
          <div class="example-fields">
            <div class="field"><span>{{ t.arguments }}</span><Arguments v-model="example.argv" :disabled="disabled" /></div>
            <label class="field"><span>{{ t.expectedStdout }}</span><textarea v-model="example.expected_stdout" class="mono output-input" :disabled="disabled" spellcheck="false" /></label>
            <label class="field exit-field"><span>{{ t.expectedExit }}</span><input v-model.number="example.expected_exit_code" type="number" min="0" max="255" :disabled="disabled"></label>
          </div>
        </div>
      </div>
    </section>
  </div>
</template>
