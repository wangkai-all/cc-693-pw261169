<script setup lang="ts">
import type { UnsupportedNote } from '../core/types';

defineProps<{ notes: UnsupportedNote[] }>();
</script>

<template>
  <div class="notes">
    <div v-if="notes.length === 0" class="hint ok">✓ 暂无不支持的控制序列，所有操作均在白名单内</div>
    <div v-for="n in notes" :key="n.id" class="note">
      <div class="head">
        <code class="seq">{{ n.sequence }}</code>
        <span class="range">字节 {{ n.range.start }}–{{ n.range.end }} · 第 {{ n.range.chunkId }} 次读取</span>
      </div>
      <div class="reason">原因：{{ n.reason }}</div>
      <div class="impact">影响：{{ n.impact }}</div>
      <div class="applied">原始字节未删除，仍已送入屏幕模拟器执行：{{ n.stillApplied ? '是' : '否' }}</div>
    </div>
  </div>
</template>

<style scoped>
.notes {
  font-size: 12px;
  max-height: 320px;
  overflow: auto;
}
.hint {
  padding: 16px;
  text-align: center;
}
.hint.ok {
  color: #3fb950;
}
.note {
  border: 1px solid #4a2a2a;
  border-left: 3px solid #f85149;
  border-radius: 6px;
  padding: 8px;
  margin-bottom: 6px;
  background: #1d1418;
}
.head {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 4px;
}
.seq {
  color: #ff9b95;
}
.range {
  color: #8b6b6b;
}
.reason,
.impact,
.applied {
  color: #c9b8b8;
  margin-top: 2px;
}
.impact {
  color: #e0a458;
}
</style>
