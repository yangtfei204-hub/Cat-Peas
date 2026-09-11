// inventory.js — Cat Peas 库存管理（合并版）

(function () {
    'use strict';

    var DB_NAME = 'CatPeasInventoryDB';
    var DB_VERSION = 2;
    var STORE_STOCK = 'stock';
    var STORE_RECORDS = 'records';
    var _db = null;

    function openDB() {
        return new Promise(function (resolve, reject) {
            if (_db) { resolve(_db); return; }
            var req = indexedDB.open(DB_NAME, DB_VERSION);
            req.onupgradeneeded = function (e) {
                var db = e.target.result;
                if (!db.objectStoreNames.contains(STORE_STOCK)) {
                    db.createObjectStore(STORE_STOCK, { keyPath: 'id' });
                }
                if (!db.objectStoreNames.contains(STORE_RECORDS)) {
                    var rs = db.createObjectStore(STORE_RECORDS, { keyPath: 'id' });
                    rs.createIndex('timestamp', 'timestamp', { unique: false });
                }
                // 迁移旧数据
                if (e.oldVersion < 2) {
                    if (db.objectStoreNames.contains('boxes')) db.deleteObjectStore('boxes');
                    if (db.objectStoreNames.contains('bags')) db.deleteObjectStore('bags');
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

    var $ = function (id) { return document.getElementById(id); };

    function showToast(msg, type) {
        var c = $('invToastContainer');
        var t = document.createElement('div');
        t.className = 'inv-toast' + (type ? ' ' + type : '');
        t.textContent = msg;
        c.appendChild(t);
        setTimeout(function () { t.classList.add('fade-out'); setTimeout(function () { if (t.parentNode) t.parentNode.removeChild(t); }, 300); }, 2200);
    }

    function escapeHtml(s) { var d = document.createElement('div'); d.appendChild(document.createTextNode(s || '')); return d.innerHTML; }

    function formatTime(ts) {
        if (!ts) return '--';
        var d = new Date(ts);
        return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0') + ' ' + String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
    }

    function formatDate(ts) {
        var d = new Date(ts);
        var today = new Date();
        var s = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
        if (d.toDateString() === today.toDateString()) s += ' (today)';
        return s + ' ' + String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
    }

    function luminance(hex) {
        var r = parseInt(hex.slice(1, 3), 16), g = parseInt(hex.slice(3, 5), 16), b = parseInt(hex.slice(5, 7), 16);
        return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    }

    // ===========================
    //  State
    // ===========================
    var stockData = [];
    var recordData = [];
    var checkItems = [], checkIndex = 0, checkChanges = [];

    // ===========================
    //  Tabs
    // ===========================
    function switchTab(tab) {
        document.querySelectorAll('.inv-tab').forEach(function (t) { t.classList.toggle('active', t.dataset.tab === tab); });
        document.querySelectorAll('.inv-page').forEach(function (p) { p.classList.toggle('active', p.dataset.page === tab); });
        if (tab === 'stock') renderStockList();
        if (tab === 'records') renderRecordList();
        if (tab === 'shortage') renderShortageList();
    }

    // ===========================
    //  Stock List
    // ===========================
    function renderStockList() {
        var search = ($('stockSearch').value || '').trim().toLowerCase();
        var filter = $('stockFilter').value;
        var sort = $('stockSort').value;

        var items = stockData.filter(function (s) {
            if (filter !== 'all' && s.status !== filter) return false;
            if (search && s.colorId.toLowerCase().indexOf(search) < 0 && s.colorName.toLowerCase().indexOf(search) < 0) return false;
            return true;
        });

        items.sort(function (a, b) {
            if (sort === 'id_asc') return a.colorId.localeCompare(b.colorId);
            if (sort === 'id_desc') return b.colorId.localeCompare(a.colorId);
            if (sort === 'box_asc') return a.boxCount - b.boxCount;
            if (sort === 'box_desc') return b.boxCount - a.boxCount;
            if (sort === 'bag_asc') return a.bagCount - b.bagCount;
            if (sort === 'bag_desc') return b.bagCount - a.bagCount;
            if (sort === 'update_desc') return (b.updatedAt || 0) - (a.updatedAt || 0);
            return 0;
        });

        var totalColors = stockData.length, totalBoxes = 0, totalBags = 0, outCount = 0, lowCount = 0;
        var transitCount = 0;
        stockData.forEach(function (s) {
            totalBoxes += s.boxCount; totalBags += s.bagCount;
            if (s.status === 'out') outCount++;
            if (s.status === 'low') lowCount++;
            if (s.status === 'transit') transitCount++;
        });
        $('stockTotalColors').textContent = totalColors;
        $('stockTotalBoxes').textContent = totalBoxes;
        $('stockTotalBags').textContent = totalBags;
        $('stockOutCount').textContent = outCount;
        $('stockLowCount').textContent = lowCount;
        $('stockTransitCount').textContent = transitCount;

        var list = $('stockList');
        if (items.length === 0) {
            list.innerHTML = '<div class="inv-empty">' + (stockData.length === 0 ? '暂无库存数据，请添加色号' : '没有匹配的结果') + '</div>';
            return;
        }

        list.innerHTML = '';

        // 判断是否按字母分组显示（仅在按色号排序且无搜索筛选时分组）
        var shouldGroup = (sort === 'id_asc' || sort === 'id_desc') && !search && filter === 'all';

        if (shouldGroup) {
            // 按首字母分组
            var grouped = {};
            items.forEach(function (item) {
                var prefix = item.colorId.charAt(0).toUpperCase();
                if (!grouped[prefix]) grouped[prefix] = [];
                grouped[prefix].push(item);
            });

            var prefixKeys = Object.keys(grouped).sort();
            if (sort === 'id_desc') prefixKeys.reverse();

            prefixKeys.forEach(function (prefix) {
                // 分组标题
                var groupHeader = document.createElement('div');
                groupHeader.className = 'inv-group-header';
                var groupItems = grouped[prefix];
                var groupOutCount = 0, groupLowCount = 0, groupTransitCount = 0;
                groupItems.forEach(function (gi) {
                    if (gi.status === 'out') groupOutCount++;
                    if (gi.status === 'low') groupLowCount++;
                    if (gi.status === 'transit') groupTransitCount++;
                });
                var badgeHtml = '';
                if (groupOutCount > 0) badgeHtml += '<span class="inv-group-badge inv-group-badge-out">' + groupOutCount + ' 缺货</span>';
                if (groupLowCount > 0) badgeHtml += '<span class="inv-group-badge inv-group-badge-low">' + groupLowCount + ' 偏少</span>';
                if (groupTransitCount > 0) badgeHtml += '<span class="inv-group-badge inv-group-badge-transit">' + groupTransitCount + ' 在途</span>';

                groupHeader.innerHTML =
                    '<span class="inv-group-dot" style="background:' + groupItems[0].hex + '"></span>' +
                    '<span class="inv-group-title">' + (PALETTE_GROUP_NAMES[prefix] || prefix + ' 系列') + '</span>' +
                    '<span class="inv-group-count">' + groupItems.length + ' 色</span>' +
                    badgeHtml +
                    '<svg class="inv-group-arrow" viewBox="0 0 12 12" width="10" height="10"><path d="M3 4.5l3 3 3-3" stroke="currentColor" stroke-width="1.5" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>';

                groupHeader.addEventListener('click', function () {
                    var container = groupHeader.nextElementSibling;
                    if (container) {
                        var collapsed = container.classList.toggle('inv-stock-group-collapsed');
                        groupHeader.classList.toggle('collapsed', collapsed);
                    }
                });
                groupHeader.classList.add('collapsed');
                groupHeader.style.cursor = 'pointer';
                list.appendChild(groupHeader);

                // 色号卡片容器（默认折叠）
                var groupContainer = document.createElement('div');
                groupContainer.className = 'inv-stock-group-container inv-stock-group-collapsed';

                groupItems.forEach(function (item) {
                    groupContainer.appendChild(createStockCard(item));
                });

                list.appendChild(groupContainer);
            });
        } else {
            items.forEach(function (item) {
                list.appendChild(createStockCard(item));
            });
        }

        bindStockEvents();
    }

    function createStockCard(item) {
        var card = document.createElement('div');
        card.className = 'inv-card' + (item.status === 'out' ? ' inv-card-out' : '') + (item.status === 'low' ? ' inv-card-low' : '') + (item.status === 'transit' ? ' inv-card-transit' : '');

        var statusClass = item.status === 'ok' ? 'status-ok' : item.status === 'low' ? 'status-low' : item.status === 'transit' ? 'status-transit' : 'status-out';

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
                            '<option value="transit"' + (item.status === 'transit' ? ' selected' : '') + '>在途</option>' +
                        '</select>' +
                    '</div>' +
                '</div>' +
                '<div class="inv-card-mid">' +
                    '<div class="inv-card-count-row">' +
                        '<span class="inv-count-label">盒</span>' +
                        '<div class="inv-counter">' +
                            '<button class="inv-counter-btn" data-action="box-dec" data-id="' + item.id + '">-</button>' +
                            '<input type="number" class="inv-counter-input" value="' + item.boxCount + '" min="0" data-field="box" data-id="' + item.id + '">' +
                            '<button class="inv-counter-btn" data-action="box-inc" data-id="' + item.id + '">+</button>' +
                        '</div>' +
                    '</div>' +
                    '<div class="inv-card-count-row">' +
                        '<span class="inv-count-label">袋</span>' +
                        '<div class="inv-counter">' +
                            '<button class="inv-counter-btn" data-action="bag-dec" data-id="' + item.id + '">-</button>' +
                            '<input type="number" class="inv-counter-input" value="' + item.bagCount + '" min="0" data-field="bag" data-id="' + item.id + '">' +
                            '<button class="inv-counter-btn" data-action="bag-inc" data-id="' + item.id + '">+</button>' +
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

        return card;
    }

    function findItem(id) { return stockData.find(function (s) { return s.id === id; }); }

    function bindStockEvents() {
        var list = $('stockList');

        list.querySelectorAll('.inv-counter-btn').forEach(function (btn) {
            btn.addEventListener('click', function () {
                var id = btn.dataset.id, item = findItem(id);
                if (!item) return;
                var action = btn.dataset.action;
                if (action === 'box-inc') item.boxCount++;
                if (action === 'box-dec' && item.boxCount > 0) item.boxCount--;
                if (action === 'bag-inc') item.bagCount++;
                if (action === 'bag-dec' && item.bagCount > 0) item.bagCount--;
                item.updatedAt = Date.now();
                dbPut(STORE_STOCK, item).then(function () { renderStockList(); });
            });
        });

        list.querySelectorAll('.inv-counter-input').forEach(function (input) {
            input.addEventListener('change', function () {
                var id = input.dataset.id, item = findItem(id);
                if (!item) return;
                var val = Math.max(0, parseInt(input.value) || 0);
                if (input.dataset.field === 'box') item.boxCount = val;
                else item.bagCount = val;
                item.updatedAt = Date.now();
                dbPut(STORE_STOCK, item).then(function () { renderStockList(); });
            });
        });

        list.querySelectorAll('.inv-card-status select').forEach(function (sel) {
            sel.addEventListener('change', function () {
                var id = sel.dataset.id, item = findItem(id);
                if (!item) return;
                item.status = sel.value;
                item.updatedAt = Date.now();
                dbPut(STORE_STOCK, item).then(function () { renderStockList(); renderShortageList(); });
            });
        });

        list.querySelectorAll('.inv-card-note').forEach(function (el) {
            el.addEventListener('change', function () {
                var id = el.dataset.id, item = findItem(id);
                if (!item) return;
                item.note = el.value;
                item.updatedAt = Date.now();
                dbPut(STORE_STOCK, item);
            });
        });

        list.querySelectorAll('.inv-card-del').forEach(function (btn) {
            btn.addEventListener('click', function () {
                var id = btn.dataset.id;
                if (!confirm('确定删除这个色号吗？')) return;
                dbDelete(STORE_STOCK, id).then(function () {
                    stockData = stockData.filter(function (s) { return s.id !== id; });
                    renderStockList();
                    renderShortageList();
                    showToast('已删除', 'success');
                });
            });
        });
    }

    // ===========================
    //  Record List
    // ===========================
    function renderRecordList() {
        var range = parseInt($('recordRange').value);
        var now = Date.now();
        var items = recordData.filter(function (r) {
            if (range > 0 && (now - r.timestamp) > range * 86400000) return false;
            return true;
        });
        items.sort(function (a, b) { return b.timestamp - a.timestamp; });

        var list = $('recordList');
        if (items.length === 0) { list.innerHTML = '<div class="inv-empty">暂无盘点记录</div>'; return; }

        list.innerHTML = '';
        items.forEach(function (rec) {
            var card = document.createElement('div');
            card.className = 'inv-record-card';
            var changesHtml = '';
            if (rec.changes && rec.changes.length > 0) {
                changesHtml = '<div class="inv-record-changes">';
                rec.changes.forEach(function (ch) {
                    var boxDelta = ch.newBoxCount - ch.oldBoxCount;
                    var bagDelta = ch.newBagCount - ch.oldBagCount;
                    var hasDelta = boxDelta !== 0 || bagDelta !== 0;
                    var deltaClass = hasDelta ? (boxDelta < 0 || bagDelta < 0 ? 'negative' : 'positive') : 'neutral';
                    var deltaStr = '';
                    if (boxDelta !== 0) deltaStr += '盒' + (boxDelta > 0 ? '+' : '') + boxDelta;
                    if (bagDelta !== 0) deltaStr += (deltaStr ? ' ' : '') + '袋' + (bagDelta > 0 ? '+' : '') + bagDelta;
                    if (!deltaStr) deltaStr = '无变动';

                    changesHtml += '<div class="inv-record-change-item">' +
                        '<div class="inv-record-change-swatch" style="background:' + (ch.hex || '#ccc') + '"></div>' +
                        '<span>' + escapeHtml(ch.colorId) + ' ' + escapeHtml(ch.colorName || '') + '</span>' +
                        '<span>盒' + ch.oldBoxCount + '->' + ch.newBoxCount + ' 袋' + ch.oldBagCount + '->' + ch.newBagCount + '</span>' +
                        '<span class="inv-record-change-delta ' + deltaClass + '">' + deltaStr + '</span>' +
                        '</div>';
                });
                changesHtml += '</div>';
            }
            card.innerHTML = '<div class="inv-record-header">' +
                '<span class="inv-record-date">' + formatDate(rec.timestamp) + '</span>' +
                (rec.note ? '<span class="inv-record-note">' + escapeHtml(rec.note) + '</span>' : '') +
                '<button class="inv-card-del inv-record-del" data-rid="' + rec.id + '" title="删除此记录" style="margin-left:auto;">' +
                    '<svg viewBox="0 0 16 16" width="12" height="12"><path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>' +
                '</button>' +
                '</div>' + changesHtml;
            list.appendChild(card);
        });


        // 绑定删除事件
        list.querySelectorAll('.inv-record-del').forEach(function (btn) {
            btn.addEventListener('click', function (e) {
                e.stopPropagation();
                var rid = btn.dataset.rid;
                if (!confirm('确定删除这条盘点记录吗？')) return;
                dbDelete(STORE_RECORDS, rid).then(function () {
                    recordData = recordData.filter(function (r) { return r.id !== rid; });
                    renderRecordList();
                    showToast('已删除', 'success');
                });
            });
        });

    }

    // ===========================
    //  Shortage List
    // ===========================
    function renderShortageList() {
        var outItems = [], lowItems = [], transitItems = [];
        stockData.forEach(function (s) {
            if (s.status === 'out') outItems.push(s);
            else if (s.status === 'low') lowItems.push(s);
            else if (s.status === 'transit') transitItems.push(s);
        });

        $('shortageOutTotal').textContent = outItems.length;
        $('shortageLowTotal').textContent = lowItems.length;
        $('shortageTransitTotal').textContent = transitItems.length;
        $('shortageTotalColors').textContent = stockData.length;

        // 在缺货标题中附加盒袋合计
        var outBoxSum = 0, outBagSum = 0, lowBoxSum = 0, lowBagSum = 0;
        outItems.forEach(function (s) { outBoxSum += s.boxCount; outBagSum += s.bagCount; });
        lowItems.forEach(function (s) { lowBoxSum += s.boxCount; lowBagSum += s.bagCount; });

        var list = $('shortageList');
        if (outItems.length === 0 && lowItems.length === 0) {
            list.innerHTML = '<div class="inv-empty">所有色号库存充足</div>';
            return;
        }

        list.innerHTML = '';
        if (outItems.length > 0) {
            var t1 = document.createElement('div');
            t1.className = 'inv-shortage-section-title';
            t1.innerHTML = '<svg viewBox="0 0 16 16" width="14" height="14"><path d="M8 2a6 6 0 100 12A6 6 0 008 2zm0 3v4M8 12h.01" stroke="currentColor" stroke-width="1.3" fill="none" stroke-linecap="round"/></svg> 缺货（需立即补货）';
            list.appendChild(t1);
            outItems.forEach(function (item) { list.appendChild(createShortageItem(item)); });
        }
        if (lowItems.length > 0) {
            var t2 = document.createElement('div');
            t2.className = 'inv-shortage-section-title caution';
            t2.innerHTML = '<svg viewBox="0 0 16 16" width="14" height="14"><path d="M8 1L1 14h14L8 1z" stroke="currentColor" stroke-width="1.2" fill="none" stroke-linecap="round" stroke-linejoin="round"/><path d="M8 5v4M8 12h.01" stroke="currentColor" stroke-width="1.2" fill="none" stroke-linecap="round"/></svg> 偏少（建议补货）';
            list.appendChild(t2);
            lowItems.forEach(function (item) { list.appendChild(createShortageItem(item)); });
        }
        if (transitItems.length > 0) {
            var t3 = document.createElement('div');
            t3.className = 'inv-shortage-section-title transit';
            t3.innerHTML = '<svg viewBox="0 0 16 16" width="14" height="14"><path d="M2 8h12M10 4l4 4-4 4" stroke="currentColor" stroke-width="1.3" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg> 在途中（已下单等待到货）';
            list.appendChild(t3);
            transitItems.forEach(function (item) { list.appendChild(createShortageItem(item)); });
        }
    }

    function createShortageItem(item) {
        var el = document.createElement('div');
        el.className = 'inv-shortage-item';
        el.innerHTML = '<div class="inv-shortage-swatch" style="background:' + item.hex + '"></div>' +
            '<span class="inv-shortage-id">' + escapeHtml(item.colorId) + '</span>' +
            '<span class="inv-shortage-name">' + escapeHtml(item.colorName) + '</span>' +
            '<span class="inv-shortage-stats">盒: ' + item.boxCount + ' / 袋: ' + item.bagCount + '</span>';
        return el;
    }

    // ===========================
    //  Add Modal
    // ===========================
    function openAddModal() { buildAddPalette(); $('addModal').classList.add('active'); }
    function closeAddModal() { $('addModal').classList.remove('active'); }

    var PALETTE_GROUP_NAMES = {
        'A': 'A - 黄橙系', 'B': 'B - 绿色系', 'C': 'C - 蓝青系',
        'D': 'D - 蓝紫系', 'E': 'E - 粉玫系', 'F': 'F - 红色系',
        'G': 'G - 棕肤系', 'H': 'H - 黑白灰系', 'M': 'M - 大地系'
    };

    function buildAddPalette() {
        var grid = $('addPaletteGrid');
        var searchVal = ($('paletteSearchInput').value || '').trim().toLowerCase();
        grid.innerHTML = '';
        var existingIds = new Set();
        stockData.forEach(function (s) { existingIds.add(s.colorId); });

        // 按首字母分组
        var groups = {};
        MARD_PALETTE.forEach(function (c) {
            if (searchVal && c.id.toLowerCase().indexOf(searchVal) < 0 && c.name.toLowerCase().indexOf(searchVal) < 0) return;
            var prefix = c.id.charAt(0);
            if (!groups[prefix]) groups[prefix] = [];
            groups[prefix].push(c);
        });

        var prefixes = Object.keys(groups).sort();

        // 搜索时不分组，直接平铺
        if (searchVal) {
            prefixes.forEach(function (prefix) {
                groups[prefix].forEach(function (c) {
                    grid.appendChild(createPaletteCell(c, existingIds));
                });
            });
            return;
        }

        prefixes.forEach(function (prefix) {
            var items = groups[prefix];
            var addedCount = 0;
            items.forEach(function (c) { if (existingIds.has(c.id)) addedCount++; });

            // 分组标题
            var header = document.createElement('div');
            header.className = 'inv-palette-group-header';
            header.innerHTML =
                '<span class="inv-palette-group-dot" style="background:' + items[0].hex + '"></span>' +
                '<span class="inv-palette-group-title">' + (PALETTE_GROUP_NAMES[prefix] || prefix) + '</span>' +
                '<span class="inv-palette-group-count">' + addedCount + '/' + items.length + '</span>' +
                '<svg class="inv-palette-group-arrow" viewBox="0 0 12 12" width="10" height="10"><path d="M3 4.5l3 3 3-3" stroke="currentColor" stroke-width="1.5" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>';

            header.addEventListener('click', function () {
                var wrapper = header.nextElementSibling;
                if (wrapper) {
                    var collapsed = wrapper.classList.toggle('inv-palette-group-collapsed');
                    header.classList.toggle('collapsed', collapsed);
                }
            });

            header.classList.add('collapsed');
            grid.appendChild(header);

            // 色块容器（默认折叠）
            var wrapper = document.createElement('div');
            wrapper.className = 'inv-palette-group-cells inv-palette-group-collapsed';

            items.forEach(function (c) {
                wrapper.appendChild(createPaletteCell(c, existingIds));
            });

            grid.appendChild(wrapper);
        });
    }

    function createPaletteCell(c, existingIds) {
        var cell = document.createElement('div');
        cell.className = 'inv-palette-cell' + (existingIds.has(c.id) ? ' added' : '');
        cell.style.background = c.hex;
        cell.title = c.id + ' ' + c.name;
        var lum = luminance(c.hex);
        var span = document.createElement('span');
        span.className = 'inv-pcell-id';
        span.textContent = c.id;
        span.style.color = lum > 0.55 ? 'rgba(50,40,45,0.6)' : 'rgba(255,255,255,0.8)';
        cell.appendChild(span);
        cell.addEventListener('click', function () {
            if (existingIds.has(c.id)) { showToast(c.id + ' 已在库存中', 'error'); return; }
            addToStock(c.id, c.name, c.hex, 0, 0);
            existingIds.add(c.id);
            cell.classList.add('added');
            // 更新分组标题的计数
            var header = cell.closest('.inv-palette-group-cells');
            if (header && header.previousElementSibling) {
                var countEl = header.previousElementSibling.querySelector('.inv-palette-group-count');
                if (countEl) {
                    var parts = countEl.textContent.split('/');
                    countEl.textContent = (parseInt(parts[0]) + 1) + '/' + parts[1];
                }
            }
            showToast('已添加 ' + c.id + ' ' + c.name, 'success');
        });
        return cell;
    }

    function addToStock(colorId, colorName, hex, boxCount, bagCount) {
        var item = {
            id: 'inv_' + colorId,
            colorId: colorId, colorName: colorName, hex: hex,
            boxCount: boxCount, bagCount: bagCount,
            status: (boxCount > 0 || bagCount > 0) ? 'ok' : 'out',
            note: '', updatedAt: Date.now()
        };
        stockData.push(item);
        dbPut(STORE_STOCK, item).then(function () {
            renderStockList();
            // 滚动到列表底部看到新增的
            var list = document.getElementById('stockList');
            if (list && list.lastElementChild) {
                list.lastElementChild.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
            }
        });
    }

    function addManualColor() {
        var colorId = $('manualColorId').value.trim();
        var colorName = $('manualColorName').value.trim() || colorId;
        var hex = $('manualColorHex').value.toUpperCase();
        var boxCount = parseInt($('manualBoxCount').value) || 0;
        var bagCount = parseInt($('manualBagCount').value) || 0;
        if (!colorId) { alert('请输入色号'); return; }
        if (stockData.some(function (s) { return s.colorId === colorId; })) { alert('色号 ' + colorId + ' 已存在'); return; }
        addToStock(colorId, colorName, hex, boxCount, bagCount);
        $('manualColorId').value = ''; $('manualColorName').value = '';
        $('manualBoxCount').value = '0'; $('manualBagCount').value = '0';
        showToast('已添加 ' + colorId, 'success');
        buildAddPalette();
    }

    // ===========================
    //  Check (盘点)
    // ===========================
    function startCheck() {
        checkItems = stockData.slice();
        if (checkItems.length === 0) { alert('没有库存数据可盘点'); return; }
        checkItems.sort(function (a, b) { return a.colorId.localeCompare(b.colorId); });
        checkIndex = 0; checkChanges = [];
        $('checkNote').value = '';
        $('checkModal').classList.add('active');
        renderCheckCard();
    }

    function renderCheckCard() {
        if (checkIndex >= checkItems.length) { finishCheck(); return; }
        var item = checkItems[checkIndex];
        var pct = Math.round((checkIndex / checkItems.length) * 100);
        $('checkProgressFill').style.width = pct + '%';
        $('checkProgressText').textContent = (checkIndex + 1) + ' / ' + checkItems.length;

        $('checkCard').innerHTML =
            '<div class="inv-check-swatch" style="background:' + item.hex + '"></div>' +
            '<div class="inv-check-color-id">' + escapeHtml(item.colorId) + '</div>' +
            '<div class="inv-check-color-name">' + escapeHtml(item.colorName) + '</div>' +
            '<div class="inv-check-old">当前记录: 盒 ' + item.boxCount + ' / 袋 ' + item.bagCount + '</div>' +
            '<div class="inv-check-counters">' +
                '<div class="inv-card-count-row"><span class="inv-count-label">盒</span>' +
                    '<div class="inv-counter"><button class="inv-counter-btn" id="ckBoxDec">-</button>' +
                    '<input type="number" class="inv-counter-input" id="ckBoxInput" value="' + item.boxCount + '" min="0">' +
                    '<button class="inv-counter-btn" id="ckBoxInc">+</button></div></div>' +
                '<div class="inv-card-count-row"><span class="inv-count-label">袋</span>' +
                    '<div class="inv-counter"><button class="inv-counter-btn" id="ckBagDec">-</button>' +
                    '<input type="number" class="inv-counter-input" id="ckBagInput" value="' + item.bagCount + '" min="0">' +
                    '<button class="inv-counter-btn" id="ckBagInc">+</button></div></div>' +
            '</div>' +
            '<div class="inv-form-row" style="margin-top:8px;justify-content:center;">' +
                '<label>状态</label>' +
                '<select class="inv-select" id="ckStatusSel">' +
                    '<option value="ok"' + (item.status === 'ok' ? ' selected' : '') + '>充足</option>' +
                    '<option value="low"' + (item.status === 'low' ? ' selected' : '') + '>偏少</option>' +
                    '<option value="out"' + (item.status === 'out' ? ' selected' : '') + '>缺货</option>' +
                '</select>' +
            '</div>';

        $('ckBoxDec').addEventListener('click', function () { var i = $('ckBoxInput'); var v = parseInt(i.value)||0; if(v>0) i.value=v-1; });
        $('ckBoxInc').addEventListener('click', function () { var i = $('ckBoxInput'); i.value=(parseInt(i.value)||0)+1; });
        $('ckBagDec').addEventListener('click', function () { var i = $('ckBagInput'); var v = parseInt(i.value)||0; if(v>0) i.value=v-1; });
        $('ckBagInc').addEventListener('click', function () { var i = $('ckBagInput'); i.value=(parseInt(i.value)||0)+1; });
    }

    function confirmCheckItem() {
        var item = checkItems[checkIndex];
        var newBox = parseInt($('ckBoxInput').value) || 0;
        var newBag = parseInt($('ckBagInput').value) || 0;
        var newStatus = $('ckStatusSel').value;

        // 只记录有变动的项
        if (newBox !== item.boxCount || newBag !== item.bagCount || newStatus !== item.status) {
            checkChanges.push({
                colorId: item.colorId, colorName: item.colorName, hex: item.hex,
                oldBoxCount: item.boxCount, newBoxCount: newBox,
                oldBagCount: item.bagCount, newBagCount: newBag,
                oldStatus: item.status, newStatus: newStatus
            });
        }

        item.boxCount = newBox; item.bagCount = newBag;
        item.status = newStatus; item.updatedAt = Date.now();
        dbPut(STORE_STOCK, item);
        checkIndex++;
        renderCheckCard();
    }

    function finishCheck() {
        $('checkProgressFill').style.width = '100%';
        $('checkProgressText').textContent = checkItems.length + ' / ' + checkItems.length;
        if (checkChanges.length > 0) {
            var record = { id: 'check_' + Date.now(), timestamp: Date.now(), changes: checkChanges, note: $('checkNote').value.trim() };
            recordData.push(record);
            dbPut(STORE_RECORDS, record);
        }
        $('checkModal').classList.remove('active');
        showToast('盘点完成！共 ' + checkItems.length + ' 个色号', 'success');
        renderStockList();
        renderRecordList();
        renderShortageList();
    }

    function abortCheck() {
        if (checkChanges.length > 0) {
            var record = { id: 'check_' + Date.now(), timestamp: Date.now(), changes: checkChanges, note: ($('checkNote').value.trim() || '') + ' (中断于 ' + checkIndex + '/' + checkItems.length + ')' };
            recordData.push(record);
            dbPut(STORE_RECORDS, record);
        }
        $('checkModal').classList.remove('active');
        showToast('盘点已中断，已盘点的数据已保存', 'success');
        renderStockList();
        renderRecordList();
        renderShortageList();
    }

    // ===========================
    //  Copy Shortage
    // ===========================
    function copyShortage() {
        var lines = ['Cat Peas 补货清单 ' + new Date().toLocaleDateString('zh-CN'), '---'];
        var outItems = [], lowItems = [], transitItems = [];
        stockData.forEach(function (s) {
            if (s.status === 'out') outItems.push(s);
            else if (s.status === 'low') lowItems.push(s);
            else if (s.status === 'transit') transitItems.push(s);
        });
        if (outItems.length === 0 && lowItems.length === 0 && transitItems.length === 0) { showToast('所有色号库存充足', 'success'); return; }
        if (outItems.length > 0) {
            lines.push('缺货:');
            outItems.forEach(function (i) { lines.push('  ' + i.colorId + ' ' + i.colorName + ' - 盒' + i.boxCount + '/袋' + i.bagCount); });
        }
        if (lowItems.length > 0) {
            lines.push('偏少:');
            lowItems.forEach(function (i) { lines.push('  ' + i.colorId + ' ' + i.colorName + ' - 盒' + i.boxCount + '/袋' + i.bagCount); });
        }
        if (transitItems.length > 0) {
            lines.push('在途:');
            transitItems.forEach(function (i) { lines.push('  ' + i.colorId + ' ' + i.colorName + ' - 盒' + i.boxCount + '/袋' + i.bagCount); });
        }
        var text = lines.join('\n');
        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(text).then(function () { showToast('已复制到剪贴板', 'success'); });
        } else {
            var ta = document.createElement('textarea'); ta.value = text; ta.style.cssText = 'position:fixed;opacity:0';
            document.body.appendChild(ta); ta.select(); document.execCommand('copy'); document.body.removeChild(ta);
            showToast('已复制到剪贴板', 'success');
        }
    }

    // ===========================
    //  Export / Import
    // ===========================
    function exportData() {
        var data = { format: 'catpeas_inventory', version: 2, stock: stockData, records: recordData, exportedAt: new Date().toISOString() };
        var blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        var a = document.createElement('a'); a.download = 'CatPeas_库存数据_' + new Date().toISOString().slice(0, 10) + '.json';
        a.href = URL.createObjectURL(blob); a.click();
        showToast('已导出', 'success');
    }

    function importData(file) {
        var reader = new FileReader();
        reader.onload = function (e) {
            try {
                var data = JSON.parse(e.target.result);
                if (data.format !== 'catpeas_inventory') { alert('文件格式不正确'); return; }
                if (!confirm('导入将覆盖现有库存数据，确定吗？')) return;
                var promises = [];
                if (data.stock) {
                    stockData = data.stock;
                    stockData.forEach(function (s) { promises.push(dbPut(STORE_STOCK, s)); });
                }
                if (data.records) {
                    recordData = data.records;
                    recordData.forEach(function (r) { promises.push(dbPut(STORE_RECORDS, r)); });
                }
                Promise.all(promises).then(function () { renderStockList(); showToast('导入成功', 'success'); });
            } catch (err) { alert('导入失败: ' + err.message); }
        };
        reader.readAsText(file);
    }

    // ===========================
    //  Theme helpers
    // ===========================
    function hexToRgbTheme(hex) { return { r: parseInt(hex.slice(1,3),16), g: parseInt(hex.slice(3,5),16), b: parseInt(hex.slice(5,7),16) }; }
    function lightenTheme(hex, amt) { var c = hexToRgbTheme(hex); return 'rgb('+Math.min(255,c.r+amt)+','+Math.min(255,c.g+amt)+','+Math.min(255,c.b+amt)+')'; }
    function darkenTheme(hex, amt) { var c = hexToRgbTheme(hex); return 'rgb('+Math.max(0,c.r-amt)+','+Math.max(0,c.g-amt)+','+Math.max(0,c.b-amt)+')'; }

    // ===========================
    //  Init
    // ===========================
    function init() {
        try {
            var theme = localStorage.getItem('catpeas_theme');
            if (theme && theme !== 'default') {
                if (theme === 'custom') {
                    var data = JSON.parse(localStorage.getItem('catpeas_custom_theme') || '{}');
                    if (data.primary) {
                        var r = document.documentElement;
                        var bl = hexToRgbTheme(data.bg); var isDark = (bl.r+bl.g+bl.b)/3 < 128;
                        r.style.setProperty('--pink', data.primary);
                        r.style.setProperty('--pink-light', lightenTheme(data.primary, 40));
                        r.style.setProperty('--pink-lighter', isDark ? darkenTheme(data.primary, 100) : lightenTheme(data.primary, 70));
                        r.style.setProperty('--pink-dark', darkenTheme(data.primary, 30));
                        r.style.setProperty('--iris', data.secondary);
                        r.style.setProperty('--iris-light', lightenTheme(data.secondary, 40));
                        r.style.setProperty('--iris-lighter', isDark ? darkenTheme(data.secondary, 100) : lightenTheme(data.secondary, 70));
                        r.style.setProperty('--iris-dark', isDark ? lightenTheme(data.secondary, 30) : darkenTheme(data.secondary, 30));
                        r.style.setProperty('--bg', data.bg); r.style.setProperty('--bg-panel', data.bg + 'f8');
                        r.style.setProperty('--bg-card', isDark ? lightenTheme(data.bg, 15) : '#ffffff');
                        r.style.setProperty('--text', isDark ? '#d8dee9' : '#3e3640');
                        r.style.setProperty('--text-secondary', isDark ? '#b0b8c8' : '#6e6472');
                        r.style.setProperty('--text-muted', isDark ? '#7a8498' : '#a69caa');
                        r.style.setProperty('--border', isDark ? lightenTheme(data.bg, 30) : darkenTheme(data.bg, 20));
                        r.style.setProperty('--border-light', isDark ? lightenTheme(data.bg, 18) : darkenTheme(data.bg, 10));
                    }
                } else { document.documentElement.setAttribute('data-theme', theme); }
            }
            var css = localStorage.getItem('catpeas_custom_css');
            if (css) { var s = document.createElement('style'); s.id = 'catpeas-custom-style'; s.textContent = css; document.head.appendChild(s); }
        } catch (e) {}

        Promise.all([dbGetAll(STORE_STOCK), dbGetAll(STORE_RECORDS)]).then(function (results) {
            stockData = results[0] || [];
            recordData = results[1] || [];
            renderStockList();
        });

        document.querySelectorAll('.inv-tab').forEach(function (tab) { tab.addEventListener('click', function () { switchTab(tab.dataset.tab); }); });

        var _stockSearchTimer = null;
        $('stockSearch').addEventListener('input', function () {
            clearTimeout(_stockSearchTimer);
            _stockSearchTimer = setTimeout(renderStockList, 200);
        });
        $('stockFilter').addEventListener('change', renderStockList);
        $('stockSort').addEventListener('change', renderStockList);
        $('recordRange').addEventListener('change', renderRecordList);

        $('stockAddBtn').addEventListener('click', openAddModal);
        $('addModalClose').addEventListener('click', closeAddModal);
        $('addModal').addEventListener('click', function (e) { if (e.target === this) closeAddModal(); });

        document.querySelectorAll('.inv-add-tab').forEach(function (tab) {
            tab.addEventListener('click', function () {
                document.querySelectorAll('.inv-add-tab').forEach(function (t) { t.classList.toggle('active', t.dataset.addtab === tab.dataset.addtab); });
                document.querySelectorAll('.inv-add-panel').forEach(function (p) { p.classList.toggle('active', p.dataset.addpanel === tab.dataset.addtab); });
            });
        });

        $('paletteSearchInput').addEventListener('input', buildAddPalette);

        $('addAllPaletteBtn').addEventListener('click', function () {
            var existingIds = new Set();
            stockData.forEach(function (s) { existingIds.add(s.colorId); });
            var added = 0;
            var promises = [];
            MARD_PALETTE.forEach(function (c) {
                if (existingIds.has(c.id)) return;
                var item = {
                    id: 'inv_' + c.id,
                    colorId: c.id, colorName: c.name, hex: c.hex,
                    boxCount: 0, bagCount: 0,
                    status: 'out', note: '', updatedAt: Date.now()
                };
                stockData.push(item);
                promises.push(dbPut(STORE_STOCK, item));
                added++;
            });
            if (added === 0) {
                showToast('所有色号已在库存中', 'error');
                return;
            }
            Promise.all(promises).then(function () {
                renderStockList();
                buildAddPalette();
                showToast('已添加 ' + added + ' 个色号', 'success');
            });
        });
        $('manualAddBtn').addEventListener('click', addManualColor);
        $('manualBoxDec').addEventListener('click', function () { var i=$('manualBoxCount'); var v=parseInt(i.value)||0; if(v>0) i.value=v-1; });
        $('manualBoxInc').addEventListener('click', function () { $('manualBoxCount').value=(parseInt($('manualBoxCount').value)||0)+1; });
        $('manualBagDec').addEventListener('click', function () { var i=$('manualBagCount'); var v=parseInt(i.value)||0; if(v>0) i.value=v-1; });
        $('manualBagInc').addEventListener('click', function () { $('manualBagCount').value=(parseInt($('manualBagCount').value)||0)+1; });

        $('stockCheckBtn').addEventListener('click', startCheck);
        $('checkModalClose').addEventListener('click', function () { $('checkModal').classList.remove('active'); });
        $('checkConfirmBtn').addEventListener('click', confirmCheckItem);

        // 盘点键盘快捷键
        document.addEventListener('keydown', function (e) {
            if (!document.getElementById('checkModal').classList.contains('active')) return;
            if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') {
                if (e.key === 'Enter') { e.preventDefault(); confirmCheckItem(); }
                return;
            }
            if (e.key === 'Enter') { e.preventDefault(); confirmCheckItem(); }
            if (e.key === 'Tab') { e.preventDefault(); checkIndex++; renderCheckCard(); }
        });

        $('checkSkipBtn').addEventListener('click', function () { checkIndex++; renderCheckCard(); });
        $('checkAbortBtn').addEventListener('click', function () { if (confirm('确定中断盘点吗？')) abortCheck(); });

        $('stockClearAllBtn').addEventListener('click', function () {
            if (stockData.length === 0) { showToast('库存已经是空的', 'error'); return; }
            if (!confirm('确定清空全部库存数据吗？共 ' + stockData.length + ' 个色号将被删除。此操作不可恢复。')) return;
            if (!confirm('再次确认：清空后无法恢复，建议先导出备份。确定继续？')) return;
            var promises = [];
            stockData.forEach(function (s) { promises.push(dbDelete(STORE_STOCK, s.id)); });
            Promise.all(promises).then(function () {
                stockData = [];
                renderStockList();
                renderShortageList();
                showToast('已清空全部库存', 'success');
            });
        });

        $('shortageCopyBtn').addEventListener('click', copyShortage);
        $('invExportBtn').addEventListener('click', exportData);
        $('invImportBtn').addEventListener('click', function () { $('invFileInput').click(); });
        $('invFileInput').addEventListener('change', function (e) { if (e.target.files[0]) importData(e.target.files[0]); e.target.value = ''; });

        $('invHelpBtn').addEventListener('click', function () { $('invHelpModal').classList.add('active'); });
        $('invHelpClose').addEventListener('click', function () { $('invHelpModal').classList.remove('active'); });
        $('invHelpOk').addEventListener('click', function () { $('invHelpModal').classList.remove('active'); });
        $('invHelpModal').addEventListener('click', function (e) { if (e.target === this) this.classList.remove('active'); });

        // 首次使用或版本更新时自动弹出使用说明
        try {
            var invHelpVersion = localStorage.getItem('catpeas_inv_help_version');
            if (invHelpVersion !== '2.0.0') {
                $('invHelpModal').classList.add('active');
                localStorage.setItem('catpeas_inv_help_version', '2.0.0');
            }
        } catch (e) {}

    }

    init();
})();
