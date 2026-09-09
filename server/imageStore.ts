import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

export const MAX_UPLOAD_BYTES = 6 * 1024 * 1024;

export type StoredImageType = { mime: string; extension: string };

// The mime a caller declares in a data URL is just text they typed. Only the leading
// bytes of the decoded buffer say what the file actually is, so the stored extension is
// derived from those and a mismatch is rejected outright.
const SIGNATURES: Array<{ type: StoredImageType; matches: (bytes: Buffer) => boolean }> = [
  { type: { mime: "image/png", extension: "png" }, matches: b => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  { type: { mime: "image/jpeg", extension: "jpg" }, matches: b => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { type: { mime: "image/gif", extension: "gif" }, matches: b => b.subarray(0, 6).toString("latin1").startsWith("GIF8") },
  { type: { mime: "image/webp", extension: "webp" }, matches: b => b.subarray(0, 4).toString("latin1") === "RIFF" && b.subarray(8, 12).toString("latin1") === "WEBP" },
];

export function detectImageType(bytes: Buffer): StoredImageType | undefined {
  if (bytes.length < 12) return undefined;
  return SIGNATURES.find(entry => entry.matches(bytes))?.type;
}

/** Reads intrinsic size from the header. Undefined rather than guessed when unreadable. */
export function imageDimensions(bytes: Buffer, type: StoredImageType): { width: number; height: number } | undefined {
  try {
    if (type.mime === "image/png") return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
    if (type.mime === "image/gif") return { width: bytes.readUInt16LE(6), height: bytes.readUInt16LE(8) };
    if (type.mime === "image/jpeg") {
      // Walk the segment chain to the frame header; only it carries the dimensions.
      let offset = 2;
      while (offset + 9 < bytes.length) {
        if (bytes[offset] !== 0xff) return undefined;
        const marker = bytes[offset + 1];
        const length = bytes.readUInt16BE(offset + 2);
        const isFrameHeader = marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker);
        if (isFrameHeader) return { height: bytes.readUInt16BE(offset + 5), width: bytes.readUInt16BE(offset + 7) };
        offset += 2 + length;
      }
    }
  } catch {
    return undefined;
  }
  return undefined;
}

const DATA_URL = /^data:([a-z0-9.+/-]+);base64,([A-Za-z0-9+/=\s]+)$/i;

export type DecodedUpload = { bytes: Buffer; type: StoredImageType; sha256: string; dimensions?: { width: number; height: number } };
export type DecodeFailure = { error: "not_a_data_url" | "too_large" | "unsupported_type" | "malformed_base64" };

export function decodeImageDataUrl(value: unknown): DecodedUpload | DecodeFailure {
  if (typeof value !== "string") return { error: "not_a_data_url" };
  const match = DATA_URL.exec(value.trim());
  if (!match) return { error: "not_a_data_url" };
  // Reject on the encoded length first: decoding a huge string just to measure it is
  // the memory spike an upload cap is supposed to prevent.
  if (match[2].length > Math.ceil(MAX_UPLOAD_BYTES / 3) * 4) return { error: "too_large" };
  let bytes: Buffer;
  try {
    bytes = Buffer.from(match[2], "base64");
  } catch {
    return { error: "malformed_base64" };
  }
  if (!bytes.length) return { error: "malformed_base64" };
  if (bytes.length > MAX_UPLOAD_BYTES) return { error: "too_large" };
  const type = detectImageType(bytes);
  if (!type) return { error: "unsupported_type" };
  return { bytes, type, sha256: createHash("sha256").update(bytes).digest("hex"), dimensions: imageDimensions(bytes, type) };
}

export function uploadDirectory() {
  return path.resolve(process.env.CF_UPLOAD_DIR || path.join(process.cwd(), ".data", "uploads"));
}

// Content-addressed: the name is the hash of the bytes, so no caller-supplied string
// ever reaches the filesystem and identical uploads collapse onto one file.
export function storedFileName(sha256: string, type: StoredImageType) {
  if (!/^[a-f0-9]{64}$/.test(sha256)) throw new Error("Refusing to build a path from a non-digest name.");
  return `${sha256}.${type.extension}`;
}

export async function saveImage(upload: DecodedUpload) {
  const directory = uploadDirectory();
  await mkdir(directory, { recursive: true });
  const file = path.join(directory, storedFileName(upload.sha256, upload.type));
  await writeFile(file, upload.bytes, { flag: "w" });
  return file;
}

export async function readStoredImage(sha256: string, extension: string) {
  const type = SIGNATURES.find(entry => entry.type.extension === extension)?.type;
  if (!type) return undefined;
  try {
    return { bytes: await readFile(path.join(uploadDirectory(), storedFileName(sha256, type))), type };
  } catch {
    return undefined;
  }
}

export function toDataUrl(bytes: Buffer, type: StoredImageType) {
  return `data:${type.mime};base64,${bytes.toString("base64")}`;
}
