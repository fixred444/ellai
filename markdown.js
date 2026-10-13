// Renderer Markdown kecil (tanpa dependensi). Semua teks di-escape dulu supaya aman dari XSS.
(function (root) {
  'use strict';

  function esc(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function inline(s) {
    const codes = [];
    s = s.replace(/`([^`\n]+)`/g, (m, c) => { codes.push(c); return '\u0001' + (codes.length - 1) + '\u0001'; });
    s = s
      .replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>')
      .replace(/(^|[^*])\*([^*\s][^*\n]*)\*(?!\*)/g, '$1<em>$2</em>')
      .replace(/~~([^~\n]+)~~/g, '<del>$1</del>')
      .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
    return s.replace(/\u0001(\d+)\u0001/g, (m, i) => '<code>' + codes[i] + '</code>');
  }

  function codeBlock(b) {
    const lang = esc(b.lang || 'kode');
    return '<div class="code"><div class="code-head"><span>' + lang + '</span>' +
      '<button type="button" class="copy-code" data-copy-code>Salin</button></div>' +
      '<pre><code>' + esc(b.code) + '</code></pre></div>';
  }

  const UL = /^\s*[-*+]\s+/;
  const OL = /^\s*\d+[.)]\s+/;
  const SEP = /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)+\|?\s*$/;

  function cells(row) {
    return row.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
  }

  function render(src) {
    const codes = [];
    const text = String(src).replace(/\r\n?/g, '\n').replace(/```([\w+#.-]*)[^\S\n]*\n?([\s\S]*?)(?:```|$)/g, (m, lang, code) => {
      codes.push({ lang, code: code.replace(/\n$/, '') });
      return '\n\u0002' + (codes.length - 1) + '\u0002\n';
    });

    const lines = esc(text).split('\n');
    let out = '';
    let para = [];
    let i = 0;
    const flush = () => {
      if (para.length) { out += '<p>' + inline(para.join('<br>')) + '</p>'; para = []; }
    };

    function collectList(re, ordered) {
      const first = lines[i].match(/^\s*(\d+)/);
      const items = [];
      while (i < lines.length) {
        if (re.test(lines[i])) {
          items.push(lines[i].replace(re, ''));
          i++;
        } else if (items.length && /^\s{2,}\S/.test(lines[i]) && !UL.test(lines[i]) && !OL.test(lines[i])) {
          items[items.length - 1] += '<br>' + lines[i].trim();
          i++;
        } else {
          break;
        }
        // izinkan baris kosong di antara item daftar yang sama
        let j = i;
        while (j < lines.length && !lines[j].trim()) j++;
        if (j > i && j < lines.length && re.test(lines[j])) i = j;
      }
      const tag = ordered ? 'ol' : 'ul';
      const start = ordered && first && first[1] !== '1' ? ' start="' + first[1] + '"' : '';
      out += '<' + tag + start + '>' + items.map((x) => '<li>' + inline(x) + '</li>').join('') + '</' + tag + '>';
    }

    while (i < lines.length) {
      const l = lines[i];
      let m;

      if (!l.trim()) { flush(); i++; continue; }

      if ((m = l.match(/^\u0002(\d+)\u0002$/))) { flush(); out += codeBlock(codes[+m[1]]); i++; continue; }

      if ((m = l.match(/^(#{1,4})\s+(.*)$/))) {
        flush();
        const level = m[1].length + 1;
        out += '<h' + level + '>' + inline(m[2]) + '</h' + level + '>';
        i++; continue;
      }

      if (/^\s*([-*_])\s*\1\s*\1[\s\-*_]*$/.test(l)) { flush(); out += '<hr>'; i++; continue; }

      if (/^\s*&gt;\s?/.test(l)) {
        flush();
        const q = [];
        while (i < lines.length && /^\s*&gt;\s?/.test(lines[i])) { q.push(lines[i].replace(/^\s*&gt;\s?/, '')); i++; }
        out += '<blockquote>' + inline(q.join('<br>')) + '</blockquote>';
        continue;
      }

      if (UL.test(l)) { flush(); collectList(UL, false); continue; }
      if (OL.test(l)) { flush(); collectList(OL, true); continue; }

      if (l.includes('|') && i + 1 < lines.length && SEP.test(lines[i + 1])) {
        flush();
        const head = cells(l);
        i += 2;
        const rows = [];
        while (i < lines.length && lines[i].trim() && lines[i].includes('|')) { rows.push(cells(lines[i])); i++; }
        out += '<div class="table-wrap"><table><thead><tr>' + head.map((c) => '<th>' + inline(c) + '</th>').join('') + '</tr></thead><tbody>' +
          rows.map((r) => '<tr>' + head.map((_, k) => '<td>' + inline(r[k] || '') + '</td>').join('') + '</tr>').join('') +
          '</tbody></table></div>';
        continue;
      }

      para.push(l);
      i++;
    }
    flush();
    return out;
  }

  const api = { render, esc };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.ElMd = api;
})(typeof window !== 'undefined' ? window : globalThis);
