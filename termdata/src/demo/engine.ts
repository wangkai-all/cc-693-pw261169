import { EventEmitter } from 'node:events';
import { ansi, cellWidth, padEndCell, padStartCell, toBytes } from './screen.js';

export interface Device {
  id: string;
  name: string;
  status: '运行' | '待机' | '告警' | '离线';
  temp: number;
  humidity: number;
  voltage: number;
}

export type EngineCommand = 'help' | 'resize' | 'overlay' | 'swap' | 'unsupported' | 'quit-help';

interface WidthPlan {
  cols: number;
  keys: { key: keyof Device | '更新时间'; title: string; width: number }[];
}

const DEVICE_SEED: Device[] = [
  { id: 'DEV-001', name: '一号空压机', status: '运行', temp: 42.1, humidity: 55, voltage: 220.4 },
  { id: 'DEV-002', name: '循环水泵', status: '运行', temp: 38.7, humidity: 60, voltage: 219.1 },
  { id: 'DEV-003', name: '冷却塔风机', status: '待机', temp: 31.2, humidity: 64, voltage: 0 },
  { id: 'DEV-004', name: '配电柜', status: '告警', temp: 57.9, humidity: 41, voltage: 235.8 },
  { id: 'DEV-005', name: '干燥机', status: '运行', temp: 45.0, humidity: 32, voltage: 221.0 },
  { id: 'DEV-006', name: '通风机组', status: '离线', temp: 0, humidity: 0, voltage: 0 },
];

const STATUS_COLOR: Record<Device['status'], string> = {
  运行: '\x1b[32m',
  待机: '\x1b[33m',
  告警: '\x1b[31m',
  离线: '\x1b[90m',
};

const ROWS = 24;

/**
 * 演示进程：持续输出设备状态表的「真实终端程序」。
 * 它只写字节流，使用回车/退格/光标定位/清行/替代屏幕刷新同一区域。
 */
export class DemoEngine extends EventEmitter {
  private cols = 80;
  private readonly rows = ROWS;
  private devices: Device[] = DEVICE_SEED.map((d) => ({ ...d }));
  private tickCount = 0;
  private timer: NodeJS.Timeout | null = null;
  private helpTimer: NodeJS.Timeout | null = null;
  private inHelp = false;
  private inAlt = false;
  private overlayUntil = 0;
  private widthIndex = 0;
  private readonly widthPlans: WidthPlan[] = [
    {
      cols: 80,
      keys: [
        { key: 'id', title: '设备ID', width: 10 },
        { key: 'name', title: '名称', width: 14 },
        { key: 'status', title: '状态', width: 8 },
        { key: 'temp', title: '温度', width: 10 },
        { key: 'humidity', title: '湿度', width: 10 },
        { key: 'voltage', title: '电压', width: 10 },
      ],
    },
    {
      cols: 100,
      keys: [
        { key: 'id', title: '设备ID', width: 12 },
        { key: 'name', title: '名称', width: 18 },
        { key: 'status', title: '状态', width: 10 },
        { key: 'temp', title: '温度', width: 12 },
        { key: 'humidity', title: '湿度', width: 12 },
        { key: 'voltage', title: '电压', width: 12 },
        { key: '更新时间', title: '更新时间', width: 20 },
      ],
    },
    {
      cols: 60,
      keys: [
        { key: 'id', title: '设备ID', width: 10 },
        { key: 'name', title: '名称', width: 16 },
        { key: 'status', title: '状态', width: 8 },
        { key: 'temp', title: '温度', width: 10 },
      ],
    },
  ];

  constructor(private readonly intervalMs = 900) {
    super();
  }

  start(): void {
    this.emit('data', toBytes(ansi.enterAlt() + ansi.hideCursor()));
    this.inAlt = true;
    this.emit('resize', { cols: this.cols, rows: this.rows });
    this.emit('data', toBytes(this.renderFrame()));
    this.timer = setInterval(() => this.tick(), this.intervalMs);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    if (this.helpTimer) clearTimeout(this.helpTimer);
    this.timer = null;
    this.helpTimer = null;
    if (this.inAlt) {
      this.emit('data', toBytes(ansi.showCursor() + ansi.exitAlt()));
      this.inAlt = false;
    }
  }

  get currentCols(): number {
    return this.cols;
  }

  get currentRows(): number {
    return this.rows;
  }

  get isHelp(): boolean {
    return this.inHelp;
  }

