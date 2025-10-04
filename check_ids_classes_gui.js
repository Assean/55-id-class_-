/**
 * check_ids_classes_gui.js
 * Usage:
 *   node check_ids_classes_gui.js path/to/page_spec.json "D:\\xampp\\htdocs\\技能競賽\\55界技能競賽(全國；分區)\\分區(複習)" path/to/optional.pdf
 *
 * - 第1個參數: page_spec.json 的路徑 (required)
 * - 第2個參數: 要掃描的資料夾路徑 (required)
 * - 第3個參數: PDF 檔案路徑 (optional) -> 如果提供，程式會嘗試把 PDF 轉文字再搜尋其中的 id/class
 *
 * 會產生:
 * - report.json
 * - report.html (並自動在預設瀏覽器開啟，載入時會 alert() 缺少項目)
 */

const fs = require('fs');
const path = require('path');
const child_process = require('child_process');

// optional pdf parsing
let pdfParse = null;
try { pdfParse = require('pdf-parse'); } catch(e){ /* pdf-parse not installed, PDF search skipped */ }

if (process.argv.length < 4) {
  console.error('Usage: node check_ids_classes_gui.js path/to/page_spec.json path/to/search_folder [path/to/file.pdf]');
  process.exit(1);
}

const specPath = process.argv[2];
const searchFolder = process.argv[3];
const pdfPath = process.argv[4] || null;

if (!fs.existsSync(specPath)) {
  console.error('Spec file not found:', specPath);
  process.exit(1);
}
if (!fs.existsSync(searchFolder)) {
  console.error('Search folder not found:', searchFolder);
  process.exit(1);
}

const spec = JSON.parse(fs.readFileSync(specPath, 'utf8'));
const caseSensitive = !!(spec.meta && spec.meta.case_sensitive);
const fileExts = ['.html', '.htm', '.php'];

// helper walk
function walk(dir, filelist = []) {
  const files = fs.readdirSync(dir);
  files.forEach(f => {
    const full = path.join(dir, f);
    const stat = fs.statSync(full);
    if (stat.isDirectory()) {
      walk(full, filelist);
    } else {
      const ext = path.extname(full).toLowerCase();
      if (fileExts.includes(ext)) filelist.push(full);
    }
  });
  return filelist;
}

