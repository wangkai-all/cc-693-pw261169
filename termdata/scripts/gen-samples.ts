import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { DemoEngine } from '../src/demo/engine.js';
import { ansi, toBytes } from '../src/demo/screen.js';
import { concatBytes, encodeFrame, splitBreakingUtf8 } from '../src/demo/bytes.js';

export interface SampleMeta {
  id: string;
  title: string;
  description: string;
  initialCols: number;
  initialRows: number;
  /** 帧数量（每帧对应一次真实「读取」）。 */
  frames: number;
  bytes: number;
  /** 场景中刻意包含的特殊情况，供前端展示。 */
  features: string[];
  createdAt: string;
}

interface CapturedFrame {
  data: Uint8Array;
  /** 该帧触发的终端尺寸变化（若有）。 */
  resize?: { cols: number; rows: number };
  delayMs?: number;
}

/** 录制引擎在一组命令下产生的全部输出帧。 */
async function record(commands: { cmd: Parameters<DemoEngine['command']>[0]; afterMs: number }[], intervalMs = 50): Promise<CapturedFrame[]> {
  const engine = new DemoEngine(intervalMs);
  const frames: CapturedFrame[] = [];
  engine.on('data', (b: Uint8Array) => frames.push({ data: Uint8Array.from(b) }));
  engine.on('resize', (r: { cols: number; rows: number }) => {
    const last = frames[frames.length - 1];
    if (last) last.resize = r;
    else frames.push({ data: new Uint8Array(0), resize: r });
  });
  engine.start();
  for (const c of commands) {
    await wait(c.afterMs);
    engine.command(c.cmd);
  }
  await wait(intervalMs * 3);
  engine.stop();
  // stop 会发退出替代屏幕，也录进去。
  return frames.filter((f) => f.data.length > 0 || f.resize);
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

function buildStream(frames: CapturedFrame[], breakUtf8 = false): { stream: Uint8Array; meta: Pick<SampleMeta, 'frames' | 'bytes'> } {
  const parts: Uint8Array[] = [];
  let frameCount = 0;
  let dataFrameIdx = 0;
  for (const f of frames) {
    if (f.resize) {
      // 用一条私有约定帧承载 resize：长度帧 + 载荷首字节 0x01 + 2 字节 cols + 2 字节 rows。
      const payload = new Uint8Array(5);
      payload[0] = 0x01;
      new DataView(payload.buffer).setUint16(1, f.resize.cols, false);
      new DataView(payload.buffer).setUint16(3, f.resize.rows, false);
      parts.push(encodeFrame(payload));
      frameCount += 1;
    }
    if (f.data.length === 0) continue;
    dataFrameIdx += 1;
    // 仅对约四分之一的数据帧做半字符切断，既覆盖拆包场景又控制帧规模。
    if (breakUtf8 && dataFrameIdx % 4 === 0) {
      for (const piece of splitBreakingUtf8(f.data)) {
        parts.push(encodeFrame(piece));
        frameCount += 1;
      }
    } else {
      parts.push(encodeFrame(f.data));
      frameCount += 1;
    }
  }
  const stream = concatBytes(parts);
  return { stream, meta: { frames: frameCount, bytes: stream.length } };
}

/** 手工构造的边界场景（不依赖引擎时序）。 */
function handcraftedSplitCjk(): { stream: Uint8Array; meta: Pick<SampleMeta, 'frames' | 'bytes'> } {
  const frame = toBytes(
    ansi.enterAlt() + ansi.hideCursor() + ansi.clearScreen() + ansi.cursorHome() +
    '设备温度：36.5℃，状态：运行正常\r\n' +
    '机柜湿度：48%（宽字符列对齐测试）',
  );
  // 找到「设」的 UTF-8（E8 AE BE），从中间切开。
  const pieces = splitBreakingUtf8(frame);
  const parts = pieces.map(encodeFrame);
  const stream = concatBytes(parts);
  return { stream, meta: { frames: parts.length, bytes: stream.length } };
}

function handcraftedUnsupported(): { stream: Uint8Array; meta: Pick<SampleMeta, 'frames' | 'bytes'> } {
  const frames = [
    toBytes(ansi.enterAlt() + ansi.clearScreen() + ansi.cursorHome()),
    toBytes('不支持序列演示行\r\n'),
    toBytes(ansi.csi('?1000h')), // 鼠标上报
    toBytes(ansi.esc('=')), // 应用小键盘
    toBytes('\x1b]52;c;Zm9v\x07'), // OSC 52 剪贴板
    toBytes('\x9b?25l'), // 裸 C1 CSI（0x9b 等价 ESC[）
    toBytes(ansi.csi('999m')), // 未知 SGR 码
    toBytes('\r\n序列后仍可正常显示文本'),
  ];
  const stream = concatBytes(frames.map(encodeFrame));
  return { stream, meta: { frames: frames.length, bytes: stream.length } };
}

async function main() {
  const outDir = join(process.cwd(), 'samples');
  await mkdir(outDir, { recursive: true });

  const scenarios: { id: string; title: string; description: string; features: string[]; build: () => Promise<{ stream: Uint8Array; meta: Pick<SampleMeta, 'frames' | 'bytes'>; cols: number }> | { stream: Uint8Array; meta: Pick<SampleMeta, 'frames' | 'bytes'>; cols: number } }[] = [
    {
      id: '01-basic-table',
      title: '基础表格持续刷新',
      description: '替代屏幕中持续原地刷新设备状态表，验证不会把每次输出当成新增行',
      features: ['替代屏幕', '光标定位', '清行', '原地刷新'],
      build: async () => ({ ...buildStream(await record([], 60)), cols: 80 }),
    },
    {
      id: '02-help-pause',
      title: '帮助页暂停与表头重确认',
      description: '切到帮助页时暂停表格提取，返回后重新确认表头再恢复',
      features: ['帮助页', '提取暂停', '表头重确认'],
      build: async () => ({
        ...buildStream(await record([{ cmd: 'help', afterMs: 200 }, { cmd: 'quit-help', afterMs: 700 }], 60)),
        cols: 80,
      }),
    },
    {
      id: '03-width-cycle',
      title: '终端宽度变化重排',
      description: '80→100→60→80 列切换，表格按格子列重新对齐',
      features: ['resize', '整屏回流', '宽字符'],
      build: async () => ({
        ...buildStream(await record([
          { cmd: 'resize', afterMs: 150 },
          { cmd: 'resize', afterMs: 300 },
          { cmd: 'resize', afterMs: 450 },
        ], 60)),
        cols: 80,
      }),
    },
    {
      id: '04-overlay-update',
      title: '覆盖更新告警',
      description: '反白警告覆盖在同一区域，不产生滚动新行',
      features: ['SGR 反白', '覆盖写', '清行'],
      build: async () => ({
        ...buildStream(await record([{ cmd: 'overlay', afterMs: 200 }], 60)),
        cols: 80,
      }),
    },
    {
      id: '05-screen-swap',
      title: '换屏（替代屏幕进出）',
      description: '退出替代屏幕进入普通屏幕，再切回并重新渲染表格',
      features: ['DEC 1049', '普通/替代缓冲', '换屏'],
      build: async () => ({
        ...buildStream(await record([{ cmd: 'swap', afterMs: 200 }], 60)),
        cols: 80,
      }),
    },
    {
      id: '06-unsupported-sequences',
      title: '不支持控制序列标注',
      description: '鼠标上报、小键盘、OSC52、裸 C1 与未知 SGR，均需标注影响且不删除字节',
      features: ['不支持序列', 'C1', 'OSC52', '影响标注'],
      build: () => ({ ...handcraftedUnsupported(), cols: 80 }),
    },
    {
      id: '07-split-utf8',
      title: '跨读取的 UTF-8 拆分',
      description: '中文宽字符的字节被拆在两次读取中，仍需正确解码与列对齐',
      features: ['UTF-8 拆包', '中文宽字符', '格子列'],
      build: () => ({ ...handcraftedSplitCjk(), cols: 80 }),
    },
    {
      id: '08-mixed-live',
      title: '综合混合场景',
      description: '帮助页、宽度变化、覆盖更新与不支持序列交替出现，且帧在 UTF-8 中间切断',
      features: ['综合', 'UTF-8 拆包', '帮助页', 'resize', '不支持序列'],
      build: async () => ({
        ...buildStream(
          await record([
            { cmd: 'help', afterMs: 150 },
            { cmd: 'quit-help', afterMs: 500 },
            { cmd: 'resize', afterMs: 200 },
            { cmd: 'overlay', afterMs: 200 },
            { cmd: 'unsupported', afterMs: 200 },
            { cmd: 'resize', afterMs: 200 },
          ], 60),
          true,
        ),
        cols: 80,
      }),
    },
  ];

  const index: SampleMeta[] = [];
  for (const sc of scenarios) {
    const { stream, meta, cols } = await sc.build();
    const tstreamPath = join(outDir, `${sc.id}.tstream`);
    await writeFile(tstreamPath, stream);
    const full: SampleMeta = {
      id: sc.id,
      title: sc.title,
      description: sc.description,
      initialCols: cols,
      initialRows: 24,
      frames: meta.frames,
      bytes: meta.bytes,
      features: sc.features,
      createdAt: new Date().toISOString(),
    };
    await writeFile(join(outDir, `${sc.id}.json`), JSON.stringify(full, null, 2));
    index.push(full);
    console.log(`生成 ${sc.id}: ${meta.frames} 帧 / ${meta.bytes} 字节`);
  }
  await writeFile(join(outDir, 'index.json'), JSON.stringify(index, null, 2));
  console.log(`共 ${index.length} 个样本，输出到 ${outDir}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
