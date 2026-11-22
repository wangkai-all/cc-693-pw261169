import { HeadlessTerminal } from './xterm-compat.js';
import type { CellMeta, ScreenCell, ScreenSnapshot, StreamToken } from './types.js';

interface GridCell {
  key: string;
  cell: ScreenCell;
}

function styleKey(term: InstanceType<typeof HeadlessTerminal>, x: number, y: number): string {
  const line = term.buffer.active.getLine(y);
  if (!line) return '';
  const c = line.getCell(x);
  if (!c) return '';
  return [
    c.getChars(),
    c.getWidth(),
    c.getFgColorMode(),
    c.getFgColor(),
    c.getBgColorMode(),
    c.getBgColor(),
    c.isBold(),
    c.isItalic(),
    c.isDim(),
    c.isUnderline(),
    c.isInverse(),
    c.isBlink(),
    c.isStrikethrough(),
  ].join('|');
}

/**
 * 无头终端封装：
 * - 内部使用 @xterm/headless 还原屏幕（正确处理回车、退格、光标移动、清行、替代屏幕）；
 * - 维护与缓冲对齐的影子网格，逐 token diff，把「当前格子由哪个输出片段形成」记录到 CellMeta；
 * - 宽字符（CJK 占 2 列）由 xterm 的 width=2/0 格子表达，列坐标天然正确。
 */
export class ScreenEmulator {
  readonly term: InstanceType<typeof HeadlessTerminal>;
  private grid: (GridCell | null)[][] = [];
  private seq = 0;
  private bytesReceived = 0;

  constructor(cols = 80, rows = 24) {
    this.term = new HeadlessTerminal({ cols, rows, allowProposedApi: true });
    this.rebuildGrid(null);
  }

  get cols(): number {
    return this.term.cols;
  }

  get rows(): number {
    return this.term.rows;
  }

  resize(cols: number, rows: number): void {
    if (cols === this.cols && rows === this.rows) return;
    const meta: CellMeta = {
      range: { start: this.bytesReceived, end: this.bytesReceived, chunkId: -1 },
      tokenType: 'csi',
      updateSeq: this.nextSeq(),
    };
    this.term.resize(cols, rows);
    // resize 后内容可能回流，重新采样并把受影响格子标记为 resize 片段。
    this.rebuildGrid(meta);
  }

  /**
   * 应用一个 token。返回 Promise，resolve 时 xterm 已完成解析，可安全采样。
   * 所有原始字节都写入（包括不支持的序列），不做任何删除。
   */
  apply(token: StreamToken): Promise<void> {
    this.bytesReceived += token.bytes.length;
    const before = this.snapshotKeys();
    return new Promise((resolve) => {
      this.term.write(token.bytes, () => {
        this.diff(before, token);
        resolve();
      });
    });
  }

  snapshot(): ScreenSnapshot {
    const buf = this.term.buffer.active;
    const lines: string[] = [];
    const gridOut: (ScreenCell | null)[][] = [];
    for (let y = 0; y < this.term.rows; y++) {
      const line = buf.getLine(y);
      lines.push(line ? line.translateToString(false) : '');
      const row: (ScreenCell | null)[] = [];
      for (let x = 0; x < this.term.cols; x++) {
        row.push(this.grid[y]?.[x]?.cell ?? null);
      }
      gridOut.push(row);
    }
    return {
      cols: this.term.cols,
      rows: this.term.rows,
      lines,
      grid: gridOut,
      bufferType: buf.type,
      cursorX: buf.cursorX,
      cursorY: buf.cursorY,
      bytesReceived: this.bytesReceived,
      seq: this.seq,
    };
  }

  dispose(): void {
    this.term.dispose();
  }

  private nextSeq(): number {
    this.seq += 1;
    return this.seq;
  }

  private snapshotKeys(): string[][] {
    const out: string[][] = [];
    for (let y = 0; y < this.term.rows; y++) {
      const row: string[] = [];
      for (let x = 0; x < this.cols; x++) {
        row.push(styleKey(this.term, x, y));
      }
      out.push(row);
    }
    return out;
  }

  private diff(before: string[][], token: StreamToken): void {
    const updateSeq = this.nextSeq();
    for (let y = 0; y < this.term.rows; y++) {
      for (let x = 0; x < this.term.cols; x++) {
        const now = styleKey(this.term, x, y);
        if (now !== (before[y]?.[x] ?? '')) {
          const line = this.term.buffer.active.getLine(y);
          const raw = line?.getCell(x);
          const cell: ScreenCell = {
            char: raw?.getChars() ?? '',
            width: (raw?.getWidth() ?? 1) as 0 | 1 | 2,
            bgFgKey: now,
            meta: { range: { ...token.range }, tokenType: token.type, updateSeq },
          };
          this.grid[y]![x] = { key: now, cell };
        }
      }
    }
  }

  private rebuildGrid(meta: CellMeta | null): void {
    const grid: (GridCell | null)[][] = [];
    for (let y = 0; y < this.term.rows; y++) {
      const row: (GridCell | null)[] = [];
      for (let x = 0; x < this.term.cols; x++) {
        const key = styleKey(this.term, x, y);
        const line = this.term.buffer.active.getLine(y);
        const raw = line?.getCell(x);
        const cell: ScreenCell = {
          char: raw?.getChars() ?? '',
          width: (raw?.getWidth() ?? 1) as 0 | 1 | 2,
          bgFgKey: key,
          meta,
        };
        row.push(key ? { key, cell } : null);
      }
      grid.push(row);
    }
    this.grid = grid;
  }
}