  command(cmd: EngineCommand): void {
    switch (cmd) {
      case 'help':
        this.showHelp();
        break;
      case 'quit-help':
        this.closeHelp();
        break;
      case 'resize':
        this.cycleWidth();
        break;
      case 'overlay':
        this.triggerOverlay();
        break;
      case 'swap':
        this.swapScreen();
        break;
      case 'unsupported':
        this.emitUnsupported();
        break;
    }
  }

  private tick(): void {
    this.tickCount += 1;
    this.mutateDevices();
    if (this.inHelp) return;
    // 演示「同一区域刷新」：只重绘表格行而不是滚屏新增。
    this.emit('data', toBytes(this.renderTableRows()));
  }

  private mutateDevices(): void {
    for (const d of this.devices) {
      if (d.status === '离线') continue;
      const jitter = (base: number, span: number) => base + (Math.random() - 0.5) * span;
      d.temp = d.temp === 0 ? 0 : Math.max(0, round1(jitter(d.temp, 1.6)));
      d.humidity = clamp(Math.round(jitter(d.humidity, 4)), 5, 95);
      if (d.status !== '待机') d.voltage = round1(jitter(220, 6));
      // 偶发状态翻转，制造颜色与文本变化。
      if (Math.random() < 0.08) {
        const pool: Device['status'][] = ['运行', '待机', '告警'];
        d.status = pool[Math.floor(Math.random() * pool.length)]!;
      }
    }
  }

  private plan(): WidthPlan {
    return this.widthPlans[this.widthIndex]!;
  }

  private renderFrame(): string {
    const p = this.plan();
    let s = ansi.clearScreen() + ansi.cursorHome();
    s += ansi.bold() + ansi.cyan() + padEndCell('设备状态监控（演示进程）', this.cols) + ansi.reset() + '\r\n';
    s += '\r\n';
    // 表头
    s += ansi.inverse() + this.formatHeader(p) + ansi.reset() + '\r\n';
    s += this.separatorLine(p) + '\r\n';
    s += this.renderTableRows();
    s += this.renderFooter();
    if (Date.now() < this.overlayUntil) s += this.renderOverlay();
    return s;
  }

  private formatHeader(p: WidthPlan): string {
    let line = '';
    for (const k of p.keys) line += padEndCell(k.title, k.width);
    return padEndCell(line, this.cols);
  }

  private separatorLine(p: WidthPlan): string {
    const total = p.keys.reduce((acc, k) => acc + k.width, 0);
    return padEndCell('-'.repeat(Math.min(total, this.cols)), this.cols);
  }

  private renderTableRows(): string {
    const p = this.plan();
    let s = '';
    const firstRow = 4; // 标题(0) 空(1) 表头(2) 分隔(3)
    this.devices.forEach((d, idx) => {
      const y = firstRow + idx;
      s += ansi.cup(y, 0);
      s += this.formatDeviceRow(d, p);
      s += ansi.csi('K'); // 清掉行内残留（宽度变窄时尤其重要）
      s += '\r';
    });
    return s;
  }

  private formatDeviceRow(d: Device, p: WidthPlan): string {
    let line = '';
    for (const k of p.keys) {
      let text: string;
      if (k.key === '更新时间') {
        text = nowTime();
      } else if (k.key === 'status') {
        text = d.status;
      } else if (k.key === 'temp') {
        text = d.status === '离线' ? '--' : d.temp.toFixed(1);
      } else if (k.key === 'humidity') {
        text = d.status === '离线' ? '--' : String(d.humidity);
      } else if (k.key === 'voltage') {
        text = d.voltage === 0 ? '--' : d.voltage.toFixed(1);
      } else {
        text = String(d[k.key]);
      }
      if (k.key === 'status') {
        line += STATUS_COLOR[d.status] + padEndCell(text, k.width) + ansi.reset();
      } else if (k.key === 'id') {
        line += ansi.bold() + padEndCell(text, k.width) + ansi.reset();
      } else if (k.key === 'temp' && d.temp >= 55) {
        line += ansi.yellow() + padStartCell(text, k.width) + ansi.reset();
      } else {
        line += k.key === 'name' ? padEndCell(text, k.width) : padStartCell(text, k.width);
      }
    }
    return padEndCell(line, this.cols);
  }

