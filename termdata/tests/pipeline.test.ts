import { describe, expect, it } from 'vitest';
import { Pipeline } from '../src/core/pipeline.js';

const enc = new TextEncoder();

async function feed(p: Pipeline, parts: (string | Uint8Array)[]): Promise<void> {
  for (const part of parts) {
    await p.push(typeof part === 'string' ? enc.encode(part) : part);
  }
}

// 与演示程序一致的定宽列（格子列），表头短、字段占满列宽。
const COLS80 = [
  { name: '设备ID', width: 10 },
  { name: '名称', width: 14 },
  { name: '状态', width: 8 },
  { name: '温度', width: 10 },
];
const COLS60 = [
  { name: '设备ID', width: 10 },
  { name: '名称', width: 16 },
  { name: '状态', width: 8 },
  { name: '温度', width: 10 },
];

/** 简易格子宽度（仅用于测试夹具，字符集与演示一致）。 */
function cellW(s: string): number {
  let w = 0;
  for (const ch of s) {
    const cp = ch.codePointAt(0)!;
    w += cp >= 0x2e80 && cp <= 0x9fff ? 2 : 1;
  }
  return w;
}
function pad(s: string, width: number): string {
  return s + ' '.repeat(Math.max(0, width - cellW(s)));
}
function headerLine(cols: { name: string; width: number }[]): string {
  return cols.map((c) => pad(c.name, c.width)).join('');
}
function dataLine(values: string[], cols: { width: number }[]): string {
  return values.map((v, i) => pad(v, cols[i]!.width)).join('');
}

function tableScreen(rows: string[][], width = 80, cols = COLS80): string {
  const lines = [headerLine(cols), '-'.repeat(40), ...rows.map((r) => dataLine(r, cols))];
  let s = '\x1b[?1049h\x1b[2J\x1b[H';
  lines.forEach((line, i) => {
    s += `\x1b[${i + 1};1H${line.padEnd(width)}`;
  });
  return s;
}

const SAMPLE_ROWS = [
  ['DEV-001', '一号空压机', '运行', '42.1'],
  ['DEV-002', '循环水泵', '待机', '38.7'],
];

describe('屏幕模拟器', () => {
  it('退格与回车是改写而不是新增行', async () => {
    const p = new Pipeline(40, 8);
    await feed(p, ['abcdef\rxyz']);
    const snap = p.current().snapshot;
    expect(snap.lines[0]!.trim()).toBe('xyzdef');
    p.dispose();
  });

  it('清行后旧内容消失', async () => {
    const p = new Pipeline(40, 8);
    await feed(p, ['旧数据旧数据\r\x1b[K新数据']);
    expect(p.current().snapshot.lines[0]!.trim()).toBe('新数据');
    p.dispose();
  });

  it('中文宽字符占两个格子，列定位正确', async () => {
    const p = new Pipeline(40, 8);
    await feed(p, ['温度']);
    const snap = p.current().snapshot;
    // 「温」占 0,1；「度」占 2,3（尾格 width=0）。
    expect(snap.grid[0]![0]!.char).toBe('温');
    expect(snap.grid[0]![0]!.width).toBe(2);
    expect(snap.grid[0]![1]!.width).toBe(0);
    expect(snap.grid[0]![2]!.char).toBe('度');
    expect(snap.lines[0]!.indexOf('温度')).toBe(0);
    p.dispose();
  });

  it('格子溯源指向产生它的输出片段', async () => {
    const p = new Pipeline(40, 8);
    await feed(p, ['abc']);
    await feed(p, ['\r\x1b[2CX']);
    const cell = p.current().snapshot.grid[0]![2]!;
    expect(cell.char).toBe('X');
    expect(cell.meta!.range.chunkId).toBe(2);
    expect(cell.meta!.tokenType).toBe('text');
    p.dispose();
  });

  it('替代屏幕切换会反映在 bufferType', async () => {
    const p = new Pipeline(40, 8);
    expect(p.current().snapshot.bufferType).toBe('normal');
    await feed(p, ['\x1b[?1049h']);
    expect(p.current().snapshot.bufferType).toBe('alternate');
    await feed(p, ['\x1b[?1049l']);
    expect(p.current().snapshot.bufferType).toBe('normal');
    p.dispose();
  });

  it('resize 后网格按新尺寸采样', async () => {
    const p = new Pipeline(40, 8);
    await feed(p, ['1234567890']);
    await p.resize(20, 6);
    const snap = p.current().snapshot;
    expect(snap.cols).toBe(20);
    expect(snap.rows).toBe(6);
    expect(snap.grid.length).toBe(6);
    p.dispose();
  });
});

