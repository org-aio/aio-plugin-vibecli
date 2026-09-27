<script setup lang="ts">
import { Plus, X } from 'lucide-vue-next';
import { text as t } from './text';

const props = defineProps<{ modelValue: string[]; disabled?: boolean }>();
const emit = defineEmits<{ 'update:modelValue': [value: string[]] }>();

function update(index: number, value: string) {
  const next = [...props.modelValue];
  next[index] = value;
  emit('update:modelValue', next);
}

function remove(index: number) {
  emit('update:modelValue', props.modelValue.filter((_, position) => position !== index));
}
</script>

<template>
  <div class="argument-list">
    <div v-for="(argument, index) in modelValue" :key="index" class="argument-item">
      <input :value="argument" :aria-label="`${t.arguments} ${index + 1}`" :placeholder="t.argumentPlaceholder"
        :disabled="disabled" @input="update(index, ($event.target as HTMLInputElement).value)">
      <button type="button" class="icon-button small" :title="t.removeArgument" :aria-label="t.removeArgument"
        :disabled="disabled" @click="remove(index)"><X :size="14" /></button>
    </div>
    <button type="button" class="button subtle small" :disabled="disabled" @click="emit('update:modelValue', [...modelValue, ''])">
      <Plus :size="14" />{{ t.addArgument }}
    </button>
  </div>
</template>