  private renderFooter(): string {
    let s = '';
    const y = this.rows - 3;
    s += ansi.cup(y, 0) + ansi.csi('K') + padEndCell(
      `第 ${this.tickCount} 次刷新 · 宽度 ${this.cols} 列 · 替代屏幕=${this.inAlt ? '是' : '否'}`,
      this.cols,
    );
    s += ansi.cup(y + 1, 0) + ansi.csi('K') + padEndCell(
      '快捷键: H 帮助  W 宽度  O 覆盖更新  R 换屏  X 不支持序列',
      this.cols,
    );
    return s;
  }

  private renderOverlay(): string {
    const y = this.rows - 5;
    const msg = '⚠ 覆盖更新：配电柜温度越限，请现场核查';
    const x = Math.max(0, Math.floor((this.cols - cellWidth(msg)) / 2));
    return ansi.cup(y, x) + ansi.inverse() + ansi.red() + msg + ansi.reset();
  }

  private showHelp(): void {
    if (this.inHelp) return;
    this.inHelp = true;
    this.emit('data', toBytes(this.renderHelp()));
    this.helpTimer = setTimeout(() => this.closeHelp(), 4000);
  }

  private closeHelp(): void {
    if (!this.inHelp) return;
    this.inHelp = false;
    if (this.helpTimer) clearTimeout(this.helpTimer);
    this.helpTimer = null;
    // 返回后整屏重绘：提取器必须重新确认表头才能恢复抽取。
    this.emit('data', toBytes(this.renderFrame()));
  }

  private renderHelp(): string {
    const lines = [
      '帮助 / 操作说明',
      '',
      'H        打开/关闭本帮助页（表格提取自动暂停，返回后重新确认表头）',
      'W        循环切换终端宽度 80 → 100 → 60 → 80，整屏回流重排',
      'O        在表格下方触发一次覆盖更新（反白警告，不新增滚动行）',
      'R        退出并重新进入替代屏幕，模拟换屏',
      'X        输出一段不在支持清单的控制序列，观察影响标注',
      '',
      '数据仅通过终端字节流输出，不存在任何结构化接口。',
      '4 秒后自动返回，或按 Q 立即返回。',
    ];
    let s = ansi.clearScreen() + ansi.cursorHome();
    lines.forEach((line, i) => {
      s += ansi.cup(i + 2, 2) + (i === 0 ? ansi.bold() + ansi.cyan() : '') + padEndCell(line, this.cols - 4) + ansi.reset();
    });
    return s;
  }

  private cycleWidth(): void {
    this.widthIndex = (this.widthIndex + 1) % this.widthPlans.length;
    this.cols = this.plan().cols;
    // 先通知宿主调整终端尺寸，再按新宽度整屏重绘。
    this.emit('resize', { cols: this.cols, rows: this.rows });
    this.emit('data', toBytes(this.renderFrame()));
  }

  private triggerOverlay(): void {
    this.overlayUntil = Date.now() + 2500;
    this.emit('data', toBytes(this.renderOverlay()));
  }

  private swapScreen(): void {
    // 退出替代屏幕 → 普通屏幕上的空闲画面 → 再进入替代屏幕重绘表格。
    this.inAlt = false;
    this.emit('data', toBytes(
      ansi.showCursor() + ansi.exitAlt() + ansi.clearScreen() + ansi.cursorHome() +
      padEndCell('普通屏幕：演示进程暂时挂起，按 R 重新进入监控画面', this.cols),
    ));
    setTimeout(() => {
      this.inAlt = true;
      this.emit('data', toBytes(ansi.enterAlt() + ansi.hideCursor() + this.renderFrame()));
    }, 1200);
  }

  private emitUnsupported(): void {
    // 故意输出白名单之外的序列：鼠标上报、剪贴板 OSC52、RIS 不会真的发（避免清屏），
    // 这里发鼠标模式与 OSC 52，工具应标注影响而非删除。
    const payload =
      ansi.csi('?1000h') + // 鼠标上报
      ansi.csi('?1006h') + // 鼠标 SGR 编码
      '\x1b]52;c;Q0xMTIz\x07' + // OSC 52 剪贴板
      '\x9b38;2;1;2;3m'; // 裸 C1 CSI（0x9b）+ RGB SGR，测试 C1 标注
    this.emit('data', toBytes(payload));
    // 紧接着在状态行给出提示，证明字节未被删除、画面仍连续。
    this.emit('data', toBytes(ansi.cup(this.rows - 1, 0) + ansi.csi('K') +
      padEndCell('已输出 4 个不支持序列，详见「不支持序列」面板', this.cols)));
  }
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

function nowTime(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}
