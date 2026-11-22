<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import ControlBar from './components/ControlBar.vue';
import FragmentsPanel from './components/FragmentsPanel.vue';
import NotesPanel from './components/NotesPanel.vue';
import RecordsPanel from './components/RecordsPanel.vue';
import TableView from './components/TableView.vue';
import TerminalView from './components/TerminalView.vue';
import { processSample, downloadJson, downloadText } from './api.js';
import { useSession } from './composables/useSession';
import type { SampleMeta } from './api';

const {
  state,
  result,
  recentFragments,
  connect,
  startLive,
  startReplay,
  stop,
  command,
  loadSamples,
} = useSession();

const samples = ref<SampleMeta[]>([]);
const selectedRow = ref<number | null>(null);
const rightTab = ref<'table' | 'records'>('table');
const bottomTab = ref<'fragments' | 'notes' | 'screen'>('fragments');

const snapshot = computed(() => result.value?.snapshot ?? null);
const extraction = computed(() => result.value?.extraction ?? null);
const notes = computed(() => result.value?.notes ?? []);
const records = computed(() => result.value?.records ?? []);

const selectedFragments = computed(() => {
  if (selectedRow.value === null || !extraction.value) return recentFragments.value;
  const row = extraction.value.rows.find((r) => r.screenRow === selectedRow.value);
  if (!row) return recentFragments.value;
  // 通过全量片段索引反查形成该行格子的输出片段，历史原地刷新也能溯源。
  const matched = pipeline.value.fragmentsFor(row.fragments);
  return matched.length ? matched : recentFragments.value;
});

const selectedCells = computed(() => {
  if (selectedRow.value === null || !extraction.value) return [];
  const row = extraction.value.rows.find((r) => r.screenRow === selectedRow.value);
  if (!row) return [];
  return Object.entries(row.fieldCells).map(([field, cell]) => ({ field, ...cell }));
});

onMounted(async () => {
  connect();
  samples.value = await loadSamples();
});

function onSelectRow(y: number | null) {
  selectedRow.value = y;
  if (y !== null) bottomTab.value = 'fragments';
}

async function exportServerResult(sampleId: string) {
  if (!sampleId) return;
  const data = await processSample(sampleId);
  downloadJson(`termdata-result-${sampleId}-${Date.now()}.json`, data);
}

function exportCurrentSnapshot() {
  if (!result.value) return;
  downloadText(`termdata-screen-${Date.now()}.txt`, result.value.snapshot.lines.join('\n'));
}
</script>

<template>
  <div class="app">
    <header class="app-header">
      <div class="brand">
        <span class="logo">▚</span>
        <div>
          <h1>TermData 终端数据接入</h1>
          <p>字节流 → 屏幕还原 → 表格抽取（无结构化接口）</p>
        </div>
      </div>
      <div class="stats">
        <span><b>{{ state.cols }}×{{ state.rows }}</b> 格子</span>
        <span><b>{{ state.bytesReceived.toLocaleString() }}</b> 字节</span>
        <span><b>{{ state.chunkCount }}</b> 次读取</span>
        <span><b>{{ state.fps }}</b> 帧/3s</span>
        <span class="mode" :class="state.mode">{{ state.mode }}</span>
        <span v-if="state.source" class="source">{{ state.source }}</span>
      </div>
    </header>

    <ControlBar
      :connected="state.connected"
      :mode="state.mode"
      :samples="samples"
      @start-live="startLive"
      @start-replay="startReplay"
      @stop="stop"
      @command="command"
    />

    <main class="layout">
      <section class="pane terminal-pane">
        <div class="pane-head">
          <h2>真实终端画面</h2>
          <button class="ghost" @click="exportCurrentSnapshot" :disabled="!result">下载屏幕文本</button>
        </div>
        <TerminalView
          :snapshot="snapshot"
          :extraction="extraction"
          :highlight-row="selectedRow"
        />
        <div v-if="selectedCells.length" class="cell-info">
          选中行格子定位：
          <code v-for="c in selectedCells" :key="c.field">
            {{ c.field }} → (行{{ c.y + 1 }}, 列{{ c.x + 1 }}–{{ c.x + c.width }})
          </code>
        </div>
      </section>

      <section class="pane data-pane">
        <div class="pane-head tabs">
          <div class="tab-group">
            <button :class="{ on: rightTab === 'table' }" @click="rightTab = 'table'">当前屏幕数据</button>
            <button :class="{ on: rightTab === 'records' }" @click="rightTab = 'records'">
              合并记录 <span class="pill">{{ records.length }}</span>
            </button>
          </div>
          <button
            v-if="state.source"
            class="ghost"
            @click="exportServerResult(state.source)"
          >
            服务端解析结果下载
          </button>
        </div>
        <TableView
          v-if="rightTab === 'table'"
          :extraction="extraction"
          :selected-row="selectedRow"
          @select-row="onSelectRow"
        />
        <RecordsPanel
          v-else
          :records="records"
          :extraction="extraction"
          :source="state.source"
        />
      </section>
    </main>

    <section class="pane bottom-pane">
      <div class="pane-head tabs">
        <div class="tab-group">
          <button :class="{ on: bottomTab === 'fragments' }" @click="bottomTab = 'fragments'">
            输出片段溯源
          </button>
          <button :class="{ on: bottomTab === 'notes' }" @click="bottomTab = 'notes'">
            不支持序列 <span class="pill danger">{{ notes.length }}</span>
          </button>
          <button :class="{ on: bottomTab === 'screen' }" @click="bottomTab = 'screen'">屏幕文本</button>
        </div>
      </div>
      <FragmentsPanel v-if="bottomTab === 'fragments'" :fragments="selectedFragments" />
      <NotesPanel v-else-if="bottomTab === 'notes'" :notes="notes" />
      <pre v-else class="screen-text">{{ snapshot?.lines.join('\n') }}</pre>
    </section>
  </div>
