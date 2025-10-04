// 直接貼入檢查run


(async function(){
  // ====== 修改或確認 pageSpec（可依需要編輯） ======
  const pageSpec = {
    "Home.php": { ids: ["logo","site-title","navbar","home","news","performance","tickets","carousel","event-info","share-info","fb","google","footer"], classes: ["prev","next","image","title","description"]},
    "News.php": { ids: ["logo","site-title","navbar","home","news","performance","tickets","map","map-info","map-info-image","map-info-text","share-info","fb","google","footer"], classes: ["title"]},
    "Performance.php": { ids: ["logo","site-title","navbar","home","news","performance","tickets","performance-information","portfolio","share-info","fb","google","footer"], classes: ["description","toggle-btn"]},
    "Tickets.php": { ids: ["logo","site-title","navbar","home","news","performance","tickets","name-input","phone-input","password-input","password-confirmation-input","ticket-type","amount-input","total-price","reset-capthca-button","reset-captcha","submit-button","reset-button","share-info","fb","google","footer"], classes: []},
    "Search.php": { ids: ["logo","site-title","phone-input","password-input","captcha","reset-captcha","submit-button"], classes: ["color-box"]},
    "Result.php": { ids: ["logo","site-title","name-list","phone","amount-general-ticket","amount-vip-ticket","total-price","back-button","footer"], classes: ["name"]},
    "AdminLogin.php": { ids: ["username-input","password-input","submit-button"], classes: []},
    "AdminSetting.php": { ids: ["site-title-input","logo-upload","footer-input","save-button"], classes: []},
    "AdminTickets.php": { ids: ["tickets-table","tickets-delete-button","footer"], classes: []},
    "common": { ids: ["logo","site-title","navbar","share-info","fb","google","footer"], classes: ["title","description"] }
  };

  // ====== UI：建立檔案選取器 ======
  function pickFiles() {
    return new Promise(resolve => {
      const input = document.createElement('input');
      input.type = 'file';
      input.multiple = true;
      // accept html/php
      input.accept = '.html,.htm,.php,text/html,application/x-httpd-php';
      input.style.display = 'none';
      document.body.appendChild(input);
      input.addEventListener('change', ()=> {
        resolve(Array.from(input.files));
        input.remove();
      });
      input.click();
    });
  }

  // ====== 讀檔為文字 ======
  function readFileAsText(file) {
    return new Promise((res, rej) => {
      const fr = new FileReader();
      fr.onerror = ()=> rej(fr.error);
      fr.onload = ()=> res(fr.result);
      fr.readAsText(file, 'utf-8');
    });
  }

  // ====== 解析 HTML 並檢查 id & class ======
  function checkHtmlText(text, ids = [], classes = []) {
    const parser = new DOMParser();
    // 若 PHP 等含有 <?php ... ?> 可能影響 parser，先移除 php 區塊
    const cleaned = text.replace(/<\?[\s\S]*?\?>/g, ''); 
    const doc = parser.parseFromString(cleaned, 'text/html');
    const missing = { ids: [], classes: [] };
    ids.forEach(id => {
      if (!doc.getElementById(id)) missing.ids.push(id);
    });
    classes.forEach(cls => {
      if (doc.getElementsByClassName(cls).length === 0) missing.classes.push(cls);
    });
    return missing;
  }

  // ====== 對檔名做頁面對應 (簡單包含比對，忽略大小寫) ======
  function matchSpecKeyByFilename(filename, specKeys) {
    const lower = filename.toLowerCase();
    // 1) exact match
    for (const k of specKeys) {
      if (k.toLowerCase() === lower) return k;
    }
    // 2) filename contains key without extension
    for (const k of specKeys) {
      const keyNoExt = k.replace(/\.[^.]+$/,'').toLowerCase();
      if (lower.includes(keyNoExt)) return k;
    }
    // 3) fallback: try common
    if (specKeys.includes('common')) return 'common';
    return null;
  }

  // ====== 主流程 ======
  const picked = await pickFiles();
  if (!picked || picked.length === 0) {
    alert('未選取檔案，取消。');
    return;
  }

  // prepare list of keys to check (exclude meta if any)
  const specKeys = Object.keys(pageSpec).filter(k => k !== 'meta');

  // read all files
  const filesData = [];
  for (const f of picked) {
    try {
      const txt = await readFileAsText(f);
      filesData.push({ file: f, name: f.name, text: txt });
    } catch (e) {
      filesData.push({ file: f, name: f.name, text: '', error: e });
    }
  }

  // build report per spec key
  const report = {};
  for (const k of specKeys) {
    if (k === 'common') continue;
    const expectedIds = Array.from(new Set([...(pageSpec[k].ids||[]), ...(pageSpec.common?.ids||[]) ]));
    const expectedClasses = Array.from(new Set([...(pageSpec[k].classes||[]), ...(pageSpec.common?.classes||[]) ]));
    report[k] = { expectedIds, expectedClasses, matchedFiles: [], found: {}, missing: { ids: [], classes: [] } };
    expectedIds.forEach(id => report[k].found[`id:${id}`] = []);
    expectedClasses.forEach(c => report[k].found[`class:${c}`] = []);
  }

  // check each uploaded file: try to map it to a spec key and check
  for (const fdata of filesData) {
    const mappedKey = matchSpecKeyByFilename(fdata.name, specKeys) || 'common';
    // prefer mapping to pages, not 'common'
    let targetKeys = [];
    if (mappedKey === 'common') {
      // add to all pages as "found in file" search
      targetKeys = specKeys.filter(k => k !== 'common');
    } else {
      targetKeys = [mappedKey];
    }
    for (const tk of targetKeys) {
      const expectedIds = report[tk].expectedIds;
      const expectedClasses = report[tk].expectedClasses;
      const missing = checkHtmlText(fdata.text, expectedIds, expectedClasses);
      // record found occurrences (we'll record non-missing as found; and missing later)
      // for simplicity, if an id/class is NOT missing, record as found in this file
      expectedIds.forEach(id => {
        if (missing.ids.indexOf(id) === -1) {
          report[tk].found[`id:${id}`].push({file: fdata.name});
        }
      });
      expectedClasses.forEach(c => {
        if (missing.classes.indexOf(c) === -1) {
          report[tk].found[`class:${c}`].push({file: fdata.name});
        }
      });
      if (!report[tk].matchedFiles.includes(fdata.name)) report[tk].matchedFiles.push(fdata.name);
    }
  }

  // determine missing per page
  for (const [page, info] of Object.entries(report)) {
    const missIds = [], missClasses = [];
    info.expectedIds.forEach(id => {
      if (!info.found[`id:${id}`] || info.found[`id:${id}`].length === 0) missIds.push(id);
    });
    info.expectedClasses.forEach(c => {
      if (!info.found[`class:${c}`] || info.found[`class:${c}`].length === 0) missClasses.push(c);
    });
    info.missing.ids = missIds;
    info.missing.classes = missClasses;
  }

  // build summary
  const summaryLines = [];
  let pagesMissingCount = 0;
  for (const [page, info] of Object.entries(report)) {
    if (info.missing.ids.length || info.missing.classes.length) {
      pagesMissingCount++;
      summaryLines.push(`${page} — IDs missing: ${info.missing.ids.join(', ') || '無'} ; Classes missing: ${info.missing.classes.join(', ') || '無'}`);
    }
  }

  const summaryText = summaryLines.length ? summaryLines.join('\n') : 'All expected ids/classes were found in the provided files.';

  // open report in a new window/tab
  const reportWindow = window.open('', '_blank');
  const html = `
    <html><head><meta charset="utf-8"><title>ID/Class Check Report</title>
    <style>body{font-family:Segoe UI,system-ui;padding:20px;} code{background:#f4f4f4;padding:2px 6px;border-radius:4px;} section{border:1px solid #ddd;padding:10px;margin:10px 0}</style>
    </head><body>
    <h1>ID/Class Check Report</h1>
    <p>Files checked: <strong>${filesData.length}</strong></p>
    <h2>Summary</h2>
    <pre>${summaryText}</pre>
    <h2>Details</h2>
    ${Object.entries(report).map(([p,info])=>{
      const matched = info.matchedFiles.length ? `<div>Matched files: ${info.matchedFiles.join(', ')}</div>` : '';
      const missingHtml = (info.missing.ids.length||info.missing.classes.length) ? `<div style="color:#b00"><strong>Missing:</strong><div>IDs: ${info.missing.ids.join(', ')||'—'}</div><div>Classes: ${info.missing.classes.join(', ')||'—'}</div></div>` : `<div style="color:green"><strong>All found</strong></div>`;
      return `<section><h3>${p}</h3>${matched}${missingHtml}</section>`;
    }).join('')}
    <script>setTimeout(()=>{ alert(${JSON.stringify(pagesMissingCount?('有 '+pagesMissingCount+' 個頁面缺少 ID/Class，詳情請見此頁面。'):'檢查完成：所有指定 id/class 已找到。')}); },200);</script>
    </body></html>
  `;
  reportWindow.document.open();
  reportWindow.document.write(html);
  reportWindow.document.close();

  console.log('Done. Report opened in new tab.');
})();
