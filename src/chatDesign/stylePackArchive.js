// Small, action-only ZIP adapter for .uibedazzler-pack archives.

export const STYLE_PACK_EXTENSION = '.uibedazzler-pack';
export const STYLE_PACK_MIME = 'application/vnd.uibedazzler.style-pack+zip';

const MAX_ARCHIVE_BYTES = 64 * 1024 * 1024;
const MAX_ENTRY_BYTES = 8 * 1024 * 1024;
const MAX_TOTAL_BYTES = 64 * 1024 * 1024;
const MAX_ENTRIES = 64;
const MAX_NAME_BYTES = 240;
const PACK_JSON = 'pack.json';
const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder('utf-8', { fatal: true });
let crcTable = null;

function getCrcTable() {
    if (crcTable) return crcTable;
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
        let value = n;
        for (let bit = 0; bit < 8; bit++) value = (value & 1) ? (0xEDB88320 ^ (value >>> 1)) : (value >>> 1);
        crcTable[n] = value >>> 0;
    }
    return crcTable;
}

function crc32(bytes) {
    const table = getCrcTable();
    let crc = 0xFFFFFFFF;
    for (const byte of bytes) crc = table[(crc ^ byte) & 0xFF] ^ (crc >>> 8);
    return (crc ^ 0xFFFFFFFF) >>> 0;
}

function asBytes(value) {
    if (value instanceof Uint8Array) return value;
    if (value instanceof ArrayBuffer) return new Uint8Array(value);
    if (typeof value === 'string') return textEncoder.encode(value);
    throw new TypeError('Archive entries must be strings, ArrayBuffers, or Uint8Arrays.');
}

