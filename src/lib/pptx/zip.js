// Minimal ZIP reader for OOXML packages (.pptx/.odp are zip containers).
// Uses pako for raw inflate; no dependency on Node's zlib so it also runs in the browser.

// pako 2.x resolves to its ESM build here, so this works in the browser and Node.
import { inflateRaw } from 'pako';

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const LOCAL_SIGNATURE = 0x04034b50;

function findEndOfCentralDirectory(view) {
  const minimum = Math.max(0, view.byteLength - 22 - 0xffff);
  for (let offset = view.byteLength - 22; offset >= minimum; offset -= 1) {
    if (view.getUint32(offset, true) === EOCD_SIGNATURE) return offset;
  }
  throw new Error('不是有效的 PPTX/ZIP 文件（缺少中央目录）');
}

const decoder = new TextDecoder('utf-8');

export function unzip(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const eocd = findEndOfCentralDirectory(view);
  const count = view.getUint16(eocd + 10, true);
  let pointer = view.getUint32(eocd + 16, true);

  const files = new Map();
  for (let index = 0; index < count; index += 1) {
    if (view.getUint32(pointer, true) !== CENTRAL_SIGNATURE) break;
    const method = view.getUint16(pointer + 10, true);
    const compressedSize = view.getUint32(pointer + 20, true);
    const nameLength = view.getUint16(pointer + 28, true);
    const extraLength = view.getUint16(pointer + 30, true);
    const commentLength = view.getUint16(pointer + 32, true);
    const localOffset = view.getUint32(pointer + 42, true);
    const name = decoder.decode(bytes.subarray(pointer + 46, pointer + 46 + nameLength));
    pointer += 46 + nameLength + extraLength + commentLength;

    if (name.endsWith('/')) continue;
    if (view.getUint32(localOffset, true) !== LOCAL_SIGNATURE) continue;
    const localNameLength = view.getUint16(localOffset + 26, true);
    const localExtraLength = view.getUint16(localOffset + 28, true);
    const dataStart = localOffset + 30 + localNameLength + localExtraLength;
    const data = bytes.subarray(dataStart, dataStart + compressedSize);
    files.set(name, { method, data });
  }

  return {
    names: [...files.keys()],
    has: (name) => files.has(name),
    bytes(name) {
      const entry = files.get(name);
      if (!entry) return null;
      if (entry.method === 0) return entry.data;
      if (entry.method !== 8) throw new Error(`不支持的压缩方式：${entry.method}`);
      return inflateRaw(entry.data);
    },
    text(name) {
      const data = this.bytes(name);
      return data ? decoder.decode(data) : null;
    },
  };
}
