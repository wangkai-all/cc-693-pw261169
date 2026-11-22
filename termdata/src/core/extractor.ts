import type {
  ColumnDef,
  DeviceRecord,
  ExtractedRow,
  ScreenSnapshot,
  TableExtraction,
} from './types.js';

const HEADER_KEYWORDS = ['设备ID', '名称', '状态', '温度', '湿度', '电压', '更新时间'];
const HELP_KEYWORDS = ['帮助', '操作说明', 'HELP'];
const ROW_ID_PATTERN = /^DEV-\d{3,}/;
const MIN_COLUMNS = 3;

interface Segment {
  text: string;
  start: number;
  end: number; // 不含
}

/**
 * 表格提取器。
 *
 * 设计要点：
 * - 一切定位以「格子列」为准：中文宽字符占 2 列，直接用快照 grid 的 width 信息，
 *   不使用 JS 字符串下标（字符串下标会把宽字符算成 1）；
 * - 必须先在当前屏幕重新确认表头，才会输出数据行；
 * - 帮助页期间进入 suspended 状态、暂停提取；从帮助页返回后要求再次看到表头才恢复；
 * - 同一块区域的原地刷新不会产生「新增记录」，每次输出的是当前屏幕上的行。
 */
export class TableExtractor {
  private suspended = false;

  reset(): void {
    this.suspended = false;
  }

  extract(snap: ScreenSnapshot): TableExtraction {
    const mode = this.detectMode(snap);

    if (mode === 'help') {
      this.suspended = true;
      return {
        mode,
        modeReason: '屏幕出现帮助页特征文本，暂停表格提取',
        headerRow: null,
        headerConfirmed: false,
        columns: [],
        rows: [],
        suspended: true,
      };
    }

    if (mode === 'unknown') {
      return {
        mode,
        modeReason: this.suspended
          ? '帮助页已退出，但当前屏幕尚未重新出现表头，继续暂停'
          : '当前屏幕未识别到表头，不进行数据抽取',
        headerRow: null,
        headerConfirmed: false,
        columns: [],
        rows: [],
        suspended: this.suspended,
      };
    }

    // mode === 'table'
    const header = this.findHeader(snap);
    if (!header) {
      return {
        mode: 'unknown',
        modeReason: '未找到包含完整列名的表头行',
        headerRow: null,
        headerConfirmed: false,
        columns: [],
        rows: [],
        suspended: this.suspended,
      };
    }

    // 帮助页后重新确认到表头 → 恢复提取。
    if (this.suspended) {
      this.suspended = false;
    }

    const rows: ExtractedRow[] = [];
    for (let y = header.row + 1; y < snap.rows; y++) {
      const firstText = this.rowSlice(snap, y, 0, snap.cols).trim();
      if (!firstText) continue;
      if (!ROW_ID_PATTERN.test(firstText)) continue;
      const fields: Record<string, string> = {};
      const fieldCells: ExtractedRow['fieldCells'] = {};
      const fragmentKeys = new Set<string>();
      const fragments = [];
      for (const col of header.columns) {
        const value = this.rowSlice(snap, y, col.start, col.end).trim();
        fields[col.name] = value;
        fieldCells[col.name] = { x: col.start, y, width: col.end - col.start };
        for (let x = col.start; x < col.end; x++) {
          const meta = snap.grid[y]?.[x]?.meta;
          if (!meta) continue;
          const key = `${meta.range.chunkId}:${meta.range.start}:${meta.range.end}`;
          if (!fragmentKeys.has(key)) {
            fragmentKeys.add(key);
            fragments.push(meta.range);
          }
        }
      }
      rows.push({ screenRow: y, fields, fieldCells, fragments });
    }

    return {
      mode: 'table',
      modeReason: `在第 ${header.row + 1} 行确认表头，共 ${header.columns.length} 列`,
      headerRow: header.row,
      headerConfirmed: true,
      columns: header.columns,
      rows,
      suspended: false,
    };
  }

