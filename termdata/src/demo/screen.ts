/**
 * 演示进程的屏幕构建工具。
 * 所有输出都是普通字节流 + 明确白名单内的 ANSI 序列，不提供任何结构化接口。
 */

const ESC = '\x1b';

export const ansi = {
  esc: (s: string) => ESC + s,
  csi: (s: string) => ESC + '[' + s,
  cup: (row: number, col: number) => ESC + `[${row + 1};${col + 1}H`,
  clearScreen: () => ESC + '[2J',
  clearLine: () => ESC + '[K',
  cursorHome: () => ESC + '[H',
  hideCursor: () => ESC + '[?25l',
  showCursor: () => ESC + '[?25h',
  enterAlt: () => ESC + '[?1049h',
  exitAlt: () => ESC + '[?1049l',
  sgr: (...codes: number[]) => ESC + `[${codes.join(';')}m`,
  bold: () => ESC + '[1m',
  red: () => ESC + '[31m',
  green: () => ESC + '[32m',
  yellow: () => ESC + '[33m',
  cyan: () => ESC + '[36m',
  inverse: () => ESC + '[7m',
  reset: () => ESC + '[0m',
  cr: () => '\r',
  lf: () => '\n',
};

export function toBytes(s: string): Uint8Array {
  return new TextEncoder().encode(s);
}

/** 简化的东亚宽字符判定（覆盖常用 CJK/全角区间），与 xterm 的格子宽度保持一致。 */
export function displayWidth(codePoint: number): 1 | 2 {
  const cp = codePoint;
  if (
    (cp >= 0x1100 && cp <= 0x115f) || // Hangul Jamo
    cp === 0x2329 || cp === 0x232a ||
    (cp >= 0x2e80 && cp <= 0x303e) || // CJK 部首/注音
    (cp >= 0x3041 && cp <= 0x33ff) || // 假名/全角符号
    (cp >= 0x3400 && cp <= 0x4dbf) || // Ext A
    (cp >= 0x4e00 && cp <= 0x9fff) || // CJK 统一表意
    (cp >= 0xa000 && cp <= 0xa4cf) ||
    (cp >= 0xac00 && cp <= 0xd7a3) || // Hangul 音节
    (cp >= 0xf900 && cp <= 0xfaff) || // 兼容表意
    (cp >= 0xfe30 && cp <= 0xfe4f) || // CJK 兼容形式
    (cp >= 0xff00 && cp <= 0xff60) || // 全角 ASCII
    (cp >= 0xffe0 && cp <= 0xffe6) ||
    (cp >= 0x1f300 && cp <= 0x1faff) // emoji/符号
  ) {
    return 2;
  }
  return 1;
}

export function cellWidth(s: string): number {
  let w = 0;
  for (const ch of s) w += displayWidth(ch.codePointAt(0)!);
  return w;
}

/** 按格子宽度右补空格；超出时按格子裁剪并补省略号。 */
export function padEndCell(s: string, width: number): string {
  const w = cellWidth(s);
  if (w === width) return s;
  if (w < width) return s + ' '.repeat(width - w);
  // 过宽：逐字符截断。
  let out = '';
  let used = 0;
  for (const ch of s) {
    const cw = displayWidth(ch.codePointAt(0)!);
    if (used + cw > width - 1) break;
    out += ch;
    used += cw;
  }
  return padEndCell(out + '…', width);
}

export function padStartCell(s: string, width: number): string {
  const w = cellWidth(s);
  if (w >= width) return padEndCell(s, width);
  return ' '.repeat(width - w) + s;
}

/** 定宽写入并清掉行内残余字符（用于原地刷新某个单元格）。 */
export function overwriteCell(row: number, col: number, text: string, width: number): string {
  return ansi.cup(row, col) + padEndCell(text, width) + ' ' + ansi.csi('K');
}
