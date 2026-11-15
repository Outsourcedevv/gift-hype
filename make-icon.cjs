// Makes Unbound's icon files from the logo: public/icon.png (256 px) and icon.ico (16 to 256 px).
// public/img/logo.svg is the logo; public/img/logo-small.svg is the same without the ring, for 32 px and smaller.
// Run once with: node make-icon.cjs   (it uses Playwright's Chromium to draw the SVG)
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

(async () => {
    const big = fs.readFileSync(path.join(__dirname, 'public', 'img', 'logo.svg'), 'utf8');
    const small = fs.readFileSync(path.join(__dirname, 'public', 'img', 'logo-small.svg'), 'utf8');
    const browser = await chromium.launch();
    const page = await browser.newPage({ deviceScaleFactor: 1 });
    const sizes = [16, 24, 32, 48, 64, 128, 256];
    const pngs = [];
    for (const s of sizes) {
        await page.setViewportSize({ width: s, height: s });
        await page.setContent(`<html><body style="margin:0;background:transparent"><div style="width:${s}px;height:${s}px">${s <= 32 ? small : big}</div></body></html>`);
        pngs.push(await page.screenshot({ omitBackground: true, clip: { x: 0, y: 0, width: s, height: s } }));
    }
    await browser.close();
    fs.writeFileSync(path.join(__dirname, 'public', 'icon.png'), pngs[sizes.indexOf(256)]);
    // .ico with PNG images inside (Windows Vista and newer)
    const head = Buffer.alloc(6); head.writeUInt16LE(0, 0); head.writeUInt16LE(1, 2); head.writeUInt16LE(sizes.length, 4);
    let offset = 6 + 16 * sizes.length;
    const dir = sizes.map((s, i) => {
        const e = Buffer.alloc(16);
        e[0] = s >= 256 ? 0 : s; e[1] = s >= 256 ? 0 : s; e.writeUInt16LE(1, 4); e.writeUInt16LE(32, 6);
        e.writeUInt32LE(pngs[i].length, 8); e.writeUInt32LE(offset, 12);
        offset += pngs[i].length;
        return e;
    });
    fs.writeFileSync(path.join(__dirname, 'icon.ico'), Buffer.concat([head, ...dir, ...pngs]));
    console.log('icon done');
})();
