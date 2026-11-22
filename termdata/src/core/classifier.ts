import { SGR_SIMPLE_WHITELIST } from './catalog.js';
import type { StreamToken, UnsupportedNote } from './types.js';

export interface Classification {
  supported: boolean;
  reason: string;
  impact: string;
  unsupportedParams?: number[];
}

const SUPPORTED_CSI_FINALS = new Set(['A', 'B', 'C', 'D', 'E', 'F', 'G', 'd', 'H', 'f', 'J', 'K', '@', 'P', 'X', 'L', 'M', 'r', 'S', 'T']);
const SUPPORTED_PRIVATE_DECSET = new Set(['1049', '47', '25']);
const SUPPORTED_ESC_FINALS = new Set(['D', 'M', 'E', '7', '8']);
const SUPPORTED_OSC = new Set([0, 2]);

/** 人类可读的序列形态，用于标注面板。 */
export function describeSequence(t: StreamToken): string {
  const name = (s: string) => s.replace(/\x1b/g, 'ESC ');
  if (t.type === 'c0' || t.type === 'c1') {
    const code = t.bytes[0]!;
    return t.type === 'c0' ? `C0 0x${hex2(code)} ${controlName(code)}` : `C1 0x${hex2(code)}`;
  }
  return name(t.raw).replace(/\x07/g, ' BEL').replace(/\x1b \\/g, 'ST');
}

function hex2(n: number): string {
  return n.toString(16).padStart(2, '0').toUpperCase();
}

function controlName(code: number): string {
  const names: Record<number, string> = {
    0x00: 'NUL', 0x07: 'BEL', 0x08: 'BS', 0x09: 'HT', 0x0a: 'LF',
    0x0b: 'VT', 0x0c: 'FF', 0x0d: 'CR', 0x7f: 'DEL',
  };
  return names[code] ?? '';
}

function flatParams(params: (number | number[])[]): number[] {
  const out: number[] = [];
  for (const p of params) {
    if (Array.isArray(p)) out.push(...p);
    else out.push(p);
  }
  return out;
}

/** 校验 SGR 参数，返回其中不在白名单的码。 */
export function checkSgr(params: (number | number[])[]): number[] {
  const bad: number[] = [];
  for (let i = 0; i < params.length; i++) {
    const p = params[i]!;
    if (Array.isArray(p)) {
      // 子参数整体视为不支持（SGR 白名单不含子参数用法）。
      bad.push(...p);
      continue;
    }
    if (p === 38 || p === 48) {
      const mode = params[i + 1];
      if (mode === 5 && typeof params[i + 2] === 'number') {
        i += 2;
        continue;
      }
      if (mode === 2 && typeof params[i + 2] === 'number' && typeof params[i + 3] === 'number' && typeof params[i + 4] === 'number') {
        i += 4;
        continue;
      }
      bad.push(p);
      continue;
    }
    if (!SGR_SIMPLE_WHITELIST.has(p)) bad.push(p);
  }
  return bad;
}

