import { decodeFrames } from './bytes.js';

export interface ReplayFrame {
  kind: 'data' | 'resize';
  payload: Uint8Array;
  cols?: number;
  rows?: number;
}

/** 解析 .tstream 字节为带类型的帧序列。 */
export function parseStream(stream: Uint8Array): ReplayFrame[] {
  const frames: ReplayFrame[] = [];
  for (const raw of decodeFrames(stream)) {
    if (raw.length >= 5 && raw[0] === 0x01) {
      const dv = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
      frames.push({ kind: 'resize', payload: raw, cols: dv.getUint16(1, false), rows: dv.getUint16(3, false) });
    } else {
      frames.push({ kind: 'data', payload: raw });
    }
  }
  return frames;
}

export interface ReplayOptions {
  /** 每帧间隔毫秒；0 表示尽快。 */
  delayMs?: number;
  onData?: (frame: Uint8Array, index: number) => Promise<void> | void;
  onResize?: (cols: number, rows: number, index: number) => Promise<void> | void;
  signal?: { cancelled: boolean };
}

export async function replay(frames: ReplayFrame[], opts: ReplayOptions = {}): Promise<void> {
  const delay = opts.delayMs ?? 120;
  for (let i = 0; i < frames.length; i++) {
    if (opts.signal?.cancelled) return;
    const f = frames[i]!;
    if (f.kind === 'resize' && f.cols && f.rows) {
      await opts.onResize?.(f.cols, f.rows, i);
    } else {
      await opts.onData?.(f.payload, i);
    }
    if (delay > 0 && i < frames.length - 1) {
      await new Promise((r) => setTimeout(r, delay));
    }
  }
}
