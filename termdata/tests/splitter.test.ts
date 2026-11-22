import { describe, expect, it } from 'vitest';
import { StreamSplitter } from '../src/core/splitter.js';
import type { StreamToken } from '../src/core/types.js';

function allTokens(chunks: Uint8Array[]): StreamToken[] {
  const sp = new StreamSplitter();
  const out: StreamToken[] = [];
  for (const c of chunks) out.push(...sp.push(c));
  out.push(...sp.end());
  return out;
}

describe('StreamSplitter 控制序列识别', () => {
  it('识别 CSI 光标定位与参数', () => {
    const tokens = allTokens([new TextEncoder().encode('\x1b[5;10H')]);
    const csi = tokens.find((t) => t.type === 'csi')!;
    expect(csi.final).toBe('H');
    expect(csi.params).toEqual([5, 10]);
    expect(csi.range).toEqual({ start: 0, end: 7, chunkId: 1 });
  });

  it('识别私有前缀与 SGR 复合参数', () => {
    const tokens = allTokens([new TextEncoder().encode('\x1b[?1049h\x1b[38;2;10;20;30m')]);
    const priv = tokens.find((t) => t.type === 'csi' && t.prefix === '?')!;
    expect(priv.params).toEqual([1049]);
    expect(priv.final).toBe('h');
    const sgr = tokens.find((t) => t.type === 'csi' && t.final === 'm')!;
    expect(sgr.params).toEqual([38, 2, 10, 20, 30]);
  });

  it('识别 OSC（BEL 与 ST 两种终结）与 DCS', () => {
    const tokens = allTokens([
      new TextEncoder().encode('\x1b]2;标题\x07\x1bP1+r\x1b\\'),
    ]);
    expect(tokens.some((t) => t.type === 'osc' && t.oscCode === 2)).toBe(true);
    expect(tokens.some((t) => t.type === 'dcs')).toBe(true);
  });

  it('C0 控制字符单独成 token', () => {
    const tokens = allTokens([new TextEncoder().encode('a\rb\nc\bd')]);
    expect(tokens.filter((t) => t.type === 'c0').length).toBe(3);
    expect(tokens.filter((t) => t.type === 'text').map((t) => t.raw)).toEqual(['a', 'b', 'c', 'd']);
  });

  it('裸 C1 字节 0x9b 被识别为 c1', () => {
    const tokens = allTokens([Uint8Array.from([0x9b, 0x6d])]);
    expect(tokens[0]!.type).toBe('c1');
    expect(tokens[1]!.type).toBe('text');
  });

  it('不完整序列跨 push 缓存后再吐出', () => {
    const sp = new StreamSplitter();
    const first = sp.push(new TextEncoder().encode('\x1b[5'));
    expect(first).toEqual([]);
    const second = sp.push(new TextEncoder().encode(';10H'));
    const csi = second.find((t) => t.type === 'csi')!;
    expect(csi.params).toEqual([5, 10]);
    expect(csi.range.start).toBe(0);
    expect(csi.range.end).toBe(7);
  });

  it('end() 把挂起的不完整序列标为 invalid', () => {
    const sp = new StreamSplitter();
    sp.push(new TextEncoder().encode('\x1b[?25'));
    const tail = sp.end();
    expect(tail[0]!.type).toBe('invalid');
  });

  it('不删除任何字节：拼接后与输入完全一致', () => {
    const input = new TextEncoder().encode('设备\x1b[K数据\r\n\x1b]0;x\x07');
    const tokens = allTokens([input]);
    const rebuilt = concat(tokens.map((t) => t.bytes));
    expect(Array.from(rebuilt)).toEqual(Array.from(input));
  });
});

describe('StreamSplitter UTF-8 拆包', () => {
  it('中文被拆在两次读取仍能正确解码', () => {
    const encoder = new TextEncoder();
    const full = encoder.encode('设备温度');
    // 在「设」(E8 AE BE) 的第一字节后切开。
    const cut = 1;
    const part1 = full.subarray(0, cut);
    const part2 = full.subarray(cut);
    const sp = new StreamSplitter();
    const t1 = sp.push(part1);
    expect(t1).toEqual([]); // 半个字符不产生 token
    const t2 = sp.push(part2);
    const text = t2.filter((t) => t.type === 'text').map((t) => t.raw).join('');
    expect(text).toBe('设备温度');
  });

  it('文本 token 不跨 push，溯源到不同 chunkId', () => {
    const sp = new StreamSplitter();
    const a = sp.push(new TextEncoder().encode('abc'));
    const b = sp.push(new TextEncoder().encode('def'));
    expect(a[0]!.range.chunkId).toBe(1);
    expect(b[0]!.range.chunkId).toBe(2);
  });

  it('4 字节 emoji 跨三批读取', () => {
    const bytes = new TextEncoder().encode('😀');
    expect(bytes.length).toBe(4);
    const sp = new StreamSplitter();
    expect(sp.push(bytes.subarray(0, 1))).toEqual([]);
    expect(sp.push(bytes.subarray(1, 3))).toEqual([]);
    const out = sp.push(bytes.subarray(3));
    expect(out[0]!.type).toBe('text');
    expect(out[0]!.raw).toBe('😀');
  });

  it('非法 UTF-8 前导字节被标为 invalid 而不是吞掉', () => {
    const tokens = allTokens([Uint8Array.from([0xff, 0x41])]);
    expect(tokens[0]!.type).toBe('invalid');
    expect(tokens[1]!.type).toBe('text');
    expect(tokens[1]!.raw).toBe('A');
  });
});

function concat(arrs: Uint8Array[]): Uint8Array {
  const total = arrs.reduce((a, b) => a + b.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const a of arrs) {
    out.set(a, off);
    off += a.length;
  }
  return out;
}
