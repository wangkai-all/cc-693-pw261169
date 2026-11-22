import { describe, expect, it } from 'vitest';
import { checkSgr, classify, describeSequence } from '../src/core/classifier.js';
import { StreamSplitter } from '../src/core/splitter.js';

function token(s: string) {
  const sp = new StreamSplitter();
  const tokens = sp.push(new TextEncoder().encode(s));
  return tokens.find((t) => t.type !== 'text' && t.type !== 'c0')!;
}

describe('classifier 白名单判定', () => {
  it('支持的光标/清行/替代屏幕序列', () => {
    expect(classify(token('\x1b[K')).supported).toBe(true);
    expect(classify(token('\x1b[2J')).supported).toBe(true);
    expect(classify(token('\x1b[5;3H')).supported).toBe(true);
    expect(classify(token('\x1b[?1049h')).supported).toBe(true);
    expect(classify(token('\x1b[?25l')).supported).toBe(true);
  });

  it('鼠标上报与自动换行私有模式不支持', () => {
    const mouse = classify(token('\x1b[?1000h'));
    expect(mouse.supported).toBe(false);
    expect(mouse.impact).toContain('鼠标');
    expect(classify(token('\x1b[?7h')).supported).toBe(false);
  });

  it('SGR 白名单与未知码', () => {
    expect(checkSgr([31, 1, 0])).toEqual([]);
    expect(checkSgr([38, 2, 10, 20, 30])).toEqual([]);
    expect(checkSgr([38, 5, 200])).toEqual([]);
    expect(checkSgr([999])).toEqual([999]);
    expect(classify(token('\x1b[999m')).supported).toBe(false);
  });

  it('RIS、小键盘、HTS 不支持', () => {
    expect(classify(token('\x1bc')).supported).toBe(false);
    expect(classify(token('\x1b=')).supported).toBe(false);
    expect(classify(token('\x1bH')).supported).toBe(false);
  });

  it('OSC 0/2 支持，OSC 52 不支持', () => {
    expect(classify(token('\x1b]2;标题\x07')).supported).toBe(true);
    expect(classify(token('\x1b]52;c;Zm9v\x07')).supported).toBe(false);
  });

  it('DCS/APC 不支持且带影响描述', () => {
    const dcs = classify(token('\x1bP1+r\x1b\\'));
    expect(dcs.supported).toBe(false);
    expect(dcs.impact.length).toBeGreaterThan(0);
  });

  it('裸 C1 与 BEL 被标注', () => {
    const c1 = classify({
      type: 'c1',
      raw: '\x9b',
      bytes: Uint8Array.from([0x9b]),
      range: { start: 0, end: 1, chunkId: 1 },
    });
    expect(c1.supported).toBe(false);
    expect(c1.impact).toContain('光标');
  });

  it('describeSequence 可读化', () => {
    expect(describeSequence(token('\x1b[?25l'))).toContain('ESC');
  });
});
