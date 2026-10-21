/*
 * 시안 사진 목록 만들기
 * ─────────────────────────────────────────────
 * Netlify가 배포할 때마다 자동으로 실행돼요 (netlify.toml 참고).
 * '시안사진' 폴더 안의 사진을 읽어서 dist/manifest.js 를 만들고,
 * 사이트 파일과 사진을 dist/ 폴더에 정리해 둡니다.
 *
 *   시안사진/
 *     1_촬영 시안/        ← 위쪽 탭 (앞 숫자는 순서, 화면엔 안 보여요)
 *       1_실내/           ← 필터 버튼
 *       2_야외/
 *     2_헤어변형/
 *       1_반묶음/ ...
 *
 * 내 컴퓨터에서 미리 확인하고 싶으면:  node build.js  →  dist/index.html 열기
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = __dirname;
const SRC = ['시안사진', 'photos'].map((d) => path.join(ROOT, d)).find((d) => fs.existsSync(d));
const OUT = path.join(ROOT, 'dist');
const SITE_FILES = ['index.html', 'favicon.svg'];
const IMG = /\.(jpe?g|png|webp|gif|avif)$/i;

const nfc = (n) => n.normalize('NFC');
const label = (n) => nfc(n).replace(/^\d+[\s._)\-]*/, '').trim() || nfc(n);
const rank = (n) => {
  const m = nfc(n).match(/^(\d+)/);
  return m ? Number(m[1]) : Infinity;
};
const byName = (a, b) => rank(a) - rank(b) || nfc(a).localeCompare(nfc(b), 'ko', { numeric: true });
const visible = (n) => !n.startsWith('.') && !n.startsWith('_');
const entries = (dir) =>
  fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((d) => visible(d.name))
    .sort((a, b) => byName(a.name, b.name));

/* ── 사진 가로·세로 크기 읽기 (외부 라이브러리 없이) ── */
function exifOrientation(b, start) {
  if (b.toString('ascii', start, start + 4) !== 'Exif') return 0;
  const t = start + 6;
  const le = b.toString('ascii', t, t + 2) === 'II';
  const u16 = (o) => (le ? b.readUInt16LE(o) : b.readUInt16BE(o));
  const u32 = (o) => (le ? b.readUInt32LE(o) : b.readUInt32BE(o));
  const ifd = t + u32(t + 4);
  const n = u16(ifd);
  for (let k = 0; k < n; k++) {
    const e = ifd + 2 + k * 12;
    if (u16(e) === 0x0112) return u16(e + 8);
  }
  return 0;
}

function imageSize(b) {
  try {
    if (b.length > 24 && b.readUInt32BE(0) === 0x89504e47) return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
    if (b.toString('ascii', 0, 3) === 'GIF') return { w: b.readUInt16LE(6), h: b.readUInt16LE(8) };
    if (b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP') {
      const t = b.toString('ascii', 12, 16);
      if (t === 'VP8 ') return { w: b.readUInt16LE(26) & 0x3fff, h: b.readUInt16LE(28) & 0x3fff };
      if (t === 'VP8L') {
        const bits = b.readUInt32LE(21);
        return { w: (bits & 0x3fff) + 1, h: ((bits >> 14) & 0x3fff) + 1 };
      }
      if (t === 'VP8X') return { w: 1 + b.readUIntLE(24, 3), h: 1 + b.readUIntLE(27, 3) };
    }
    if (b[0] === 0xff && b[1] === 0xd8) {
      let i = 2;
      let orient = 1;
      while (i < b.length - 9) {
        if (b[i] !== 0xff) { i++; continue; }
        const m = b[i + 1];
        if (m === 0xd8 || m === 0x01 || (m >= 0xd0 && m <= 0xd7) || m === 0xff) { i += m === 0xff ? 1 : 2; continue; }
        const len = b.readUInt16BE(i + 2);
        if (m === 0xe1) orient = exifOrientation(b, i + 4) || orient;
        if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) {
          let h = b.readUInt16BE(i + 5);
          let w = b.readUInt16BE(i + 7);
          if (orient >= 5) [w, h] = [h, w];
          return { w, h };
        }
        i += 2 + len;
      }
    }
  } catch (e) {
    /* 크기를 못 읽어도 사진은 정상적으로 보여요 */
  }
  return null;
}

/* ── 사진 복사: 내용 기준으로 이름을 정해서 주소가 바뀌지 않게 ── */
const written = new Set();
let total = 0;
function addPhoto(file) {
  const buf = fs.readFileSync(file);
  const hash = crypto.createHash('sha1').update(buf).digest('hex').slice(0, 16);
  const ext = path.extname(file).toLowerCase().replace('.jpeg', '.jpg');
  const src = `g/${hash}${ext}`;
  if (!written.has(src)) {
    fs.writeFileSync(path.join(OUT, src), buf);
    written.add(src);
  }
  total++;
  const size = imageSize(buf);
  return size ? { src, w: size.w, h: size.h } : { src };
}

function collect(dir) {
  const out = [];
  for (const e of entries(dir)) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...collect(p));
    else if (IMG.test(e.name)) out.push(addPhoto(p));
  }
  return out;
}

/* ── 실행 ── */
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(path.join(OUT, 'g'), { recursive: true });
for (const f of SITE_FILES) {
  const p = path.join(ROOT, f);
  if (fs.existsSync(p)) fs.copyFileSync(p, path.join(OUT, f));
}

const sections = [];
if (SRC) {
  const loose = [];
  for (const d of entries(SRC)) {
    const p = path.join(SRC, d.name);
    if (!d.isDirectory()) {
      if (IMG.test(d.name)) loose.push(addPhoto(p));
      continue;
    }
    const sec = { title: label(d.name), categories: [], photos: [] };
    for (const e of entries(p)) {
      const q = path.join(p, e.name);
      if (e.isDirectory()) sec.categories.push({ title: label(e.name), photos: collect(q) });
      else if (IMG.test(e.name)) sec.photos.push(addPhoto(q));
    }
    sections.push(sec);
  }
  if (loose.length) sections.push({ title: '기타', categories: [], photos: loose });
} else {
  console.warn('⚠ "시안사진" 폴더를 찾지 못했어요. 사진 없이 사이트만 만들어요.');
}

const manifest = { updated: new Date().toISOString(), sections };
fs.writeFileSync(path.join(OUT, 'manifest.js'), `window.GALLERY = ${JSON.stringify(manifest)};\n`);

console.log(`✓ 시안 사진 ${total}장 정리 완료 (중복 제외 ${written.size}장)`);
for (const s of sections) {
  const n = s.photos.length + s.categories.reduce((a, c) => a + c.photos.length, 0);
  console.log(`  · ${s.title}: ${n}장` + (s.categories.length ? `  [${s.categories.map((c) => `${c.title} ${c.photos.length}`).join(', ')}]` : ''));
}
