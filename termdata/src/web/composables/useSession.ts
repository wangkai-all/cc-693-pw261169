import { reactive, readonly, shallowRef } from 'vue';
import { Pipeline, fragmentFromToken } from '../../core/pipeline.js';
import type { FragmentInfo, PipelineResult } from '../../core/types.js';
import type { SampleMeta } from '../api.js';

type ServerOut =
  | { type: 'chunk'; data: string; chunkId: number }
  | { type: 'resize'; cols: number; rows: number }
  | { type: 'mode'; mode: 'live' | 'replay' | 'idle'; source?: string }
  | { type: 'done'; source: string }
  | { type: 'error'; message: string };

type ServerIn =
  | { type: 'start-live'; intervalMs?: number }
  | { type: 'start-replay'; sampleId: string; delayMs?: number }
  | { type: 'stop' }
  | { type: 'command'; command: string };

interface UiState {
  connected: boolean;
  mode: 'live' | 'replay' | 'idle';
  source: string;
  cols: number;
  rows: number;
  bytesReceived: number;
  chunkCount: number;
  fps: number;
  lastError: string;
}

/**
 * 浏览器侧会话：接收服务端转发的原始字节流，
 * 在本地用同一套 core 管道还原屏幕并抽取表格。
 */
export function useSession() {
  const pipeline = shallowRef<Pipeline>(new Pipeline(80, 24));
  const result = shallowRef<PipelineResult | null>(null);
  const recentFragments = shallowRef<FragmentInfo[]>([]);
  const state = reactive<UiState>({
    connected: false,
    mode: 'idle',
    source: '',
    cols: 80,
    rows: 24,
    bytesReceived: 0,
    chunkCount: 0,
    fps: 0,
    lastError: '',
  });

  let ws: WebSocket | null = null;
  let frameTimestamps: number[] = [];
  let samples: SampleMeta[] = [];

  function ensurePipeline(cols: number, rows: number) {
    if (pipeline.value.emulator.cols === cols && pipeline.value.emulator.rows === rows) return;
    pipeline.value.dispose();
    pipeline.value = new Pipeline(cols, rows);
    result.value = null;
    recentFragments.value = [];
  }

  function connect() {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    ws = new WebSocket(`${proto}://${location.host}/ws`);
    ws.binaryType = 'arraybuffer';
    ws.onopen = () => {
      state.connected = true;
    };
    ws.onclose = () => {
      state.connected = false;
      setTimeout(connect, 1500);
    };
    ws.onerror = () => {
      state.lastError = 'WebSocket 连接错误';
    };
    ws.onmessage = async (ev) => {
      const msg = JSON.parse(ev.data as string) as ServerOut;
      if (msg.type === 'chunk') {
        const bytes = base64ToBytes(msg.data);
        state.bytesReceived += bytes.length;
        state.chunkCount += 1;
        const push = await pipeline.value.push(bytes);
        result.value = push.result;
        recentFragments.value = push.tokens.map(fragmentFromToken);
        state.cols = push.result.snapshot.cols;
        state.rows = push.result.snapshot.rows;
        markFrame();
      } else if (msg.type === 'resize') {
        ensurePipeline(msg.cols, msg.rows);
        result.value = await pipeline.value.resize(msg.cols, msg.rows);
        state.cols = msg.cols;
        state.rows = msg.rows;
      } else if (msg.type === 'mode') {
        state.mode = msg.mode;
        state.source = msg.source ?? '';
        if (msg.mode === 'live' || msg.mode === 'replay') {
          frameTimestamps = [];
        }
      } else if (msg.type === 'done') {
        state.mode = 'idle';
      } else if (msg.type === 'error') {
        state.lastError = msg.message;
      }
    };
  }

  function markFrame() {
    const now = performance.now();
    frameTimestamps.push(now);
    frameTimestamps = frameTimestamps.filter((t) => now - t < 3000);
    state.fps = Math.round((frameTimestamps.length / 3) * 10) / 10;
  }

  function send(msg: ServerIn) {
    if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
  }

  function startLive() {
    resetLocal();
    send({ type: 'start-live', intervalMs: 700 });
  }

  function startReplay(sampleId: string, delayMs = 90) {
    resetLocal();
    send({ type: 'start-replay', sampleId, delayMs });
  }

  function stop() {
    send({ type: 'stop' });
  }

  function command(command: string) {
    send({ type: 'command', command: command as never });
  }

  function resetLocal() {
    pipeline.value.dispose();
    pipeline.value = new Pipeline(state.cols || 80, state.rows || 24);
    result.value = null;
    recentFragments.value = [];
    state.bytesReceived = 0;
    state.chunkCount = 0;
    state.lastError = '';
  }

  async function loadSamples(): Promise<SampleMeta[]> {
    const resp = await fetch('/api/samples');
    const data = (await resp.json()) as { samples: SampleMeta[] };
    samples = data.samples;
    return samples;
  }

  return {
    state: readonly(state),
    result,
    recentFragments,
    connect,
    startLive,
    startReplay,
    stop,
    command,
    loadSamples,
    pipeline,
  };
}

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