export function normalizeArchivePath(value) {
    const path = String(value || '').replace(/\\/g, '/').replace(/^\.\//, '');
    const segments = path.split('/');
    if (!path || path.startsWith('/') || path.includes(':') || segments.some(part => !part || part === '.' || part === '..')) {
        throw new Error(`Unsafe archive path: ${value || '(empty)'}`);
    }
    const encoded = textEncoder.encode(path);
    if (encoded.length > MAX_NAME_BYTES) throw new Error(`Archive path is too long: ${path}`);
    return path;
}

function dosTimestamp(date = new Date()) {
    const year = Math.min(2107, Math.max(1980, date.getFullYear()));
    return {
        time: ((date.getHours() & 0x1F) << 11) | ((date.getMinutes() & 0x3F) << 5) | ((date.getSeconds() / 2) & 0x1F),
        date: ((year - 1980) << 9) | (((date.getMonth() + 1) & 0x0F) << 5) | (date.getDate() & 0x1F),
    };
}

function concatBytes(parts) {
    const length = parts.reduce((sum, part) => sum + part.length, 0);
    const result = new Uint8Array(length);
    let offset = 0;
    for (const part of parts) {
        result.set(part, offset);
        offset += part.length;
    }
    return result;
}

function localHeader(name, bytes, crc, stamp) {
    const header = new Uint8Array(30 + name.length);
    const view = new DataView(header.buffer);
    view.setUint32(0, 0x04034B50, true);
    view.setUint16(4, 20, true);
    view.setUint16(6, 0x0800, true);
    view.setUint16(8, 0, true);
    view.setUint16(10, stamp.time, true);
    view.setUint16(12, stamp.date, true);
    view.setUint32(14, crc, true);
    view.setUint32(18, bytes.length, true);
    view.setUint32(22, bytes.length, true);
    view.setUint16(26, name.length, true);
    view.setUint16(28, 0, true);
    header.set(name, 30);
    return header;
}

function centralHeader(name, bytes, crc, stamp, offset) {
    const header = new Uint8Array(46 + name.length);
    const view = new DataView(header.buffer);
    view.setUint32(0, 0x02014B50, true);
    view.setUint16(4, 20, true);
    view.setUint16(6, 20, true);
    view.setUint16(8, 0x0800, true);
    view.setUint16(10, 0, true);
    view.setUint16(12, stamp.time, true);
    view.setUint16(14, stamp.date, true);
    view.setUint32(16, crc, true);
    view.setUint32(20, bytes.length, true);
    view.setUint32(24, bytes.length, true);
    view.setUint16(28, name.length, true);
    view.setUint16(30, 0, true);
    view.setUint16(32, 0, true);
    view.setUint16(34, 0, true);
    view.setUint16(36, 0, true);
    view.setUint32(38, 0, true);
    view.setUint32(42, offset, true);
    header.set(name, 46);
    return header;
}

/** Build a standards-compliant, uncompressed ZIP. Work only happens when called. */
export function createStylePackArchive(manifest, files = []) {
    const entries = [{ path: PACK_JSON, data: `${JSON.stringify(manifest, null, 2)}\n` }, ...files];
    if (entries.length > MAX_ENTRIES) throw new Error(`A Style Pack may contain at most ${MAX_ENTRIES} files.`);

    const seen = new Set();
    const normalized = entries.map(entry => {
        const path = normalizeArchivePath(entry.path);
        if (seen.has(path.toLowerCase())) throw new Error(`Duplicate archive entry: ${path}`);
        seen.add(path.toLowerCase());
        const bytes = asBytes(entry.data);
        if (bytes.length > MAX_ENTRY_BYTES) throw new Error(`Archive entry is too large: ${path}`);
        return { path, name: textEncoder.encode(path), bytes, crc: crc32(bytes) };
    });
    const totalBytes = normalized.reduce((sum, entry) => sum + entry.bytes.length, 0);
    if (totalBytes > MAX_TOTAL_BYTES) throw new Error('Style Pack contents are too large.');

    const stamp = dosTimestamp();
    const localParts = [];
    const centralParts = [];
    let offset = 0;
    for (const entry of normalized) {
        const header = localHeader(entry.name, entry.bytes, entry.crc, stamp);
        localParts.push(header, entry.bytes);
        centralParts.push(centralHeader(entry.name, entry.bytes, entry.crc, stamp, offset));
        offset += header.length + entry.bytes.length;
    }
    const central = concatBytes(centralParts);
    const end = new Uint8Array(22);
    const endView = new DataView(end.buffer);
    endView.setUint32(0, 0x06054B50, true);
    endView.setUint16(8, normalized.length, true);
    endView.setUint16(10, normalized.length, true);
    endView.setUint32(12, central.length, true);
    endView.setUint32(16, offset, true);
    return new Blob([...localParts, central, end], { type: STYLE_PACK_MIME });
}

function findEndOfCentralDirectory(bytes) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const floor = Math.max(0, bytes.length - 65_557);
    for (let offset = bytes.length - 22; offset >= floor; offset--) {
        if (view.getUint32(offset, true) === 0x06054B50) return offset;
    }
    throw new Error('This is not a readable ZIP archive.');
}

async function inflateRaw(bytes, expectedSize) {
    if (typeof DecompressionStream !== 'function') throw new Error('Compressed ZIP entries are not supported by this browser.');
    let stream;
    try {
        stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    } catch {
        throw new Error('Compressed ZIP entries are not supported by this browser.');
    }
    const result = new Uint8Array(await new Response(stream).arrayBuffer());
    if (result.length !== expectedSize) throw new Error('A compressed archive entry has an invalid size.');
    return result;
}