// build regex helpers
function idRegex(id) {
  // match id="foo" or id='foo' with optional spaces, case insensitive maybe
  return new RegExp(`id\\s*=\\s*["']${escapeRegExp(id)}["']`, caseSensitive ? '' : 'i');
}
function classRegex(cls) {
  // match class="... cls ..." or class='... cls ...' (word boundary)
  return new RegExp(`class\\s*=\\s*["'][^"']*(?:^|\\s)${escapeRegExp(cls)}(?:\\s|$)[^"']*["']`, caseSensitive ? '' : 'i');
}
function escapeRegExp(string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// get list of files to scan
const files = walk(searchFolder);

// read each file content
const fileContents = {};
files.forEach(file => {
  try {
    const txt = fs.readFileSync(file, 'utf8');
    fileContents[file] = txt;
  } catch (e) {
    // try reading as binary then to string (fallback)
    try {
      const txt = fs.readFileSync(file);
      fileContents[file] = txt.toString('utf8');
    } catch (ee) {
      fileContents[file] = '';
    }
  }
});

// optional: read PDF text
async function readPdfText(pdfPath) {
  if (!pdfPath || !pdfParse) return '';
  if (!fs.existsSync(pdfPath)) return '';
  const data = fs.readFileSync(pdfPath);
  try {
    const res = await pdfParse(data);
    return res.text || '';
  } catch (e) {
    console.warn('Failed to parse PDF:', e.message);
    return '';
  }
}

// compile expected pages from spec (ignore "meta" and "common")
const pages = {};
for (const k of Object.keys(spec)) {
  if (k === 'meta' || k === 'common') continue;
  pages[k] = {
    ids: Array.isArray(spec[k].ids) ? spec[k].ids.slice() : [],
    classes: Array.isArray(spec[k].classes) ? spec[k].classes.slice() : []
  };
}

// if common exists, you may want to ensure common ones are present in each page (optional)
if (spec.common) {
  const commonIds = spec.common.ids || [];
  const commonClasses = spec.common.classes || [];
  for (const p of Object.keys(pages)) {
    pages[p].ids = Array.from(new Set([...pages[p].ids, ...commonIds]));
    pages[p].classes = Array.from(new Set([...pages[p].classes, ...commonClasses]));
  }
}

(async () => {
  const pdfText = await readPdfText(pdfPath);

  const report = {
    scannedFolder: searchFolder,
    scannedFilesCount: files.length,
    pages: {},
    timestamp: new Date().toISOString()
  };

  // For each expected page (spec key), try to find candidate files in the scanned files
  // We'll match by filename (case-insensitive by default)
  for (const pageName of Object.keys(pages)) {
    const expected = pages[pageName];
    const lowerName = pageName.toLowerCase();
    // find all files whose filename matches pageName (exact) OR contains pageName without extension
    const candidates = files.filter(f => {
      const base = path.basename(f).toLowerCase();
      return base === lowerName || base === lowerName.toLowerCase() || base.startsWith(lowerName.replace('.php','').toLowerCase());
    });

    // If no exact-match file, also attempt to find files that contain the "page key" in filename
    if (candidates.length === 0) {
      for (const f of files) {
        const bn = path.basename(f).toLowerCase();
        if (bn.includes(lowerName.replace('.php','').toLowerCase())) candidates.push(f);
      }
    }

    // Evaluate expected ids/classes across candidates and the PDF text
    const pageReport = {
      expectedIds: expected.ids,
      expectedClasses: expected.classes,
      found: {},
      missing: { ids: [], classes: [] },
      matchedFiles: candidates
    };

    // initialize found mapping
    expected.ids.forEach(i => pageReport.found[`id:${i}`] = []);
    expected.classes.forEach(c => pageReport.found[`class:${c}`] = []);

    // search in candidate files
    for (const f of candidates) {
      const content = fileContents[f] || '';
      const lines = content.split(/\r?\n/);
      // search ids
      expected.ids.forEach(id => {
        const re = idRegex(id);
        lines.forEach((ln, idx) => {
          if (re.test(ln)) {
            pageReport.found[`id:${id}`].push({file: f, line: idx + 1, excerpt: ln.trim()});
          }
        });
      });
      // search classes
      expected.classes.forEach(cls => {
        const re = classRegex(cls);
        lines.forEach((ln, idx) => {
          if (re.test(ln)) {
            pageReport.found[`class:${cls}`].push({file: f, line: idx + 1, excerpt: ln.trim()});
          }
        });
      });
    }

    // also search in all files if candidate list empty (fallback)
    if (candidates.length === 0) {
      for (const f of files) {
        const content = fileContents[f] || '';
        expected.ids.forEach(id => {
          const re = idRegex(id);
          if (re.test(content)) {
            pageReport.found[`id:${id}`].push({file: f, line: 0, excerpt: 'found in file (no line info)'});
          }
        });
        expected.classes.forEach(cls => {
          const re = classRegex(cls);
          if (re.test(content)) {
            pageReport.found[`class:${cls}`].push({file: f, line: 0, excerpt: 'found in file (no line info)'});
          }
        });
      }
    }

    // search in PDF text (if any)
    if (pdfText) {
      expected.ids.forEach(id => {
        const re = new RegExp(`\\b${escapeRegExp(id)}\\b`, caseSensitive ? '' : 'i');
        if (re.test(pdfText)) {
          pageReport.found[`id:${id}`].push({file: pdfPath, line: 0, excerpt: 'found in PDF text'});
        }
      });
      expected.classes.forEach(cls => {
        const re = new RegExp(`\\b${escapeRegExp(cls)}\\b`, caseSensitive ? '' : 'i');
        if (re.test(pdfText)) {
          pageReport.found[`class:${cls}`].push({file: pdfPath, line: 0, excerpt: 'found in PDF text'});
        }
      });
    }

    // determine missing (no occurrences)
    expected.ids.forEach(id => {
      if (!pageReport.found[`id:${id}`] || pageReport.found[`id:${id}`].length === 0) {
        pageReport.missing.ids.push(id);
      }
    });
    expected.classes.forEach(cls => {
      if (!pageReport.found[`class:${cls}`] || pageReport.found[`class:${cls}`].length === 0) {
        pageReport.missing.classes.push(cls);
      }
    });

    report.pages[pageName] = pageReport;
  }

  // also create a summary of missing across all pages
  const summary = {};
  for (const p of Object.keys(report.pages)) {
    const miss = report.pages[p].missing;
    if (miss.ids.length || miss.classes.length) {
      summary[p] = miss;
    }
  }

  // write report.json
  fs.writeFileSync('report.json', JSON.stringify(report, null, 2), 'utf8');

  // produce an HTML report and auto-open it; the HTML onload will alert() summary of missing items
  const html = buildHtmlReport(report, summary);
  fs.writeFileSync('report.html', html, 'utf8');

  // open in default browser (Windows: start, mac: open, linux: xdg-open)
  openFile('report.html');

  console.log('Scan complete. report.json + report.html generated. report.html will open in your browser.');

})();

function buildHtmlReport(report, summary) {
  const summaryText = Object.keys(summary).length === 0
    ? 'All expected ids/classes were found in scanned files.'
    : Object.entries(summary).map(([p, s]) => {
        const ids = s.ids.length ? `IDs missing: ${s.ids.join(', ')}` : '';
        const cls = s.classes.length ? `Classes missing: ${s.classes.join(', ')}` : '';
        return `<strong>${p}</strong>: ${[ids, cls].filter(x=>x).join(' ; ')}`;
      }).join('\\n');

  // prepare full details
  const pagesHtml = Object.entries(report.pages).map(([p, info]) => {
    const foundItems = Object.entries(info.found).map(([k, arr]) => {
      const pretty = arr.map(a => `${escapeHtml(a.file)}${a.line?(' (line '+a.line+')'):''} - ${escapeHtml(a.excerpt)}`).join('<br>');
      return `<li><code>${escapeHtml(k)}</code> (${arr.length})<div style="margin-left:12px">${pretty || '—'}</div></li>`;
    }).join('');
    const missingHtml = (info.missing.ids.length || info.missing.classes.length)
      ? `<div style="color:#b00"><strong>Missing:</strong><div>IDs: ${info.missing.ids.join(', ') || '—'}</div><div>Classes: ${info.missing.classes.join(', ') || '—'}</div></div>`
      : `<div style="color:green"><strong>All found</strong></div>`;
    const matchedFiles = info.matchedFiles.length ? `<div><em>Matched files: ${info.matchedFiles.map(f=>escapeHtml(f)).join(', ')}</em></div>` : '';
    return `<section style="border:1px solid #ddd;padding:10px;margin:10px 0"><h3>${escapeHtml(p)}</h3>${matchedFiles}${missingHtml}<ul>${foundItems}</ul></section>`;
  }).join('\\n');

  const html = `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<title>ID/Class Check Report</title>
<style>
  body{font-family:system-ui,Segoe UI,Roboto,Helvetica,Arial;margin:20px;}
  code{background:#f4f4f4;padding:2px 6px;border-radius:4px;}
  section h3{margin:0 0 6px 0;}
</style>
</head>
<body>
  <h1>ID / Class Check Report</h1>
  <p>Scanned folder: <code>${escapeHtml(report.scannedFolder)}</code></p>
  <p>Files scanned: ${report.scannedFilesCount}</p>
  <h2>Summary</h2>
  <pre id="summary-block">${escapeHtml(summaryText)}</pre>
  <h2>Details</h2>
  ${pagesHtml}
  <script>
    // On load, show an alert popup with a concise missing summary
    const summary = document.getElementById('summary-block').innerText;
    if (summary && summary !== 'All expected ids/classes were found in scanned files.') {
      alert('Missing items found:\\n\\n' + summary);
    } else {
      alert('檢查完成：所有指定 id/class 已找到（或在 PDF/檔案中被找到）。');
    }
  </script>
</body>
</html>`;
  return html;
}

function escapeHtml(str) {
  return (str+'').replace(/[&<>"]/g, function(m){ return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[m]; });
}

function openFile(file) {
  const plat = process.platform;
  const abs = path.resolve(file);
  if (plat === 'win32') {
    child_process.exec(`start "" "${abs.replace(/"/g,'\\"')}"`);
  } else if (plat === 'darwin') {
    child_process.exec(`open "${abs}"`);
  } else {
    child_process.exec(`xdg-open "${abs}"`);
  }
}
