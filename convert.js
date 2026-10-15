/* El Ai — konversi foto ke PDF / Word (tanpa library, semua diproses di browser).
 *  ElConvert.buildPdf(images)          -> Uint8Array  (tiap gambar = 1 halaman)
 *  ElConvert.buildDocxFromText(pages)  -> Uint8Array  (pages: array teks, 1 teks = 1 halaman)
 *  ElConvert.buildDocxFromImages(imgs) -> Uint8Array  (gambar ditempel di dokumen Word)
 * `images` = [{ bytes: Uint8Array (JPEG), w, h }]
 */
(function (root) {
  'use strict';
  const enc = new TextEncoder();

  /* ---------- util ---------- */
  function concat(chunks) {
    let n = 0;
    chunks.forEach((c) => { n += c.length; });
    const out = new Uint8Array(n);
    let o = 0;
    chunks.forEach((c) => { out.set(c, o); o += c.length; });
    return out;
  }
  const bytes = (s) => (typeof s === 'string' ? enc.encode(s) : s);
  const num = (n) => String(Math.round(n * 100) / 100);

  /* ---------- PDF ---------- */
  function buildPdf(images) {
    if (!images || !images.length) throw new Error('Tidak ada gambar');
    const parts = [];
    const offsets = [];
    let len = 0;
    const push = (d) => { const b = bytes(d); parts.push(b); len += b.length; };

    push('%PDF-1.4\n');
    push(new Uint8Array([0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a]));

    const total = 2 + images.length * 3;       // 1 katalog + 1 pages + (halaman, isi, gambar) per gambar
    const pageIds = images.map((_, i) => 3 + i * 3);

    offsets[1] = len;
    push('1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n');
    offsets[2] = len;
    push('2 0 obj\n<< /Type /Pages /Kids [' + pageIds.map((id) => id + ' 0 R').join(' ') + '] /Count ' + images.length + ' >>\nendobj\n');

    images.forEach((im, i) => {
      const pageId = 3 + i * 3, contentId = 4 + i * 3, imgId = 5 + i * 3;
      const landscape = im.w > im.h * 1.15;
      const pw = landscape ? 842 : 595;
      const ph = landscape ? 595 : 842;
      const m = 20;
      const s = Math.min((pw - 2 * m) / im.w, (ph - 2 * m) / im.h);
      const dw = im.w * s, dh = im.h * s;
      const x = (pw - dw) / 2, y = (ph - dh) / 2;
      const content = 'q ' + num(dw) + ' 0 0 ' + num(dh) + ' ' + num(x) + ' ' + num(y) + ' cm /Im0 Do Q';

      offsets[pageId] = len;
      push(pageId + ' 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ' + pw + ' ' + ph + '] /Resources << /XObject << /Im0 ' + imgId + ' 0 R >> >> /Contents ' + contentId + ' 0 R >>\nendobj\n');

      offsets[contentId] = len;
      push(contentId + ' 0 obj\n<< /Length ' + content.length + ' >>\nstream\n' + content + '\nendstream\nendobj\n');

      offsets[imgId] = len;
      push(imgId + ' 0 obj\n<< /Type /XObject /Subtype /Image /Width ' + im.w + ' /Height ' + im.h + ' /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ' + im.bytes.length + ' >>\nstream\n');
      push(im.bytes);
      push('\nendstream\nendobj\n');
    });

    const xrefPos = len;
    let xref = 'xref\n0 ' + (total + 1) + '\n0000000000 65535 f \n';
    for (let i = 1; i <= total; i++) xref += String(offsets[i]).padStart(10, '0') + ' 00000 n \n';
    push(xref);
    push('trailer\n<< /Size ' + (total + 1) + ' /Root 1 0 R >>\nstartxref\n' + xrefPos + '\n%%EOF\n');
    return concat(parts);
  }

  /* ---------- ZIP (tanpa kompresi) ---------- */
  let crcTable = null;
  function crc32(buf) {
    if (!crcTable) {
      crcTable = new Uint32Array(256);
      for (let n = 0; n < 256; n++) {
        let c = n;
        for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
        crcTable[n] = c >>> 0;
      }
    }
    let c = 0xffffffff;
    for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  }

  function zip(files) {
    const chunks = [];
    const central = [];
    let offset = 0;
    const d = new Date();
    const time = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
    const date = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();

    files.forEach((f) => {
      const name = enc.encode(f.name);
      const data = bytes(f.data);
      const crc = crc32(data);

      const lh = new DataView(new ArrayBuffer(30));
      lh.setUint32(0, 0x04034b50, true);
      lh.setUint16(4, 20, true);
      lh.setUint16(6, 0x0800, true);
      lh.setUint16(8, 0, true);
      lh.setUint16(10, time, true);
      lh.setUint16(12, date, true);
      lh.setUint32(14, crc, true);
      lh.setUint32(18, data.length, true);
      lh.setUint32(22, data.length, true);
      lh.setUint16(26, name.length, true);
      lh.setUint16(28, 0, true);
      chunks.push(new Uint8Array(lh.buffer), name, data);

      const ch = new DataView(new ArrayBuffer(46));
      ch.setUint32(0, 0x02014b50, true);
      ch.setUint16(4, 20, true);
      ch.setUint16(6, 20, true);
      ch.setUint16(8, 0x0800, true);
      ch.setUint16(10, 0, true);
      ch.setUint16(12, time, true);
      ch.setUint16(14, date, true);
      ch.setUint32(16, crc, true);
      ch.setUint32(20, data.length, true);
      ch.setUint32(24, data.length, true);
      ch.setUint16(28, name.length, true);
      ch.setUint32(42, offset, true);
      central.push(new Uint8Array(ch.buffer), name);

      offset += 30 + name.length + data.length;
    });

    const cd = concat(central);
    const end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true);
    end.setUint16(8, files.length, true);
    end.setUint16(10, files.length, true);
    end.setUint32(12, cd.length, true);
    end.setUint32(16, offset, true);
    return concat([...chunks, cd, new Uint8Array(end.buffer)]);
  }

  /* ---------- DOCX ---------- */
  const NS = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" ' +
    'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" ' +
    'xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" ' +
    'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" ' +
    'xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"';

  const esc = (s) => String(s)
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  const RPR = '<w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:cs="Calibri"/>';

  // "**tebal**" -> run tebal
  function runs(text, size, forceBold) {
    const out = [];
    const re = /\*\*(.+?)\*\*/g;
    let last = 0, m;
    const add = (t, bold) => {
      if (!t) return;
      out.push('<w:r><w:rPr>' + RPR + (bold || forceBold ? '<w:b/>' : '') + '<w:sz w:val="' + size + '"/></w:rPr>' +
        '<w:t xml:space="preserve">' + esc(t) + '</w:t></w:r>');
    };
    while ((m = re.exec(text))) { add(text.slice(last, m.index), false); add(m[1], true); last = m.index + m[0].length; }
    add(text.slice(last), false);
    return out.join('');
  }

  function para(inner, ppr) {
    return '<w:p><w:pPr><w:spacing w:after="120" w:line="276" w:lineRule="auto"/>' + (ppr || '') + '</w:pPr>' + inner + '</w:p>';
  }

  function lineToParagraph(raw) {
    let line = raw.replace(/\s+$/, '');
    if (!line.trim()) return para('');
    if (/^\s*\|?[\s:|-]+\|?\s*$/.test(line) && line.includes('-') && line.includes('|')) return ''; // baris pemisah tabel markdown
    if (/^\s*\|.*\|\s*$/.test(line)) line = line.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim()).join('\t');
    line = line.replace(/\t/g, '    ');
    const h = /^(#{1,6})\s+(.*)$/.exec(line);
    if (h) {
      const size = [36, 32, 28, 26, 24, 24][h[1].length - 1];
      return para(runs(h[2].replace(/\*\*/g, ''), size, true), '<w:keepNext/>');
    }
    const b = /^(\s*)[-*•]\s+(.*)$/.exec(line);
    if (b) return para(runs('•  ' + b[2], 24), '<w:ind w:left="' + (360 + Math.min(b[1].length, 8) * 120) + '" w:hanging="260"/>');
    const indent = /^(\s+)/.exec(line);
    return para(runs(line.trim(), 24), indent && indent[1].length >= 2 ? '<w:ind w:left="' + Math.min(indent[1].length, 12) * 120 + '"/>' : '');
  }

  const PAGE_BREAK = '<w:p><w:r><w:br w:type="page"/></w:r></w:p>';
  const SECT = '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr>';

  function drawing(rId, id, cx, cy) {
    return '<w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0">' +
      '<wp:extent cx="' + cx + '" cy="' + cy + '"/><wp:docPr id="' + id + '" name="Gambar ' + id + '"/>' +
      '<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic>' +
      '<pic:nvPicPr><pic:cNvPr id="' + id + '" name="gambar' + id + '.jpg"/><pic:cNvPicPr/></pic:nvPicPr>' +
      '<pic:blipFill><a:blip r:embed="' + rId + '"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>' +
      '<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="' + cx + '" cy="' + cy + '"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr>' +
      '</pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>';
  }

  function docxPackage(bodyXml, images) {
    const hasImg = images && images.length;
    const files = [
      {
        name: '[Content_Types].xml',
        data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
          '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
          '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
          '<Default Extension="xml" ContentType="application/xml"/>' +
          (hasImg ? '<Default Extension="jpg" ContentType="image/jpeg"/>' : '') +
          '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
          '</Types>',
      },
      {
        name: '_rels/.rels',
        data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
          '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
          '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' +
          '</Relationships>',
      },
      {
        name: 'word/document.xml',
        data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document ' + NS + '><w:body>' + bodyXml + SECT + '</w:body></w:document>',
      },
    ];
    if (hasImg) {
      files.push({
        name: 'word/_rels/document.xml.rels',
        data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
          '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
          images.map((_, i) => '<Relationship Id="rId' + (i + 1) + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/gambar' + (i + 1) + '.jpg"/>').join('') +
          '</Relationships>',
      });
      images.forEach((im, i) => files.push({ name: 'word/media/gambar' + (i + 1) + '.jpg', data: im.bytes }));
    }
    return zip(files);
  }

  function buildDocxFromText(pages) {
    const list = (pages || []).filter((p) => p != null);
    if (!list.length) throw new Error('Tidak ada teks');
    const body = list.map((t) => String(t).replace(/\r/g, '').split('\n').map(lineToParagraph).join('')).join(PAGE_BREAK);
    return docxPackage(body, null);
  }

  function buildDocxFromImages(images) {
    if (!images || !images.length) throw new Error('Tidak ada gambar');
    const MAXW = 5943600, MAXH = 8686800;   // 6,5 inci x 9,5 inci (EMU)
    const body = images.map((im, i) => {
      const s = Math.min(MAXW / im.w, MAXH / im.h);
      return (i ? PAGE_BREAK : '') + drawing('rId' + (i + 1), i + 1, Math.round(im.w * s), Math.round(im.h * s));
    }).join('');
    return docxPackage(body, images);
  }

  const api = { buildPdf, buildDocxFromText, buildDocxFromImages, _zip: zip, _crc32: crc32 };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.ElConvert = api;
})(typeof window !== 'undefined' ? window : globalThis);
