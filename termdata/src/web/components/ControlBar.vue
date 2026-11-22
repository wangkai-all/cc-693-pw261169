<script setup lang="ts">
import { onMounted, ref } from 'vue';
import type { SampleMeta } from '../api';

const props = defineProps<{
  connected: boolean;
  mode: string;
  samples: SampleMeta[];
}>();

const emit = defineEmits<{
  (e: 'start-live'): void;
  (e: 'start-replay', sampleId: string): void;
  (e: 'stop'): void;
  (e: 'command', command: string): void;
}>();

const selected = ref('');
onMounted(() => {
  selected.value = props.samples[0]?.id ?? '';
});
</script>

<template>
  <div class="control-bar">
    <div class="group">
      <button class="primary" :disabled="!connected || mode === 'live'" @click="emit('start-live')">
        ▶ 启动实时演示
      </button>
      <button class="danger" :disabled="mode === 'idle'" @click="emit('stop')">■ 停止</button>
    </div>
    <div class="group">
      <select v-model="selected" :disabled="samples.length === 0">
        <option v-for="s in samples" :key="s.id" :value="s.id">
          {{ s.id }} · {{ s.title }}
        </option>
      </select>
      <button :disabled="!connected || !selected" @click="emit('start-replay', selected)">
        ⟲ 重放样本
      </button>
    </div>
    <div class="group ops">
      <span class="group-label">操作页指令：</span>
      <button title="帮助页：暂停表格提取" @click="emit('command', 'help')">H 帮助</button>
      <button title="循环切换终端宽度" @click="emit('command', 'resize')">W 宽度</button>
      <button title="触发同区域覆盖更新" @click="emit('command', 'overlay')">O 覆盖</button>
      <button title="退出并重新进入替代屏幕" @click="emit('command', 'swap')">R 换屏</button>
      <button title="输出不支持的控制序列" @click="emit('command', 'unsupported')">X 不支持序列</button>
    </div>
  </div>
</template>

<style scoped>
.control-bar {
  display: flex;
  flex-wrap: wrap;
  gap: 16px;
  align-items: center;
  padding: 10px 14px;
  background: #131a2a;
  border-bottom: 1px solid #232a3a;
}
.group {
  display: flex;
  gap: 8px;
  align-items: center;
}
.group-label {
  color: #8b94a7;
  font-size: 12px;
}
button,
select {
  background: #1d2740;
  color: #d7dce6;
  border: 1px solid #2c3a5c;
  border-radius: 6px;
  padding: 6px 12px;
  font-size: 13px;
  cursor: pointer;
}
button:hover:not(:disabled) {
  background: #26335a;
}
button:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}
button.primary {
  background: #1f6feb;
  border-color: #1f6feb;
}
button.danger {
  background: #6e2d3a;
  border-color: #8a3a4a;
}
.ops button {
  font-size: 12px;
  padding: 5px 9px;
}
select {
  max-width: 260px;
}
</style>
