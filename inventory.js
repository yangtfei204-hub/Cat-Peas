// inventory.js — Cat Peas 库存管理

(function () {
    'use strict';

    // ===========================
    //  IndexedDB
    // ===========================
    var DB_NAME = 'CatPeasInventoryDB';
    var DB_VERSION = 1;
    var STORE_BOXES = 'boxes';
    var STORE_BAGS = 'bags';
    var STORE_RECORDS = 'records';
    var _db = null;

    function openDB() {
        return new Promise(function (resolve, reject) {
            if (_db) { resolve(_db); return; }
            var req = indexedDB.open(DB_NAME, DB_VERSION);
            req.onupgradeneeded = function (e) {
                var db = e.target.result;
                if (!db.objectStoreNames.contains(STORE_BOXES)) {
                    db.createObjectStore(STORE_BOXES, { keyPath: 'id' });
                }
                if (!db.objectStoreNames.contains(STORE_BAGS)) {
                    db.createObjectStore(STORE_BAGS, { keyPath: 'id' });
                }
                if (!db.objectStoreNames.contains(STORE_RECORDS)) {
                    var rs = db.createObjectStore(STORE_RECORDS, { keyPath: 'id' });
                    rs.createIndex('timestamp', 'timestamp', { unique: false });
                }
            };
            req.onsuccess = function (e) { _db = e.target.result; resolve(_db); };
            req.onerror = function (e) { reject(e.target.error); };
        });
    }

    function dbPut(store, data) {
        return openDB().then(function (db) {
            return new Promise(function (resolve, reject) {
                var tx = db.transaction(store, 'readwrite');
                tx.objectStore(store).put(data);
                tx.oncomplete = function () { resolve(); };
                tx.onerror = function () { reject(tx.error); };
            });
        });
    }

    function dbGetAll(store) {
        return openDB().then(function (db) {
            return new Promise(function (resolve, reject) {
                var tx = db.transaction(store, 'readonly');
                var req = tx.objectStore(store).getAll();
                req.onsuccess = function () { resolve(req.result); };
                req.onerror = function () { reject(req.error); };
            });
        });
    }

    function dbDelete(store, id) {
        return openDB().then(function (db) {
            return new Promise(function (resolve, reject) {
                var tx = db.transaction(store, 'readwrite');
                tx.objectStore(store).delete(id);
                tx.oncomplete = function () { resolve(); };
                tx.onerror = function () { reject(tx.error); };
            });
        });
    }

    // ===========================
    //  DOM Helpers
    // ===========================
    var $ = function (id) { return document.getElementById(id); };

    function showToast(msg, type) {
        var c = $('invToastContainer');
        var t = document.createElement('div');
        t.className = 'inv-toast' + (type ? ' ' + type : '');
        t.textContent = msg;
        c.appendChild(t);
        setTimeout(function () { t.classList.add('fade-out'); setTimeout(function () { if (t.parentNode) t.parentNode.removeChild(t); }, 300); }, 2200);
    }

    function escapeHtml(s) {
        var d = document.createElement('div');
        d.appendChild(document.createTextNode(s));
        return d.innerHTML;
    }

    function formatTime(ts) {
        if (!ts) return '--';
        var d = new Date(ts);
        return d.getFullYear() + '-' +
            String(d.getMonth() + 1).padStart(2, '0') + '-' +
            String(d.getDate()).padStart(2, '0') + ' ' +
            String(d.getHours()).padStart(2, '0') + ':' +
            String(d.getMinutes()).padStart(2, '0');
    }

    function formatDate(ts) {
        var d = new Date(ts);
        var today = new Date();
        var dateStr = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
        if (d.toDateString() === today.toDateString()) dateStr += ' (today)';
        return dateStr + ' ' + String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
    }

    // ===========================
    //  State
    // ===========================
    var boxData = []; // array of box items
    var bagData = [];
    var recordData = [];
    var currentAddType = 'box'; // 'box' or 'bag'
    var checkItems = [];
    var checkIndex = 0;
    var checkChanges = [];
    var checkType = 'box';

    // ===========================
    //  Color Lookup
    // ===========================
    function getColorHex(colorId) {
        for (var i = 0; i < MARD_PALETTE.length; i++) {
            if (MARD_PALETTE[i].id === colorId) return MARD_PALETTE[i].hex;
        }
        return '#cccccc';
    }

    function getColorName(colorId) {
        for (var i = 0; i < MARD_PALETTE.length; i++) {
            if (MARD_PALETTE[i].id === colorId) return MARD_PALETTE[i].name;
        }
        return '';
    }

    function luminance(hex) {
        var r = parseInt(hex.slice(1, 3), 16);
        var g = parseInt(hex.slice(3, 5), 16);
        var b = parseInt(hex.slice(5, 7), 16);
        return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    }

    // ===========================
    //  Tabs
    // ===========================
    function switchTab(tab) {
        document.querySelectorAll('.inv-tab').forEach(function (t) { t.classList.toggle('active', t.dataset.tab === tab); });
        document.querySelectorAll('.inv-page').forEach(function (p) { p.classList.toggle('active', p.dataset.page === tab); });
        if (tab === 'boxes') renderBoxList();
        if (tab === 'bags') renderBagList();
        if (tab === 'records') renderRecordList();
        if (tab === 'shortage') renderShortageList();
    }

    // ===========================
    //  Box List Render
    // ===========================
    function renderBoxList() {
        var search = ($('boxSearch').value || '').trim().toLowerCase();
        var filter = $('boxFilter').value;
        var sort = $('boxSort').value;

        var items = boxData.filter(function (b) {
            if (filter !== 'all' && b.status !== filter) return false;
            if (search && b.colorId.toLowerCase().indexOf(search) < 0 && b.colorName.toLowerCase().indexOf(search) < 0) return false;
            return true;
        });

        items.sort(function (a, b) {
            if (sort === 'id_asc') return a.colorId.localeCompare(b.colorId);
            if (sort === 'id_desc') return b.colorId.localeCompare(a.colorId);
            if (sort === 'count_asc') return a.boxCount - b.boxCount;
            if (sort === 'count_desc') return b.boxCount - a.boxCount;
            if (sort === 'update_desc') return (b.updatedAt || 0) - (a.updatedAt || 0);
            return 0;
        });

        // Summary
        var totalColors = boxData.length;
        var totalCount = 0, outCount = 0, lowCount = 0;
        boxData.forEach(function (b) { totalCount += b.boxCount; if (b.status === 'out') outCount++; if (b.status === 'low') lowCount++; });
        $('boxTotalColors').textContent = totalColors;
        $('boxTotalCount').textContent = totalCount;
        $('boxOutCount').textContent = outCount;
        $('boxLowCount').textContent = lowCount;

        var list = $('boxList');
        if (items.length === 0) {
            list.innerHTML = '<div class="inv-empty">' + (boxData.length === 0 ? '暂无库存数据，请添加色号' : '没有匹配的结果') + '</div>';
            return;
        }

        list.innerHTML = '';
        items.forEach(function (item) {
            var card = document.createElement('div');
            card.className = 'inv-card' + (item.status === 'out' ? ' inv-card-out' : '') + (item.status === 'low' ? ' inv-card-low' : '');
            card.dataset.id = item.id;

            var statusClass = item.status === 'ok' ? 'status-ok' : item.status === 'low' ? 'status-low' : 'status-out';

            card.innerHTML =
                '<div class="inv-card-swatch" style="background:' + item.hex + '"></div>' +
                '<div class="inv-card-info">' +
                    '<div class="inv-card-top">' +
                        '<span class="inv-card-id">' + escapeHtml(item.colorId) + '</span>' +
                        '<span class="inv-card-name">' + escapeHtml(item.colorName) + '</span>' +
                        '<div class="inv-card-status">' +
                            '<select class="' + statusClass + '" data-id="' + item.id + '">' +
                                '<option value="ok"' + (item.status === 'ok' ? ' selected' : '') + '>充足</option>' +
                                '<option value="low"' + (item.status === 'low' ? ' selected' : '') + '>偏少</option>' +
                                '<option value="out"' + (item.status === 'out' ? ' selected' : '') + '>缺货</option>' +
                            '</select>' +
                        '</div>' +
                    '</div>' +
                    '<div class="inv-card-mid">' +
                        '<div class="inv-card-count-row">' +
                            '<span>盒数:</span>' +
                            '<div class="inv-counter">' +
                                '<button class="inv-counter-btn" data-action="dec" data-id="' + item.id + '">-</button>' +
                                '<input type="number" class="inv-counter-input" value="' + item.boxCount + '" min="0" data-id="' + item.id + '">' +
                                '<button class="inv-counter-btn" data-action="inc" data-id="' + item.id + '">+</button>' +
                            '</div>' +
                        '</div>' +
                    '</div>' +
                    '<div class="inv-card-bottom">' +
                        '<input type="text" class="inv-card-note" placeholder="备注..." value="' + escapeHtml(item.note || '') + '" data-id="' + item.id + '">' +
                        '<span class="inv-card-time">' + formatTime(item.updatedAt) + '</span>' +
                        '<button class="inv-card-del" data-id="' + item.id + '" title="删除">' +
                            '<svg viewBox="0 0 16 16" width="12" height="12"><path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>' +
                        '</button>' +
                    '</div>' +
                '</div>';

            list.appendChild(card);
        });

        bindBoxCardEvents();
    }

    function bindBoxCardEvents() {
        var list = $('boxList');

        // Counter buttons
        list.querySelectorAll('.inv-counter-btn').forEach(function (btn) {
            btn.addEventListener('click', function () {
                var id = btn.dataset.id;
                var item = boxData.find(function (b) { return b.id === id; });
                if (!item) return;
                if (btn.dataset.action === 'inc') item.boxCount++;
                if (btn.dataset.action === 'dec' && item.boxCount > 0) item.boxCount--;
                item.updatedAt = Date.now();
                dbPut(STORE_BOXES, item).then(function () { renderBoxList(); });
            });
        });

        // Counter input
        list.querySelectorAll('.inv-counter-input').forEach(function (input) {
            input.addEventListener('change', function () {
                var id = input.dataset.id;
                var item = boxData.find(function (b) { return b.id === id; });
                if (!item) return;
                var val = parseInt(input.value);
                if (isNaN(val) || val < 0) val = 0;
                item.boxCount = val;
                item.updatedAt = Date.now();
                dbPut(STORE_BOXES, item).then(function () { renderBoxList(); });
            });
        });

        // Status select
        list.querySelectorAll('.inv-card-status select').forEach(function (sel) {
            sel.addEventListener('change', function () {
                var id = sel.dataset.id;
                var item = boxData.find(function (b) { return b.id === id; });
                if (!item) return;
                item.status = sel.value;
                item.updatedAt = Date.now();
                dbPut(STORE_BOXES, item).then(function () { renderBoxList(); });
            });
        });

        // Note
        list.querySelectorAll('.inv-card-note').forEach(function (noteEl) {
            noteEl.addEventListener('change', function () {
                var id = noteEl.dataset.id;
                var item = boxData.find(function (b) { return b.id === id; });
                if (!item) return;
                item.note = noteEl.value;
                item.updatedAt = Date.now();
                dbPut(STORE_BOXES, item);
            });
        });

        // Delete
        list.querySelectorAll('.inv-card-del').forEach(function (btn) {
            btn.addEventListener('click', function () {
                var id = btn.dataset.id;
                if (!confirm('确定删除这个色号的库存记录吗？')) return;
                dbDelete(STORE_BOXES, id).then(function () {
                    boxData = boxData.filter(function (b) { return b.id !== id; });
                    renderBoxList();
                    showToast('已删除', 'success');
                });
            });
        });
    }

    // ===========================
    //  Bag List Render (similar to boxes)
    // ===========================
    function renderBagList() {
        var search = ($('bagSearch').value || '').trim().toLowerCase();
        var filter = $('bagFilter').value;
        var sort = $('bagSort').value;

        var items = bagData.filter(function (b) {
            if (filter !== 'all' && b.status !== filter) return false;
            if (search && b.colorId.toLowerCase().indexOf(search) < 0 && b.colorName.toLowerCase().indexOf(search) < 0) return false;
            return true;
        });

        items.sort(function (a, b) {
            if (sort === 'id_asc') return a.colorId.localeCompare(b.colorId);
            if (sort === 'count_asc') return a.bagCount - b.bagCount;
            if (sort === 'count_desc') return b.bagCount - a.bagCount;
            return 0;
        });

        var totalColors = bagData.length;
        var totalCount = 0, outCount = 0;
        bagData.forEach(function (b) { totalCount += b.bagCount; if (b.status === 'out') outCount++; });
        $('bagTotalColors').textContent = totalColors;
        $('bagTotalCount').textContent = totalCount;
        $('bagOutCount').textContent = outCount;

        var list = $('bagList');
        if (items.length === 0) {
            list.innerHTML = '<div class="inv-empty">' + (bagData.length === 0 ? '暂无补豆袋数据，请添加色号' : '没有匹配的结果') + '</div>';
            return;
        }

        list.innerHTML = '';
        items.forEach(function (item) {
            var card = document.createElement('div');
            card.className = 'inv-card' + (item.status === 'out' ? ' inv-card-out' : '') + (item.status === 'low' ? ' inv-card-low' : '');

            var statusClass = item.status === 'ok' ? 'status-ok' : item.status === 'low' ? 'status-low' : 'status-out';

            card.innerHTML =
                '<div class="inv-card-swatch" style="background:' + item.hex + '"></div>' +
                '<div class="inv-card-info">' +
                    '<div class="inv-card-top">' +
                        '<span class="inv-card-id">' + escapeHtml(item.colorId) + '</span>' +
                        '<span class="inv-card-name">' + escapeHtml(item.colorName) + '</span>' +
                        '<div class="inv-card-status">' +
                            '<select class="' + statusClass + '" data-id="' + item.id + '">' +
                                '<option value="ok"' + (item.status === 'ok' ? ' selected' : '') + '>充足</option>' +
                                '<option value="low"' + (item.status === 'low' ? ' selected' : '') + '>偏少</option>' +
                                '<option value="out"' + (item.status === 'out' ? ' selected' : '') + '>缺货</option>' +
                            '</select>' +
                        '</div>' +
                    '</div>' +
                    '<div class="inv-card-mid">' +
                        '<div class="inv-card-count-row">' +
                            '<span>袋数:</span>' +
                            '<div class="inv-counter">' +
                                '<button class="inv-counter-btn" data-action="dec" data-id="' + item.id + '">-</button>' +
                                '<input type="number" class="inv-counter-input" value="' + item.bagCount + '" min="0" data-id="' + item.id + '">' +
                                '<button class="inv-counter-btn" data-action="inc" data-id="' + item.id + '">+</button>' +
                            '</div>' +
                        '</div>' +
                        '<span class="inv-card-per-bag">每袋约 ' + (item.beadsPerBag || 500) + ' 颗</span>' +
                    '</div>' +
                    '<div class="inv-card-bottom">' +
                        '<input type="text" class="inv-card-note" placeholder="备注..." value="' + escapeHtml(item.note || '') + '" data-id="' + item.id + '">' +
                        '<span class="inv-card-time">' + formatTime(item.updatedAt) + '</span>' +
                        '<button class="inv-card-del" data-id="' + item.id + '" title="删除">' +
                            '<svg viewBox="0 0 16 16" width="12" height="12"><path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>' +
                        '</button>' +
                    '</div>' +
                '</div>';

            list.appendChild(card);
        });

        bindBagCardEvents();
    }

    function bindBagCardEvents() {
        var list = $('bagList');

        list.querySelectorAll('.inv-counter-btn').forEach(function (btn) {
            btn.addEventListener('click', function () {
                var id = btn.dataset.id;
                var item = bagData.find(function (b) { return b.id === id; });
                if (!item) return;
                if (btn.dataset.action === 'inc') item.bagCount++;
                if (btn.dataset.action === 'dec' && item.bagCount > 0) item.bagCount--;
                item.updatedAt = Date.now();
                dbPut(STORE_BAGS, item).then(function () { renderBagList(); });
            });
        });

        list.querySelectorAll('.inv-counter-input').forEach(function (input) {
            input.addEventListener('change', function () {
                var id = input.dataset.id;
                var item = bagData.find(function (b) { return b.id === id; });
                if (!item) return;
                var val = parseInt(input.value);
                if (isNaN(val) || val < 0) val = 0;
                item.bagCount = val;
                item.updatedAt = Date.now();
                dbPut(STORE_BAGS, item).then(function () { renderBagList(); });
            });
        });

        list.querySelectorAll('.inv-card-status select').forEach(function (sel) {
            sel.addEventListener('change', function () {
                var id = sel.dataset.id;
                var item = bagData.find(function (b) { return b.id === id; });
                if (!item) return;
                item.status = sel.value;
                item.updatedAt = Date.now();
                dbPut(STORE_BAGS, item).then(function () { renderBagList(); });
            });
        });

        list.querySelectorAll('.inv-card-note').forEach(function (noteEl) {
            noteEl.addEventListener('change', function () {
                var id = noteEl.dataset.id;
                var item = bagData.find(function (b) { return b.id === id; });
                if (!item) return;
                item.note = noteEl.value;
                item.updatedAt = Date.now();
                dbPut(STORE_BAGS, item);
            });
        });

        list.querySelectorAll('.inv-card-del').forEach(function (btn) {
            btn.addEventListener('click', function () {
                var id = btn.dataset.id;
                if (!confirm('确定删除这个色号的补豆袋记录吗？')) return;
                dbDelete(STORE_BAGS, id).then(function () {
                    bagData = bagData.filter(function (b) { return b.id !== id; });
                    renderBagList();
                    showToast('已删除', 'success');
                });
            });
        });
    }

    // ===========================
    //  Record List
    // ===========================
    function renderRecordList() {
        var filter = $('recordFilter').value;
        var range = parseInt($('recordRange').value);

        var now = Date.now();
        var items = recordData.filter(function (r) {
            if (filter !== 'all' && r.type !== filter) return false;
            if (range > 0 && (now - r.timestamp) > range * 86400000) return false;
            return true;
        });

        items.sort(function (a, b) { return b.timestamp - a.timestamp; });

        var list = $('recordList');
        if (items.length === 0) {
            list.innerHTML = '<div class="inv-empty">暂无盘点记录</div>';
            return;
        }

        list.innerHTML = '';
        items.forEach(function (rec) {
            var card = document.createElement('div');
            card.className = 'inv-record-card';

            var typeLabel = rec.type === 'box' ? '豆架盘点' : '补豆袋盘点';
            var changesHtml = '';
            if (rec.changes && rec.changes.length > 0) {
                changesHtml = '<div class="inv-record-changes">';
                rec.changes.forEach(function (ch) {
                    var delta = ch.newCount - ch.oldCount;
                    var deltaStr = delta === 0 ? '无变动' : (delta > 0 ? '+' + delta : '' + delta);
                    var deltaClass = delta === 0 ? 'neutral' : (delta > 0 ? 'positive' : 'negative');
                    var hex = ch.hex || getColorHex(ch.colorId);
                    changesHtml += '<div class="inv-record-change-item">' +
                        '<div class="inv-record-change-swatch" style="background:' + hex + '"></div>' +
                        '<span>' + escapeHtml(ch.colorId) + ' ' + escapeHtml(ch.colorName || '') + '</span>' +
                        '<span>' + ch.oldCount + ' -> ' + ch.newCount + '</span>' +
                        '<span class="inv-record-change-delta ' + deltaClass + '">' + deltaStr + '</span>' +
                        '</div>';
                });
                changesHtml += '</div>';
            }

            card.innerHTML =
                '<div class="inv-record-header">' +
                    '<span class="inv-record-date">' + formatDate(rec.timestamp) + '</span>' +
                    '<span class="inv-record-type">' + typeLabel + '</span>' +
                    (rec.note ? '<span class="inv-record-note">' + escapeHtml(rec.note) + '</span>' : '') +
                '</div>' +
                changesHtml;

            list.appendChild(card);
        });
    }

    // ===========================
    //  Shortage List
    // ===========================
    function renderShortageList() {
        var outItems = [];
        var lowItems = [];

        boxData.forEach(function (b) {
            var bagItem = bagData.find(function (bg) { return bg.colorId === b.colorId; });
            var entry = {
                colorId: b.colorId, colorName: b.colorName, hex: b.hex,
                boxCount: b.boxCount, bagCount: bagItem ? bagItem.bagCount : -1,
                status: b.status
            };
            if (b.status === 'out') outItems.push(entry);
            else if (b.status === 'low') lowItems.push(entry);
        });

        // Also check bags that are out/low but not in boxes
        bagData.forEach(function (bg) {
            if (bg.status === 'out' || bg.status === 'low') {
                var alreadyIn = outItems.concat(lowItems).some(function (e) { return e.colorId === bg.colorId; });
                if (!alreadyIn) {
                    var entry = {
                        colorId: bg.colorId, colorName: bg.colorName, hex: bg.hex,
                        boxCount: -1, bagCount: bg.bagCount, status: bg.status
                    };
                    if (bg.status === 'out') outItems.push(entry);
                    else lowItems.push(entry);
                }
            }
        });

        $('shortageOutTotal').textContent = outItems.length;
        $('shortageLowTotal').textContent = lowItems.length;
        $('shortageTotalColors').textContent = boxData.length;

        var list = $('shortageList');
        if (outItems.length === 0 && lowItems.length === 0) {
            list.innerHTML = '<div class="inv-empty">所有色号库存充足</div>';
            return;
        }

        list.innerHTML = '';

        if (outItems.length > 0) {
            var title1 = document.createElement('div');
            title1.className = 'inv-shortage-section-title';
            title1.innerHTML = '<svg viewBox="0 0 16 16" width="14" height="14"><path d="M8 2a6 6 0 100 12A6 6 0 008 2zm0 3v4M8 12h.01" stroke="currentColor" stroke-width="1.3" fill="none" stroke-linecap="round"/></svg> 缺货（需立即补货）';
            list.appendChild(title1);

            outItems.forEach(function (item) {
                list.appendChild(createShortageItem(item));
            });
        }

        if (lowItems.length > 0) {
            var title2 = document.createElement('div');
            title2.className = 'inv-shortage-section-title caution';
            title2.innerHTML = '<svg viewBox="0 0 16 16" width="14" height="14"><path d="M8 1L1 14h14L8 1z" stroke="currentColor" stroke-width="1.2" fill="none" stroke-linecap="round" stroke-linejoin="round"/><path d="M8 5v4M8 12h.01" stroke="currentColor" stroke-width="1.2" fill="none" stroke-linecap="round"/></svg> 偏少（建议补货）';
            list.appendChild(title2);

            lowItems.forEach(function (item) {
                list.appendChild(createShortageItem(item));
            });
        }
    }

    function createShortageItem(item) {
        var el = document.createElement('div');
        el.className = 'inv-shortage-item';
        var stats = '';
        if (item.boxCount >= 0) stats += '豆架: ' + item.boxCount + '盒';
        if (item.boxCount >= 0 && item.bagCount >= 0) stats += ' / ';
        if (item.bagCount >= 0) stats += '补豆: ' + item.bagCount + '袋';

        el.innerHTML =
            '<div class="inv-shortage-swatch" style="background:' + item.hex + '"></div>' +
            '<span class="inv-shortage-id">' + escapeHtml(item.colorId) + '</span>' +
            '<span class="inv-shortage-name">' + escapeHtml(item.colorName) + '</span>' +
            '<span class="inv-shortage-stats">' + stats + '</span>';
        return el;
    }

    // ===========================
    //  Add Modal
    // ===========================
    function openAddModal(type) {
        currentAddType = type;
        $('addModalTitle').textContent = type === 'box' ? '添加豆架库存色号' : '添加补豆袋色号';
        $('manualCountLabel').textContent = type === 'box' ? '盒数' : '袋数';
        buildAddPalette();
        $('addModal').classList.add('active');
    }

    function closeAddModal() {
        $('addModal').classList.remove('active');
    }

    function buildAddPalette() {
        var grid = $('addPaletteGrid');
        var searchVal = ($('paletteSearchInput').value || '').trim().toLowerCase();
        grid.innerHTML = '';

        var existingIds = new Set();
        var dataArr = currentAddType === 'box' ? boxData : bagData;
        dataArr.forEach(function (d) { existingIds.add(d.colorId); });

        MARD_PALETTE.forEach(function (c) {
            if (searchVal && c.id.toLowerCase().indexOf(searchVal) < 0 && c.name.toLowerCase().indexOf(searchVal) < 0) return;

            var cell = document.createElement('div');
            cell.className = 'inv-palette-cell' + (existingIds.has(c.id) ? ' added' : '');
            cell.style.background = c.hex;
            cell.title = c.id + ' ' + c.name;
            cell.dataset.id = c.id;

            var lum = luminance(c.hex);
            var span = document.createElement('span');
            span.className = 'inv-pcell-id';
            span.textContent = c.id;
            span.style.color = lum > 0.55 ? 'rgba(50,40,45,0.6)' : 'rgba(255,255,255,0.8)';
            cell.appendChild(span);

            cell.addEventListener('click', function () {
                if (existingIds.has(c.id)) {
                    showToast(c.id + ' 已在库存中', 'error');
                    return;
                }
                addColorToInventory(c.id, c.name, c.hex, 0);
                existingIds.add(c.id);
                cell.classList.add('added');
                showToast('已添加 ' + c.id + ' ' + c.name, 'success');
            });

            grid.appendChild(cell);
        });
    }

    function addColorToInventory(colorId, colorName, hex, count) {
        var now = Date.now();
        if (currentAddType === 'box') {
            var item = {
                id: 'inv_box_' + colorId,
                colorId: colorId,
                colorName: colorName,
                hex: hex,
                boxCount: count,
                status: count > 0 ? 'ok' : 'out',
                note: '',
                updatedAt: now
            };
            boxData.push(item);
            dbPut(STORE_BOXES, item).then(function () { renderBoxList(); });
        } else {
            var item2 = {
                id: 'inv_bag_' + colorId,
                colorId: colorId,
                colorName: colorName,
                hex: hex,
                bagCount: count,
                beadsPerBag: 500,
                status: count > 0 ? 'ok' : 'out',
                note: '',
                updatedAt: now
            };
            bagData.push(item2);
            dbPut(STORE_BAGS, item2).then(function () { renderBagList(); });
        }
    }

    function addManualColor() {
        var colorId = $('manualColorId').value.trim();
        var colorName = $('manualColorName').value.trim() || colorId;
        var hex = $('manualColorHex').value.toUpperCase();
        var count = parseInt($('manualCount').value) || 0;

        if (!colorId) { alert('请输入色号'); return; }

        var dataArr = currentAddType === 'box' ? boxData : bagData;
        if (dataArr.some(function (d) { return d.colorId === colorId; })) {
            alert('色号 ' + colorId + ' 已存在');
            return;
        }

        addColorToInventory(colorId, colorName, hex, count);
        $('manualColorId').value = '';
        $('manualColorName').value = '';
        $('manualCount').value = '0';
        showToast('已添加 ' + colorId, 'success');
        buildAddPalette();
    }

    // ===========================
    //  Check (盘点)
    // ===========================
    function startCheck(type) {
        checkType = type;
        checkItems = (type === 'box' ? boxData : bagData).slice();
        if (checkItems.length === 0) {
            alert('没有库存数据可盘点，请先添加色号');
            return;
        }
        checkItems.sort(function (a, b) { return a.colorId.localeCompare(b.colorId); });
        checkIndex = 0;
        checkChanges = [];
        $('checkModalTitle').textContent = '一键盘点 - ' + (type === 'box' ? '豆架' : '补豆袋');
        $('checkNote').value = '';
        $('checkModal').classList.add('active');
        renderCheckCard();
    }

    function renderCheckCard() {
        if (checkIndex >= checkItems.length) {
            finishCheck();
            return;
        }

        var item = checkItems[checkIndex];
        var count = checkType === 'box' ? item.boxCount : item.bagCount;
        var pct = Math.round((checkIndex / checkItems.length) * 100);
        $('checkProgressFill').style.width = pct + '%';
        $('checkProgressText').textContent = (checkIndex + 1) + ' / ' + checkItems.length;

        var label = checkType === 'box' ? '盒' : '袋';

        $('checkCard').innerHTML =
            '<div class="inv-check-swatch" style="background:' + item.hex + '"></div>' +
            '<div class="inv-check-color-id">' + escapeHtml(item.colorId) + '</div>' +
            '<div class="inv-check-color-name">' + escapeHtml(item.colorName) + '</div>' +
            '<div class="inv-check-old">当前记录: ' + count + ' ' + label + '</div>' +
            '<div class="inv-card-count-row" style="margin-top:8px;">' +
                '<span>实际数量:</span>' +
                '<div class="inv-counter">' +
                    '<button class="inv-counter-btn" id="checkDec">-</button>' +
                    '<input type="number" class="inv-counter-input" id="checkCountInput" value="' + count + '" min="0">' +
                    '<button class="inv-counter-btn" id="checkInc">+</button>' +
                '</div>' +
            '</div>' +
            '<div class="inv-form-row" style="margin-top:6px;">' +
                '<label>状态</label>' +
                '<select class="inv-select" id="checkStatusSel">' +
                    '<option value="ok"' + (item.status === 'ok' ? ' selected' : '') + '>充足</option>' +
                    '<option value="low"' + (item.status === 'low' ? ' selected' : '') + '>偏少</option>' +
                    '<option value="out"' + (item.status === 'out' ? ' selected' : '') + '>缺货</option>' +
                '</select>' +
            '</div>';

        // Bind counter events inside check card
        $('checkDec').addEventListener('click', function () {
            var inp = $('checkCountInput');
            var v = parseInt(inp.value) || 0;
            if (v > 0) inp.value = v - 1;
        });
        $('checkInc').addEventListener('click', function () {
            var inp = $('checkCountInput');
            inp.value = (parseInt(inp.value) || 0) + 1;
        });
    }

    function confirmCheckItem() {
        var item = checkItems[checkIndex];
        var newCount = parseInt($('checkCountInput').value) || 0;
        var newStatus = $('checkStatusSel').value;
        var oldCount = checkType === 'box' ? item.boxCount : item.bagCount;

        checkChanges.push({
            colorId: item.colorId,
            colorName: item.colorName,
            hex: item.hex,
            oldCount: oldCount,
            newCount: newCount,
            statusChanged: newStatus !== item.status ? newStatus : null
        });

        // Update item
        if (checkType === 'box') {
            item.boxCount = newCount;
        } else {
            item.bagCount = newCount;
        }
        item.status = newStatus;
        item.updatedAt = Date.now();
        dbPut(checkType === 'box' ? STORE_BOXES : STORE_BAGS, item);

        checkIndex++;
        renderCheckCard();
    }

    function skipCheckItem() {
        checkIndex++;
        renderCheckCard();
    }

    function finishCheck() {
        $('checkProgressFill').style.width = '100%';
        $('checkProgressText').textContent = checkItems.length + ' / ' + checkItems.length;

        // Save record
        if (checkChanges.length > 0) {
            var record = {
                id: 'check_' + Date.now(),
                type: checkType,
                timestamp: Date.now(),
                changes: checkChanges,
                note: $('checkNote').value.trim()
            };
            recordData.push(record);
            dbPut(STORE_RECORDS, record);
        }

        closeCheckModal();
        showToast('盘点完成！共检查 ' + checkItems.length + ' 个色号，' + checkChanges.length + ' 个有变动', 'success');

        if (checkType === 'box') renderBoxList();
        else renderBagList();
    }

    function abortCheck() {
        if (checkChanges.length > 0) {
            var record = {
                id: 'check_' + Date.now(),
                type: checkType,
                timestamp: Date.now(),
                changes: checkChanges,
                note: ($('checkNote').value.trim() || '') + ' (中断于 ' + checkIndex + '/' + checkItems.length + ')'
            };
            recordData.push(record);
            dbPut(STORE_RECORDS, record);
        }
        closeCheckModal();
        showToast('盘点已中断，已盘点的数据已保存', 'success');
        if (checkType === 'box') renderBoxList();
        else renderBagList();
    }

    function closeCheckModal() {
        $('checkModal').classList.remove('active');
    }

    // ===========================
    //  Copy Shortage
    // ===========================
    function copyShortageToClipboard() {
        var lines = ['Cat Peas 补货清单 ' + new Date().toLocaleDateString('zh-CN'), '---'];
        var outItems = [];
        var lowItems = [];

        boxData.forEach(function (b) {
            var bagItem = bagData.find(function (bg) { return bg.colorId === b.colorId; });
            if (b.status === 'out') outItems.push({ id: b.colorId, name: b.colorName, box: b.boxCount, bag: bagItem ? bagItem.bagCount : -1 });
            else if (b.status === 'low') lowItems.push({ id: b.colorId, name: b.colorName, box: b.boxCount, bag: bagItem ? bagItem.bagCount : -1 });
        });

        if (outItems.length > 0) {
            lines.push('缺货:');
            outItems.forEach(function (i) {
                var s = '  ' + i.id + ' ' + i.name + ' - 豆架' + i.box + '盒';
                if (i.bag >= 0) s += '/补豆' + i.bag + '袋';
                lines.push(s);
            });
        }
        if (lowItems.length > 0) {
            lines.push('偏少:');
            lowItems.forEach(function (i) {
                var s = '  ' + i.id + ' ' + i.name + ' - 豆架' + i.box + '盒';
                if (i.bag >= 0) s += '/补豆' + i.bag + '袋';
                lines.push(s);
            });
        }

        if (outItems.length === 0 && lowItems.length === 0) {
            showToast('所有色号库存充足，无需补货', 'success');
            return;
        }

        var text = lines.join('\n');
        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(text).then(function () {
                showToast('已复制到剪贴板', 'success');
            });
        } else {
            var ta = document.createElement('textarea');
            ta.value = text;
            ta.style.position = 'fixed';
            ta.style.opacity = '0';
            document.body.appendChild(ta);
            ta.select();
            document.execCommand('copy');
            document.body.removeChild(ta);
            showToast('已复制到剪贴板', 'success');
        }
    }

    // ===========================
    //  Export / Import
    // ===========================
    function exportData() {
        var data = {
            format: 'catpeas_inventory',
            version: 1,
            boxes: boxData,
            bags: bagData,
            records: recordData,
            exportedAt: new Date().toISOString()
        };
        var blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        var link = document.createElement('a');
        link.download = 'CatPeas_库存数据_' + new Date().toISOString().slice(0, 10) + '.json';
        link.href = URL.createObjectURL(blob);
        link.click();
        showToast('已导出', 'success');
    }

    function importData(file) {
        var reader = new FileReader();
        reader.onload = function (e) {
            try {
                var data = JSON.parse(e.target.result);
                if (data.format !== 'catpeas_inventory') {
                    alert('文件格式不正确');
                    return;
                }
                if (!confirm('导入将覆盖现有库存数据，确定吗？')) return;

                var promises = [];
                if (data.boxes) {
                    boxData = data.boxes;
                    boxData.forEach(function (b) { promises.push(dbPut(STORE_BOXES, b)); });
                }
                if (data.bags) {
                    bagData = data.bags;
                    bagData.forEach(function (b) { promises.push(dbPut(STORE_BAGS, b)); });
                }
                if (data.records) {
                    recordData = data.records;
                    recordData.forEach(function (r) { promises.push(dbPut(STORE_RECORDS, r)); });
                }

                Promise.all(promises).then(function () {
                    renderBoxList();
                    showToast('导入成功', 'success');
                });
            } catch (err) {
                alert('导入失败: ' + err.message);
            }
        };
        reader.readAsText(file);
    }

    function hexToRgbTheme(hex) {
        return { r: parseInt(hex.slice(1,3),16), g: parseInt(hex.slice(3,5),16), b: parseInt(hex.slice(5,7),16) };
    }
    function lightenTheme(hex, amt) {
        var c = hexToRgbTheme(hex);
        return 'rgb(' + Math.min(255,c.r+amt) + ',' + Math.min(255,c.g+amt) + ',' + Math.min(255,c.b+amt) + ')';
    }
    function darkenTheme(hex, amt) {
        var c = hexToRgbTheme(hex);
        return 'rgb(' + Math.max(0,c.r-amt) + ',' + Math.max(0,c.g-amt) + ',' + Math.max(0,c.b-amt) + ')';
    }

    // ===========================
    //  Init
    // ===========================
    function init() {
        // Load theme
        try {
            var theme = localStorage.getItem('catpeas_theme');
            if (theme && theme !== 'default') {
                if (theme === 'custom') {
                    var data = JSON.parse(localStorage.getItem('catpeas_custom_theme') || '{}');
                    if (data.primary) {
                        var r = document.documentElement;
                        var bl = hexToRgbTheme(data.bg);
                        var isDark = (bl.r + bl.g + bl.b) / 3 < 128;
                        r.style.setProperty('--pink', data.primary);
                        r.style.setProperty('--pink-light', lightenTheme(data.primary, 40));
                        r.style.setProperty('--pink-lighter', isDark ? darkenTheme(data.primary, 100) : lightenTheme(data.primary, 70));
                        r.style.setProperty('--pink-dark', darkenTheme(data.primary, 30));
                        r.style.setProperty('--iris', data.secondary);
                        r.style.setProperty('--iris-light', lightenTheme(data.secondary, 40));
                        r.style.setProperty('--iris-lighter', isDark ? darkenTheme(data.secondary, 100) : lightenTheme(data.secondary, 70));
                        r.style.setProperty('--iris-dark', isDark ? lightenTheme(data.secondary, 30) : darkenTheme(data.secondary, 30));
                        r.style.setProperty('--bg', data.bg);
                        r.style.setProperty('--bg-panel', data.bg + 'f8');
                        r.style.setProperty('--bg-card', isDark ? lightenTheme(data.bg, 15) : '#ffffff');
                        r.style.setProperty('--text', isDark ? '#d8dee9' : '#3e3640');
                        r.style.setProperty('--text-secondary', isDark ? '#b0b8c8' : '#6e6472');
                        r.style.setProperty('--text-muted', isDark ? '#7a8498' : '#a69caa');
                        r.style.setProperty('--border', isDark ? lightenTheme(data.bg, 30) : darkenTheme(data.bg, 20));
                        r.style.setProperty('--border-light', isDark ? lightenTheme(data.bg, 18) : darkenTheme(data.bg, 10));
                    }
                } else {
                    document.documentElement.setAttribute('data-theme', theme);
                }
            }
            var css = localStorage.getItem('catpeas_custom_css');
            if (css) {
                var style = document.createElement('style');
                style.id = 'catpeas-custom-style';
                style.textContent = css;
                document.head.appendChild(style);
            }
        } catch (e) {}

        // Load data
        Promise.all([
            dbGetAll(STORE_BOXES),
            dbGetAll(STORE_BAGS),
            dbGetAll(STORE_RECORDS)
        ]).then(function (results) {
            boxData = results[0] || [];
            bagData = results[1] || [];
            recordData = results[2] || [];
            renderBoxList();
        });

        // Tab switching
        document.querySelectorAll('.inv-tab').forEach(function (tab) {
            tab.addEventListener('click', function () { switchTab(tab.dataset.tab); });
        });

        // Search & filter
        $('boxSearch').addEventListener('input', renderBoxList);
        $('boxFilter').addEventListener('change', renderBoxList);
        $('boxSort').addEventListener('change', renderBoxList);
        $('bagSearch').addEventListener('input', renderBagList);
        $('bagFilter').addEventListener('change', renderBagList);
        $('bagSort').addEventListener('change', renderBagList);
        $('recordFilter').addEventListener('change', renderRecordList);
        $('recordRange').addEventListener('change', renderRecordList);

        // Add buttons
        $('boxAddBtn').addEventListener('click', function () { openAddModal('box'); });
        $('bagAddBtn').addEventListener('click', function () { openAddModal('bag'); });

        // Add modal
        $('addModalClose').addEventListener('click', closeAddModal);
        $('addModal').addEventListener('click', function (e) { if (e.target === this) closeAddModal(); });

        // Add modal tabs
        document.querySelectorAll('.inv-add-tab').forEach(function (tab) {
            tab.addEventListener('click', function () {
                document.querySelectorAll('.inv-add-tab').forEach(function (t) { t.classList.toggle('active', t.dataset.addtab === tab.dataset.addtab); });
                document.querySelectorAll('.inv-add-panel').forEach(function (p) { p.classList.toggle('active', p.dataset.addpanel === tab.dataset.addtab); });
            });
        });

        // Palette search in add modal
        $('paletteSearchInput').addEventListener('input', buildAddPalette);

        // Manual add
        $('manualAddBtn').addEventListener('click', addManualColor);
        $('manualCountDec').addEventListener('click', function () {
            var v = parseInt($('manualCount').value) || 0;
            if (v > 0) $('manualCount').value = v - 1;
        });
        $('manualCountInc').addEventListener('click', function () {
            $('manualCount').value = (parseInt($('manualCount').value) || 0) + 1;
        });

        // Check (盘点)
        $('boxCheckBtn').addEventListener('click', function () { startCheck('box'); });
        $('bagCheckBtn').addEventListener('click', function () { startCheck('bag'); });
        $('checkModalClose').addEventListener('click', closeCheckModal);
        $('checkConfirmBtn').addEventListener('click', confirmCheckItem);
        $('checkSkipBtn').addEventListener('click', skipCheckItem);
        $('checkAbortBtn').addEventListener('click', function () {
            if (confirm('确定中断盘点吗？已盘点的数据会保存。')) abortCheck();
        });

        // Shortage
        $('shortageCopyBtn').addEventListener('click', copyShortageToClipboard);

        // Export / Import
        $('invExportBtn').addEventListener('click', exportData);
        $('invImportBtn').addEventListener('click', function () { $('invFileInput').click(); });
        $('invFileInput').addEventListener('change', function (e) {
            var file = e.target.files[0];
            if (file) importData(file);
            e.target.value = '';
        });


        // Help
        $('invHelpBtn').addEventListener('click', function () { $('invHelpModal').classList.add('active'); });
        $('invHelpClose').addEventListener('click', function () { $('invHelpModal').classList.remove('active'); });
        $('invHelpOk').addEventListener('click', function () { $('invHelpModal').classList.remove('active'); });
        $('invHelpModal').addEventListener('click', function (e) { if (e.target === this) this.classList.remove('active'); });

    }

    init();
})();
