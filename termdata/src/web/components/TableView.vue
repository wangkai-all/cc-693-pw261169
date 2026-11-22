<script setup lang="ts">
import type { TableExtraction } from '../core/types';

const props = defineProps<{
  extraction: TableExtraction | null;
  selectedRow: number | null;
}>();

const emit = defineEmits<{
  (e: 'select-row', row: number | null): void;
}>();

function select(y: number) {
  emit('select-row', props.selectedRow === y ? null : y);
}
</script>

<template>
  <div class="table-panel">
    <div v-if="!extraction" class="hint">等待字节流…</div>
    <div v-else-if="extraction.suspended" class="hint warn">
      ⏸ 已暂停表格提取：{{ extraction.modeReason }}
    </div>
    <div v-else-if="!extraction.headerConfirmed" class="hint">
      未确认表头，不抽取数据行（{{ extraction.modeReason }}）
    </div>
    <template v-else>
      <div class="meta">
        表头第 {{ (extraction.headerRow ?? 0) + 1 }} 行 · {{ extraction.columns.length }} 列 ·
        当前屏幕 {{ extraction.rows.length }} 条数据
      </div>
      <table>
        <thead>
          <tr>
            <th class="row-no">#</th>
            <th v-for="col in extraction.columns" :key="col.name">{{ col.name }}</th>
            <th>屏幕行</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="(row, i) in extraction.rows"
            :key="row.screenRow"
            :class="{ active: selectedRow === row.screenRow }"
            @click="select(row.screenRow)"
          >
            <td class="row-no">{{ i + 1 }}</td>
            <td v-for="col in extraction.columns" :key="col.name">{{ row.fields[col.name] }}</td>
            <td class="row-no">{{ row.screenRow + 1 }}</td>
          </tr>
        </tbody>
      </table>
    </template>
  </div>
</template>

<style scoped>
.table-panel {
  font-size: 13px;
}
.hint {
  padding: 24px;
  text-align: center;
  color: #8b94a7;
}
.hint.warn {
  color: #e0a458;
}
.meta {
  margin-bottom: 8px;
  color: #8b94a7;
  font-size: 12px;
}
table {
  width: 100%;
  border-collapse: collapse;
}
th,
td {
  text-align: left;
  padding: 6px 10px;
  border-bottom: 1px solid #232a3a;
  white-space: nowrap;
}
th {
  color: #9ab;
  font-weight: 600;
  background: #141b2c;
  position: sticky;
  top: 0;
}
tbody tr {
  cursor: pointer;
}
tbody tr:hover {
  background: #182136;
}
tbody tr.active {
  background: #1f3a66;
}
.row-no {
  color: #6b7488;
  text-align: right;
}
</style>
