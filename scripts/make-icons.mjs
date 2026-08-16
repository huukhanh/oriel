#!/usr/bin/env node
/**
 * Draw the app mark and write it out as PNG at every size the extension and the
 * iOS app need.
 *
 * There is no image tooling on this box — no ImageMagick, no PIL, no rasteriser
 * — so the mark is defined as signed-distance fields and encoded to PNG with
 * `zlib`, which Node has. That sounds like a stunt, and the alternative was
 * committing binaries nobody in the project could regenerate or explain.
 * Sixty lines of maths is the cheaper liability.
 *
 * The mark: two overlapping rounded rectangles. The outlined one is the site as
 * its owners built it; the solid one is the skin laid over it. It reads at
 * 16 pixels, which is the only real constraint on a favicon.
 *
 * Usage: node scripts/make-icons.mjs
 */
import { deflateSync } from "node:zlib";
import { writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

/** Distance from a point to a rounded rectangle. Negative inside. */
function roundedRect(px, py, cx, cy, halfW, halfH, radius) {
    const dx = Math.abs(px - cx) - (halfW - radius);
    const dy = Math.abs(py - cy) - (halfH - radius);
    const outside = Math.hypot(Math.max(dx, 0), Math.max(dy, 0));
    return outside + Math.min(Math.max(dx, dy), 0) - radius;
}

/** Anti-aliased coverage for a distance field, one pixel of feather. */
function coverage(distance, feather) {
    return Math.min(1, Math.max(0, 0.5 - distance / feather));
}

function mix(a, b, t) {
    return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

function over(under, layer, alpha) {
    return mix(under, layer, alpha);
}

const TOP = [124, 92, 255];
const BOTTOM = [56, 189, 248];
const INK = [255, 255, 255];

/**
 * @param {number} size
 * @param {boolean} opaque  iOS rejects an app icon that has an alpha channel,
 *   and applies its own corner mask, so that one is drawn full-bleed and solid.
 *   Everything else keeps its own rounded tile, because a browser toolbar puts
 *   the icon on whatever colour it likes.
 */
function render(size, opaque) {
    const feather = Math.max(1, size / 24);
    const pixels = Buffer.alloc(size * size * 4);

    for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
            const px = x + 0.5;
            const py = y + 0.5;

            // The tile itself. Extension toolbars and iOS both round the corners
            // for us, but a shape that is already round survives either.
            const tile = roundedRect(px, py, size / 2, size / 2, size / 2, size / 2, size * 0.22);
            const tileAlpha = opaque ? 1 : coverage(tile, feather);

            let colour = mix(TOP, BOTTOM, y / size);

            // The site: an outline, because it is what is already there.
            const siteCentre = size * 0.40;
            const site = roundedRect(px, py, siteCentre, siteCentre, size * 0.21, size * 0.21, size * 0.06);
            const siteRing = Math.abs(site) - size * 0.035;
            colour = over(colour, INK, coverage(siteRing, feather) * 0.92);

            // The skin: solid, laid over the site and offset, with a gap punched
            // through the outline beneath so the two read as separate layers
            // rather than one muddled shape.
            const skinCentre = size * 0.60;
            const skin = roundedRect(px, py, skinCentre, skinCentre, size * 0.21, size * 0.21, size * 0.06);
            const gap = skin - size * 0.045;
            colour = mix(colour, mix(TOP, BOTTOM, y / size), coverage(gap, feather));
            colour = over(colour, INK, coverage(skin, feather));

            const i = (y * size + x) * 4;
            pixels[i] = Math.round(colour[0]);
            pixels[i + 1] = Math.round(colour[1]);
            pixels[i + 2] = Math.round(colour[2]);
            pixels[i + 3] = Math.round(tileAlpha * 255);
        }
    }
    return pixels;
}

function png(size, pixels) {
    const raw = Buffer.alloc(size * (size * 4 + 1));
    for (let y = 0; y < size; y++) {
        raw[y * (size * 4 + 1)] = 0; // filter: none
        pixels.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
    }

    const chunk = (type, body) => {
        const length = Buffer.alloc(4);
        length.writeUInt32BE(body.length);
        const typed = Buffer.concat([Buffer.from(type, "ascii"), body]);
        const crc = Buffer.alloc(4);
        crc.writeUInt32BE(crc32(typed));
        return Buffer.concat([length, typed, crc]);
    };

    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(size, 0);
    ihdr.writeUInt32BE(size, 4);
    ihdr[8] = 8; // bit depth
    ihdr[9] = 6; // truecolour with alpha
    return Buffer.concat([
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
        chunk("IHDR", ihdr),
        chunk("IDAT", deflateSync(raw, { level: 9 })),
        chunk("IEND", Buffer.alloc(0))
    ]);
}

const CRC_TABLE = (() => {
    const table = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
        let c = n;
        for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
        table[n] = c;
    }
    return table;
})();

function crc32(buffer) {
    let c = 0xffffffff;
    for (const byte of buffer) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
}

function write(path, size, opaque = false) {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, png(size, render(size, opaque)));
    return path;
}

const written = [
    write(join(root, "assets", "icons", "icon-16.png"), 16),
    write(join(root, "assets", "icons", "icon-32.png"), 32),
    write(join(root, "assets", "icons", "icon-48.png"), 48),
    write(join(root, "assets", "icons", "icon-128.png"), 128),
    write(join(root, "apple", "Sources", "Assets.xcassets", "AppIcon.appiconset", "icon-1024.png"), 1024, true)
];

process.stdout.write(`${written.length} icons written\n`);
