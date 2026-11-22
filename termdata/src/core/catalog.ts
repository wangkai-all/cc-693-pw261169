import type { CatalogEntry } from './types.js';

/**
 * 本工具明确支持的 ANSI / VT 操作白名单。
 * 只有列在这里且 supported=true 的操作会被视为「已支持」；
 * 流中出现的其他控制序列一律生成 UnsupportedNote 标注影响，
 * 但原始字节仍会完整送入屏幕模拟器，不会被删除。
 */
export const CATALOG: CatalogEntry[] = [
  // ---------- C0 控制字符 ----------
  { kind: 'C0', notation: 'BS (0x08)', name: '退格', effect: '光标左移一列', supported: true },
  { kind: 'C0', notation: 'HT (0x09)', name: '水平制表', effect: '光标跳到下一制表位', supported: true },
  { kind: 'C0', notation: 'LF (0x0A)', name: '换行', effect: '光标下移一行', supported: true },
  { kind: 'C0', notation: 'VT (0x0B)', name: '垂直制表', effect: '同 LF 处理', supported: true },
  { kind: 'C0', notation: 'FF (0x0C)', name: '换页', effect: '同 LF 处理', supported: true },
  { kind: 'C0', notation: 'CR (0x0D)', name: '回车', effect: '光标回到行首', supported: true },

  // ---------- ESC 序列 ----------
  { kind: 'ESC', notation: 'ESC c', name: 'RIS 全复位', effect: '清空屏幕并复位终端状态', supported: false },
  { kind: 'ESC', notation: 'ESC D', name: 'IND 下移', effect: '光标下移一行（到底部时滚动）', supported: true },
  { kind: 'ESC', notation: 'ESC M', name: 'RI 上移', effect: '光标上移一行（到顶部时滚动）', supported: true },
  { kind: 'ESC', notation: 'ESC E', name: 'NEL 下一行', effect: '回车加换行', supported: true },
  { kind: 'ESC', notation: 'ESC 7', name: 'DECSC 保存光标', effect: '保存光标位置与属性', supported: true },
  { kind: 'ESC', notation: 'ESC 8', name: 'DECRC 恢复光标', effect: '恢复光标位置与属性', supported: true },
  { kind: 'ESC', notation: 'ESC ( B / ESC ) B', name: '字符集选择 US-ASCII', effect: '指定 G0/G1 为 ASCII 字符集', supported: true },
  { kind: 'ESC', notation: 'ESC = / ESC >', name: '小键盘模式', effect: '切换应用/数字小键盘模式', supported: false },
  { kind: 'ESC', notation: 'ESC H', name: 'HTS 置制表位', effect: '在当前列设置制表位', supported: false },

  // ---------- CSI：光标移动与编辑 ----------
  { kind: 'CSI', notation: 'CSI <n> A', name: 'CUU 光标上移', effect: '光标上移 n 行', supported: true, final: 'A' },
  { kind: 'CSI', notation: 'CSI <n> B', name: 'CUD 光标下移', effect: '光标下移 n 行', supported: true, final: 'B' },
  { kind: 'CSI', notation: 'CSI <n> C', name: 'CUF 光标右移', effect: '光标右移 n 列', supported: true, final: 'C' },
  { kind: 'CSI', notation: 'CSI <n> D', name: 'CUB 光标左移', effect: '光标左移 n 列', supported: true, final: 'D' },
  { kind: 'CSI', notation: 'CSI <n> E', name: 'CNL 光标到下 n 行行首', effect: '下移 n 行并回到第一列', supported: true, final: 'E' },
  { kind: 'CSI', notation: 'CSI <n> F', name: 'CPL 光标到上 n 行行首', effect: '上移 n 行并回到第一列', supported: true, final: 'F' },
  { kind: 'CSI', notation: 'CSI <n> G', name: 'CHA 光标到列', effect: '光标移动到第 n 列', supported: true, final: 'G' },
  { kind: 'CSI', notation: 'CSI <n> d', name: 'VPA 光标到行', effect: '光标移动到第 n 行', supported: true, final: 'd' },
  { kind: 'CSI', notation: 'CSI <r> ; <c> H', name: 'CUP 光标定位', effect: '光标移动到指定行列', supported: true, final: 'H' },
  { kind: 'CSI', notation: 'CSI <r> ; <c> f', name: 'HVP 光标定位', effect: '同 CUP', supported: true, final: 'f' },
  { kind: 'CSI', notation: 'CSI <n> J', name: 'ED 清屏', effect: '0 光标后清屏 / 1 光标前 / 2 全屏 / 3 回滚区', supported: true, final: 'J' },
  { kind: 'CSI', notation: 'CSI <n> K', name: 'EL 清行', effect: '0 光标后清行 / 1 光标前 / 2 整行', supported: true, final: 'K' },
  { kind: 'CSI', notation: 'CSI <n> @', name: 'ICH 插入空格', effect: '在光标处插入 n 个空格', supported: true, final: '@' },
  { kind: 'CSI', notation: 'CSI <n> P', name: 'DCH 删除字符', effect: '删除光标处 n 个字符', supported: true, final: 'P' },
  { kind: 'CSI', notation: 'CSI <n> X', name: 'ECH 擦除字符', effect: '擦除光标处 n 个字符（不移动光标）', supported: true, final: 'X' },
  { kind: 'CSI', notation: 'CSI <n> L', name: 'IL 插入行', effect: '在光标行插入 n 个空行', supported: true, final: 'L' },
  { kind: 'CSI', notation: 'CSI <n> M', name: 'DL 删除行', effect: '删除光标起 n 行', supported: true, final: 'M' },
  { kind: 'CSI', notation: 'CSI <top> ; <bottom> r', name: 'DECSTBM 滚动区域', effect: '设置上下滚动边界', supported: true, final: 'r' },
  { kind: 'CSI', notation: 'CSI <n> S', name: 'SU 向上滚动', effect: '整页上滚 n 行', supported: true, final: 'S' },
  { kind: 'CSI', notation: 'CSI <n> T', name: 'SD 向下滚动', effect: '整页下滚 n 行', supported: true, final: 'T' },

  // ---------- CSI：SGR 样式 ----------
  { kind: 'CSI', notation: 'CSI <params> m', name: 'SGR 字符样式', effect: '仅支持白名单码：0/1/2/3/4/7/9/22/23/24/27/29/30-39/40-49/90-97/100-107/38;5;n/48;5;n/38;2;r;g;b/48;2;r;g;b', supported: true, final: 'm' },

  // ---------- CSI：私有模式 ----------
  { kind: 'CSI', notation: "CSI ? 1049 h/l", name: '替代屏幕（含光标保存）', effect: '进入/退出替代屏幕，是同区域刷新的核心', supported: true, prefix: '?', final: 'h' },
  { kind: 'CSI', notation: "CSI ? 47 h/l", name: '替代屏幕（旧式）', effect: '进入/退出替代屏幕', supported: true, prefix: '?', final: 'h' },
  { kind: 'CSI', notation: "CSI ? 25 h/l", name: '光标可见性', effect: '显示/隐藏光标', supported: true, prefix: '?', final: 'h' },
  { kind: 'CSI', notation: "CSI ? 1000 h/l 等", name: '鼠标上报模式', effect: '启用鼠标事件上报', supported: false, prefix: '?', final: 'h' },
  { kind: 'CSI', notation: "CSI ? 7 h/l", name: '自动换行模式', effect: '控制越界自动换行', supported: false, prefix: '?', final: 'h' },

  // ---------- OSC ----------
  { kind: 'OSC', notation: 'OSC 0 ; <t> ST', name: '设置图标名与窗口标题', effect: '仅记录，不改变屏幕格子', supported: true },
  { kind: 'OSC', notation: 'OSC 2 ; <t> ST', name: '设置窗口标题', effect: '仅记录，不改变屏幕格子', supported: true },
  { kind: 'OSC', notation: 'OSC <其他编号>', name: '其他 OSC（颜色/剪贴板等）', effect: '未列出的 OSC，可能修改调色板或主机剪贴板', supported: false },

  // ---------- 明确不支持的大类 ----------
  { kind: 'DCS', notation: 'DCS ... ST', name: '设备控制字符串', effect: '可能注入软字体/六字节数据等，本工具不解析', supported: false },
  { kind: 'ESC', notation: 'APC / PM / SOS ... ST', name: '应用/隐私/开始字符串', effect: '语义依宿主程序而定，本工具不解析', supported: false },
];

/** SGR 白名单参数码（复合参数 38/48 单独处理）。 */
export const SGR_SIMPLE_WHITELIST = new Set<number>([
  0, 1, 2, 3, 4, 7, 9,
  22, 23, 24, 27, 29,
  30, 31, 32, 33, 34, 35, 36, 37, 39,
  40, 41, 42, 43, 44, 45, 46, 47, 49,
  90, 91, 92, 93, 94, 95, 96, 97,
  100, 101, 102, 103, 104, 105, 106, 107,
]);
