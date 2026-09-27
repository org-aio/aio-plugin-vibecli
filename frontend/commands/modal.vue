<script setup lang="ts">
import { nextTick, ref, useId, watch } from 'vue';
import { X } from 'lucide-vue-next';
import { text as t } from './text';

const props = defineProps<{ open: boolean; title: string; wide?: boolean }>();
const emit = defineEmits<{ close: [] }>();
const dialog = ref<HTMLDialogElement>();
const titleId = useId();

watch(() => props.open, async (open) => {
  await nextTick();
  if (open && !dialog.value?.open) {
    dialog.value?.showModal();
  } else if (!open && dialog.value?.open) {
    dialog.value.close();
  }
}, { immediate: true });
</script>

<template>
  <dialog ref="dialog" :class="['modal', { wide }]" :aria-labelledby="titleId"
    @cancel.prevent="emit('close')" @click="event => { if (event.target === dialog) emit('close'); }">
    <header class="modal-header">
      <h2 :id="titleId">{{ title }}</h2>
      <button type="button" class="icon-button" :title="t.close" :aria-label="t.close" @click="emit('close')"><X :size="18" /></button>
    </header>
    <div class="modal-body"><slot /></div>
    <footer v-if="$slots.footer" class="modal-footer"><slot name="footer" /></footer>
  </dialog>
</template>