/** Read and validate an uploaded Style Pack archive without extracting to disk. */
export async function readStylePackArchive(file) {
    if (!file || typeof file.arrayBuffer !== 'function') throw new TypeError('Choose a .uibedazzler-pack file.');
    if (file.size > MAX_ARCHIVE_BYTES) throw new Error('That Style Pack archive is too large.');
    const bytes = new Uint8Array(await file.arrayBuffer());
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const endOffset = findEndOfCentralDirectory(bytes);
    const disk = view.getUint16(endOffset + 4, true);
    const centralDisk = view.getUint16(endOffset + 6, true);
    const entryCount = view.getUint16(endOffset + 10, true);
    const centralSize = view.getUint32(endOffset + 12, true);
    const centralOffset = view.getUint32(endOffset + 16, true);
    if (disk !== 0 || centralDisk !== 0) throw new Error('Multi-part ZIP archives are not supported.');
    if (!entryCount || entryCount > MAX_ENTRIES) throw new Error('The Style Pack has an invalid number of files.');
    if (centralOffset + centralSize > endOffset) throw new Error('The ZIP directory is invalid.');

    const records = [];
    const seen = new Set();
    let totalSize = 0;
    let cursor = centralOffset;
    for (let index = 0; index < entryCount; index++) {
        if (cursor + 46 > bytes.length || view.getUint32(cursor, true) !== 0x02014B50) throw new Error('The ZIP directory is malformed.');
        const flags = view.getUint16(cursor + 8, true);
        const method = view.getUint16(cursor + 10, true);
        const crc = view.getUint32(cursor + 16, true);
        const compressedSize = view.getUint32(cursor + 20, true);
        const size = view.getUint32(cursor + 24, true);
        const nameLength = view.getUint16(cursor + 28, true);
        const extraLength = view.getUint16(cursor + 30, true);
        const commentLength = view.getUint16(cursor + 32, true);
        const localOffset = view.getUint32(cursor + 42, true);
        if (flags & 0x0001) throw new Error('Encrypted ZIP entries are not supported.');
        if (method !== 0 && method !== 8) throw new Error('The ZIP uses an unsupported compression method.');
        if (size > MAX_ENTRY_BYTES || compressedSize > MAX_ENTRY_BYTES) throw new Error('A Style Pack file is too large.');
        const nameEnd = cursor + 46 + nameLength;
        if (nameEnd > bytes.length) throw new Error('The ZIP contains an invalid filename.');
        const path = normalizeArchivePath(textDecoder.decode(bytes.subarray(cursor + 46, nameEnd)));
        if (seen.has(path.toLowerCase())) throw new Error(`Duplicate archive entry: ${path}`);
        seen.add(path.toLowerCase());
        totalSize += size;
        if (totalSize > MAX_TOTAL_BYTES) throw new Error('The expanded Style Pack is too large.');
        records.push({ path, flags, method, crc, compressedSize, size, localOffset });
        cursor = nameEnd + extraLength + commentLength;
    }

    const entries = new Map();
    for (const record of records) {
        const offset = record.localOffset;
        if (offset + 30 > bytes.length || view.getUint32(offset, true) !== 0x04034B50) throw new Error(`Missing ZIP entry: ${record.path}`);
        const localNameLength = view.getUint16(offset + 26, true);
        const localExtraLength = view.getUint16(offset + 28, true);
        const dataOffset = offset + 30 + localNameLength + localExtraLength;
        const dataEnd = dataOffset + record.compressedSize;
        if (dataEnd > bytes.length) throw new Error(`Truncated ZIP entry: ${record.path}`);
        const compressed = bytes.subarray(dataOffset, dataEnd);
        const data = record.method === 0 ? new Uint8Array(compressed) : await inflateRaw(compressed, record.size);
        if (data.length !== record.size || crc32(data) !== record.crc) throw new Error(`Corrupt ZIP entry: ${record.path}`);
        entries.set(record.path, data);
    }

    const manifestBytes = entries.get(PACK_JSON);
    if (!manifestBytes) throw new Error('The archive is missing pack.json.');
    let manifest;
    try {
        manifest = JSON.parse(textDecoder.decode(manifestBytes));
    } catch {
        throw new Error('pack.json is not valid UTF-8 JSON.');
    }
    return { manifest, entries };
}

export function downloadStylePack(blob, filename) {
    const clean = String(filename || 'Style-Pack')
        .replace(/[<>:"/\\|?*\u0000-\u001F]/g, '-')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 100) || 'Style-Pack';
    const href = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = href;
    anchor.download = clean.endsWith(STYLE_PACK_EXTENSION) ? clean : `${clean}${STYLE_PACK_EXTENSION}`;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(href), 30_000);
}
