<script setup lang="ts">
import type { FragmentInfo } from '../core/types';

defineProps<{ fragments: FragmentInfo[] }>();

const tokenLabel: Record<string, string> = {
  text: '文本',
  c0: 'C0',
  c1: 'C1',
  esc: 'ESC',
  csi: 'CSI',
  osc: 'OSC',
  dcs: 'DCS',
  apc: 'APC',
  pm: 'PM',
  sos: 'SOS',
  invalid: '非法',
};
</script>

<template>
  <div class="fragments">
    <div v-if="fragments.length === 0" class="hint">本批暂无输出片段</div>
    <div v-for="f in fragments" :key="`${f.range.start}-${f.range.end}`" class="frag" :class="f.tokenType">
      <div class="head">
        <span class="badge">{{ tokenLabel[f.tokenType] ?? f.tokenType }}</span>
        <span class="range">
          字节 {{ f.range.start }}–{{ f.range.end }} · 第 {{ f.range.chunkId }} 次读取 · {{ f.length }}B
        </span>
      </div>
      <pre class="preview">{{ f.preview || '(空)' }}</pre>
      <pre class="hex">{{ f.hex }}</pre>
    </div>
  </div>
</template>

<style scoped>
.fragments {
  font-size: 12px;
  max-height: 320px;
  overflow: auto;
}
.hint {
  color: #8b94a7;
  padding: 16px;
  text-align: center;
}
.frag {
  border: 1px solid #232a3a;
  border-radius: 6px;
  padding: 6px 8px;
  margin-bottom: 6px;
  background: #121929;
}
.frag.text {
  border-left: 3px solid #3fb950;
}
.frag.csi,
.frag.esc {
  border-left: 3px solid #58a6ff;
}
.frag.c0,
.frag.c1 {
  border-left: 3px solid #d29922;
}
.frag.osc,
.frag.dcs,
.frag.apc,
.frag.pm,
.frag.sos,
.frag.invalid {
  border-left: 3px solid #f85149;
}
.head {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 4px;
}
.badge {
  background: #24304a;
  border-radius: 4px;
  padding: 0 6px;
  color: #c9d4ea;
}
.range {
  color: #6b7488;
}
.preview {
  margin: 2px 0;
  white-space: pre-wrap;
  word-break: break-all;
  color: #d7dce6;
}
.hex {
  margin: 0;
  color: #6b7488;
  white-space: pre-wrap;
  word-break: break-all;
}
</style>