describe('表格提取', () => {
  it('从屏幕格子抽取表头与数据行', async () => {
    const p = new Pipeline(80, 20);
    await feed(p, [tableScreen(SAMPLE_ROWS)]);
    const ex = p.current().extraction;
    expect(ex.headerConfirmed).toBe(true);
    expect(ex.columns.map((c) => c.name)).toContain('设备ID');
    expect(ex.rows).toHaveLength(2);
    expect(ex.rows[0]!.fields['设备ID']).toBe('DEV-001');
    expect(ex.rows[0]!.fields['名称']).toBe('一号空压机');
    expect(ex.rows[0]!.fieldCells['设备ID']).toMatchObject({ y: 2 });
    p.dispose();
  });

  it('同区域刷新不增加记录，只更新同一设备', async () => {
    const p = new Pipeline(80, 20);
    await feed(p, [tableScreen([['DEV-001', '一号空压机', '运行', '42.1']])]);
    const refreshed = dataLine(['DEV-001', '一号空压机', '运行', '43.9'], COLS80).padEnd(80);
    await feed(p, [`\x1b[3;1H${refreshed}\x1b[K`]);
    const recs = p.current().records;
    expect(recs).toHaveLength(1);
    expect(recs[0]!.latest['温度']).toBe('43.9');
    expect(recs[0]!.updates).toBe(2);
    p.dispose();
  });

  it('帮助页暂停提取，返回后需重新确认表头', async () => {
    const p = new Pipeline(80, 20);
    await feed(p, [tableScreen([['DEV-001', '一号空压机', '运行', '42.1']])]);
    expect(p.current().extraction.suspended).toBe(false);

    await feed(p, ['\x1b[2J\x1b[H帮助 / 操作说明\r\n这里是帮助页']);
    const helpEx = p.current().extraction;
    expect(helpEx.mode).toBe('help');
    expect(helpEx.suspended).toBe(true);
    expect(helpEx.rows).toHaveLength(0);

    // 返回但先给一个无表头画面 → 仍暂停。
    await feed(p, ['\x1b[2J\x1b[H正在加载…']);
    expect(p.current().extraction.mode).toBe('unknown');
    expect(p.current().extraction.suspended).toBe(true);

    // 重新出现表头才恢复。
    await feed(p, [tableScreen([['DEV-001', '一号空压机', '运行', '44.0']])]);
    const back = p.current().extraction;
    expect(back.suspended).toBe(false);
    expect(back.headerConfirmed).toBe(true);
    expect(back.rows[0]!.fields['设备ID']).toBe('DEV-001');
    p.dispose();
  });

  it('宽字符列变化（resize 到 60 列）后按新格子列对齐', async () => {
    const p = new Pipeline(80, 20);
    await p.resize(60, 20);
    const lines = [
      headerLine(COLS60).padEnd(60),
      '-'.repeat(40).padEnd(60),
      dataLine(['DEV-001', '一号空压机', '运行', '42.1'], COLS60).padEnd(60),
    ];
    let s = '\x1b[2J\x1b[H';
    lines.forEach((line, i) => {
      s += `\x1b[${i + 1};1H${line}`;
    });
    await feed(p, [s]);
    const ex = p.current().extraction;
    expect(ex.headerConfirmed).toBe(true);
    expect(ex.rows[0]!.fields['名称']).toBe('一号空压机');
    p.dispose();
  });

  it('数据行携带形成它的字节片段', async () => {
    const p = new Pipeline(80, 20);
    await feed(p, [tableScreen([['DEV-001', '一号空压机', '运行', '42.1']])]);
    const row = p.current().extraction.rows[0]!;
    expect(row.fragments.length).toBeGreaterThan(0);
    for (const f of row.fragments) {
      expect(f.end).toBeGreaterThan(f.start);
      expect(f.chunkId).toBeGreaterThanOrEqual(1);
    }
    p.dispose();
  });

  it('并发 push 仍严格按调用顺序处理（WebSocket 连续到达场景）', async () => {
    const p = new Pipeline(40, 6);
    // 不 await，模拟同步连续到达的多个读取批次。
    const jobs = [
      p.push(enc.encode('abcdef')),
      p.push(enc.encode('\r')),
      p.push(enc.encode('xyz')),
    ];
    await Promise.all(jobs);
    // 严格顺序：回车回到行首后 xyz 覆盖前 3 格，def 保留。
    expect(p.current().snapshot.lines[0]!.trim()).toBe('xyzdef');
    p.dispose();
  });

  it('片段索引可按字节区间反查形成格子的历史片段', async () => {
    const p = new Pipeline(80, 20);
    await feed(p, [tableScreen([['DEV-001', '一号空压机', '运行', '42.1']])]);
    // 原地刷新同一行（模拟同区域更新）。
    const refreshed = dataLine(['DEV-001', '一号空压机', '告警', '58.6'], COLS80).padEnd(80);
    await feed(p, [`\x1b[3;1H${refreshed}\x1b[K`]);
    const row = p.current().extraction.rows[0]!;
    const frags = p.fragmentsFor(row.fragments);
    expect(frags.length).toBeGreaterThan(0);
    // 索引应同时覆盖文本与控制序列片段。
    expect(frags.some((f) => f.tokenType === 'text')).toBe(true);
    expect(p.fragmentCount).toBeGreaterThanOrEqual(frags.length);
    p.dispose();
  });
});
