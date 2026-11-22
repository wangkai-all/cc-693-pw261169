import { classify, resetNoteSeq, toNote } from './classifier.js';
import { ScreenEmulator } from './emulator.js';
import { RecordStore, TableExtractor } from './extractor.js';
import { StreamSplitter } from './splitter.js';
import type {
  ByteRange,
  DeviceRecord,
  FragmentInfo,
  PipelineResult,
  StreamToken,
  TableExtraction,
  UnsupportedNote,
} from './types.js';

export interface PushResult {
  result: PipelineResult;
  /** 本批产生的 token（用于实时字节流视图）。 */
  tokens: StreamToken[];
}

/** 把 token 转成片段预览：控制序列转义可读，文本原样展示。 */
export function fragmentFromToken(t: StreamToken): FragmentInfo {
  const preview =
    t.type === 'text'
      ? t.raw
      : t.raw
          .replace(/\x1b/g, 'ESC ')
          .replace(/\x07/g, ' BEL')
          .replace(/[\x00-\x06\x08-\x1f]/g, (c) => `^${String.fromCharCode(c.charCodeAt(0) + 64)}`);
  const hex = Array.from(t.bytes)
    .map((b) => b.toString(16).padStart(2, '0').toUpperCase())
    .join(' ');
  return {
    range: { ...t.range },
    tokenType: t.type,
    preview,
    hex,
    length: t.bytes.length,
  };
}

/**
 * 完整处理管道。输入只有原始终端字节流（Uint8Array 批次），
 * 输出屏幕快照、表格抽取结果、不支持序列标注与合并记录。
 * 可在浏览器与 Node 中运行（仅依赖 @xterm/headless）。
 */
export class Pipeline {
  readonly splitter = new StreamSplitter();
  readonly emulator: ScreenEmulator;
  readonly extractor = new TableExtractor();
  readonly records = new RecordStore();
  notes: UnsupportedNote[] = [];
  private lastExtraction: TableExtraction | null = null;
  private lastTokens: StreamToken[] = [];
  /** 全量片段索引，key = chunkId:start:end，用于按格子溯源反查（含历史原地刷新）。 */
  private fragmentIndex = new Map<string, FragmentInfo>();
  /**
   * 串行化队列：终端字节流有严格顺序，即使多个 push 被并发调用
   * （例如 WebSocket 消息同步连续到达），也必须按调用顺序处理，
   * 否则 xterm 的异步 write 回调会让屏幕状态错乱。
   */
  private chain: Promise<unknown> = Promise.resolve();

  constructor(cols = 80, rows = 24) {
    this.emulator = new ScreenEmulator(cols, rows);
  }

  push(chunk: Uint8Array): Promise<PushResult> {
    const run = this.chain.then(() => this.processChunk(chunk));
    // 队列本身不因单个任务失败而中断后续处理。
    this.chain = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  private async processChunk(chunk: Uint8Array): Promise<PushResult> {
    const tokens = this.splitter.push(chunk);
    this.lastTokens = tokens;
    for (const token of tokens) {
      const c = classify(token);
      if (!c.supported) {
        this.notes.push(toNote(token, c));
      }
      this.indexFragment(token);
      // 所有字节（含不支持序列）都送入模拟器，保证画面完整还原。
      await this.emulator.apply(token);
    }
    const snapshot = this.emulator.snapshot();
    const extraction = this.extractor.extract(snapshot);
    this.lastExtraction = extraction;
    for (const row of extraction.rows) {
      this.records.upsert(row, snapshot.seq);
    }
    return {
      result: {
        snapshot,
        extraction,
        notes: this.notes,
        records: this.records.all(),
      },
      tokens,
    };
  }

  end(): Promise<PushResult> {
    const run = this.chain.then(() => this.processEnd());
    this.chain = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  private async processEnd(): Promise<PushResult> {
    const tail = this.splitter.end();
    for (const token of tail) {
      const c = classify(token);
      if (!c.supported) this.notes.push(toNote(token, c));
      this.indexFragment(token);
      await this.emulator.apply(token);
    }
    const snapshot = this.emulator.snapshot();
    const extraction = this.extractor.extract(snapshot);
    this.lastExtraction = extraction;
    return {
      result: { snapshot, extraction, notes: this.notes, records: this.records.all() },
      tokens: tail,
    };
  }

  resize(cols: number, rows: number): Promise<PipelineResult> {
    const run = this.chain.then(() => this.processResize(cols, rows));
    this.chain = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  private processResize(cols: number, rows: number): PipelineResult {
    this.emulator.resize(cols, rows);
    const snapshot = this.emulator.snapshot();
    const extraction = this.extractor.extract(snapshot);
    this.lastExtraction = extraction;
    return { snapshot, extraction, notes: this.notes, records: this.records.all() };
  }

  current(): PipelineResult {
    const snapshot = this.emulator.snapshot();
    return {
      snapshot,
      extraction: this.lastExtraction ?? this.extractor.extract(snapshot),
      notes: this.notes,
      records: this.records.all(),
    };
  }

  get recentTokens(): StreamToken[] {
    return this.lastTokens;
  }

  /** 等待所有已排队的 push/end/resize 处理完成。 */
  drain(): Promise<void> {
    return this.chain.then(() => undefined);
  }

  /** 按字节区间反查形成格子的输出片段（覆盖历史刷新，不止最近一批）。 */
  fragmentsFor(ranges: ByteRange[]): FragmentInfo[] {
    const out: FragmentInfo[] = [];
    const seen = new Set<string>();
    for (const r of ranges) {
      const key = `${r.chunkId}:${r.start}:${r.end}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const frag = this.fragmentIndex.get(key);
      if (frag) out.push(frag);
    }
    return out;
  }

  get fragmentCount(): number {
    return this.fragmentIndex.size;
  }

  private indexFragment(token: StreamToken): void {
    const key = `${token.range.chunkId}:${token.range.start}:${token.range.end}`;
    if (!this.fragmentIndex.has(key)) {
      this.fragmentIndex.set(key, fragmentFromToken(token));
    }
  }

  dispose(): void {
    this.emulator.dispose();
  }
}

export function resetClassifiers(): void {
  resetNoteSeq();
}

export type { DeviceRecord };
