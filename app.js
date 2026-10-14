/* app.js — 颜文字管理：状态、渲染、复制、增删改、导入导出、换肤 */
(function () {
  'use strict';

  var STORE_KEY = 'kaomoji.store.v1';
  var ACCENT_KEY = 'kaomoji.accent';
  var ACCENTS = [
    { name: '紫罗兰', value: '#7C5CFF' },
    { name: '蓝', value: '#3B82F6' },
    { name: '粉', value: '#EC4899' },
    { name: '绿', value: '#10B981' }
  ];

  var store = null;                       // { version, categories, entries }
  var state = { filter: 'all', keyword: '' };
  var editingId = null;
  var toastTimer = null;

  var $ = function (sel) { return document.querySelector(sel); };
  var overlay, sheet, chipsEl, listEl, searchEl, toastEl, importFileEl;

  /* ---------- 工具 ---------- */
  function uid() {
    return 'k_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 7);
  }
  function escHtml(s) {
    return String(s).replace(/[&<>]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c];
    });
  }
  function escAttr(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function hexToRgba(hex, a) {
    var n = String(hex).replace('#', '');
    var r = parseInt(n.slice(0, 2), 16),
        g = parseInt(n.slice(2, 4), 16),
        b = parseInt(n.slice(4, 6), 16);
    return 'rgba(' + r + ',' + g + ',' + b + ',' + a + ')';
  }

  /* ---------- 主题色 ---------- */
  function applyAccent(hex, persist) {
    document.documentElement.style.setProperty('--accent', hex);
    document.documentElement.style.setProperty('--accent-weak', hexToRgba(hex, 0.12));
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', hex);
    if (persist !== false) {
      try { localStorage.setItem(ACCENT_KEY, hex); } catch (e) { /* 忽略 */ }
    }
  }
  function currentAccent() {
    var hex = ACCENTS[0].value;
    try { hex = localStorage.getItem(ACCENT_KEY) || hex; } catch (e) { /* 忽略 */ }
    return hex;
  }

  /* ---------- 存储 ---------- */
  function mergeCategories(existing, defaults) {
    var out = (existing || []).slice();
    (defaults || []).forEach(function (c) { if (out.indexOf(c) === -1) out.push(c); });
    return out;
  }
  function seedEntries() {
    return SEED_KAOMOJIS.map(function (seed) {
      return {
        id: uid(),
        text: seed.text,
        category: seed.category,
        tags: (seed.tags || []).slice(),
        custom: false,
        favorite: false,
        useCount: 0,
        lastUsedAt: null
      };
    });
  }
  function loadStore() {
    var raw = null;
    try { raw = localStorage.getItem(STORE_KEY); } catch (e) { /* 忽略 */ }
    if (raw) {
      try {
        var parsed = JSON.parse(raw);
        if (parsed && Array.isArray(parsed.entries)) {
          store = parsed;
          store.categories = mergeCategories(store.categories, DEFAULT_CATEGORIES);
          store.entries.forEach(function (e) {
            if (typeof e.favorite !== 'boolean') e.favorite = false;
            if (typeof e.useCount !== 'number') e.useCount = 0;
            if (e.lastUsedAt === undefined) e.lastUsedAt = null;
            if (!Array.isArray(e.tags)) e.tags = [];
            if (typeof e.custom !== 'boolean') e.custom = false;
          });
          return;
        }
      } catch (e) { /* 解析失败则重新初始化 */ }
    }
    store = {
      version: 1,
      categories: DEFAULT_CATEGORIES.slice(),
      entries: seedEntries()
    };
    saveStore();
  }
  function saveStore() {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(store));
    } catch (e) {
      toast('保存失败：本地存储空间不足');
    }
  }

  /* ---------- Toast ---------- */
  function toast(msg) {
    toastEl.textContent = msg;
    toastEl.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toastEl.hidden = true; }, 1400);
  }

  /* ---------- 复制 ---------- */
  function copyText(text, done) {
    function fallback() {
      try {
        var ta = document.createElement('textarea');
        ta.value = text;
        ta.setAttribute('readonly', '');
        ta.style.position = 'fixed';
        ta.style.top = '-1000px';
        document.body.appendChild(ta);
        ta.select();
        ta.setSelectionRange(0, text.length);
        var ok = document.execCommand('copy');
        document.body.removeChild(ta);
        done(ok);
      } catch (e) { done(false); }
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () { done(true); }, fallback);
    } else {
      fallback();
    }
  }

  /* ---------- 过滤与渲染 ---------- */
  function matchesKeyword(entry, kw) {
    if (String(entry.text).toLowerCase().indexOf(kw) !== -1) return true;
    if (String(entry.category || '').toLowerCase().indexOf(kw) !== -1) return true;
    return (entry.tags || []).some(function (t) {
      return String(t).toLowerCase().indexOf(kw) !== -1;
    });
  }
  function getFiltered() {
    var list = store.entries.slice();
    var f = state.filter;
    if (f === 'favorite') {
      list = list.filter(function (e) { return e.favorite; });
    } else if (f === 'recent') {
      list = list.filter(function (e) { return e.lastUsedAt; })
        .sort(function (a, b) { return b.lastUsedAt - a.lastUsedAt; })
        .slice(0, 30);
    } else if (f === 'hot') {
      list = list.filter(function (e) { return e.useCount > 0; })
        .sort(function (a, b) { return b.useCount - a.useCount; })
        .slice(0, 30);
    } else if (f !== 'all') {
      list = list.filter(function (e) { return e.category === f; });
    }
    var kw = state.keyword.trim().toLowerCase();
    if (kw) list = list.filter(function (e) { return matchesKeyword(e, kw); });
    return list;
  }
  function cardHTML(e) {
    return '' +
      '<div class="card" data-id="' + escAttr(e.id) + '">' +
        '<button class="icon-btn fav' + (e.favorite ? ' on' : '') + '" data-act="fav" aria-label="收藏">' +
          (e.favorite ? '★' : '☆') +
        '</button>' +
        '<button class="icon-btn more" data-act="more" aria-label="更多操作">⋯</button>' +
        '<div class="face">' + escHtml(e.text) + '</div>' +
      '</div>';
  }
  function renderChips() {
    var items = [
      { key: 'all', label: '全部' },
      { key: 'hot', label: '常用' },
      { key: 'favorite', label: '★ 收藏' },
      { key: 'recent', label: '最近' }
    ].concat(store.categories.map(function (c) { return { key: c, label: c }; }));

    chipsEl.innerHTML = items.map(function (it) {
      var active = state.filter === it.key ? ' active' : '';
      return '<button class="chip' + active + '" data-filter="' + escAttr(it.key) + '">' +
        escHtml(it.label) + '</button>';
    }).join('');
  }
  function render() {
    renderChips();
    var list = getFiltered();
    if (!list.length) {
      listEl.innerHTML = '<div class="empty">没有找到颜文字<br><span>换个关键词或分类试试～</span></div>';
      return;
    }
    listEl.innerHTML = list.map(cardHTML).join('');
    var activeChip = chipsEl.querySelector('.chip.active');
    if (activeChip) activeChip.scrollIntoView({ inline: 'center', block: 'nearest' });
  }

  /* ---------- 交互动作 ---------- */
  function handleCardTap(entry) {
    copyText(entry.text, function (ok) {
      if (ok) {
        entry.useCount = (entry.useCount || 0) + 1;
        entry.lastUsedAt = Date.now();
        saveStore();
        toast('已复制 ✓');
        if (state.filter === 'recent' || state.filter === 'hot') render();
      } else {
        toast('复制失败，请长按手动选择');
      }
    });
  }
  function toggleFavorite(entry) {
    entry.favorite = !entry.favorite;
    saveStore();
    render();
    toast(entry.favorite ? '已收藏 ★' : '已取消收藏');
  }

  /* ---------- 弹层 ---------- */
  function showOverlay() { overlay.hidden = false; }
  function closeSheet() {
    overlay.hidden = true;
    sheet.innerHTML = '';
    editingId = null;
  }

  function openEditor(entry) {
    editingId = entry ? entry.id : null;
    var current = entry ? entry.category : '其他';
    if (store.categories.indexOf(current) === -1) store.categories.push(current);
    var catOptions = store.categories.map(function (c) {
      return '<option value="' + escAttr(c) + '"' + (c === current ? ' selected' : '') + '>' +
        escHtml(c) + '</option>';
    }).join('') + '<option value="__new__">＋ 新建分类…</option>';
    sheet.innerHTML = '' +
      '<h2>' + (entry ? '编辑颜文字' : '新增颜文字') + '</h2>' +
      '<div class="field">' +
        '<label>颜文字（可粘贴多行，每行一条）</label>' +
        '<textarea id="fText" placeholder="例如 (๑•̀ㅂ•́)و✧">' + (entry ? escHtml(entry.text) : '') + '</textarea>' +
      '</div>' +
      '<div class="field">' +
        '<label>分类</label>' +
        '<select id="fCat">' + catOptions + '</select>' +
        '<input id="fCatNew" placeholder="输入新分类名" style="display:none;margin-top:8px">' +
      '</div>' +
      '<div class="field">' +
        '<label>标签（用逗号分隔，便于搜索）</label>' +
        '<input id="fTags" value="' + escAttr(entry ? (entry.tags || []).join(',') : '') + '" placeholder="如：加油,奋斗">' +
      '</div>' +
      '<div class="row">' +
        '<button class="btn" id="cancelBtn">取消</button>' +
        '<button class="btn primary" id="saveBtn">保存</button>' +
      '</div>' +
      (entry ? '<button class="btn danger" id="delBtn">删除</button>' : '');
    showOverlay();
    $('#cancelBtn').onclick = closeSheet;
    $('#saveBtn').onclick = saveEditor;
    var del = $('#delBtn');
    if (del) del.onclick = function () { deleteEntry(editingId); };
    var catSel = $('#fCat');
    var catNew = $('#fCatNew');
    catSel.onchange = function () {
      var isNew = catSel.value === '__new__';
      catNew.style.display = isNew ? 'block' : 'none';
      if (isNew) catNew.focus();
    };
    var ta = $('#fText');
    if (ta) ta.focus();
  }

  function saveEditor() {
    var text = $('#fText').value;
    var sel = $('#fCat').value;
    var category;
    if (sel === '__new__') {
      category = ($('#fCatNew').value || '').trim();
      if (!category) { toast('请输入新分类名'); return; }
    } else {
      category = sel;
    }
    var tags = ($('#fTags').value || '').split(/[,，\s]+/).map(function (s) { return s.trim(); })
      .filter(Boolean);

    if (!text.trim()) { toast('请输入颜文字'); return; }
    if (store.categories.indexOf(category) === -1) store.categories.push(category);

    if (editingId) {
      var e = store.entries.filter(function (x) { return x.id === editingId; })[0];
      if (e) {
        e.text = text.split('\n')[0].trim();
        e.category = category;
        e.tags = tags;
      }
      saveStore();
      closeSheet();
      render();
      toast('已保存');
      return;
    }

    var lines = text.split('\n').map(function (s) { return s.trim(); }).filter(Boolean);
    var uniq = [];
    lines.forEach(function (l) { if (uniq.indexOf(l) === -1) uniq.push(l); });

    var added = 0, skipped = 0;
    uniq.forEach(function (l) {
      var dup = store.entries.some(function (x) { return x.text === l; });
      if (dup) { skipped++; return; }
      store.entries.push({
        id: uid(), text: l, category: category, tags: tags.slice(),
        custom: true, favorite: false, useCount: 0, lastUsedAt: null
      });
      added++;
    });
    saveStore();
    closeSheet();
    render();
    toast('已添加 ' + added + ' 条' + (skipped ? '，跳过重复 ' + skipped + ' 条' : ''));
  }

  function deleteEntry(id) {
    var e = store.entries.filter(function (x) { return x.id === id; })[0];
    if (!e) return;
    if (!e.custom) { toast('内置颜文字不可删除'); return; }
    if (!confirm('确定删除这条颜文字吗？')) return;
    store.entries = store.entries.filter(function (x) { return x.id !== id; });
    saveStore();
    closeSheet();
    render();
    toast('已删除');
  }

  function openActions(entry) {
    var canEdit = !!entry.custom;
    sheet.innerHTML = '' +
      '<h2>操作</h2>' +
      '<div class="face-lg">' + escHtml(entry.text) + '</div>' +
      '<button class="btn primary" id="aCopy">复制</button>' +
      '<button class="btn" id="aFav">' + (entry.favorite ? '取消收藏' : '收藏') + '</button>' +
      '<button class="btn" id="aEdit"' + (canEdit ? '' : ' disabled') + '>编辑</button>' +
      '<button class="btn danger" id="aDel"' + (canEdit ? '' : ' disabled') + '>删除</button>' +
      (canEdit ? '' : '<div class="note">内置颜文字不可编辑/删除</div>') +
      '<button class="btn" id="aCancel">取消</button>';
    showOverlay();
    $('#aCopy').onclick = function () { closeSheet(); handleCardTap(entry); };
    $('#aFav').onclick = function () { closeSheet(); toggleFavorite(entry); };
    $('#aEdit').onclick = function () { if (canEdit) openEditor(entry); };
    $('#aDel').onclick = function () { if (canEdit) deleteEntry(entry.id); };
    $('#aCancel').onclick = closeSheet;
  }

  /* ---------- 设置 ---------- */
  function openSettings() {
    var cur = currentAccent().toLowerCase();
    var dots = ACCENTS.map(function (a) {
      var active = a.value.toLowerCase() === cur ? ' active' : '';
      return '<button class="dot' + active + '" data-accent="' + a.value + '" ' +
        'style="background:' + a.value + '" title="' + escAttr(a.name) + '" ' +
        'aria-label="' + escAttr(a.name) + '"></button>';
    }).join('');
    sheet.innerHTML = '' +
      '<h2>设置</h2>' +
      '<div class="field"><label>主题色</label></div>' +
      '<div class="accent-row">' + dots + '</div>' +
      '<button class="btn" id="sExport">导出数据（JSON 备份）</button>' +
      '<button class="btn" id="sImport">导入数据</button>' +
      '<button class="btn" id="sReset">恢复内置库</button>' +
      '<button class="btn danger" id="sClear">清空自定义</button>' +
      '<button class="btn" id="sClose">关闭</button>';
    showOverlay();
    Array.prototype.forEach.call(sheet.querySelectorAll('.dot'), function (d) {
      d.onclick = function () {
        applyAccent(d.dataset.accent, true);
        Array.prototype.forEach.call(sheet.querySelectorAll('.dot'), function (x) {
          x.classList.remove('active');
        });
        d.classList.add('active');
      };
    });
    $('#sExport').onclick = exportData;
    $('#sImport').onclick = function () { importFileEl.click(); };
    $('#sReset').onclick = resetToSeed;
    $('#sClear').onclick = clearCustom;
    $('#sClose').onclick = closeSheet;
  }

  /* ---------- 导入导出 ---------- */
  function exportData() {
    var data = JSON.stringify(store, null, 2);
    var blob = new Blob([data], { type: 'application/json' });
    var url = URL.createObjectURL(blob);
    var d = new Date();
    var pad = function (n) { return String(n).padStart(2, '0'); };
    var name = 'kaomoji-backup-' + d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate()) + '.json';
    var a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
    toast('已导出备份');
  }

  function importData(file) {
    if (!file) return;
    var reader = new FileReader();
    reader.onload = function () {
      var data;
      try { data = JSON.parse(reader.result); } catch (e) { toast('文件格式错误'); return; }
      var entries = Array.isArray(data) ? data : (data && data.entries);
      if (!Array.isArray(entries)) { toast('文件格式错误'); return; }

      var mode = confirm('确定：合并到现有数据（自动跳过重复）\n取消：替换全部数据') ? 'merge' : 'replace';
      var normalized = entries.map(function (e) {
        return {
          id: uid(),
          text: String(e.text || '').trim(),
          category: e.category || '其他',
          tags: Array.isArray(e.tags) ? e.tags.map(String) : [],
          custom: e.custom !== false,
          favorite: !!e.favorite,
          useCount: Number(e.useCount) || 0,
          lastUsedAt: e.lastUsedAt || null
        };
      }).filter(function (e) { return e.text; });

      if (mode === 'replace') {
        store.entries = normalized;
        store.categories = mergeCategories(Array.isArray(data) ? [] : (data.categories || []), DEFAULT_CATEGORIES);
        saveStore();
        render();
        toast('已替换为 ' + normalized.length + ' 条');
      } else {
        var texts = {};
        store.entries.forEach(function (x) { texts[x.text] = true; });
        var added = 0, skipped = 0;
        normalized.forEach(function (e) {
          if (texts[e.text]) { skipped++; return; }
          texts[e.text] = true;
          store.entries.push(e);
          added++;
        });
        if (!Array.isArray(data)) {
          (data.categories || []).forEach(function (c) {
            if (store.categories.indexOf(c) === -1) store.categories.push(c);
          });
        }
        saveStore();
        render();
        toast('已合并 ' + added + ' 条' + (skipped ? '，跳过重复 ' + skipped + ' 条' : ''));
      }
    };
    reader.readAsText(file);
  }

  function resetToSeed() {
    if (!confirm('将恢复为内置颜文字库，自定义内容与收藏/使用记录将全部丢失，确定吗？')) return;
    store = { version: 1, categories: DEFAULT_CATEGORIES.slice(), entries: seedEntries() };
    saveStore();
    state.filter = 'all';
    state.keyword = '';
    searchEl.value = '';
    closeSheet();
    render();
    toast('已恢复内置库');
  }

  function clearCustom() {
    var n = store.entries.filter(function (e) { return e.custom; }).length;
    if (!n) { toast('没有自定义颜文字'); return; }
    if (!confirm('将删除 ' + n + ' 条自定义颜文字，确定吗？')) return;
    store.entries = store.entries.filter(function (e) { return !e.custom; });
    saveStore();
    closeSheet();
    render();
    toast('已清空自定义');
  }

  /* ---------- Service Worker ---------- */
  function registerServiceWorker() {
    if (!('serviceWorker' in navigator)) return;
    if (location.protocol === 'file:') return;
    try {
      navigator.serviceWorker.register('./sw.js').catch(function () { /* 静默失败 */ });
    } catch (e) { /* 静默失败 */ }
  }

  /* ---------- 初始化 ---------- */
  function init() {
    overlay = $('#overlay');
    sheet = $('#sheet');
    chipsEl = $('#chips');
    listEl = $('#list');
    searchEl = $('#search');
    toastEl = $('#toast');
    importFileEl = $('#importFile');

    applyAccent(currentAccent(), false);
    loadStore();
    render();
    registerServiceWorker();

    searchEl.addEventListener('input', function () {
      state.keyword = searchEl.value;
      render();
    });

    // 顶部 chips 横向拖动滚动（触屏用原生滑动，鼠标支持按住拖动）
    var chipsDragged = false;
    var chipsDown = false, chipsStartX = 0, chipsStartScroll = 0;
    function onChipsMove(e) {
      if (!chipsDown) return;
      var dx = e.clientX - chipsStartX;
      if (Math.abs(dx) > 4) chipsDragged = true;
      chipsEl.scrollLeft = chipsStartScroll - dx;
    }
    function onChipsUp() {
      chipsDown = false;
      window.removeEventListener('pointermove', onChipsMove);
      window.removeEventListener('pointerup', onChipsUp);
      window.removeEventListener('pointercancel', onChipsUp);
    }
    chipsEl.addEventListener('pointerdown', function (e) {
      if (e.pointerType && e.pointerType !== 'mouse') return; // 触屏交给原生滑动
      chipsDown = true;
      chipsDragged = false;
      chipsStartX = e.clientX;
      chipsStartScroll = chipsEl.scrollLeft;
      window.addEventListener('pointermove', onChipsMove);
      window.addEventListener('pointerup', onChipsUp);
      window.addEventListener('pointercancel', onChipsUp);
    });

    chipsEl.addEventListener('click', function (ev) {
      var chip = ev.target.closest('.chip');
      if (!chip) return;
      if (chipsDragged) { chipsDragged = false; return; }
      state.filter = chip.dataset.filter;
      render();
    });

    listEl.addEventListener('click', function (ev) {
      var card = ev.target.closest('.card');
      if (!card) return;
      var entry = store.entries.filter(function (x) { return x.id === card.dataset.id; })[0];
      if (!entry) return;
      if (ev.target.closest('[data-act="fav"]')) { toggleFavorite(entry); return; }
      if (ev.target.closest('[data-act="more"]')) { openActions(entry); return; }
      handleCardTap(entry);
    });

    overlay.addEventListener('click', function (ev) {
      if (ev.target === overlay) closeSheet();
    });

    importFileEl.addEventListener('change', function () {
      importData(importFileEl.files[0]);
      importFileEl.value = '';
    });

    $('#menuBtn').onclick = openSettings;
    $('#addBtn').onclick = function () { openEditor(null); };
  }

  document.addEventListener('DOMContentLoaded', init);
})();
