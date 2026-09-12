/**
 * Records how the TypeScript store identified and measured image bytes.
 *
 *   npx tsx api/scripts/capture_image_bytes_golden.mjs
 *
 * Type sniffing and header parsing are where a "reasonable" Python rewrite silently
 * accepts or rejects something the Node server did not — and the sniffed type decides the
 * stored filename and the Content-Type it is later served with.
 */
import { writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { decodeImageDataUrl, detectImageType, imageDimensions, MAX_UPLOAD_BYTES } from "../../server/imageStore.ts";

/** Minimal but structurally real files, built by hand so every header field is known. */
function png(width, height) {
  const header = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(17);
  ihdr.write("IHDR", 0, "latin1");
  ihdr.writeUInt32BE(width, 4);
  ihdr.writeUInt32BE(height, 8);
  return Buffer.concat([header, Buffer.alloc(4), ihdr]);
}

function gif(width, height) {
  const bytes = Buffer.alloc(16);
  bytes.write("GIF89a", 0, "latin1");
  bytes.writeUInt16LE(width, 6);
  bytes.writeUInt16LE(height, 8);
  return bytes;
}

function jpeg(width, height, { marker = 0xc0, preamble = [] } = {}) {
  const parts = [Buffer.from([0xff, 0xd8])];
  for (const [segMarker, length] of preamble) {
    const segment = Buffer.alloc(2 + length);
    segment.writeUInt8(0xff, 0);
    segment.writeUInt8(segMarker, 1);
    segment.writeUInt16BE(length, 2);
    parts.push(segment);
  }
  const frame = Buffer.alloc(11);
  frame.writeUInt8(0xff, 0);
  frame.writeUInt8(marker, 1);
  frame.writeUInt16BE(8, 2);
  frame.writeUInt8(8, 4);
  frame.writeUInt16BE(height, 5);
  frame.writeUInt16BE(width, 7);
  parts.push(frame, Buffer.alloc(16));
  return Buffer.concat(parts);
}

function webp(size = 32) {
  const bytes = Buffer.alloc(size);
  bytes.write("RIFF", 0, "latin1");
  bytes.write("WEBP", 8, "latin1");
  return bytes;
}

const SAMPLES = [
  ["png 275x183", png(275, 183)],
  ["png 1x1", png(1, 1)],
  ["png huge dims", png(65535, 65535)],
  ["gif 320x240", gif(320, 240)],
  ["gif 1x1", gif(1, 1)],
  ["jpeg 640x480 sof0", jpeg(640, 480)],
  ["jpeg sof2 progressive", jpeg(800, 600, { marker: 0xc2 })],
  ["jpeg after app0", jpeg(100, 50, { preamble: [[0xe0, 16]] })],
  ["jpeg after two segments", jpeg(24, 36, { preamble: [[0xe0, 16], [0xdb, 67]] })],
  ["jpeg with c4 huffman first", jpeg(48, 64, { preamble: [[0xc4, 20]] })],
  ["jpeg truncated before frame", Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 1, 2, 3, 4, 5, 6, 7, 8])],
  ["jpeg zero length segment", Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x00]), jpeg(12, 14).subarray(2)])],
  ["webp", webp()],
  ["too short", Buffer.from([0x89, 0x50, 0x4e, 0x47])],
  ["eleven bytes", Buffer.alloc(11, 0xff)],
  ["bmp not supported", Buffer.concat([Buffer.from("BM", "latin1"), Buffer.alloc(30)])],
  ["svg text not supported", Buffer.from("<svg xmlns='x'></svg>                ", "latin1")],
  ["zeros", Buffer.alloc(32)],
];

const sniffing = SAMPLES.map(([name, bytes]) => {
  const type = detectImageType(bytes);
  return {
    name,
    base64: bytes.toString("base64"),
    type: type ?? null,
    dimensions: type ? (imageDimensions(bytes, type) ?? null) : null,
  };
});

const png275 = png(275, 183).toString("base64");
const DECODE_CASES = [
  ["valid png", `data:image/png;base64,${png275}`],
  ["declared jpeg but png bytes", `data:image/jpeg;base64,${png275}`],
  ["declared svg but png bytes", `data:image/svg+xml;base64,${png275}`],
  ["uppercase scheme", `DATA:IMAGE/PNG;BASE64,${png275}`],
  ["surrounded by whitespace", `   data:image/png;base64,${png275}   `],
  ["newlines inside payload", `data:image/png;base64,${png275.slice(0, 8)}\n${png275.slice(8)}`],
  ["not a data url", "https://example.test/a.png"],
  ["url encoded not base64", "data:image/svg+xml,<svg/>"],
  ["empty payload", "data:image/png;base64,"],
  ["only padding", "data:image/png;base64,===="],
  ["unsupported bytes", `data:image/png;base64,${Buffer.alloc(32).toString("base64")}`],
  ["bmp bytes", `data:image/bmp;base64,${Buffer.concat([Buffer.from("BM", "latin1"), Buffer.alloc(30)]).toString("base64")}`],
  ["oversized encoded", `data:image/png;base64,${"A".repeat(Math.ceil(MAX_UPLOAD_BYTES / 3) * 4 + 4)}`],
  ["non-string", 12345],
  ["null", null],
];

const decoding = DECODE_CASES.map(([name, input]) => {
  const result = decodeImageDataUrl(input);
  return {
    name,
    input: typeof input === "string" ? input : null,
    inputKind: typeof input,
    output: "error" in result
      ? { error: result.error }
      : { type: result.type, sha256: result.sha256, byteLength: result.bytes.length, dimensions: result.dimensions ?? null },
  };
});

const out = path.resolve(import.meta.dirname, "..", "tests", "fixtures", "image_bytes_golden.json");
mkdirSync(path.dirname(out), { recursive: true });
writeFileSync(out, `${JSON.stringify({ maxUploadBytes: MAX_UPLOAD_BYTES, sniffing, decoding }, null, 2)}\n`, "utf8");
console.log(`wrote ${sniffing.length} sniff cases and ${decoding.length} decode cases -> ${out}`);