</template>

<style scoped>
.app {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
}
.app-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 18px;
  background: #0d1320;
  border-bottom: 1px solid #232a3a;
  flex-wrap: wrap;
  gap: 10px;
}
.brand {
  display: flex;
  gap: 12px;
  align-items: center;
}
.logo {
  font-size: 28px;
  color: #58a6ff;
}
h1 {
  font-size: 17px;
  margin: 0;
}
.app-header p {
  margin: 2px 0 0;
  color: #8b94a7;
  font-size: 12px;
}
.stats {
  display: flex;
  gap: 16px;
  font-size: 12px;
  color: #8b94a7;
  align-items: center;
}
.stats b {
  color: #d7dce6;
}
.mode {
  padding: 2px 8px;
  border-radius: 10px;
  background: #333;
  text-transform: uppercase;
}
.mode.live {
  background: #1a4d2e;
  color: #7ee2a8;
}
.mode.replay {
  background: #1c3a6e;
  color: #9ec5ff;
}
.mode.idle {
  background: #3a3f4b;
}
.source {
  color: #d29922;
}
.layout {
  flex: 1;
  display: grid;
  grid-template-columns: minmax(420px, 1fr) minmax(380px, 1fr);
  gap: 12px;
  padding: 12px;
  min-height: 380px;
}
.pane {
  background: #111827;
  border: 1px solid #232a3a;
  border-radius: 10px;
  padding: 10px 12px;
  overflow: auto;
}
.pane-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 8px;
}
.pane-head h2 {
  font-size: 14px;
  margin: 0;
}
.tabs {
  gap: 8px;
}
.tab-group {
  display: flex;
  gap: 6px;
}
.tab-group button {
  background: transparent;
  border: 1px solid #2c3a5c;
  color: #9ab;
  border-radius: 6px;
  padding: 4px 12px;
  cursor: pointer;
  font-size: 12px;
}
.tab-group button.on {
  background: #1f6feb;
  color: #fff;
  border-color: #1f6feb;
}
.pill {
  background: #2c3a5c;
  border-radius: 8px;
  padding: 0 6px;
  margin-left: 4px;
}
.pill.danger {
  background: #7a2d3a;
}
.ghost {
  background: transparent;
  border: 1px solid #2c3a5c;
  color: #9ab;
  border-radius: 6px;
  padding: 4px 10px;
  cursor: pointer;
  font-size: 12px;
}
.ghost:disabled {
  opacity: 0.4;
}
.bottom-pane {
  margin: 0 12px 12px;
  min-height: 200px;
}
.cell-info {
  margin-top: 8px;
  font-size: 12px;
  color: #8b94a7;
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.cell-info code {
  background: #182136;
  padding: 2px 6px;
  border-radius: 4px;
  color: #c9d4ea;
}
.screen-text {
  font-family: monospace;
  font-size: 12px;
  color: #9ab;
  margin: 0;
  white-space: pre;
}
@media (max-width: 1100px) {
  .layout {
    grid-template-columns: 1fr;
  }
}
</style>
