import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Pipeline } from '../src/core/pipeline.js';
import { parseStream, replay } from '../src/demo/replay.js';
import { splitBreakingUtf8 } from '../src/demo/bytes.js';

const samplesDir = join(process.cwd(), 'samples');

interface RunStats {
  maxRecords: number;
  sawSuspended: boolean;
  sawTable: boolean;
  notes: number;
  maxColumns: number;
}

async function runSample(id: string): Promise<{ pipeline: Pipeline; stats: RunStats }> {
  const stream = new Uint8Array(await readFile(join(samplesDir, `${id}.tstream`)));
  const meta = JSON.parse(await readFile(join(samplesDir, `${id}.json`), 'utf8')) as { initialCols: number; initialRows: number };
  const pipeline = new Pipeline(meta.initialCols, meta.initialRows);
  const stats: RunStats = { maxRecords: 0, sawSuspended: false, sawTable: false, notes: 0, maxColumns: 0 };
  await replay(parseStream(stream), {
    delayMs: 0,
    onData: async (chunk) => {
      const r = await pipeline.push(chunk);
      stats.maxRecords = Math.max(stats.maxRecords, r.result.records.length);
      stats.maxColumns = Math.max(stats.maxColumns, r.result.extraction.columns.length);
      if (r.result.extraction.suspended) stats.sawSuspended = true;
      if (r.result.extraction.mode === 'table') stats.sawTable = true;
      stats.notes = r.result.notes.length;
    },
    onResize: async (cols, rows) => {
      await pipeline.resize(cols, rows);
    },
  });
  return { pipeline, stats };
}

describe('可重放字节样本（需先 npm run gen:samples）', () => {
  it('基础表格样本能抽出多条设备记录', async () => {
    const { pipeline, stats } = await runSample('01-basic-table');
    expect(stats.maxRecords).toBeGreaterThanOrEqual(4);
    expect(stats.maxColumns).toBeGreaterThanOrEqual(4);
    expect(stats.sawTable).toBe(true);
    pipeline.dispose();
  });

  it('帮助页样本经历 suspended 且返回后重新确认表头', async () => {
    const { pipeline, stats } = await runSample('02-help-pause');
    expect(stats.sawSuspended).toBe(true);
    expect(stats.sawTable).toBe(true);
    expect(stats.maxRecords).toBeGreaterThan(0);
    pipeline.dispose();
  });

  it('宽度变化样本最终屏幕宽度为 80（80→100→60→80）', async () => {
    const { pipeline } = await runSample('03-width-cycle');
    expect(pipeline.current().snapshot.cols).toBe(80);
    pipeline.dispose();
  });

  it('不支持序列样本产生标注且字节未被丢弃', async () => {
    const { pipeline, stats } = await runSample('06-unsupported-sequences');
    expect(stats.notes).toBeGreaterThanOrEqual(4);
    const result = pipeline.current();
    // 序列后的正常文本仍然可见，证明字节没有被删除。
    const allText = result.snapshot.lines.join('');
    expect(allText).toContain('序列后仍可正常显示文本');
    pipeline.dispose();
  });

  it('UTF-8 拆包样本正确还原中文', async () => {
    const { pipeline } = await runSample('07-split-utf8');
    const text = pipeline.current().snapshot.lines.join('');
    expect(text).toContain('设备温度');
    expect(text).toContain('机柜湿度');
    pipeline.dispose();
  });

  it('综合混合场景完整跑通且含不支持序列标注', async () => {
    const { pipeline, stats } = await runSample('08-mixed-live');
    expect(stats.notes).toBeGreaterThan(0);
    expect(stats.maxRecords).toBeGreaterThan(0);
    expect(stats.sawSuspended).toBe(true);
    pipeline.dispose();
  }, 20000);
});

describe('半字符读取（splitBreakingUtf8）', () => {
  it('任意切断后管道仍还原原始文本', async () => {
    const original = new TextEncoder().encode('设备 DEV-001 温度 36.5℃ 运行正常\r\n湿度 48%');
    const pieces = splitBreakingUtf8(original);
    // 至少有一次真的切在了多字节中间。
    expect(pieces.length).toBeGreaterThan(1);
    const pipeline = new Pipeline(60, 10);
    for (const piece of pieces) {
      await pipeline.push(piece);
    }
    const text = pipeline.current().snapshot.lines.join('');
    expect(text).toContain('设备 DEV-001');
    expect(text).toContain('湿度 48%');
    pipeline.dispose();
  });
});
