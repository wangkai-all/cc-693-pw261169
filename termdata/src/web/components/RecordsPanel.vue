<script setup lang="ts">
import { computed, ref } from 'vue';
import type { DeviceRecord, TableExtraction } from '../core/types';
import { downloadJson } from '../api';

const props = defineProps<{
  records: DeviceRecord[];
  extraction: TableExtraction | null;
  source: string;
}>();

const tab = ref<'records' | 'screen'>();

const columns = computed(() => props.extraction?.columns.map((c) => c.name) ?? []);

function exportRecords() {
  downloadJson(`termdata-records-${props.source || 'snapshot'}-${Date.now()}.json`, {
    exportedAt: new Date().toISOString(),
    source: props.source || 'live',
    count: props.records.length,
    records: props.records,
  });
}

function exportCsv() {
  const cols = columns.value.length ? columns.value : Object.keys(props.records[0]?.latest ?? {});
  const lines = [cols.join(',')];
  for (const r of props.records) {
    lines.push(cols.map((c) => csvCell(r.latest[c] ?? '')).join(','));
  }
  const blob = new Blob(['﻿' + lines.join('\n')], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `termdata-records-${Date.now()}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
}

function csvCell(v: string): string {
  return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}
</script>

<template>
  <div class="records-panel">
    <div class="toolbar">
      <span class="title">合并记录（按设备ID 去重，共 {{ records.length }} 台）</span>
      <div class="spacer"></div>
      <button @click="exportRecords" :disabled="records.length === 0">下载 JSON</button>
      <button @click="exportCsv" :disabled="records.length === 0">下载 CSV</button>
    </div>
    <table v-if="records.length">
      <thead>
        <tr>
          <th v-for="c in columns" :key="c">{{ c }}</th>
          <th>更新次数</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="r in records" :key="r.id">
          <td v-for="c in columns" :key="c">{{ r.latest[c] }}</td>
          <td class="num">{{ r.updates }}</td>
        </tr>
      </tbody>
    </table>
    <div v-else class="hint">尚无确认表头的数据行</div>
  </div>
</template>

<style scoped>
.records-panel {
  font-size: 12px;
}
.toolbar {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
}
.title {
  color: #9ab;
}
.spacer {
  flex: 1;
}
button {
  background: #1d2740;
  color: #d7dce6;
  border: 1px solid #2c3a5c;
  border-radius: 6px;
  padding: 4px 10px;
  cursor: pointer;
  font-size: 12px;
}
button:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}
table {
  width: 100%;
  border-collapse: collapse;
}
th,
td {
  padding: 5px 8px;
  border-bottom: 1px solid #232a3a;
  text-align: left;
  white-space: nowrap;
}
th {
  background: #141b2c;
  color: #9ab;
}
.num {
  text-align: right;
  color: #6b7488;
}
.hint {
  color: #8b94a7;
  padding: 18px;
  text-align: center;
}
</style>
