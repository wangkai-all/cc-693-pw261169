import type { ByteRange, StreamToken, TokenType } from './types.js';

const ESC = 0x1b;
const CSI = 0x5b; // [
const OSC = 0x5d; // ]
const DCS = 0x50; // P
const SOS = 0x58; // X
const PM = 0x5e; // ^
const APC = 0x5f; // _
const BEL = 0x07;
const ST_BYTE = 0x5c; // \ ，ESC \ 为 ST

const PREFIX_BYTES = new Set([0x3c, 0x3d, 0x3e, 0x3f]); // < = > ?
const PARAM_BYTES = new Set([0x30, 0x31, 0x32, 0x33, 0x34, 0x35, 0x36, 0x37, 0x38, 0x39, 0x3a, 0x3b]);

type State = 'ground' | 'esc' | 'csi' | 'string' | 'string-esc';

interface PendingText {
  bytes: number[];
  start: number;
  chunkId: number;
}

/**
 * 字节流分词器。
 *
 * 关键保证：
 * 1. 按字节状态机识别 C0/C1、ESC、CSI、OSC/DCS/APC/PM/SOS，不依赖完整读取；
 * 2. 跨 push 的不完整 UTF-8 与不完整转义序列会被缓存，下一批字节到达后再吐出；
 * 3. 文本 token 绝不跨 push（批次边界强制冲刷），保证溯源到「第几次读取」；
 * 4. 不删除任何字节：所有输入要么成为 text，要么成为带原始字节的序列 token。
 */
export class StreamSplitter {
  private state: State = 'ground';
  private seqBytes: number[] = [];
  private seqStart = 0;
  private seqChunkId = 0;
  private stringKind: TokenType = 'osc';
  private csiPrefix: string | undefined;
  private csiIntermediates: string | undefined;
  private pendingText: PendingText | null = null;
  /** 缓存跨 push 的不完整 UTF-8 尾字节。 */
  private utf8Tail: number[] = [];
  private utf8TailStart = 0;
  private utf8TailChunkId = 0;
  private globalOffset = 0;
  private chunkId = 0;
  private readonly decoder = new TextDecoder('utf-8', { fatal: true });