  private detectMode(snap: ScreenSnapshot): 'table' | 'help' | 'unknown' {
    let hasHelp = false;
    let hasHeaderKeyword = 0;
    for (const row of snap.grid) {
      const text = rowToText(row);
      for (const k of HELP_KEYWORDS) {
        if (text.includes(k)) hasHelp = true;
      }
      for (const k of HEADER_KEYWORDS) {
        if (text.includes(k)) hasHeaderKeyword += 1;
      }
    }
    // 表格页脚的操作提示也含「帮助」字样，因此表头特征优先，
    // 只有在缺少表头特征时才把帮助关键词判为帮助页。
    if (hasHeaderKeyword >= MIN_COLUMNS) return 'table';
    if (hasHelp) return 'help';
    return 'unknown';
  }

  private findHeader(snap: ScreenSnapshot): { row: number; columns: ColumnDef[] } | null {
    for (let y = 0; y < snap.rows; y++) {
      const segments = this.segmentRow(snap, y);
      // 表头列名允许带单位后缀（如「温度℃」「湿度%」），按关键词前缀匹配。
      const matched = segments
        .map((seg) => ({ seg, keyword: HEADER_KEYWORDS.find((k) => seg.text === k || seg.text.startsWith(k)) }))
        .filter((x): x is { seg: Segment; keyword: string } => Boolean(x.keyword))
        .map(({ seg, keyword }) => ({ seg, name: keyword }));
      if (matched.length >= MIN_COLUMNS && matched.some((m) => m.name === '设备ID')) {
        // 列边界延伸到下一列起点：表头文字通常短于定宽字段，
        // 不能用表头段自身的 end 去切数据行，否则会截断数值。
        const columns: ColumnDef[] = matched.map((m, i) => {
          const next = matched[i + 1];
          return {
            name: m.name,
            start: m.seg.start,
            end: next ? next.seg.start : snap.cols,
          };
        });
        return { row: y, columns };
      }
    }
    return null;
  }

  /** 按连续空格切分一行，分段坐标为格子列。宽字符尾格（width=0）不是边界。 */
  private segmentRow(snap: ScreenSnapshot, y: number): Segment[] {
    const segments: Segment[] = [];
    let start = -1;
    for (let x = 0; x <= snap.cols; x++) {
      const cell = x < snap.cols ? snap.grid[y]?.[x] : undefined;
      const isSpace = !cell || cell.width === 0 ? false : cell.char === ' ' || cell.char === '';
      if (!isSpace && start === -1) {
        start = x;
      } else if (isSpace && start !== -1) {
        const text = this.rowSlice(snap, y, start, x).trim();
        if (text) segments.push({ text, start, end: x });
        start = -1;
      }
    }
    return segments;
  }

  /** 取一行 [start, end) 格子列的可见文本（跳过宽字符的尾格 width=0）。 */
  private rowSlice(snap: ScreenSnapshot, y: number, start: number, end: number): string {
    let out = '';
    for (let x = start; x < end && x < snap.cols; x++) {
      const cell = snap.grid[y]?.[x];
      if (!cell) {
        out += ' ';
        continue;
      }
      if (cell.width === 0) continue;
      out += cell.char || ' ';
    }
    return out;
  }
}

function rowToText(row: (ScreenSnapshot['grid'][number][number])[]): string {
  let out = '';
  for (const cell of row) {
    if (!cell) {
      out += ' ';
      continue;
    }
    if (cell.width === 0) continue;
    out += cell.char === '' ? ' ' : cell.char;
  }
  return out;
}

/** 按设备 ID 合并各帧抽取结果，保留最新值与更新次数。 */
export class RecordStore {
  private readonly map = new Map<string, DeviceRecord>();

  upsert(row: ExtractedRow, seq: number): DeviceRecord {
    const id = row.fields['设备ID'] ?? '';
    const existing = this.map.get(id);
    if (!existing) {
      const rec: DeviceRecord = {
        id,
        latest: { ...row.fields },
        firstSeenSeq: seq,
        lastUpdateSeq: seq,
        updates: 1,
      };
      this.map.set(id, rec);
      return rec;
    }
    existing.latest = { ...row.fields };
    existing.lastUpdateSeq = seq;
    existing.updates += 1;
    return existing;
  }

  all(): DeviceRecord[] {
    return [...this.map.values()].sort((a, b) => a.id.localeCompare(b.id));
  }

  clear(): void {
    this.map.clear();
  }
}
