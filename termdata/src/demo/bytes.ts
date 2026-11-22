/** 共享的字节流工具。 */

/**
 * 在 UTF-8 字符边界处刻意切断一个字节数组，模拟「一次读取只拿到半个中文」。
 * 返回的数组拼接后与输入完全一致。
 */
export function splitInsideUtf8(data: Uint8Array, maxChunk = 4): Uint8Array[] {
  const chunks: Uint8Array[] = [];
  let i = 0;
  while (i < data.length) {
    let size = 1 + Math.floor(Math.random() * maxChunk);
    size = Math.min(size, data.length - i);
    // 若切点落在多字节 UTF-8 中间，把切点退回到该字符的前导字节，
    // 由调用方决定是否要「切断」；这里默认在边界切，保证每片自身可解码。
    const lead = data[i]!;
    if (lead >= 0x80) {
      const seqLen = utf8Len(lead);
      size = Math.min(seqLen, data.length - i);
    }
    chunks.push(data.subarray(i, i + size));
    i += size;
  }
  return chunks;
}

/** 强制在多字节字符中间切断（制造真正的半字符读取）。 */
export function splitBreakingUtf8(data: Uint8Array): Uint8Array[] {
  const out: Uint8Array[] = [];
  let i = 0;
  while (i < data.length) {
    const b = data[i]!;
    const len = utf8Len(b);
    if (len >= 2 && i + len <= data.length && Math.random() < 0.6) {
      const cut = 1 + Math.floor(Math.random() * (len - 1)); // 1..len-1
      out.push(data.subarray(i, i + cut));
      out.push(data.subarray(i + cut, i + len));
      i += len;
    } else {
      const size = Math.min(1 + Math.floor(Math.random() * 5), data.length - i);
      out.push(data.subarray(i, i + size));
      i += size;
    }
  }
  return out;
}

export function utf8Len(lead: number): number {
  if (lead < 0x80) return 1;
  if ((lead & 0xe0) === 0xc0) return 2;
  if ((lead & 0xf0) === 0xe0) return 3;
  if ((lead & 0xf8) === 0xf0) return 4;
  return 1;
}

/** .tstream 帧格式：每帧 = 4 字节大端长度 + 载荷。 */
export function encodeFrame(payload: Uint8Array): Uint8Array {
  const header = new Uint8Array(4);
  new DataView(header.buffer).setUint32(0, payload.length, false);
  const out = new Uint8Array(header.length + payload.length);
  out.set(header, 0);
  out.set(payload, 4);
  return out;
}

export function* decodeFrames(buffer: Uint8Array): Generator<Uint8Array> {
  let offset = 0;
  const dv = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  while (offset + 4 <= buffer.length) {
    const len = dv.getUint32(offset, false);
    offset += 4;
    if (offset + len > buffer.length) {
      throw new Error(`损坏的 .tstream：第 ${offset} 帧声明 ${len} 字节但数据不足`);
    }
    yield buffer.subarray(offset, offset + len);
    offset += len;
  }
}

export function concatBytes(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((a, b) => a + b.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return out;
}