  push(chunk: Uint8Array): StreamToken[] {
    this.chunkId += 1;
    const tokens: StreamToken[] = [];

    // 上一批残留的 UTF-8 尾字节与新批次拼接；继承部分仍归上一批 chunkId。
    let input: Uint8Array;
    let inheritedLen = 0;
    if (this.utf8Tail.length > 0) {
      const merged = new Uint8Array(this.utf8Tail.length + chunk.length);
      merged.set(Uint8Array.from(this.utf8Tail), 0);
      merged.set(chunk, this.utf8Tail.length);
      input = merged;
      inheritedLen = this.utf8Tail.length;
      this.utf8Tail = [];
    } else {
      input = chunk;
    }

    const chunkIdAt = (indexInInput: number) =>
      indexInInput < inheritedLen ? this.chunkId - 1 : this.chunkId;
    const flushText = (endOffset: number) => {
      if (this.pendingText && this.pendingText.bytes.length > 0) {
        tokens.push(this.makeTextToken(this.pendingText, endOffset));
        this.pendingText = null;
      }
    };
    const appendText = (b: number, at: number, cid: number) => {
      if (!this.pendingText) this.pendingText = { bytes: [], start: at, chunkId: cid };
      this.pendingText.bytes.push(b);
    };

    let i = 0;
    while (i < input.length) {
      const b = input[i]!;
      const offset = this.globalOffset;
      const cid = chunkIdAt(i);

      switch (this.state) {
        case 'ground': {
          if (b === ESC) {
            flushText(offset);
            this.enter('esc', [b], offset, cid);
            this.globalOffset += 1;
            i += 1;
            break;
          }
          if (b < 0x20 || b === 0x7f) {
            flushText(offset);
            tokens.push(this.simpleToken('c0', [b], offset, cid));
            this.globalOffset += 1;
            i += 1;
            break;
          }
          if (b >= 0x80 && b <= 0x9f) {
            flushText(offset);
            tokens.push(this.simpleToken('c1', [b], offset, cid));
            this.globalOffset += 1;
            i += 1;
            break;
          }
          const seqLen = utf8SequenceLength(b);
          if (seqLen === 0) {
            // 非法 UTF-8 前导字节：单独标注，不污染相邻文本的解码。
            flushText(offset);
            tokens.push(this.simpleToken('invalid', [b], offset, cid));
            this.globalOffset += 1;
            i += 1;
            break;
          }
          if (i + seqLen > input.length) {
            // 码点被切断：先冲刷已有文本（区间止于本码点之前），再缓存残字节。
            flushText(offset);
            const remain = Array.from(input.subarray(i));
            this.utf8Tail = remain;
            this.utf8TailStart = offset;
            this.utf8TailChunkId = cid;
            this.globalOffset += remain.length;
            i = input.length;
            break;
          }
          for (let k = 0; k < seqLen; k++) appendText(input[i + k]!, offset, cid);
          this.globalOffset += seqLen;
          i += seqLen;
          break;
        }

        case 'esc': {
          this.seqBytes.push(b);
          this.globalOffset += 1;
          i += 1;
          if (b === CSI) {
            this.state = 'csi';
            this.csiPrefix = undefined;
            this.csiIntermediates = undefined;
          } else if (b === OSC || b === DCS || b === SOS || b === PM || b === APC) {
            this.state = 'string';
            this.stringKind =
              b === OSC ? 'osc' : b === DCS ? 'dcs' : b === SOS ? 'sos' : b === PM ? 'pm' : 'apc';
          } else if (b >= 0x30 && b <= 0x7e) {
            tokens.push(this.buildEscToken());
            this.resetToGround();
          } else if (b >= 0x20 && b <= 0x2f) {
            // 中间字节，继续等待
          } else {
            // ESC 后出现非法字节：终结为 invalid 并在 ground 重放当前字节。
            tokens.push(this.buildInvalidToken());
            this.resetToGround();
            this.globalOffset -= 1;
            i -= 1;
          }
          break;
        }

        case 'csi': {
          this.seqBytes.push(b);
          this.globalOffset += 1;
          i += 1;
          if (this.seqBytes.length === 3 && PREFIX_BYTES.has(b)) {
            this.csiPrefix = String.fromCharCode(b);
          } else if (PARAM_BYTES.has(b)) {
            // 参数字节
          } else if (b >= 0x20 && b <= 0x2f) {
            this.csiIntermediates = (this.csiIntermediates ?? '') + String.fromCharCode(b);
          } else if (b >= 0x40 && b <= 0x7e) {
            tokens.push(this.buildCsiToken());
            this.resetToGround();
          } else {
            tokens.push(this.buildInvalidToken());
            this.resetToGround();
            this.globalOffset -= 1;
            i -= 1;
          }
          break;
        }

        case 'string': {
          if (b === ESC) {
            this.seqBytes.push(b);
            this.globalOffset += 1;
            i += 1;
            this.state = 'string-esc';
          } else if (b === BEL && this.stringKind === 'osc') {
            this.seqBytes.push(b);
            this.globalOffset += 1;
            i += 1;
            tokens.push(this.buildStringToken(true));
            this.resetToGround();
          } else {
            this.seqBytes.push(b);
            this.globalOffset += 1;
            i += 1;
          }
          break;
        }

        case 'string-esc': {
          this.seqBytes.push(b);
          this.globalOffset += 1;
          i += 1;
          if (b === ST_BYTE) {
            tokens.push(this.buildStringToken(false));
            this.resetToGround();
          } else {
            // 畸形 ST：退回 string 继续吞，该 ESC 已计入 seqBytes。
            this.state = 'string';
          }
          break;
        }
      }
    }

    // 批次结束冲刷文本，保证文本 token 不跨 push。
    flushText(this.globalOffset);
    return tokens;
  }

  /** 流结束：挂起的不完整序列/残字节作为 invalid 吐出。 */
  end(): StreamToken[] {
    const tokens: StreamToken[] = [];
    if (this.pendingText && this.pendingText.bytes.length > 0) {
      tokens.push(this.makeTextToken(this.pendingText, this.globalOffset));
      this.pendingText = null;
    }
    if (this.state !== 'ground' && this.seqBytes.length > 0) {
      const range: ByteRange = { start: this.seqStart, end: this.globalOffset, chunkId: this.seqChunkId };
      tokens.push({ type: 'invalid', raw: bytesToString(this.seqBytes), bytes: Uint8Array.from(this.seqBytes), range });
      this.resetToGround();
    }
    if (this.utf8Tail.length > 0) {
      const range: ByteRange = { start: this.utf8TailStart, end: this.globalOffset, chunkId: this.utf8TailChunkId };
      tokens.push({ type: 'invalid', raw: bytesToString(this.utf8Tail), bytes: Uint8Array.from(this.utf8Tail), range });
      this.utf8Tail = [];
    }
    return tokens;
  }

  get offset(): number {
    return this.globalOffset;
  }

