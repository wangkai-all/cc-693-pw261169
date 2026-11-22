<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from 'vue';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import type { ScreenSnapshot, TableExtraction } from '../core/types';

const props = defineProps<{
  snapshot: ScreenSnapshot | null;
  extraction: TableExtraction | null;
  highlightRow: number | null;
}>();

const host = ref<HTMLDivElement | null>(null);
let term: Terminal | null = null;
let fit: FitAddon | null = null;
let decorations: { dispose(): void }[] = [];
let lastKey = '';

function ensureTerminal(cols: number, rows: number) {
  if (term && term.cols === cols && term.rows === rows) return;
  if (term) {
    decorations.forEach((d) => d.dispose());
    decorations = [];
    term.dispose();
  }
  term = new Terminal({
    cols,
    rows,
    allowProposedApi: true,
    fontFamily: '"JetBrains Mono", "Cascadia Mono", Consolas, "Noto Sans Mono CJK SC", monospace',
    fontSize: 13,
    lineHeight: 1.15,
    theme: {
      background: '#0f1420',
      foreground: '#d7dce6',
      cursor: '#7aa2f7',
      selectionBackground: '#33415c',
    },
    scrollback: 0,
  });
  fit = new FitAddon();
  term.loadAddon(fit);
  term.open(host.value!);
}

function renderSnapshot(snap: ScreenSnapshot) {
  ensureTerminal(snap.cols, snap.rows);
  const t = term!;
  const key = `${snap.cols}x${snap.rows}:${snap.seq}:${snap.bytesReceived}`;
  if (key === lastKey) return;
  lastKey = key;
  // 用无头管道算出的格子文本整屏重绘（真实终端画面与解析视图严格同源）。
  // 不用 reset()：它是异步的，与紧随的 write 存在竞态；显式清屏+逐行定位更确定。
  let payload = '\x1b[?25l\x1b[H\x1b[2J\x1b[3J';
  for (let y = 0; y < snap.rows; y++) {
    payload += `\x1b[${y + 1};1H${snap.lines[y]!}`;
  }
  payload += `\x1b[${snap.cursorY + 1};${Math.max(1, snap.cursorX + 1)}H\x1b[?25h`;
  t.write(payload);
}

function applyHighlight() {
  decorations.forEach((d) => d.dispose());
  decorations = [];
  if (!term || props.highlightRow === null || !props.extraction) return;
  const y = props.highlightRow;
  const marker = term.registerMarker(y);
  if (!marker) return;
  const dec = term.registerDecoration({
    marker,
    x: 0,
    width: term.cols,
    height: 1,
    backgroundColor: '#1f6feb55',
    layer: 'top',
  });
  if (dec) decorations.push(dec);
}

watch(
  () => props.snapshot,
  (snap) => {
    if (snap) {
      renderSnapshot(snap);
      applyHighlight();
    }
  },
  { deep: false },
);

watch(
  () => props.highlightRow,
  () => applyHighlight(),
);

onBeforeUnmount(() => {
  decorations.forEach((d) => d.dispose());
  term?.dispose();
  term = null;
});
</script>

<template>
  <div class="terminal-wrap">
    <div ref="host" class="terminal-host"></div>
  </div>
</template>

<style scoped>
.terminal-wrap {
  background: #0f1420;
  border-radius: 8px;
  padding: 8px;
  overflow: auto;
}
.terminal-host {
  min-height: 100%;
}
:deep(.xterm) {
  padding: 4px;
}
</style>