export function classify(t: StreamToken): Classification {
  switch (t.type) {
    case 'text':
      return { supported: true, reason: '可打印文本', impact: '直接写入当前光标位置' };
    case 'c0': {
      const code = t.bytes[0]!;
      const ok = code === 0x08 || code === 0x09 || code === 0x0a || code === 0x0b || code === 0x0c || code === 0x0d;
      if (ok) return { supported: true, reason: '受支持的 C0 控制字符', impact: '按回车/退格/换行/制表语义移动光标' };
      if (code === 0x07) {
        return { supported: false, reason: 'BEL 响铃不在支持清单', impact: '真实终端会发出提示音，不改变屏幕格子' };
      }
      if (code === 0x7f) {
        return { supported: false, reason: 'DEL 不在支持清单', impact: '通常被终端忽略，不改变屏幕格子' };
      }
      return { supported: false, reason: `C0 控制 0x${hex2(code)} 不在支持清单`, impact: '依终端实现可能产生未定义行为' };
    }
    case 'c1': {
      const code = t.bytes[0]!;
      return {
        supported: false,
        reason: `C1 单字节控制 0x${hex2(code)} 不在支持清单`,
        impact: '等价于某些 ESC 两字节序列（如 IND/NEL/RI），可能触发光标移动或屏幕滚动，画面可能已变化',
      };
    }
    case 'esc': {
      const f = t.final ?? '';
      if (SUPPORTED_ESC_FINALS.has(f) && !t.intermediates) {
        return { supported: true, reason: '受支持的 ESC 光标/滚动操作', impact: '光标移动或屏幕滚动一行' };
      }
      if (t.intermediates === '(' || t.intermediates === ')') {
        if (f === 'B') {
          return { supported: true, reason: 'US-ASCII 字符集指定', impact: '选择 G0/G1 字符集，不直接改屏' };
        }
        return {
          supported: false,
          reason: `字符集指定 ESC ${t.intermediates} ${f} 不在支持清单`,
          impact: '可能切换特殊字符集（线条/其他国家字符），后续字节渲染字形可能与预期不同',
        };
      }
      if (f === 'c') {
        return { supported: false, reason: 'RIS 全复位不在支持清单', impact: '终端会清空整个屏幕并复位全部状态，当前表格画面会被抹掉' };
      }
      if (f === '=' || f === '>') {
        return { supported: false, reason: '小键盘模式切换不在支持清单', impact: '仅改变键盘输入解码，不改变屏幕格子' };
      }
      if (f === 'H') {
        return { supported: false, reason: 'HTS 设置制表位不在支持清单', impact: '改变后续 HT 的跳列位置，表格对齐可能偏移' };
      }
      return {
        supported: false,
        reason: `ESC 序列 ${describeSequence(t)} 不在支持清单`,
        impact: '语义未知，屏幕模拟器仍会按其自身规则执行，画面可能已变化',
      };
    }
    case 'csi': {
      const f = t.final ?? '';
      if (t.prefix === '?') {
        const firstParam = t.params?.[0];
        if ((f === 'h' || f === 'l') && t.params && t.params.length === 1 && typeof firstParam === 'number' && SUPPORTED_PRIVATE_DECSET.has(String(firstParam))) {
          return { supported: true, reason: '受支持的 DEC 私有模式（替代屏幕/光标可见性）', impact: '切换替代屏幕或光标显示状态' };
        }
        const impact = f === 'h' || f === 'l'
          ? '可能切换鼠标上报、自动换行、本地回显等终端模式，影响后续输入与换行行为'
          : '私有模式参数语义未知，画面行为依终端实现而定';
        return { supported: false, reason: `私有 CSI ${t.prefix}${flatParams(t.params ?? []).join(';')}${f} 不在支持清单`, impact };
      }
      if (f === 'm') {
        const bad = checkSgr(t.params ?? []);
        if (bad.length === 0) {
          return { supported: true, reason: 'SGR 参数均在样式白名单内', impact: '改变后续字符的颜色/样式属性' };
        }
        return {
          supported: false,
          reason: `SGR 含不支持的样式码：${bad.join(', ')}`,
          impact: '未知样式码可能被真实终端忽略或产生非预期字形效果，屏幕模拟器仍会尝试执行',
          unsupportedParams: bad,
        };
      }
      if (SUPPORTED_CSI_FINALS.has(f) && !t.intermediates && !t.prefix) {
        return { supported: true, reason: '受支持的 CSI 光标移动/编辑/滚动操作', impact: '移动光标、清除或插入/删除行列' };
      }
      return {
        supported: false,
        reason: `CSI ${t.prefix ?? ''}${t.intermediates ?? ''}${f} 不在支持清单`,
        impact: '可能是未建模的编辑/查询/设备控制操作，屏幕模拟器仍会按自身规则执行',
      };
    }
    case 'osc': {
      const code = t.oscCode;
      if (code !== undefined && SUPPORTED_OSC.has(code)) {
        return { supported: true, reason: '受支持的标题类 OSC', impact: '仅记录窗口标题，不改变屏幕格子' };
      }
      return {
        supported: false,
        reason: `OSC ${code ?? '?'} 不在支持清单`,
        impact: '可能修改调色板、剪贴板或通知，不直接改写屏幕文本但可能改变颜色',
      };
    }
    case 'dcs':
      return {
        supported: false,
        reason: 'DCS 设备控制字符串不在支持清单',
        impact: '可能注入用户自定义软字体或六字节键盘数据，后续字符字形可能被替换',
      };
    case 'apc':
    case 'pm':
    case 'sos':
      return {
        supported: false,
        reason: `${t.type.toUpperCase()} 字符串不在支持清单`,
        impact: '语义依宿主程序而定（常见于 shell 集成标记），不直接改写可见屏幕',
      };
    case 'invalid':
      return {
        supported: false,
        reason: '不完整或非法的控制序列/UTF-8 字节',
        impact: '真实终端可能丢弃或替换为错误字形，屏幕模拟器会按容错规则处理',
      };
  }
}

let noteSeq = 0;

export function toNote(t: StreamToken, c: Classification): UnsupportedNote {
  noteSeq += 1;
  return {
    id: noteSeq,
    range: { ...t.range },
    sequence: describeSequence(t),
    kind: t.type,
    reason: c.reason,
    impact: c.impact,
    stillApplied: true,
  };
}

export function resetNoteSeq() {
  noteSeq = 0;
}
