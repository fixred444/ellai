/* El Ai — konversi foto ke PDF / Word (tanpa library, semua diproses di browser).
 *  ElConvert.buildPdf(images)          -> Uint8Array  (tiap gambar = 1 halaman)
 *  ElConvert.buildDocxFromText(pages)  -> Uint8Array  (pages: array teks, 1 teks = 1 halaman)
 *  ElConvert.buildDocxFromImages(imgs) -> Uint8Array  (gambar ditempel di dokumen Word)
 *  ElConvert.buildPdfFromMarkdown(md) / buildDocxFromMarkdown(md) / buildPptxFromMarkdown(md) -> materi/teks AI jadi PDF / Word / PowerPoint
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

  /* =====================================================================
   *  TEKS (Markdown) -> PDF / Word
   *  Dipakai untuk "buatkan materi ... dalam Word/PDF" dan tombol unduh di bawah jawaban.
   *  ElConvert.buildPdfFromMarkdown(md, { title })  -> Uint8Array
   *  ElConvert.buildDocxFromMarkdown(md, { title }) -> Uint8Array
   *  ElConvert.mdTitle(md)                           -> judul pertama (# ...) atau ''
   * ===================================================================== */

  /* ---------- rumus LaTeX -> teks biasa ---------- */
  const GREEK = { alpha: 'α', beta: 'β', gamma: 'γ', delta: 'δ', Delta: 'Δ', epsilon: 'ε', theta: 'θ', lambda: 'λ', mu: 'µ', pi: 'π', rho: 'ρ', sigma: 'σ', Sigma: 'Σ', tau: 'τ', phi: 'φ', omega: 'ω', Omega: 'Ω' };
  const TEXSYM = { times: '×', cdot: '·', pm: '±', le: '≤', leq: '≤', ge: '≥', geq: '≥', approx: '≈', ne: '≠', neq: '≠', rightarrow: '→', to: '→', longrightarrow: '→', Rightarrow: '⇒', leftarrow: '←', leftrightarrow: '↔', rightleftharpoons: '⇌', degree: '°', circ: '°', infty: '∞' };
  const SUBS = '₀₁₂₃₄₅₆₇₈₉₊₋', SUPS = '⁰¹²³⁴⁵⁶⁷⁸⁹⁺⁻', NORM = '0123456789+-';
  function mapChars(x, table) {
    let out = '';
    for (const ch of x.replace(/−/g, '-')) { const i = NORM.indexOf(ch); if (i < 0) return null; out += table[i]; }
    return out;
  }
  const toSup = (x) => mapChars(x, SUPS) || '^' + x;
  const toSub = (x) => mapChars(x, SUBS) || '_' + x;

  function texInner(t) {
    let s = t.replace(/\^\{?\\circ\}?/g, '°');
    for (let k = 0; k < 4; k++) s = s.replace(/\\[dt]?frac\s*\{([^{}]*)\}\s*\{([^{}]*)\}/g, '($1)/($2)');
    s = s
      .replace(/\\(?:text|mathrm|mathbf|textbf|mathit|operatorname)\s*\{([^{}]*)\}/g, '$1')
      .replace(/\\sqrt\s*\{([^{}]*)\}/g, '√($1)')
      .replace(/\\([A-Za-z]+)(?![A-Za-z])/g, (m, w) => TEXSYM[w] || GREEK[w] || '')
      .replace(/\\[,;:! ]/g, ' ')
      .replace(/\^\{([^{}]*)\}/g, (m, x) => toSup(x))
      .replace(/\^([0-9+\-])/g, (m, x) => toSup(x))
      .replace(/_\{([^{}]*)\}/g, (m, x) => toSub(x))
      .replace(/_([0-9])/g, (m, x) => toSub(x))
      .replace(/[{}]/g, '');
    return s.replace(/\s+/g, ' ').trim();
  }

  function texToPlain(text) {
    const keep = [];
    // lindungi blok kode dan `kode inline`
    text = text.replace(/```[\s\S]*?(```|$)/g, (m) => { keep.push(m); return '\u0005' + (keep.length - 1) + '\u0005'; });
    text = text.replace(/`[^`\n]*`/g, (m) => { keep.push(m); return '\u0005' + (keep.length - 1) + '\u0005'; });
    text = text
      .replace(/\$\$([\s\S]+?)\$\$/g, (m, t) => texInner(t))
      .replace(/\\\[([\s\S]+?)\\\]/g, (m, t) => texInner(t))
      .replace(/\\\(([\s\S]+?)\\\)/g, (m, t) => texInner(t))
      .replace(/(^|[^\\$\w])\$(?!\s)([^$\n]+?)(?<!\s)\$(?![\w$])/g, (m, pre, t) => pre + texInner(t));
    return text.replace(/\u0005(\d+)\u0005/g, (m, i) => keep[i]);
  }

  /* ---------- parser Markdown ---------- */
  function parseInline(s) {
    s = String(s)
      .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
      .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '$1 ($2)')
      .replace(/<br\s*\/?>/gi, ' ')
      .replace(/~~([^~\n]+)~~/g, '$1');
    const out = [];
    const re = /(\*\*\*[^*]+?\*\*\*|\*\*[^*]+?\*\*|__[^_]+?__|\*[^*\s][^*]*?\*|`[^`]+`)/g;
    let last = 0, m;
    const add = (t, f) => { if (t) out.push(Object.assign({ t }, f)); };
    while ((m = re.exec(s))) {
      add(s.slice(last, m.index), {});
      const tok = m[0];
      if (tok.startsWith('***')) add(tok.slice(3, -3), { b: true, i: true });
      else if (tok.startsWith('**') || tok.startsWith('__')) add(tok.slice(2, -2), { b: true });
      else if (tok.startsWith('`')) add(tok.slice(1, -1), { c: true });
      else add(tok.slice(1, -1), { i: true });
      last = m.index + tok.length;
    }
    add(s.slice(last), {});
    return out;
  }

  const plainOf = (spans) => spans.map((x) => x.t).join('');

  function parseMd(md) {
    const lines = String(md).replace(/\r/g, '').replace(/\t/g, '    ').split('\n');
    const blocks = [];
    let i = 0;
    const isSep = (l) => /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(l) && l.includes('-') && (l.includes('|') || /^\s*:?-{3,}/.test(l)) && l.includes('|');
    const cells = (l) => l.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());
    const special = (l) => /^\s*(```|#{1,6}\s|>|\|.*\||[-*•+]\s+|\d+[.)]\s+|(-{3,}|\*{3,}|_{3,})\s*$)/.test(l);

    while (i < lines.length) {
      const line = lines[i];
      if (!line.trim()) { i++; continue; }

      if (/^\s*```/.test(line)) {
        const code = [];
        i++;
        while (i < lines.length && !/^\s*```/.test(lines[i])) code.push(lines[i++]);
        i++;
        blocks.push({ type: 'code', lines: code });
        continue;
      }
      if (/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) { blocks.push({ type: 'hr' }); i++; continue; }

      const h = /^\s*(#{1,6})\s+(.*?)\s*#*\s*$/.exec(line);
      if (h) { blocks.push({ type: 'h', level: h[1].length, spans: parseInline(h[2].replace(/\*\*/g, '')) }); i++; continue; }

      if (/^\s*\|.*\|\s*$/.test(line) || (line.includes('|') && i + 1 < lines.length && isSep(lines[i + 1]))) {
        const rows = [];
        while (i < lines.length && lines[i].includes('|') && lines[i].trim()) {
          if (!isSep(lines[i])) rows.push(cells(lines[i]).map(parseInline));
          i++;
        }
        if (rows.length) { blocks.push({ type: 'table', rows }); continue; }
      }

      const q = /^\s*>\s?(.*)$/.exec(line);
      if (q) {
        const buf = [q[1]];
        i++;
        while (i < lines.length && /^\s*>/.test(lines[i])) buf.push(lines[i++].replace(/^\s*>\s?/, ''));
        blocks.push({ type: 'quote', spans: parseInline(buf.join(' ')) });
        continue;
      }

      const li = /^(\s*)([-*•+]|\d+[.)])\s+(.*)$/.exec(line);
      if (li) {
        const bullet = !/\d/.test(li[2]);
        blocks.push({ type: 'li', level: Math.min(3, Math.floor(li[1].length / 2)), marker: bullet ? null : li[2], spans: parseInline(li[3]) });
        i++;
        continue;
      }

      const buf = [line.trim()];
      i++;
      while (i < lines.length && lines[i].trim() && !special(lines[i])) buf.push(lines[i++].trim());
      blocks.push({ type: 'p', spans: parseInline(buf.join(' ')) });
    }
    return blocks;
  }

  function mdTitle(md) {
    const m = /^\s*#{1,2}\s+(.+?)\s*#*\s*$/m.exec(String(md || ''));
    return m ? plainOf(parseInline(m[1].replace(/\*\*/g, ''))).trim() : '';
  }

  function colWeights(rows, total, minW) {
    const n = Math.max(...rows.map((r) => r.length));
    const w = [];
    for (let c = 0; c < n; c++) {
      let mx = 4;
      rows.forEach((r) => { if (r[c]) mx = Math.max(mx, Math.min(plainOf(r[c]).length, 42)); });
      w.push(mx + 4);
    }
    const sum = w.reduce((a, b) => a + b, 0);
    let widths = w.map((x) => Math.max(minW, (x / sum) * total));
    const s2 = widths.reduce((a, b) => a + b, 0);
    widths = widths.map((x) => (x / s2) * total);
    return widths;
  }

  /* ---------- PDF teks (font bawaan PDF: Helvetica / Courier, tanpa embed) ---------- */
  const W_REG = '278 278 355 556 556 889 667 191 333 333 389 584 278 333 278 278 556 556 556 556 556 556 556 556 556 556 278 278 584 584 584 556 1015 667 667 722 722 667 611 778 722 278 500 667 556 833 722 778 667 778 722 667 611 722 667 944 667 667 611 278 278 278 469 556 333 556 556 500 556 556 278 556 556 222 222 500 222 833 556 556 556 556 333 500 278 556 500 722 500 500 500 334 260 334 584'.split(' ').map(Number);
  const W_BOLD = '278 333 474 556 556 889 722 238 333 333 389 584 278 333 278 278 556 556 556 556 556 556 556 556 556 556 333 333 584 584 584 611 975 722 722 722 722 667 611 778 722 278 556 722 611 833 722 778 667 778 722 667 611 722 667 944 667 667 611 333 278 333 584 556 333 556 611 556 611 556 333 611 611 278 278 556 278 889 611 611 611 611 389 556 333 611 556 778 556 556 500 389 280 389 584'.split(' ').map(Number);
  const W_SPECIAL = { 0x95: 350, 0x96: 556, 0x97: 1000, 0x91: 222, 0x92: 222, 0x93: 333, 0x94: 333, 0x85: 1000, 0xb0: 400, 0xd7: 584, 0xb1: 584, 0xb7: 278, 0xa0: 278 };

  const CP1252 = { 0x20ac: 0x80, 0x201a: 0x82, 0x0192: 0x83, 0x201e: 0x84, 0x2026: 0x85, 0x2020: 0x86, 0x2021: 0x87, 0x02c6: 0x88, 0x2030: 0x89, 0x0160: 0x8a, 0x2039: 0x8b, 0x0152: 0x8c, 0x017d: 0x8e, 0x2018: 0x91, 0x2019: 0x92, 0x201c: 0x93, 0x201d: 0x94, 0x2022: 0x95, 0x2013: 0x96, 0x2014: 0x97, 0x02dc: 0x98, 0x2122: 0x99, 0x0161: 0x9a, 0x203a: 0x9b, 0x0153: 0x9c, 0x017e: 0x9e, 0x0178: 0x9f };
  const REPL = {
    '→': '->', '←': '<-', '↔': '<->', '⇒': '=>', '⇌': '<=>', '≥': '>=', '≤': '<=', '≈': '~', '≠': '!=', '∞': 'tak hingga', '√': 'akar ', '−': '-', '∑': 'jumlah ', '✓': 'v', '✔': 'v', '·': '·',
    'α': 'alfa', 'β': 'beta', 'γ': 'gamma', 'δ': 'delta', 'Δ': 'Delta', 'ε': 'epsilon', 'θ': 'theta', 'λ': 'lambda', 'µ': 'µ', 'μ': 'µ', 'π': 'pi', 'ρ': 'rho', 'σ': 'sigma', 'Σ': 'Sigma', 'τ': 'tau', 'φ': 'phi', 'ω': 'omega', 'Ω': 'Omega',
    '⁴': '^4', '⁵': '^5', '⁶': '^6', '⁷': '^7', '⁸': '^8', '⁹': '^9', '⁰': '^0', '⁺': '^+', '⁻': '^-',
    '\u00a0': ' ', '\u2009': ' ', '\u202f': ' ', '\u200b': '', '\u200d': '', '\ufe0f': '', '\u2212': '-',
  };
  '₀₁₂₃₄₅₆₇₈₉'.split('').forEach((c, i) => { REPL[c] = String(i); });
  REPL['₊'] = '+'; REPL['₋'] = '-';

  // string Unicode -> string "byte" WinAnsi (tiap karakter = 1 byte)
  function toWin(s) {
    let out = '';
    for (const ch of String(s)) {
      if (REPL[ch] !== undefined) { out += toWin(REPL[ch]); continue; }
      const c = ch.codePointAt(0);
      if (c >= 32 && c < 127) out += ch;
      else if (c >= 0xa0 && c <= 0xff) out += ch;
      else if (CP1252[c]) out += String.fromCharCode(CP1252[c]);
      else if (c === 9 || c === 10) out += ' ';
      // emoji, simbol dekoratif, dan karakter lain yang tak ada di font dasar dibuang
    }
    return out;
  }

  const hexOf = (s) => { let h = ''; for (let i = 0; i < s.length; i++) h += (s.charCodeAt(i) & 255).toString(16).padStart(2, '0'); return h; };
  function charW(code, bold, mono) {
    if (mono) return 600;
    if (code >= 32 && code <= 126) return (bold ? W_BOLD : W_REG)[code - 32];
    return W_SPECIAL[code] || (bold ? 611 : 556);
  }
  function textW(s, bold, mono, size) {
    let w = 0;
    for (let i = 0; i < s.length; i++) w += charW(s.charCodeAt(i), bold, mono);
    return (w * size) / 1000;
  }

  function buildPdfFromMarkdown(md, opts) {
    opts = opts || {};
    const blocks = parseMd(texToPlain(String(md || '')));
    if (!blocks.length) throw new Error('Tidak ada teks');
    const title = opts.title || mdTitle(md) || 'Dokumen El Ai';

    const PW = 595, PH = 842, ML = 57, MR = 57, MT = 62, MB = 68;
    const CW = PW - ML - MR;
    const pages = [];
    let ops = null, y = 0;
    const newPage = () => { ops = []; pages.push(ops); y = PH - MT; };
    newPage();

    const fontOf = (sp) => (sp.c ? 'F4' : sp.b ? 'F2' : sp.i ? 'F3' : 'F1');
    const tokensOf = (spans, base) => {
      const toks = [];
      spans.forEach((sp) => {
        const bold = !!(sp.b || base.bold), mono = !!sp.c;
        const font = mono ? 'F4' : bold ? 'F2' : (sp.i || base.italic) ? 'F3' : 'F1';
        toWin(sp.t).split(/( +)/).forEach((part) => {
          if (part) toks.push({ t: part, font, bold: font === 'F2', mono, sp: /^ +$/.test(part) });
        });
      });
      return toks;
    };

    // pecah token jadi baris sesuai lebar
    function wrap(spans, size, maxW, base) {
      const toks = tokensOf(spans, base || {});
      const lines = [];
      let cur = [], w = 0;
      const flush = () => {
        while (cur.length && cur[cur.length - 1].sp) cur.pop();
        lines.push(cur); cur = []; w = 0;
      };
      toks.forEach((tk) => {
        let tw = textW(tk.t, tk.bold, tk.mono, size);
        if (!cur.length && tk.sp) return;
        if (tw > maxW && !tk.sp) {                 // kata sangat panjang: potong per huruf
          let part = '';
          for (const chh of tk.t) {
            const cw = textW(chh, tk.bold, tk.mono, size);
            if (w + cw > maxW && (part || cur.length)) {
              if (part) cur.push({ t: part, font: tk.font, bold: tk.bold, mono: tk.mono, w: textW(part, tk.bold, tk.mono, size) });
              flush(); part = '';
            }
            part += chh; w += cw;
          }
          if (part) cur.push({ t: part, font: tk.font, bold: tk.bold, mono: tk.mono, w: textW(part, tk.bold, tk.mono, size) });
          return;
        }
        if (w + tw > maxW && cur.length && !tk.sp) flush();
        if (!cur.length && tk.sp) return;
        cur.push({ t: tk.t, font: tk.font, bold: tk.bold, mono: tk.mono, w: tw });
        w += tw;
      });
      if (cur.length) flush();
      return lines.length ? lines : [[]];
    }

    function emit(line, x, yy, size, color) {
      const runs = [];
      line.forEach((tk) => {
        const last = runs[runs.length - 1];
        if (last && last.font === tk.font) { last.t += tk.t; last.w += tk.w; } else runs.push({ font: tk.font, t: tk.t, w: tk.w });
      });
      if (color) ops.push(color + ' rg');
      let cx = x;
      runs.forEach((r) => {
        ops.push('BT /' + r.font + ' ' + num(size) + ' Tf ' + num(cx) + ' ' + num(yy) + ' Td <' + hexOf(r.t) + '> Tj ET');
        cx += r.w;
      });
      if (color) ops.push('0 g');
    }

    const need = (h) => { if (y - h < MB) newPage(); };

    function paragraph(spans, o) {
      const size = o.size || 11, lh = size * (o.lh || 1.45);
      const x = o.x != null ? o.x : ML, maxW = o.w != null ? o.w : CW;
      const lines = wrap(spans, size, maxW, o.base);
      lines.forEach((ln, idx) => {
        need(lh);
        y -= lh;
        if (o.bar) ops.push('0.93 0.97 0.96 rg ' + num(x - 12) + ' ' + num(y - size * 0.3) + ' ' + num(maxW + 16) + ' ' + num(lh) + ' re f 0.043 0.498 0.447 rg ' + num(x - 12) + ' ' + num(y - size * 0.3) + ' 3 ' + num(lh) + ' re f 0 g');
        if (idx === 0 && o.marker) emit([{ t: o.marker, font: 'F2', w: 0 }], o.markerX, y, size, o.markerColor || o.color);
        emit(ln, x, y, size, o.color);
      });
    }

    const HS = { 1: 26, 2: 16.5, 3: 13, 4: 12, 5: 11.5, 6: 11 };
    const HEAD = '0.04 0.31 0.28';
    const ACC = '0.043 0.498 0.447';
    const dateStr = new Date().toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' });
    let first = true;

    blocks.forEach((b) => {
      if (b.type === 'h') {
        const size = HS[b.level];
        if (b.level === 1 && first) {
          // blok judul: pita aksen di atas, judul besar, garis pendek, keterangan
          ops.push(ACC + ' rg 0 ' + (PH - 14) + ' ' + PW + ' 14 re f 0 g');
          y -= 22;
          paragraph(b.spans, { size, lh: 1.25, base: { bold: true }, color: HEAD });
          y -= 14;
          ops.push(ACC + ' rg ' + num(ML) + ' ' + num(y) + ' 64 3.2 re f 0 g');
          y -= 18;
          emit([{ t: toWin('Dibuat dengan El Ai  |  ' + dateStr), font: 'F1', w: 0 }], ML, y, 9.5, '0.45 0.5 0.48');
          y -= 18;
        } else {
          if (!first) y -= size * (b.level <= 2 ? 0.95 : 0.55);
          need(size * 1.4 * 2 + 24);
          if (b.level === 2) ops.push(ACC + ' rg ' + num(ML - 10) + ' ' + num(y - size * 1.3 - 1) + ' 3.5 ' + num(size * 1.2) + ' re f 0 g');
          paragraph(b.spans, { size, lh: 1.3, base: { bold: true }, color: HEAD });
          if (b.level === 2) {
            y -= 3;
            ops.push('0.80 0.88 0.86 RG 0.7 w ' + num(ML) + ' ' + num(y) + ' m ' + num(PW - MR) + ' ' + num(y) + ' l S 0 G');
          }
          y -= size * 0.4;
        }
      } else if (b.type === 'p') {
        paragraph(b.spans, { size: 11 });
        y -= 6;
      } else if (b.type === 'li') {
        const x0 = ML + 10 + b.level * 18, hang = 16;
        const marker = b.marker ? toWin(b.marker) : (b.level ? '-' : '\x95');
        paragraph(b.spans, { size: 11, x: x0 + hang, w: CW - (x0 - ML) - hang, marker, markerX: x0 + (b.marker ? 0 : 3), markerColor: ACC });
        y -= 3;
      } else if (b.type === 'quote') {
        y -= 2;
        paragraph(b.spans, { size: 11, x: ML + 16, w: CW - 24, base: { italic: true }, color: '0.12 0.3 0.28', bar: true });
        y -= 8;
      } else if (b.type === 'hr') {
        need(14); y -= 8;
        ops.push('0.75 G 0.6 w ' + num(ML) + ' ' + num(y) + ' m ' + num(PW - MR) + ' ' + num(y) + ' l S 0 G');
        y -= 8;
      } else if (b.type === 'code') {
        const size = 9.5, lh = 13, per = Math.floor((CW - 12) / (0.6 * size));
        const rows = [];
        b.lines.forEach((l) => {
          const t = toWin(l);
          if (!t.length) rows.push('');
          for (let k = 0; k < t.length; k += per) rows.push(t.slice(k, k + per));
        });
        y -= 2;
        rows.forEach((r) => {
          need(lh);
          y -= lh;
          ops.push('0.945 0.955 0.955 rg ' + num(ML) + ' ' + num(y - 3.5) + ' ' + num(CW) + ' ' + lh + ' re f 0.043 0.498 0.447 rg ' + num(ML) + ' ' + num(y - 3.5) + ' 2.5 ' + lh + ' re f 0 g');
          if (r) emit([{ t: r, font: 'F4', w: textW(r, false, true, size) }], ML + 10, y, size);
        });
        y -= 8;
      } else if (b.type === 'table') {
        const size = 9.5, lh = size * 1.4, pad = 4;
        const widths = colWeights(b.rows, CW, 42);
        const nCol = widths.length;
        const drawRow = (row, header, zebra) => {
          const cellLines = [];
          for (let c = 0; c < nCol; c++) cellLines.push(wrap(row[c] || [], size, widths[c] - 2 * pad, { bold: header }));
          const h = Math.max(...cellLines.map((l) => l.length)) * lh + 2 * pad;
          if (y - h < MB) newPage();
          const top = y;
          let cx = ML;
          for (let c = 0; c < nCol; c++) {
            if (header) ops.push('0.043 0.498 0.447 rg ' + num(cx) + ' ' + num(top - h) + ' ' + num(widths[c]) + ' ' + num(h) + ' re f 0 g');
            else if (zebra) ops.push('0.95 0.97 0.97 rg ' + num(cx) + ' ' + num(top - h) + ' ' + num(widths[c]) + ' ' + num(h) + ' re f 0 g');
            ops.push('0.78 0.84 0.83 G 0.5 w ' + num(cx) + ' ' + num(top - h) + ' ' + num(widths[c]) + ' ' + num(h) + ' re S 0 G');
            cellLines[c].forEach((ln, k) => emit(ln, cx + pad, top - pad - (k + 1) * lh + (lh - size) * 0.55, size, header ? '1 1 1' : null));
            cx += widths[c];
          }
          y = top - h;
        };
        y -= 2;
        b.rows.forEach((row, idx) => drawRow(row, idx === 0, idx % 2 === 0));
        y -= 10;
      }
      first = false;
    });

    // nomor halaman
    const total = pages.length;
    pages.forEach((p, i) => {
      const t = toWin('Halaman ' + (i + 1) + ' dari ' + total);
      let tt = toWin(title);
      while (tt.length > 3 && textW(tt, false, false, 8.5) > CW - 120) tt = tt.slice(0, -2);
      if (tt !== toWin(title)) tt += '...';
      p.push('0.82 0.88 0.87 RG 0.6 w ' + ML + ' 50 m ' + (PW - MR) + ' 50 l S 0 G');
      p.push('0.5 g BT /F1 8.5 Tf ' + ML + ' 36 Td <' + hexOf(tt) + '> Tj ET 0 g');
      p.push('0.5 g BT /F1 8.5 Tf ' + num(PW - MR - textW(t, false, false, 8.5)) + ' 36 Td <' + hexOf(t) + '> Tj ET 0 g');
    });

    // rakit objek PDF (semua ASCII; teks memakai string heksa)
    const objs = [];
    objs[1] = '<< /Type /Catalog /Pages 2 0 R >>';
    const pageIds = pages.map((_, i) => 8 + i * 2);
    objs[2] = '<< /Type /Pages /Kids [' + pageIds.map((id) => id + ' 0 R').join(' ') + '] /Count ' + pages.length + ' >>';
    ['Helvetica', 'Helvetica-Bold', 'Helvetica-Oblique', 'Courier'].forEach((f, i) => {
      objs[3 + i] = '<< /Type /Font /Subtype /Type1 /BaseFont /' + f + ' /Encoding /WinAnsiEncoding >>';
    });
    let titleHex = 'FEFF';
    for (let i = 0; i < title.length; i++) titleHex += title.charCodeAt(i).toString(16).padStart(4, '0');
    objs[7] = '<< /Title <' + titleHex + '> /Producer (El Ai) /Creator (El Ai) >>';
    pages.forEach((p, i) => {
      const stream = p.join('\n');
      objs[8 + i * 2] = '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ' + PW + ' ' + PH + '] /Resources << /Font << /F1 3 0 R /F2 4 0 R /F3 5 0 R /F4 6 0 R >> >> /Contents ' + (9 + i * 2) + ' 0 R >>';
      objs[9 + i * 2] = '<< /Length ' + stream.length + ' >>\nstream\n' + stream + '\nendstream';
    });
    const last = objs.length - 1;
    let out = '%PDF-1.4\n';
    const offs = [];
    for (let id = 1; id <= last; id++) { offs[id] = out.length; out += id + ' 0 obj\n' + objs[id] + '\nendobj\n'; }
    const xref = out.length;
    out += 'xref\n0 ' + (last + 1) + '\n0000000000 65535 f \n';
    for (let id = 1; id <= last; id++) out += String(offs[id]).padStart(10, '0') + ' 00000 n \n';
    out += 'trailer\n<< /Size ' + (last + 1) + ' /Root 1 0 R /Info 7 0 R >>\nstartxref\n' + xref + '\n%%EOF\n';
    return enc.encode(out);
  }

  /* ---------- DOCX teks (judul, daftar, tabel, kode, nomor halaman) ---------- */
  function dRuns(spans, size, o) {
    o = o || {};
    return spans.map((s) => {
      const font = s.c ? '<w:rFonts w:ascii="Consolas" w:hAnsi="Consolas" w:cs="Consolas"/>' : RPR;
      return '<w:r><w:rPr>' + font + ((s.b || o.bold) ? '<w:b/>' : '') + ((s.i || o.italic) ? '<w:i/>' : '') +
        (o.color ? '<w:color w:val="' + o.color + '"/>' : '') + '<w:sz w:val="' + size + '"/></w:rPr>' +
        '<w:t xml:space="preserve">' + esc(s.t) + '</w:t></w:r>';
    }).join('');
  }

  // urutan elemen w:pPr mengikuti skema: keepNext, pBdr, shd, spacing, ind, jc, outlineLvl
  function dPara(inner, o) {
    o = o || {};
    return '<w:p><w:pPr>' + (o.style ? '<w:pStyle w:val="' + o.style + '"/>' : '') + (o.keepNext ? '<w:keepNext/>' : '') + (o.pBdr || '') + (o.shd || '') +
      '<w:spacing w:before="' + (o.before || 0) + '" w:after="' + (o.after != null ? o.after : 120) + '" w:line="' + (o.line || 288) + '" w:lineRule="auto"/>' +
      (o.ind || '') + (o.jc ? '<w:jc w:val="' + o.jc + '"/>' : '') + (o.outline != null ? '<w:outlineLvl w:val="' + o.outline + '"/>' : '') +
      '</w:pPr>' + inner + '</w:p>';
  }

  function buildDocxFromMarkdown(md, opts) {
    opts = opts || {};
    const blocks = parseMd(texToPlain(String(md || '')));
    if (!blocks.length) throw new Error('Tidak ada teks');
    const title = opts.title || mdTitle(md) || 'Dokumen El Ai';
    const TW = 9638; // lebar teks A4 dengan margin 2 cm (dxa)
    const HS = { 1: 52, 2: 32, 3: 26, 4: 24, 5: 23, 6: 22 };
    const ACC = '0B7F72', DARK = '0A4F48';
    const dateStr = new Date().toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' });
    const body = [];
    let first = true;

    blocks.forEach((b) => {
      if (b.type === 'h') {
        const o = { keepNext: true, before: first ? 0 : (b.level <= 2 ? 360 : 220), after: 100, line: 264, outline: Math.min(b.level - 1, 8), style: b.level === 1 && first ? 'Title' : b.level <= 3 ? 'Heading' + b.level : null };
        if (b.level === 1 && first) {
          o.pBdr = '<w:pBdr><w:bottom w:val="single" w:sz="24" w:space="6" w:color="' + ACC + '"/></w:pBdr>';
          o.after = 80;
          body.push(dPara(dRuns(b.spans, HS[1], { bold: true, color: DARK }), o));
          body.push(dPara(dRuns([{ t: 'Dibuat dengan El Ai  ·  ' + dateStr }], 19, { color: '7A8682' }), { after: 280 }));
        } else {
          if (b.level === 2) o.pBdr = '<w:pBdr><w:left w:val="single" w:sz="28" w:space="8" w:color="' + ACC + '"/></w:pBdr>';
          body.push(dPara(dRuns(b.spans, HS[b.level], { bold: true, color: b.level <= 2 ? DARK : ACC }), o));
        }
      } else if (b.type === 'p') {
        body.push(dPara(dRuns(b.spans, 22), { after: 140 }));
      } else if (b.type === 'li') {
        const left = 720 + b.level * 360;
        const marker = b.marker ? b.marker : (b.level ? '–' : '•');
        const inner = '<w:r><w:rPr>' + RPR + '<w:b/><w:color w:val="' + ACC + '"/><w:sz w:val="22"/></w:rPr><w:t xml:space="preserve">' + esc(marker) + '</w:t></w:r><w:r><w:tab/></w:r>' + dRuns(b.spans, 22);
        body.push(dPara(inner, { after: 60, ind: '<w:ind w:left="' + left + '" w:hanging="360"/>' }));
      } else if (b.type === 'quote') {
        body.push(dPara(dRuns(b.spans, 22, { italic: true, color: '1F4D48' }), {
          after: 160, before: 60,
          pBdr: '<w:pBdr><w:top w:val="single" w:sz="4" w:space="5" w:color="E3F3F0"/><w:left w:val="single" w:sz="24" w:space="8" w:color="' + ACC + '"/><w:bottom w:val="single" w:sz="4" w:space="5" w:color="E3F3F0"/><w:right w:val="single" w:sz="4" w:space="8" w:color="E3F3F0"/></w:pBdr>',
          shd: '<w:shd w:val="clear" w:color="auto" w:fill="E3F3F0"/>',
          ind: '<w:ind w:left="400" w:right="200"/>',
        }));
      } else if (b.type === 'hr') {
        body.push(dPara('', { after: 120, pBdr: '<w:pBdr><w:bottom w:val="single" w:sz="6" w:space="1" w:color="BFBFBF"/></w:pBdr>' }));
      } else if (b.type === 'code') {
        (b.lines.length ? b.lines : ['']).forEach((l, k, arr) => {
          body.push(dPara(dRuns([{ t: l.replace(/\s+$/, ''), c: true }], 19), {
            after: k === arr.length - 1 ? 160 : 0, line: 252, shd: '<w:shd w:val="clear" w:color="auto" w:fill="F1F4F4"/>',
            pBdr: '<w:pBdr><w:left w:val="single" w:sz="18" w:space="6" w:color="' + ACC + '"/></w:pBdr>',
          }));
        });
      } else if (b.type === 'table') {
        const widths = colWeights(b.rows, TW, 900).map(Math.round);
        const nCol = widths.length;
        const bdr = (n) => '<w:' + n + ' w:val="single" w:sz="4" w:space="0" w:color="C5D6D3"/>';
        let t = '<w:tbl><w:tblPr><w:tblW w:w="' + TW + '" w:type="dxa"/><w:tblBorders>' + ['top', 'left', 'bottom', 'right', 'insideH', 'insideV'].map(bdr).join('') +
          '</w:tblBorders><w:tblLayout w:type="fixed"/><w:tblCellMar><w:top w:w="60" w:type="dxa"/><w:left w:w="100" w:type="dxa"/><w:bottom w:w="60" w:type="dxa"/><w:right w:w="100" w:type="dxa"/></w:tblCellMar></w:tblPr>' +
          '<w:tblGrid>' + widths.map((w) => '<w:gridCol w:w="' + w + '"/>').join('') + '</w:tblGrid>';
        b.rows.forEach((row, ri) => {
          const header = ri === 0;
          t += '<w:tr><w:trPr><w:cantSplit/>' + (header ? '<w:tblHeader/>' : '') + '</w:trPr>';
          for (let c = 0; c < nCol; c++) {
            t += '<w:tc><w:tcPr><w:tcW w:w="' + widths[c] + '" w:type="dxa"/>' + (header ? '<w:shd w:val="clear" w:color="auto" w:fill="' + ACC + '"/>' : (ri % 2 === 0 ? '<w:shd w:val="clear" w:color="auto" w:fill="F1F7F6"/>' : '')) + '</w:tcPr>' +
              dPara(dRuns(row[c] && row[c].length ? row[c] : [{ t: '' }], 20, { bold: header, color: header ? 'FFFFFF' : null }), { after: 0, line: 252 }) + '</w:tc>';
          }
          t += '</w:tr>';
        });
        body.push(t + '</w:tbl>');
        body.push(dPara('', { after: 100 }));
      }
      first = false;
    });

    const X = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
    const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
    const sect = '<w:sectPr><w:footerReference w:type="default" r:id="rId2"/><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134" w:header="708" w:footer="567" w:gutter="0"/></w:sectPr>';
    const frun = (inner) => '<w:r><w:rPr>' + RPR + '<w:color w:val="808080"/><w:sz w:val="18"/></w:rPr>' + inner + '</w:r>';
    const footer = X + '<w:ftr ' + NS + '><w:p><w:pPr><w:pBdr><w:top w:val="single" w:sz="4" w:space="6" w:color="CFE0DD"/></w:pBdr><w:tabs><w:tab w:val="clear" w:pos="4513"/><w:tab w:val="clear" w:pos="9026"/><w:tab w:val="right" w:pos="9638"/></w:tabs></w:pPr>' +
      frun('<w:t xml:space="preserve">' + esc(title.length > 70 ? title.slice(0, 68) + '…' : title) + '</w:t>') + frun('<w:tab/>') +
      frun('<w:t xml:space="preserve">Halaman </w:t>') + frun('<w:fldChar w:fldCharType="begin"/>') + frun('<w:instrText xml:space="preserve"> PAGE </w:instrText>') +
      frun('<w:fldChar w:fldCharType="separate"/>') + frun('<w:t>1</w:t>') + frun('<w:fldChar w:fldCharType="end"/>') + '</w:p></w:ftr>';
    const styles = X + '<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:docDefaults><w:rPrDefault><w:rPr>' +
      '<w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:eastAsia="Calibri" w:cs="Calibri"/><w:sz w:val="22"/><w:lang w:val="id-ID"/></w:rPr></w:rPrDefault></w:docDefaults>' +
      '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>' +
      '<w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/></w:style>' +
      [1, 2, 3].map((n) => '<w:style w:type="paragraph" w:styleId="Heading' + n + '"><w:name w:val="heading ' + n + '"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:outlineLvl w:val="' + (n - 1) + '"/></w:pPr></w:style>').join('') + '</w:styles>';
    const core = X + '<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">' +
      '<dc:title>' + esc(title) + '</dc:title><dc:creator>El Ai</dc:creator></cp:coreProperties>';

    return zip([
      { name: '[Content_Types].xml', data: X + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>' +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
        '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>' +
        '<Override PartName="/word/footer1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/>' +
        '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>' },
      { name: '_rels/.rels', data: X + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="' + REL + '/officeDocument" Target="word/document.xml"/>' +
        '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>' },
      { name: 'word/_rels/document.xml.rels', data: X + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="' + REL + '/styles" Target="styles.xml"/>' +
        '<Relationship Id="rId2" Type="' + REL + '/footer" Target="footer1.xml"/></Relationships>' },
      { name: 'word/document.xml', data: X + '<w:document ' + NS + '><w:body>' + body.join('') + sect + '</w:body></w:document>' },
      { name: 'word/styles.xml', data: styles },
      { name: 'word/footer1.xml', data: footer },
      { name: 'docProps/core.xml', data: core },
    ]);
  }


  /* =====================================================================
   *  TEKS (Markdown) -> PowerPoint (.pptx)
   *  "# Judul" = slide judul, tiap "## Subjudul" = satu slide (daftar poin, tabel, atau kode).
   *  Slide yang kepenuhan dipecah otomatis. Tanpa library: semua dirakit sebagai OOXML di browser.
   * ===================================================================== */
  const P_NS = 'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"';
  const XML_HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';

  function buildPptxFromMarkdown(md, opts) {
    opts = opts || {};
    const blocks = parseMd(texToPlain(String(md || '')));
    if (!blocks.length) throw new Error('Tidak ada teks');

    const IN = 914400, SW = 12192000, SH = 6858000;
    const E = (inch) => Math.round(inch * IN);
    const C = { dark: '0A4F48', acc: '0B7F72', mid: '3FB8A6', soft: 'E3F3F0', text: '1F2A28', grey: '6B7A76', white: 'FFFFFF', line: 'CFE0DD' };
    const dateStr = new Date().toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' });

    /* ---- 1. kelompokkan blok jadi bagian ---- */
    let deckTitle = opts.title || mdTitle(md) || 'Presentasi El Ai';
    let i0 = 0;
    if (blocks[0].type === 'h' && blocks[0].level === 1) { deckTitle = plainOf(blocks[0].spans).trim() || deckTitle; i0 = 1; }
    const levels = blocks.slice(i0).filter((b) => b.type === 'h').map((b) => b.level);
    const splitLevel = levels.includes(2) ? 2 : levels.includes(3) ? 3 : 2;
    let subtitle = '';
    const sections = [];
    let cur = null;
    blocks.slice(i0).forEach((b) => {
      if (b.type === 'h' && b.level <= splitLevel) { cur = { title: plainOf(b.spans).trim(), items: [] }; sections.push(cur); return; }
      if (b.type === 'hr') return;
      if (!cur) {
        if (!subtitle && b.type === 'p') { const t = plainOf(b.spans).trim(); subtitle = t.length > 150 ? t.slice(0, 147).replace(/\s+\S*$/, '') + '…' : t; return; }
        cur = { title: 'Pengantar', items: [] }; sections.push(cur);
      }
      cur.items.push(b);
    });
    if (!sections.length) sections.push({ title: deckTitle, items: [] });

    /* ---- 2. bangun slide (tiap slide = daftar bentuk XML) ---- */
    const slides = [];
    let nextId;
    const sid = () => nextId++;

    const rPr = (sz, o) => '<a:rPr lang="id-ID" sz="' + Math.round(sz * 100) + '"' + (o.b ? ' b="1"' : '') + (o.i ? ' i="1"' : '') + ' dirty="0">' +
      '<a:solidFill><a:srgbClr val="' + (o.color || C.text) + '"/></a:solidFill>' +
      '<a:latin typeface="' + (o.mono ? 'Consolas' : 'Calibri') + '"/><a:cs typeface="' + (o.mono ? 'Consolas' : 'Calibri') + '"/></a:rPr>';
    const runsXml = (spans, sz, o) => {
      o = o || {};
      const list = spans.length ? spans : [{ t: '' }];
      return list.map((s) => '<a:r>' + rPr(sz, { b: s.b || o.b, i: s.i || o.i, mono: s.c || o.mono, color: s.c && !o.color ? C.dark : o.color }) + '<a:t>' + esc(s.t) + '</a:t></a:r>').join('');
    };
    // satu paragraf: o = { sz, algn, bullet, marL, spcBef, color, b, i, mono, lnSpc }
    const paraXml = (spans, o) => {
      const marL = o.marL || 0, ind = o.bullet ? -E(0.3) : (o.hang ? -o.hang : 0);
      return '<a:p><a:pPr marL="' + (marL + (o.bullet || o.hang ? (o.hang || E(0.3)) : 0)) + '" indent="' + ind + '" algn="' + (o.algn || 'l') + '">' +
        '<a:lnSpc><a:spcPct val="' + (o.lnSpc || 100000) + '"/></a:lnSpc><a:spcBef><a:spcPts val="' + Math.round((o.spcBef || 0) * 100) + '"/></a:spcBef>' +
        (o.bullet ? '<a:buClr><a:srgbClr val="' + C.acc + '"/></a:buClr><a:buFont typeface="Arial"/><a:buChar char="' + o.bullet + '"/>' : '<a:buNone/>') +
        '</a:pPr>' + runsXml(spans, o.sz, o) + '<a:endParaRPr lang="id-ID" sz="' + Math.round(o.sz * 100) + '" dirty="0"/></a:p>';
    };
    const shape = (o) => {
      const id = sid();
      const fill = o.fill ? '<a:solidFill><a:srgbClr val="' + o.fill + '">' + (o.alpha ? '<a:alpha val="' + o.alpha + '"/>' : '') + '</a:srgbClr></a:solidFill>' : '<a:noFill/>';
      const ln = o.line ? '<a:ln w="12700"><a:solidFill><a:srgbClr val="' + o.line + '"/></a:solidFill></a:ln>' : '<a:ln><a:noFill/></a:ln>';
      const ph = o.ph ? '<p:ph type="' + o.ph + '"/>' : '';
      const ins = o.inset != null ? o.inset : E(0.05);
      const body = o.paras
        ? '<p:txBody><a:bodyPr wrap="square" lIns="' + ins + '" tIns="' + (o.tIns != null ? o.tIns : E(0.04)) + '" rIns="' + ins + '" bIns="' + (o.tIns != null ? o.tIns : E(0.04)) + '" anchor="' + (o.anchor || 't') + '"><a:normAutofit/></a:bodyPr><a:lstStyle/>' + o.paras + '</p:txBody>'
        : '<p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:endParaRPr lang="id-ID"/></a:p></p:txBody>';
      return '<p:sp><p:nvSpPr><p:cNvPr id="' + id + '" name="' + (o.name || 'Bentuk ' + id) + '"/><p:cNvSpPr' + (o.ph ? '><a:spLocks noGrp="1"/></p:cNvSpPr>' : o.paras ? ' txBox="1"/>' : '/>') +
        '<p:nvPr>' + ph + '</p:nvPr></p:nvSpPr><p:spPr><a:xfrm><a:off x="' + o.x + '" y="' + o.y + '"/><a:ext cx="' + o.w + '" cy="' + o.h + '"/></a:xfrm>' +
        '<a:prstGeom prst="' + (o.geom || 'rect') + '"><a:avLst/></a:prstGeom>' + fill + ln + '</p:spPr>' + body + '</p:sp>';
    };

    const slideXml = (shapes, bg) => XML_HEAD + '<p:sld ' + P_NS + '><p:cSld>' +
      (bg ? '<p:bg><p:bgPr><a:solidFill><a:srgbClr val="' + bg + '"/></a:solidFill><a:effectLst/></p:bgPr></p:bg>' : '') +
      '<p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>' +
      shapes.join('') + '</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>';

    const MX = E(0.7), CWd = SW - 2 * MX;
    const BODY_Y = E(1.8), BODY_H = E(5.0);

    function darkSlide(title, sub, small) {
      nextId = 2;
      const t = String(title);
      const sz = t.length > 70 ? 32 : t.length > 45 ? 38 : 46;
      const s = [
        shape({ name: 'Hiasan 1', x: SW - E(5.2), y: -E(2.2), w: E(7.2), h: E(7.2), geom: 'ellipse', fill: C.acc, alpha: 35000 }),
        shape({ name: 'Hiasan 2', x: SW - E(3.2), y: SH - E(2.6), w: E(5.2), h: E(5.2), geom: 'ellipse', fill: C.mid, alpha: 22000 }),
        shape({ name: 'Garis aksen', x: MX, y: E(2.35), w: E(0.9), h: E(0.09), fill: C.mid }),
        shape({ name: 'Judul', ph: 'title', x: MX, y: E(2.6), w: E(9.6), h: E(2.0), anchor: 't', inset: 0, paras: paraXml(runSpans(t), { sz, b: true, color: C.white, lnSpc: 92000 }) }),
      ];
      const tl = Math.max(1, Math.ceil((t.length * sz * 0.52) / (9.6 * 72)));
      const subY = Math.min(E(5.3), E(2.6) + Math.round((tl * sz * 1.15 + 26) * 12700));
      if (sub) s.push(shape({ name: 'Subjudul', x: MX, y: subY, w: E(8.6), h: E(1.3), inset: 0, paras: paraXml(runSpans(sub), { sz: 20, color: 'BFE6DF' }) }));
      s.push(shape({ name: 'Keterangan', x: MX, y: E(6.7), w: E(8), h: E(0.4), inset: 0, anchor: 'ctr', paras: paraXml(runSpans(small || ('El Ai  ·  ' + dateStr)), { sz: 13, color: '8FCFC4' }) }));
      slides.push(slideXml(s, C.dark));
    }
    const runSpans = (t) => [{ t }];

    function lightSlide(title, shapes) {
      nextId = 2;
      const t = String(title);
      const sz = t.length > 60 ? 24 : t.length > 40 ? 28 : 32;
      const n = slides.length + 1;
      const s = [
        shape({ name: 'Pita', x: 0, y: 0, w: E(0.22), h: SH, fill: C.acc }),
        shape({ name: 'Judul', ph: 'title', x: MX, y: E(0.45), w: CWd, h: E(0.95), anchor: 'b', inset: 0, paras: paraXml(runSpans(t), { sz, b: true, color: C.dark, lnSpc: 90000 }) }),
        shape({ name: 'Garis judul', x: MX, y: E(1.5), w: E(0.9), h: E(0.07), fill: C.acc }),
      ].concat(shapes);
      s.push(shape({ name: 'Garis kaki', x: MX, y: E(6.98), w: CWd, h: 9525, fill: C.line }));
      s.push(shape({ name: 'Kaki kiri', x: MX, y: E(7.03), w: E(5), h: E(0.32), inset: 0, anchor: 'ctr', paras: paraXml(runSpans('El Ai  ·  ' + deckTitle.slice(0, 60)), { sz: 10.5, color: C.grey }) }));
      s.push(shape({ name: 'Nomor', x: SW - MX - E(1), y: E(7.03), w: E(1), h: E(0.32), inset: 0, anchor: 'ctr', paras: paraXml(runSpans(String(n)), { sz: 10.5, color: C.grey, algn: 'r' }) }));
      slides.push(slideXml(s, null));
    }

    /* ---- perkiraan tinggi teks (pt) ---- */
    const WPT = (CWd / 12700) - 14, HPT = BODY_H / 12700 - 8;
    const linesFor = (len, sz, w) => Math.max(1, Math.ceil((len * sz * 0.5) / w));
    function itemInfo(b, sz) {
      if (b.type === 'li') {
        const ind = 22 + b.level * 24;
        const n = linesFor(plainOf(b.spans).length, sz, WPT - ind);
        return { h: n * sz * 1.2 + sz * 0.55, n };
      }
      if (b.type === 'h') { const n = linesFor(plainOf(b.spans).length, sz + 2, WPT); return { h: n * (sz + 2) * 1.2 + sz * 0.9, n }; }
      const n = linesFor(plainOf(b.spans).length, sz, WPT - (b.type === 'quote' ? 20 : 0));
      return { h: n * sz * 1.2 + sz * 0.7, n };
    }
    const flowH = (items, sz) => items.reduce((a, b) => a + itemInfo(b, sz).h, 0);

    function itemParas(items, sz) {
      return items.map((b, idx) => {
        const first = idx === 0;
        if (b.type === 'li') {
          const ind = b.level * E(0.32);
          if (b._numbered) return paraXml(b.spans, { sz, marL: ind, hang: E(0.42), spcBef: first ? 0 : sz * 0.5 });
          return paraXml(b.spans, { sz: b.level ? sz - 2 : sz, marL: ind, bullet: b.level ? '–' : '•', spcBef: first ? 0 : sz * 0.5 });
        }
        if (b.type === 'h') return paraXml(b.spans, { sz: sz + 2, b: true, color: C.acc, spcBef: first ? 0 : sz * 0.9 });
        if (b.type === 'quote') return paraXml(b.spans, { sz, i: true, color: C.dark, marL: E(0.2), spcBef: first ? 0 : sz * 0.7 });
        return paraXml(b.spans, { sz, spcBef: first ? 0 : sz * 0.7 });
      }).join('');
    }
    // daftar bernomor: tambahkan nomor sebagai teks (agar tak bergantung numbering PowerPoint)
    const numberize = (items) => items.map((b) => (b.type === 'li' && b.marker ? Object.assign({}, b, { spans: [{ t: b.marker + '  ', b: true, c: false }].concat(b.spans), marker: null, _numbered: true }) : b));

    function textSlides(title, items) {
      items = numberize(items);
      let sizes = [26, 24, 22, 20, 18];
      let sz = sizes.find((s) => flowH(items, s) <= HPT);
      let chunks;
      if (sz) chunks = [items];
      else {
        sz = 20; chunks = []; let cur2 = [], h = 0;
        items.forEach((b) => {
          const ih = itemInfo(b, sz).h;
          if (cur2.length && h + ih > HPT) { chunks.push(cur2); cur2 = []; h = 0; }
          cur2.push(b); h += ih;
        });
        if (cur2.length) chunks.push(cur2);
      }
      chunks.forEach((ch, k) => {
        const body = shape({ name: 'Isi', x: MX, y: BODY_Y, w: CWd, h: BODY_H, inset: 0, paras: itemParas(ch, sz) });
        lightSlide(chunks.length > 1 ? title + ' (' + (k + 1) + '/' + chunks.length + ')' : title, [body]);
      });
    }

    function codeSlides(title, lines) {
      const per = 13, width = 92;
      const rows = [];
      lines.forEach((l) => { const t = l.replace(/\s+$/, ''); if (!t) rows.push(''); for (let k = 0; k < t.length; k += width) rows.push(t.slice(k, k + width)); });
      const parts = [];
      for (let k = 0; k < rows.length; k += per) parts.push(rows.slice(k, k + per));
      if (!parts.length) parts.push(['']);
      parts.forEach((p, k) => {
        const paras = p.map((r) => paraXml([{ t: r || ' ' }], { sz: 15, mono: true, color: 'E6F2F0' })).join('');
        const box = shape({ name: 'Kode', x: MX, y: BODY_Y, w: CWd, h: Math.min(BODY_H, E(0.5) + p.length * E(0.3)), fill: '14201F', inset: E(0.25), tIns: E(0.2), paras });
        lightSlide(parts.length > 1 ? title + ' (' + (k + 1) + '/' + parts.length + ')' : title, [box]);
      });
    }

    function tableXml(rows, y) {
      const id = sid();
      const nCol = Math.max(...rows.map((r) => r.length));
      const widths = colWeights(rows, CWd, E(1.0));
      const sz = nCol >= 5 ? 14 : nCol === 4 ? 16 : 18;
      const grid = widths.map((w) => '<a:gridCol w="' + Math.round(w) + '"/>').join('');
      let total = 0;
      const trs = rows.map((row, ri) => {
        const header = ri === 0;
        let maxLines = 1;
        const tcs = [];
        for (let c = 0; c < nCol; c++) {
          const spans = row[c] && row[c].length ? row[c] : [{ t: '' }];
          maxLines = Math.max(maxLines, linesFor(plainOf(spans).length, sz, widths[c] / 12700 - 16));
          tcs.push('<a:tc><a:txBody><a:bodyPr/><a:lstStyle/>' + paraXml(spans, { sz, b: header, color: header ? C.white : C.text }) + '</a:txBody>' +
            '<a:tcPr marL="' + E(0.1) + '" marR="' + E(0.1) + '" marT="' + E(0.06) + '" marB="' + E(0.06) + '" anchor="ctr">' +
            '<a:lnL w="0"><a:noFill/></a:lnL><a:lnR w="0"><a:noFill/></a:lnR><a:lnT w="0"><a:noFill/></a:lnT>' +
            '<a:lnB w="9525"><a:solidFill><a:srgbClr val="' + C.line + '"/></a:solidFill></a:lnB>' +
            '<a:solidFill><a:srgbClr val="' + (header ? C.acc : ri % 2 === 0 ? 'F1F7F6' : 'FFFFFF') + '"/></a:solidFill></a:tcPr></a:tc>');
        }
        const h = Math.round((maxLines * sz * 1.2 + 14) * 12700);
        total += h;
        return '<a:tr h="' + h + '">' + tcs.join('') + '</a:tr>';
      }).join('');
      return '<p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="' + id + '" name="Tabel ' + id + '"/><p:cNvGraphicFramePr><a:graphicFrameLocks noGrp="1"/></p:cNvGraphicFramePr><p:nvPr/></p:nvGraphicFramePr>' +
        '<p:xfrm><a:off x="' + MX + '" y="' + y + '"/><a:ext cx="' + CWd + '" cy="' + total + '"/></p:xfrm>' +
        '<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/table"><a:tbl><a:tblPr firstRow="1" bandRow="1"/><a:tblGrid>' + grid + '</a:tblGrid>' + trs + '</a:tbl></a:graphicData></a:graphic></p:graphicFrame>';
    }
    function tableSlides(title, rows) {
      const head = rows[0], rest = rows.slice(1);
      const per = 6;
      const parts = [];
      for (let k = 0; k < rest.length || k === 0; k += per) parts.push(rest.slice(k, k + per));
      parts.forEach((p, k) => {
        // slide dibuat dulu supaya nomor id bentuk konsisten: id tabel diambil setelah lightSlide menetapkan nextId
        nextId = 100;
        const tbl = tableXml([head].concat(p), BODY_Y);
        lightSlide(parts.length > 1 ? title + ' (' + (k + 1) + '/' + parts.length + ')' : title, [tbl]);
      });
    }

    /* ---- 3. susun semua slide ---- */
    darkSlide(deckTitle, subtitle);
    if (sections.length >= 3) {
      const agenda = sections.slice(0, 10).map((s, k) => ({ type: 'li', level: 0, marker: (k + 1) + '.', spans: [{ t: s.title }] }));
      textSlides('Agenda', agenda);
    }
    sections.forEach((sec) => {
      let buf = [];
      const flush = () => { if (buf.length) { textSlides(sec.title, buf); buf = []; } };
      if (!sec.items.length) { textSlides(sec.title, [{ type: 'p', spans: [{ t: ' ' }] }]); return; }
      sec.items.forEach((b) => {
        if (b.type === 'table') { flush(); tableSlides(sec.title, b.rows); }
        else if (b.type === 'code') { flush(); codeSlides(sec.title, b.lines); }
        else buf.push(b);
      });
      flush();
    });
    darkSlide('Terima kasih', 'Semoga materi ini bermanfaat.', 'Dibuat dengan El Ai  ·  ' + dateStr);

    /* ---- 4. paket PPTX ---- */
    const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
    const PKG = 'http://schemas.openxmlformats.org/package/2006/relationships';
    const rels = (list) => XML_HEAD + '<Relationships xmlns="' + PKG + '">' + list.map((r) => '<Relationship Id="' + r[0] + '" Type="' + (r[1].startsWith('http') ? r[1] : REL + '/' + r[1]) + '" Target="' + r[2] + '"/>').join('') + '</Relationships>';
    const n = slides.length;

    const theme = XML_HEAD + '<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="El Ai"><a:themeElements>' +
      '<a:clrScheme name="El Ai"><a:dk1><a:srgbClr val="1F2A28"/></a:dk1><a:lt1><a:srgbClr val="FFFFFF"/></a:lt1><a:dk2><a:srgbClr val="0A4F48"/></a:dk2><a:lt2><a:srgbClr val="E3F3F0"/></a:lt2>' +
      '<a:accent1><a:srgbClr val="0B7F72"/></a:accent1><a:accent2><a:srgbClr val="3FB8A6"/></a:accent2><a:accent3><a:srgbClr val="F2B134"/></a:accent3><a:accent4><a:srgbClr val="E4572E"/></a:accent4><a:accent5><a:srgbClr val="4A7BD0"/></a:accent5><a:accent6><a:srgbClr val="8A6BBE"/></a:accent6>' +
      '<a:hlink><a:srgbClr val="0B7F72"/></a:hlink><a:folHlink><a:srgbClr val="6B7A76"/></a:folHlink></a:clrScheme>' +
      '<a:fontScheme name="El Ai"><a:majorFont><a:latin typeface="Calibri"/><a:ea typeface=""/><a:cs typeface=""/></a:majorFont><a:minorFont><a:latin typeface="Calibri"/><a:ea typeface=""/><a:cs typeface=""/></a:minorFont></a:fontScheme>' +
      '<a:fmtScheme name="El Ai"><a:fillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:fillStyleLst>' +
      '<a:lnStyleLst><a:ln w="9525"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln><a:ln w="19050"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln><a:ln w="28575"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln></a:lnStyleLst>' +
      '<a:effectStyleLst><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle></a:effectStyleLst>' +
      '<a:bgFillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:bgFillStyleLst></a:fmtScheme>' +
      '</a:themeElements></a:theme>';

    const grp = '<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>';
    const phTitle = (withXfrm) => '<p:sp><p:nvSpPr><p:cNvPr id="2" name="Judul"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr><p:spPr>' +
      (withXfrm ? '<a:xfrm><a:off x="' + MX + '" y="' + E(0.45) + '"/><a:ext cx="' + CWd + '" cy="' + E(0.95) + '"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom>' : '') +
      '</p:spPr><p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr lang="id-ID"/><a:t>Klik untuk mengubah judul</a:t></a:r></a:p></p:txBody></p:sp>';
    const master = XML_HEAD + '<p:sldMaster ' + P_NS + '><p:cSld><p:bg><p:bgPr><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill><a:effectLst/></p:bgPr></p:bg><p:spTree>' + grp + phTitle(true) + '</p:spTree></p:cSld>' +
      '<p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/>' +
      '<p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/></p:sldLayoutIdLst>' +
      '<p:txStyles><p:titleStyle><a:lvl1pPr algn="l"><a:defRPr sz="3200" b="1"><a:solidFill><a:schemeClr val="tx2"/></a:solidFill><a:latin typeface="Calibri"/></a:defRPr></a:lvl1pPr></p:titleStyle>' +
      '<p:bodyStyle><a:lvl1pPr algn="l"><a:defRPr sz="2000"><a:solidFill><a:schemeClr val="tx1"/></a:solidFill><a:latin typeface="Calibri"/></a:defRPr></a:lvl1pPr></p:bodyStyle>' +
      '<p:otherStyle><a:lvl1pPr algn="l"><a:defRPr sz="1800"><a:solidFill><a:schemeClr val="tx1"/></a:solidFill><a:latin typeface="Calibri"/></a:defRPr></a:lvl1pPr></p:otherStyle></p:txStyles></p:sldMaster>';
    const layout = XML_HEAD + '<p:sldLayout ' + P_NS + ' type="titleOnly" preserve="1"><p:cSld name="Judul"><p:spTree>' + grp + phTitle(false) + '</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>';

    const pres = XML_HEAD + '<p:presentation ' + P_NS + ' saveSubsetFonts="1"><p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst><p:sldIdLst>' +
      slides.map((_, k) => '<p:sldId id="' + (256 + k) + '" r:id="rId' + (k + 2) + '"/>').join('') + '</p:sldIdLst><p:sldSz cx="' + SW + '" cy="' + SH + '"/><p:notesSz cx="6858000" cy="9144000"/></p:presentation>';

    const files = [
      { name: '[Content_Types].xml', data: XML_HEAD + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>' +
        '<Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>' +
        '<Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml"/>' +
        '<Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"/>' +
        '<Override PartName="/ppt/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>' +
        slides.map((_, k) => '<Override PartName="/ppt/slides/slide' + (k + 1) + '.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>').join('') +
        '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>' },
      { name: '_rels/.rels', data: rels([['rId1', 'officeDocument', 'ppt/presentation.xml'], ['rId2', 'http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties', 'docProps/core.xml']]) },
      { name: 'docProps/core.xml', data: XML_HEAD + '<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>' + esc(deckTitle) + '</dc:title><dc:creator>El Ai</dc:creator></cp:coreProperties>' },
      { name: 'ppt/presentation.xml', data: pres },
      { name: 'ppt/_rels/presentation.xml.rels', data: rels([['rId1', 'slideMaster', 'slideMasters/slideMaster1.xml']].concat(slides.map((_, k) => ['rId' + (k + 2), 'slide', 'slides/slide' + (k + 1) + '.xml']), [['rId' + (n + 2), 'theme', 'theme/theme1.xml']])) },
      { name: 'ppt/slideMasters/slideMaster1.xml', data: master },
      { name: 'ppt/slideMasters/_rels/slideMaster1.xml.rels', data: rels([['rId1', 'slideLayout', '../slideLayouts/slideLayout1.xml'], ['rId2', 'theme', '../theme/theme1.xml']]) },
      { name: 'ppt/slideLayouts/slideLayout1.xml', data: layout },
      { name: 'ppt/slideLayouts/_rels/slideLayout1.xml.rels', data: rels([['rId1', 'slideMaster', '../slideMasters/slideMaster1.xml']]) },
      { name: 'ppt/theme/theme1.xml', data: theme },
    ];
    slides.forEach((x, k) => {
      files.push({ name: 'ppt/slides/slide' + (k + 1) + '.xml', data: x });
      files.push({ name: 'ppt/slides/_rels/slide' + (k + 1) + '.xml.rels', data: rels([['rId1', 'slideLayout', '../slideLayouts/slideLayout1.xml']]) });
    });
    return zip(files);
  }

  const api = { buildPdf, buildDocxFromText, buildDocxFromImages, buildPdfFromMarkdown, buildDocxFromMarkdown, buildPptxFromMarkdown, mdTitle, _parseMd: parseMd, _zip: zip, _crc32: crc32 };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.ElConvert = api;
})(typeof window !== 'undefined' ? window : globalThis);
