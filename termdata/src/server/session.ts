import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { DemoEngine } from '../demo/engine.js';
import { parseStream, replay } from '../demo/replay.js';
import type { EngineCommand } from '../demo/engine.js';

export interface SampleMeta {
  id: string;
  title: string;
  description: string;
  initialCols: number;
  initialRows: number;
  frames: number;
  bytes: number;
  features: string[];
  createdAt: string;
}

export type ServerOutMessage =
  | { type: 'chunk'; data: string; chunkId: number } // base64 原始字节
  | { type: 'resize'; cols: number; rows: number }
  | { type: 'mode'; mode: 'live' | 'replay' | 'idle'; source?: string }
  | { type: 'done'; source: string }
  | { type: 'error'; message: string };

export type ServerInMessage =
  | { type: 'start-live'; intervalMs?: number }
  | { type: 'start-replay'; sampleId: string; delayMs?: number }
  | { type: 'stop' }
  | { type: 'command'; command: EngineCommand };

/** 单个 WebSocket 连接对应一个会话：隔离的演示引擎/重放状态。 */
export class Session {
  private engine: DemoEngine | null = null;
  private cancelFlag = { cancelled: false };
  private chunkSeq = 0;
  mode: 'live' | 'replay' | 'idle' = 'idle';

  constructor(
    private readonly send: (msg: ServerOutMessage) => void,
    private readonly samplesDir: string,
  ) {}

  async handle(msg: ServerInMessage): Promise<void> {
    switch (msg.type) {
      case 'start-live':
        await this.stopCurrent();
        this.startLive(msg.intervalMs ?? 700);
        break;
      case 'start-replay':
        await this.stopCurrent();
        await this.startReplay(msg.sampleId, msg.delayMs ?? 90);
        break;
      case 'stop':
        await this.stopCurrent();
        break;
      case 'command':
        this.engine?.command(msg.command);
        break;
    }
  }

  close(): void {
    this.cancelFlag.cancelled = true;
    this.engine?.stop();
    this.engine = null;
  }

  async listSamples(): Promise<SampleMeta[]> {
    const files = await readdir(this.samplesDir);
    const metas: SampleMeta[] = [];
    for (const f of files) {
      if (!f.endsWith('.json') || f === 'index.json') continue;
      const raw = await readFile(join(this.samplesDir, f), 'utf8');
      metas.push(JSON.parse(raw) as SampleMeta);
    }
    return metas.sort((a, b) => a.id.localeCompare(b.id));
  }

  async getSample(sampleId: string): Promise<{ meta: SampleMeta; stream: Uint8Array }> {
    const safe = sampleId.replace(/[^a-z0-9-]/gi, '');
    const meta = JSON.parse(await readFile(join(this.samplesDir, `${safe}.json`), 'utf8')) as SampleMeta;
    const stream = await readFile(join(this.samplesDir, `${safe}.tstream`));
    return { meta, stream: new Uint8Array(stream) };
  }

  private startLive(intervalMs: number): void {
    this.mode = 'live';
    const engine = new DemoEngine(intervalMs);
    this.engine = engine;
    engine.on('data', (b: Uint8Array) => this.emitChunk(b));
    engine.on('resize', (r: { cols: number; rows: number }) => {
      this.send({ type: 'resize', cols: r.cols, rows: r.rows });
    });
    engine.start();
    this.send({ type: 'mode', mode: 'live' });
  }

  private async startReplay(sampleId: string, delayMs: number): Promise<void> {
    this.mode = 'replay';
    try {
      const { meta, stream } = await this.getSample(sampleId);
      const frames = parseStream(stream);
      this.send({ type: 'mode', mode: 'replay', source: meta.id });
      this.cancelFlag = { cancelled: false };
      await replay(frames, {
        delayMs,
        signal: this.cancelFlag,
        onData: async (payload) => this.emitChunk(payload),
        onResize: async (cols, rows) => this.send({ type: 'resize', cols, rows }),
      });
      if (!this.cancelFlag.cancelled) {
        this.send({ type: 'done', source: meta.id });
      }
    } catch (err) {
      this.send({ type: 'error', message: (err as Error).message });
    } finally {
      this.mode = 'idle';
    }
  }

  private async stopCurrent(): Promise<void> {
    this.cancelFlag.cancelled = true;
    this.engine?.stop();
    this.engine = null;
    this.mode = 'idle';
    this.send({ type: 'mode', mode: 'idle' });
    // 给 in-flight 重放一个微时序退出。
    await new Promise((r) => setTimeout(r, 0));
    this.cancelFlag = { cancelled: false };
  }

  private emitChunk(bytes: Uint8Array): void {
    this.chunkSeq += 1;
    this.send({ type: 'chunk', data: Buffer.from(bytes).toString('base64'), chunkId: this.chunkSeq });
  }
}