  private enter(state: State, bs: number[], start: number, cid: number) {
    this.state = state;
    this.seqBytes = bs;
    this.seqStart = start;
    this.seqChunkId = cid;
  }

  private resetToGround() {
    this.state = 'ground';
    this.seqBytes = [];
    this.csiPrefix = undefined;
    this.csiIntermediates = undefined;
  }

  private makeTextToken(p: PendingText, end: number): StreamToken {
    const bytes = Uint8Array.from(p.bytes);
    return {
      type: 'text',
      raw: this.decoder.decode(bytes),
      bytes,
      range: { start: p.start, end, chunkId: p.chunkId },
    };
  }

  private simpleToken(type: TokenType, bs: number[], start: number, cid: number): StreamToken {
    return {
      type,
      raw: bytesToString(bs),
      bytes: Uint8Array.from(bs),
      range: { start, end: start + bs.length, chunkId: cid },
    };
  }

  private buildEscToken(): StreamToken {
    return {
      type: 'esc',
      raw: bytesToString(this.seqBytes),
      bytes: Uint8Array.from(this.seqBytes),
      range: { start: this.seqStart, end: this.globalOffset, chunkId: this.seqChunkId },
      intermediates: this.seqBytes.length > 2 ? String.fromCharCode(this.seqBytes[1]!) : undefined,
      final: String.fromCharCode(this.seqBytes[this.seqBytes.length - 1]!),
    };
  }

  private buildCsiToken(): StreamToken {
    const contentStart = this.csiPrefix ? 3 : 2;
    const paramBytes = this.seqBytes.slice(contentStart, -1);
    return {
      type: 'csi',
      raw: bytesToString(this.seqBytes),
      bytes: Uint8Array.from(this.seqBytes),
      range: { start: this.seqStart, end: this.globalOffset, chunkId: this.seqChunkId },
      params: parseCsiParams(paramBytes),
      prefix: this.csiPrefix,
      intermediates: this.csiIntermediates,
      final: String.fromCharCode(this.seqBytes[this.seqBytes.length - 1]!),
    };
  }

  private buildStringToken(belTerminated: boolean): StreamToken {
    const bodyEnd = belTerminated ? this.seqBytes.length - 1 : this.seqBytes.length - 2;
    const body = this.seqBytes.slice(2, Math.max(2, bodyEnd));
    return {
      type: this.stringKind,
      raw: bytesToString(this.seqBytes),
      bytes: Uint8Array.from(this.seqBytes),
      range: { start: this.seqStart, end: this.globalOffset, chunkId: this.seqChunkId },
      oscCode: this.stringKind === 'osc' ? parseOscCode(body) : undefined,
    };
  }

  private buildInvalidToken(): StreamToken {
    return {
      type: 'invalid',
      raw: bytesToString(this.seqBytes),
      bytes: Uint8Array.from(this.seqBytes),
      range: { start: this.seqStart, end: this.globalOffset, chunkId: this.seqChunkId },
    };
  }
}

function utf8SequenceLength(lead: number): number {
  if (lead < 0x80) return 1;
  if ((lead & 0xe0) === 0xc0) return 2;
  if ((lead & 0xf0) === 0xe0) return 3;
  if ((lead & 0xf8) === 0xf0) return 4;
  return 0;
}

function parseCsiParams(bs: number[]): (number | number[])[] {
  const out: (number | number[])[] = [];
  let current = 0;
  let hasDigit = false;
  let sub: number[] | null = null;
  const pushCurrent = () => {
    if (sub) {
      if (hasDigit) sub.push(current);
      out.push(sub);
      sub = null;
    } else {
      out.push(hasDigit ? current : 0);
    }
    current = 0;
    hasDigit = false;
  };
  for (const b of bs) {
    if (b >= 0x30 && b <= 0x39) {
      current = current * 10 + (b - 0x30);
      hasDigit = true;
    } else if (b === 0x3a) {
      if (!sub) sub = [];
      if (hasDigit) {
        sub.push(current);
        current = 0;
        hasDigit = false;
      }
    } else if (b === 0x3b) {
      pushCurrent();
    }
  }
  pushCurrent();
  return out;
}

function parseOscCode(body: number[]): number | undefined {
  let n = 0;
  let any = false;
  for (const b of body) {
    if (b >= 0x30 && b <= 0x39) {
      n = n * 10 + (b - 0x30);
      any = true;
    } else {
      break;
    }
  }
  return any ? n : undefined;
}

function bytesToString(bs: number[]): string {
  // 控制序列按 latin1 还原，保证单字节一一对应（含 ESC 等）。
  let s = '';
  for (const b of bs) s += String.fromCharCode(b);
  return s;
}
