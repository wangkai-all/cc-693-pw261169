/**
 * 核心数据模型：字节流分词、屏幕快照、表格抽取结果。
 * 所有坐标均为「屏幕格子」列号（宽字符占 2 列），不是 JS 字符串下标。
 */

/** 原始字节流中的字节区间（全局偏移，单位 byte）。 */
export interface ByteRange {
  start: number;
  end: number;
  /** 所属读取批次（push 序号），用于回溯是哪一次读取产生的。 */
  chunkId: number;
}

export type TokenType = 'text' | 'c0' | 'c1' | 'esc' | 'csi' | 'osc' | 'dcs' | 'apc' | 'pm' | 'sos' | 'invalid';

export interface StreamToken {
  type: TokenType;
  /** 该片段解码后的文本（text 类型为可见字符；序列类型为原始字符串）。 */
  raw: string;
  /** 未经解码的原始字节（UTF-8 保留原样）。 */
  bytes: Uint8Array;
  range: ByteRange;
  /** 序列参数（仅 csi/dcs 有值），保留 subparams 结构。 */
  params?: (number | number[])[];
  /** 私有标记前缀，如 '?'、'>'、'='，普通序列为 undefined。 */
  prefix?: string;
  /** 中间字节，如 '('。 */
  intermediates?: string;
  /** 终止字节，如 'm'、'H'。 */
  final?: string;
  /** OSC 编号。 */
  oscCode?: number;
  /** 同序列内被判定为不支持的参数（如 SGR 中出现未知码）。 */
  unsupportedParams?: number[];
}

/** 工具明确支持的 ANSI 操作目录条目。 */
export interface CatalogEntry {
  kind: 'C0' | 'CSI' | 'ESC' | 'OSC' | 'DCS';
  /** 人类可读的序列形态，如 "CSI <n> A"、"ESC ["。 */
  notation: string;
  name: string;
  effect: string;
  supported: boolean;
  /** CSI 私有标记（? > =）或终止字节。 */
  prefix?: string;
  final?: string;
}

/** 遇到不支持的控制序列时产生的影响标注（绝不静默丢弃）。 */
export interface UnsupportedNote {
  id: number;
  range: ByteRange;
  /** 原始序列的可打印形态，如 "ESC [ ? 25 h"。 */
  sequence: string;
  kind: TokenType;
  reason: string;
  /** 该序列可能造成的终端影响，供人工判断。 */
  impact: string;
  /** 同时仍被送入屏幕模拟器执行（true 表示画面可能已变化）。 */
  stillApplied: boolean;
}

/** 单个屏幕格子的溯源信息。 */
export interface CellMeta {
  /** 写入该格子的片段字节区间。 */
  range: ByteRange;
  /** 产生该写入的 token 类型。 */
  tokenType: TokenType;
  /** 最近一次内容变化的逻辑序号（每次 push 自增）。 */
  updateSeq: number;
}

export interface ScreenCell {
  char: string;
  width: 1 | 2 | 0;
  bgFgKey: string;
  meta: CellMeta | null;
}

export interface ScreenSnapshot {
  cols: number;
  rows: number;
  /** 每行一个字符串（按格子拼接，宽字符占位由 xterm 保证）。 */
  lines: string[];
  /** 与 lines 对齐的格子级溯源信息。 */
  grid: (ScreenCell | null)[][];
  bufferType: 'normal' | 'alternate';
  cursorX: number;
  cursorY: number;
  /** 累计接收字节数。 */
  bytesReceived: number;
  /** 逻辑序号。 */
  seq: number;
}

export interface ColumnDef {
  name: string;
  /** 列起始格子列号。 */
  start: number;
  /** 列结束格子列号（不含）。 */
  end: number;
}

export interface ExtractedRow {
  /** 屏幕行号（0 起）。 */
  screenRow: number;
  /** 字段名 -> 文本值。 */
  fields: Record<string, string>;
  /** 每个字段占据的格子区间。 */
  fieldCells: Record<string, { x: number; y: number; width: number }>;
  /** 整行涉及的溯源片段（去重后）。 */
  fragments: ByteRange[];
}

export type ScreenMode = 'table' | 'help' | 'unknown';

export interface TableExtraction {
  mode: ScreenMode;
  /** 模式判定依据（屏幕上找到的特征文本）。 */
  modeReason: string;
  /** 表头所在屏幕行；未确认表头时为 null，此时不抽取数据。 */
  headerRow: number | null;
  headerConfirmed: boolean;
  columns: ColumnDef[];
  rows: ExtractedRow[]
  /** 帮助页期间暂停抽取的标记。 */
  suspended: boolean;
}

/** 按主键合并后的设备记录。 */
export interface DeviceRecord {
  id: string;
  latest: Record<string, string>;
  firstSeenSeq: number;
  lastUpdateSeq: number;
  updates: number;
}

/** 一次输出片段（用于「形成格子的输出片段」面板与下载）。 */
export interface FragmentInfo {
  range: ByteRange;
  tokenType: TokenType;
  /** 可打印形态：文本直接展示，控制序列转义展示。 */
  preview: string;
  hex: string;
  length: number;
}

export interface PipelineResult {
  snapshot: ScreenSnapshot;
  extraction: TableExtraction;
  notes: UnsupportedNote[];
  records: DeviceRecord[];
}
