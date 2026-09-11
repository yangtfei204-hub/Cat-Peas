// tables.js — Cat Peas 客桌管理

(function () {
    'use strict';

    // ===========================
    //  Storage (localStorage for real-time, IndexedDB for history)
    // ===========================
    var DB_NAME = 'CatPeasTablesDB';
    var DB_VERSION = 1;
    var STORE_HISTORY = 'history';
    var _db = null;

    function openDB() {
        return new Promise(function (resolve, reject) {
            if (_db) { resolve(_db); return; }
            var req = indexedDB.open(DB_NAME, DB_VERSION);
            req.onupgradeneeded = function (e) {
                var db = e.target.result;
                if (!db.objectStoreNames.contains(STORE_HISTORY)) {
                    var s = db.createObjectStore(STORE_HISTORY, { keyPath: 'id' });
                    s.createIndex('date', 'date', { unique: false });
                }
            };
            req.onsuccess = function (e) { _db = e.target.result; resolve(_db); };
            req.onerror = function (e) { reject(e.target.error); };
        });
    }

    function dbPut(data) {
        return openDB().then(function (db) {
            return new Promise(function (resolve, reject) {
                var tx = db.transaction(STORE_HISTORY, 'readwrite');
                tx.objectStore(STORE_HISTORY).put(data);
                tx.oncomplete = function () { resolve(); };
                tx.onerror = function () { reject(tx.error); };
            });
        });
    }

    function dbGetAll() {
        return openDB().then(function (db) {
            return new Promise(function (resolve, reject) {
                var tx = db.transaction(STORE_HISTORY, 'readonly');
                var req = tx.objectStore(STORE_HISTORY).getAll();
                req.onsuccess = function () { resolve(req.result); };
                req.onerror = function () { reject(req.error); };
            });
        });
    }

    function dbClear() {
        return openDB().then(function (db) {
            return new Promise(function (resolve, reject) {
                var tx = db.transaction(STORE_HISTORY, 'readwrite');
                tx.objectStore(STORE_HISTORY).clear();
                tx.oncomplete = function () { resolve(); };
                tx.onerror = function () { reject(tx.error); };
            });
        });
    }

    // ===========================
    //  DOM / Helpers
    // ===========================
    var $ = function (id) { return document.getElementById(id); };

    function showToast(msg, type) {
        var c = $('tbToastContainer');
        var t = document.createElement('div');
        t.className = 'tb-toast' + (type ? ' ' + type : '');
        t.textContent = msg;
        c.appendChild(t);
        setTimeout(function () { t.classList.add('fade-out'); setTimeout(function () { if (t.parentNode) t.parentNode.removeChild(t); }, 300); }, 2200);
    }

    function fmtTimer(seconds) {
        var neg = seconds < 0;
        var s = Math.abs(Math.floor(seconds));
        var h = Math.floor(s / 3600);
        var m = Math.floor((s % 3600) / 60);
        var sec = s % 60;
        var str = String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0') + ':' + String(sec).padStart(2, '0');
        return neg ? '-' + str : str;
    }

    function fmtTimeShort(ts) {
        var d = new Date(ts);
        return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
    }

    function fmtDate(ts) {
        var d = new Date(ts);
        return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    }

    function todayStr() { return fmtDate(Date.now()); }

    // ===========================
    //  State
    // ===========================
    var tables = []; // array of table configs: {id, name, sortOrder}
    var sessions = {}; // tableId -> session object (live state)
    var settings = {
        overtimeAutoSwitch: true,
        overtimeTopSort: true,
        defaultMode: 'up',
        defaultDuration: 60
    };
    var currentModalTableId = null;
    var timerInterval = null;

    // ===========================
    //  Persistence
    // ===========================
    function saveState() {
        try {
            localStorage.setItem('catpeas_tables_config', JSON.stringify(tables));
            localStorage.setItem('catpeas_tables_sessions', JSON.stringify(sessions));
            localStorage.setItem('catpeas_tables_settings', JSON.stringify(settings));
        } catch (e) {}
    }

    function loadState() {
        try {
            var tc = localStorage.getItem('catpeas_tables_config');
            if (tc) tables = JSON.parse(tc);
            var ts = localStorage.getItem('catpeas_tables_sessions');
            if (ts) sessions = JSON.parse(ts);
            var st = localStorage.getItem('catpeas_tables_settings');
            if (st) settings = Object.assign(settings, JSON.parse(st));
        } catch (e) {}

        if (tables.length === 0) {
            for (var i = 1; i <= 8; i++) {
                tables.push({ id: 'table_' + i, name: i + '号桌', sortOrder: i });
            }
            tables.forEach(function (t) { sessions[t.id] = { status: 'idle' }; });
            saveState();
        }

        // Ensure all tables have sessions
        tables.forEach(function (t) {
            if (!sessions[t.id]) sessions[t.id] = { status: 'idle' };
        });
    }

    // ===========================
    //  Timer Calculation
    // ===========================
    function getElapsed(session) {
        if (session.status === 'idle') return 0;
        var now = Date.now();
        if (session.status === 'paused') {
            return (session.pausedElapsed || 0);
        }
        if (session.status === 'finished') {
            return session.finalElapsed || 0;
        }
        // active or overtime
        var elapsed = (now - session.startTime) / 1000 - (session.totalPausedTime || 0);
        if (session.status === 'active' && session.pauseStartTime) {
            // Currently in a pause that hasn't been registered yet
            elapsed -= (now - session.pauseStartTime) / 1000;
        }
        return Math.max(0, elapsed);
    }

    function getDisplayTime(session) {
        var elapsed = getElapsed(session);
        if (session.timerMode === 'down') {
            var remaining = (session.timerDuration || 0) - elapsed;
            return remaining;
        }
        return elapsed;
    }

    function isOvertime(session) {
        if (session.timerMode !== 'down') return false;
        if (session.status === 'idle') return false;
        return getDisplayTime(session) < 0;
    }

    // ===========================
    //  Render
    // ===========================
    function renderGrid() {
        var grid = $('tbGrid');
        grid.innerHTML = '';

        // Sort tables
        var sorted = tables.slice();
        sorted.sort(function (a, b) {
            var sa = sessions[a.id] || { status: 'idle' };
            var sb = sessions[b.id] || { status: 'idle' };

            var orderMap = { idle: 50, finished: 40, paused: 20, active: 10 };
            var oa = orderMap[sa.status] || 30;
            var ob = orderMap[sb.status] || 30;

            // Overtime on top
            if (settings.overtimeTopSort) {
                if (isOvertime(sa)) oa = 1;
                if (isOvertime(sb)) ob = 1;
            }

            if (oa !== ob) return oa - ob;

            // Among active, sort by elapsed desc
            if (sa.status === 'active' && sb.status === 'active') {
                return getElapsed(sb) - getElapsed(sa);
            }

            return a.sortOrder - b.sortOrder;
        });

        sorted.forEach(function (table) {
            grid.appendChild(createTableCard(table));
        });

        updateStatusBar();
    }

    function createTableCard(table) {
        var session = sessions[table.id] || { status: 'idle' };
        var card = document.createElement('div');
        var overtime = isOvertime(session);
        var statusClass = overtime ? 'status-overtime' : 'status-' + session.status;
        card.className = 'tb-card ' + statusClass;
        card.dataset.tableId = table.id;

        var badgeClass = 'badge-idle', badgeText = '空闲';
        if (overtime) { badgeClass = 'badge-overtime'; badgeText = '!! 已超时'; }
        else if (session.status === 'active') { badgeClass = 'badge-active'; badgeText = '使用中'; }
        else if (session.status === 'paused') { badgeClass = 'badge-paused'; badgeText = '暂离'; }
        else if (session.status === 'finished') { badgeClass = 'badge-finished'; badgeText = '已结束'; }

        var headerHtml = '<div class="tb-card-header">' +
            '<span class="tb-card-name">' + escapeHtml(table.name) + '</span>' +
            '<span class="tb-card-badge ' + badgeClass + '">' + badgeText + '</span>' +
            '</div>';

        var bodyHtml = '';

        if (session.status === 'idle') {
            bodyHtml = '<div class="tb-card-idle-body">' +
                '<div class="tb-idle-icon"><svg viewBox="0 0 40 40" width="40" height="40"><rect x="6" y="16" width="28" height="3" rx="1.5" stroke="currentColor" stroke-width="1.5" fill="none"/><line x1="10" y1="19" x2="10" y2="30" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><line x1="30" y1="19" x2="30" y2="30" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg></div>' +
                '<span class="tb-idle-text">等待接客</span>' +
                '</div>' +
                '<div class="tb-card-actions"><button class="tb-btn tb-btn-primary tb-btn-full" data-action="start" data-table="' + table.id + '">开始接客</button></div>';
        } else {
            var displayTime = getDisplayTime(session);
            var timerClass = overtime ? ' overtime' : '';
            var timerLabel = '';
            if (session.timerMode === 'down') {
                timerLabel = overtime ? '已超出 ' + fmtTimer(Math.abs(displayTime)) : '剩余时间';
                if (session.timerDuration) timerLabel += ' (' + Math.round(session.timerDuration / 60) + '分钟套餐)';
            } else {
                timerLabel = '正计时';
            }
            if (session.status === 'paused') timerLabel = '已暂停';
            if (session.status === 'finished') timerLabel = '总用时';

            var timerHtml = '<div class="tb-card-timer">' +
                '<div class="tb-timer-digits' + timerClass + '" data-timer="' + table.id + '">' + fmtTimer(displayTime) + '</div>' +
                '<div class="tb-timer-label">' + timerLabel + '</div>' +
                (session.startTime ? '<div class="tb-timer-start-time">开始: ' + fmtTimeShort(session.startTime) + '</div>' : '') +
                '</div>';

            var infoHtml = '';
            if (session.guestCount || session.guestNote || session.pattern || session.price) {
                infoHtml = '<div class="tb-card-info">';
                if (session.guestCount) infoHtml += '<div class="tb-card-info-row"><span class="tb-card-info-label">客人</span><span class="tb-card-info-value">' + session.guestCount + '位</span></div>';
                if (session.price) infoHtml += '<div class="tb-card-info-row"><span class="tb-card-info-label">价格</span><span class="tb-card-info-value">' + session.price + '元</span></div>';
                if (session.guestNote) infoHtml += '<div class="tb-card-info-row"><span class="tb-card-info-label">备注</span><span class="tb-card-info-value">' + escapeHtml(session.guestNote) + '</span></div>';
                if (session.pattern) infoHtml += '<div class="tb-card-info-row"><span class="tb-card-info-label">图案</span><span class="tb-card-info-value">' + escapeHtml(session.pattern) + '</span></div>';
                infoHtml += '</div>';
            }

            var actionsHtml = '<div class="tb-card-actions">';
            if (session.status === 'active') {
                actionsHtml += '<button class="tb-btn tb-btn-warn" data-action="pause" data-table="' + table.id + '">暂停</button>';
                actionsHtml += '<button class="tb-btn tb-btn-danger" data-action="end" data-table="' + table.id + '">结束</button>';
                actionsHtml += '<button class="tb-btn" data-action="edit" data-table="' + table.id + '">编辑</button>';
            } else if (session.status === 'paused') {
                actionsHtml += '<button class="tb-btn tb-btn-success" data-action="resume" data-table="' + table.id + '">继续</button>';
                actionsHtml += '<button class="tb-btn tb-btn-danger" data-action="end" data-table="' + table.id + '">结束</button>';
                actionsHtml += '<button class="tb-btn" data-action="edit" data-table="' + table.id + '">编辑</button>';
            } else if (session.status === 'finished') {
                actionsHtml += '<button class="tb-btn tb-btn-primary" data-action="clear" data-table="' + table.id + '">清台</button>';
            }
            actionsHtml += '</div>';

            bodyHtml = timerHtml + infoHtml + actionsHtml;
        }

        card.innerHTML = headerHtml + bodyHtml;
        bindCardActions(card);
        return card;
    }

    function escapeHtml(s) {
        var d = document.createElement('div');
        d.appendChild(document.createTextNode(s || ''));
        return d.innerHTML;
    }

    function bindCardActions(card) {
        card.querySelectorAll('[data-action]').forEach(function (btn) {
            btn.addEventListener('click', function (e) {
                e.stopPropagation();
                var tableId = btn.dataset.table;
                var action = btn.dataset.action;
                if (action === 'start') openStartModal(tableId);
                else if (action === 'pause') pauseTable(tableId);
                else if (action === 'resume') resumeTable(tableId);
                else if (action === 'end') openEndModal(tableId);
                else if (action === 'edit') openEditModal(tableId);
                else if (action === 'clear') clearTable(tableId);
            });
        });
    }

    function updateStatusBar() {
        var active = 0, idle = 0, guests = 0, overtime = 0;
        tables.forEach(function (t) {
            var s = sessions[t.id];
            if (!s || s.status === 'idle') idle++;
            else if (s.status === 'finished') idle++;
            else { active++; guests += (s.guestCount || 0); }
            if (isOvertime(s)) overtime++;
        });
        $('tbActiveCount').textContent = active;
        $('tbIdleCount').textContent = idle;
        $('tbTotalGuests').textContent = guests;

        var banner = $('tbOvertimeBanner');
        if (overtime > 0) {
            banner.classList.add('active');
            $('tbOvertimeText').textContent = overtime + ' 桌已超时';
        } else {
            banner.classList.remove('active');
        }
    }

    // ===========================
    //  Timer Tick
    // ===========================
    function startTimerLoop() {
        if (timerInterval) return;
        timerInterval = setInterval(function () {
            var needRender = false;
            tables.forEach(function (t) {
                var s = sessions[t.id];
                if (!s || s.status !== 'active') return;
                var displayTime = getDisplayTime(s);
                var el = document.querySelector('[data-timer="' + t.id + '"]');
                if (el) {
                    el.textContent = fmtTimer(displayTime);
                    var ot = isOvertime(s);
                    el.classList.toggle('overtime', ot);
                    // Check if just became overtime
                    if (ot && !s._wasOvertime) {
                        s._wasOvertime = true;
                        needRender = true;
                    }
                }
            });
            if (needRender) {
                renderGrid();
                saveState();
            }
            updateStatusBar();
        }, 1000);
    }

    // ===========================
    //  Actions
    // ===========================
    function startTable(tableId, mode, duration, guestCount, price, guestNote, pattern) {
        var now = Date.now();
        sessions[tableId] = {
            status: 'active',
            timerMode: mode,
            timerDuration: mode === 'down' ? duration * 60 : 0,
            startTime: now,
            totalPausedTime: 0,
            pauseStartTime: null,
            pausedElapsed: 0,
            guestCount: guestCount,
            price: price,
            guestNote: guestNote,
            pattern: pattern,
            _wasOvertime: false
        };
        saveState();
        renderGrid();
        startTimerLoop();
        var table = tables.find(function (t) { return t.id === tableId; });
        showToast((table ? table.name : '') + ' 开始计时', 'success');
    }

    function pauseTable(tableId) {
        var s = sessions[tableId];
        if (!s || s.status !== 'active') return;
        s.status = 'paused';
        s.pausedElapsed = getElapsed(s);
        s.pauseStartTime = Date.now();
        saveState();
        renderGrid();
    }

    function resumeTable(tableId) {
        var s = sessions[tableId];
        if (!s || s.status !== 'paused') return;
        if (s.pauseStartTime) {
            s.totalPausedTime = (s.totalPausedTime || 0) + (Date.now() - s.pauseStartTime) / 1000;
        }
        s.status = 'active';
        s.pauseStartTime = null;
        s.pausedElapsed = 0;
        saveState();
        renderGrid();
        startTimerLoop();
    }

    function endTable(tableId, endNote) {
        var s = sessions[tableId];
        if (!s || s.status === 'idle') return;
        // If paused, account for pause time
        if (s.status === 'paused' && s.pauseStartTime) {
            s.totalPausedTime = (s.totalPausedTime || 0) + (Date.now() - s.pauseStartTime) / 1000;
        }
        var elapsed = getElapsed(s);
        if (s.status === 'paused') elapsed = s.pausedElapsed || elapsed;
        else elapsed = (Date.now() - s.startTime) / 1000 - (s.totalPausedTime || 0);

        s.status = 'finished';
        s.endTime = Date.now();
        s.finalElapsed = Math.max(0, elapsed);
        s.endNote = endNote || '';

        // Save to history
        var table = tables.find(function (t) { return t.id === tableId; });
        var overtime = s.timerMode === 'down' && s.finalElapsed > (s.timerDuration || 0);
        var overtimeSeconds = overtime ? s.finalElapsed - (s.timerDuration || 0) : 0;

        var historyEntry = {
            id: 'session_' + Date.now() + '_' + tableId,
            tableId: tableId,
            tableName: table ? table.name : tableId,
            date: todayStr(),
            startTime: s.startTime,
            endTime: s.endTime,
            totalSeconds: Math.round(s.finalElapsed),
            pausedSeconds: Math.round(s.totalPausedTime || 0),
            timerMode: s.timerMode,
            timerDuration: s.timerDuration || 0,
            overtime: overtime,
            overtimeSeconds: Math.round(overtimeSeconds),
            guestCount: s.guestCount || 0,
            guestNote: s.guestNote || '',
            pattern: s.pattern || '',
            price: s.price || 0,
            endNote: endNote || ''
        };

        dbPut(historyEntry);
        saveState();
        renderGrid();
        showToast((table ? table.name : '') + ' 已结束', 'success');
    }

    function clearTable(tableId) {
        sessions[tableId] = { status: 'idle' };
        saveState();
        renderGrid();
    }

    // ===========================
    //  Start Modal
    // ===========================
    function openStartModal(tableId) {
        currentModalTableId = tableId;
        var table = tables.find(function (t) { return t.id === tableId; });
        $('startModalTitle').textContent = '开始接客 -- ' + (table ? table.name : '');

        // Reset form
        var mode = settings.defaultMode || 'up';
        $('modeUpBtn').classList.toggle('active', mode === 'up');
        $('modeDownBtn').classList.toggle('active', mode === 'down');
        $('countdownSection').style.display = mode === 'down' ? '' : 'none';
        $('guestCount').value = '1';
        $('startPrice').value = '';
        $('guestNote').value = '';
        $('patternInput').value = '';
        $('customDuration').value = settings.defaultDuration || 60;
        document.querySelectorAll('.tb-dur-btn').forEach(function (b) {
            b.classList.toggle('active', parseInt(b.dataset.min) === (settings.defaultDuration || 60));
        });

        $('startModal').classList.add('active');
    }

    function closeStartModal() { $('startModal').classList.remove('active'); }

    // ===========================
    //  Edit Modal
    // ===========================
    function openEditModal(tableId) {
        currentModalTableId = tableId;
        var table = tables.find(function (t) { return t.id === tableId; });
        var s = sessions[tableId];
        if (!s) return;
        $('editModalTitle').textContent = '编辑 -- ' + (table ? table.name : '');
        $('editStatusInfo').textContent = '状态: ' + (s.status === 'active' ? '使用中' : '暂离') + '  已用时: ' + fmtTimer(getElapsed(s));
        $('editGuestCount').value = s.guestCount || 1;
        $('editPrice').value = s.price || '';
        $('editGuestNote').value = s.guestNote || '';
        $('editPattern').value = s.pattern || '';
        $('editDurationSection').style.display = s.timerMode === 'down' ? '' : 'none';
        $('editModal').classList.add('active');
    }

    function closeEditModal() { $('editModal').classList.remove('active'); }

    // ===========================
    //  End Modal
    // ===========================
    function openEndModal(tableId) {
        currentModalTableId = tableId;
        var table = tables.find(function (t) { return t.id === tableId; });
        var s = sessions[tableId];
        if (!s) return;
        $('endModalTitle').textContent = '确认结束 -- ' + (table ? table.name : '');
        $('endNote').value = '';

        var elapsed = getElapsed(s);
        if (s.status === 'paused') elapsed = s.pausedElapsed || elapsed;
        var overtime = s.timerMode === 'down' && elapsed > (s.timerDuration || 0);
        var overtimeSeconds = overtime ? elapsed - (s.timerDuration || 0) : 0;

        var html = '<div class="tb-end-summary-row"><span>开始时间</span><strong>' + fmtTimeShort(s.startTime) + '</strong></div>' +
            '<div class="tb-end-summary-row"><span>总用时</span><strong>' + fmtTimer(elapsed) + '</strong></div>';
        if (s.totalPausedTime > 0) {
            html += '<div class="tb-end-summary-row"><span>暂离时间</span><strong>' + fmtTimer(s.totalPausedTime) + '</strong></div>';
        }
        if (overtime) {
            html += '<div class="tb-end-summary-row overtime"><span>超时</span><strong>' + fmtTimer(overtimeSeconds) + '</strong></div>';
        }
        if (s.guestCount) html += '<div class="tb-end-summary-row"><span>客人</span><strong>' + s.guestCount + '位</strong></div>';
        if (s.price) html += '<div class="tb-end-summary-row"><span>价格</span><strong>' + s.price + '元</strong></div>';
        if (s.guestNote) html += '<div class="tb-end-summary-row"><span>备注</span><strong>' + escapeHtml(s.guestNote) + '</strong></div>';

        $('endSummary').innerHTML = html;
        $('endModal').classList.add('active');
    }

    function closeEndModal() { $('endModal').classList.remove('active'); }

    // ===========================
    //  History
    // ===========================
    function openHistory() {
        // Build table filter options
        var sel = $('historyTableFilter');
        sel.innerHTML = '<option value="all">全部桌号</option>';
        tables.forEach(function (t) {
            sel.innerHTML += '<option value="' + t.id + '">' + escapeHtml(t.name) + '</option>';
        });
        $('historyModal').classList.add('active');
        refreshHistory();
    }

    function refreshHistory() {
        dbGetAll().then(function (records) {
            var dateFilter = $('historyDateFilter').value;
            var tableFilter = $('historyTableFilter').value;
            var now = Date.now();

            var items = records.filter(function (r) {
                if (tableFilter !== 'all' && r.tableId !== tableFilter) return false;
                if (dateFilter === 'today') return r.date === todayStr();
                if (dateFilter !== '0') {
                    var days = parseInt(dateFilter);
                    return (now - r.startTime) < days * 86400000;
                }
                return true;
            });

            items.sort(function (a, b) { return b.startTime - a.startTime; });

            // Summary
            var totalSessions = items.length;
            var totalGuests = 0, totalRevenue = 0, totalSeconds = 0;
            items.forEach(function (r) {
                totalGuests += (r.guestCount || 0);
                totalRevenue += (r.price || 0);
                totalSeconds += (r.totalSeconds || 0);
            });

            $('historySummary').innerHTML =
                '<div class="tb-history-stat"><span class="tb-history-stat-num">' + totalSessions + '</span><span class="tb-history-stat-label">接客桌次</span></div>' +
                '<div class="tb-history-stat"><span class="tb-history-stat-num">' + totalGuests + '</span><span class="tb-history-stat-label">总人数</span></div>' +
                '<div class="tb-history-stat"><span class="tb-history-stat-num">' + totalRevenue.toFixed(0) + '</span><span class="tb-history-stat-label">总营收 (元)</span></div>' +
                '<div class="tb-history-stat"><span class="tb-history-stat-num">' + fmtTimer(totalSeconds) + '</span><span class="tb-history-stat-label">总时长</span></div>';

            var list = $('historyList');
            if (items.length === 0) {
                list.innerHTML = '<div class="tb-empty">暂无历史记录</div>';
                return;
            }

            list.innerHTML = '';
            items.forEach(function (r) {
                var el = document.createElement('div');
                el.className = 'tb-history-item';
                var modeLabel = r.timerMode === 'down' ? Math.round(r.timerDuration / 60) + '分钟套餐' : '正计时';
                var overtimeHtml = r.overtime ? '<span class="tb-history-item-overtime">超时 ' + fmtTimer(r.overtimeSeconds) + '</span>' : '';

                el.innerHTML =
                    '<div class="tb-history-item-top">' +
                        '<span class="tb-history-item-name">' + escapeHtml(r.tableName) + '</span>' +
                        '<span class="tb-history-item-time">' + fmtTimeShort(r.startTime) + '-' + fmtTimeShort(r.endTime) + '</span>' +
                        '<span class="tb-history-item-duration">' + fmtTimer(r.totalSeconds) + '</span>' +
                        '<span style="font-size:10px;color:var(--text-muted)">' + modeLabel + '</span>' +
                        overtimeHtml +
                        (r.price ? '<span class="tb-history-item-price">' + r.price + '元</span>' : '') +
                    '</div>' +
                    '<div class="tb-history-item-bottom">' +
                        (r.guestCount ? r.guestCount + '位  ' : '') +
                        (r.guestNote ? escapeHtml(r.guestNote) : '') +
                        (r.endNote ? '  [' + escapeHtml(r.endNote) + ']' : '') +
                    '</div>';
                list.appendChild(el);
            });
        });
    }

    // ===========================
    //  Settings
    // ===========================
    function openSettings() {
        $('settingOvertimeSwitch').checked = settings.overtimeAutoSwitch;
        $('settingOvertimeTop').checked = settings.overtimeTopSort;
        $('settingDefaultMode').value = settings.defaultMode || 'up';
        $('settingDefaultDuration').value = settings.defaultDuration || 60;
        renderSettingsTableList();
        $('settingsModal').classList.add('active');
    }

    function renderSettingsTableList() {
        var list = $('settingsTableList');
        list.innerHTML = '';
        tables.forEach(function (t) {
            var el = document.createElement('div');
            el.className = 'tb-settings-table-item';
            el.innerHTML =
                '<span class="tb-settings-table-name">' + escapeHtml(t.name) + '</span>' +
                '<button class="tb-settings-table-btn" data-action="rename" data-id="' + t.id + '" title="重命名">R</button>' +
                '<button class="tb-settings-table-btn del-btn" data-action="delete" data-id="' + t.id + '" title="删除">X</button>';
            list.appendChild(el);
        });

        list.querySelectorAll('[data-action="rename"]').forEach(function (btn) {
            btn.addEventListener('click', function () {
                var id = btn.dataset.id;
                var t = tables.find(function (tt) { return tt.id === id; });
                if (!t) return;
                var name = prompt('重命名桌位:', t.name);
                if (name && name.trim()) {
                    t.name = name.trim();
                    saveState();
                    renderSettingsTableList();
                    renderGrid();
                }
            });
        });

        list.querySelectorAll('[data-action="delete"]').forEach(function (btn) {
            btn.addEventListener('click', function () {
                if (tables.length <= 1) { alert('至少保留1个桌位'); return; }
                var id = btn.dataset.id;
                var s = sessions[id];
                if (s && s.status !== 'idle' && s.status !== 'finished') {
                    alert('该桌位正在使用中，请先结束后再删除');
                    return;
                }
                if (!confirm('确定删除这个桌位吗？')) return;
                tables = tables.filter(function (tt) { return tt.id !== id; });
                delete sessions[id];
                saveState();
                renderSettingsTableList();
                renderGrid();
            });
        });
    }

    function addTables(count) {
        if (tables.length + count > 20) { alert('最多 20 个桌位'); return; }
        var maxOrder = 0;
        var maxNum = 0;
        tables.forEach(function (t) {
            if (t.sortOrder > maxOrder) maxOrder = t.sortOrder;
            var m = t.name.match(/(\d+)/);
            if (m && parseInt(m[1]) > maxNum) maxNum = parseInt(m[1]);
        });
        for (var i = 0; i < count; i++) {
            maxNum++;
            maxOrder++;
            var id = 'table_' + Date.now() + '_' + i;
            tables.push({ id: id, name: maxNum + '号桌', sortOrder: maxOrder });
            sessions[id] = { status: 'idle' };
        }
        saveState();
        renderSettingsTableList();
        renderGrid();
        showToast('已添加 ' + count + ' 个桌位', 'success');
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
    //  Init & Events
    // ===========================
    function init() {
        // Theme
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
            if (css) { var st = document.createElement('style'); st.textContent = css; document.head.appendChild(st); }
        } catch (e) {}

        loadState();
        renderGrid();
        startTimerLoop();

        // Tab add
        $('tbAddTableBtn').addEventListener('click', function () {
            if (tables.length >= 20) { alert('最多 20 个桌位'); return; }
            addTables(1);
        });

        // History
        $('tbHistoryBtn').addEventListener('click', openHistory);
        $('historyModalClose').addEventListener('click', function () { $('historyModal').classList.remove('active'); });
        $('historyCloseBtn').addEventListener('click', function () { $('historyModal').classList.remove('active'); });
        $('historyDateFilter').addEventListener('change', refreshHistory);
        $('historyTableFilter').addEventListener('change', refreshHistory);
        $('historyClearBtn').addEventListener('click', function () {
            if (!confirm('确定清空所有历史记录吗？此操作不可恢复。')) return;
            dbClear().then(function () { refreshHistory(); showToast('历史已清空', 'success'); });
        });
        $('historyExportBtn').addEventListener('click', function () {
            dbGetAll().then(function (records) {
                var blob = new Blob([JSON.stringify({ format: 'catpeas_tables_history', records: records, exportedAt: new Date().toISOString() }, null, 2)], { type: 'application/json' });
                var a = document.createElement('a');
                a.download = 'CatPeas_客桌记录_' + todayStr() + '.json';
                a.href = URL.createObjectURL(blob);
                a.click();
            });
        });

        // Settings
        $('tbSettingsBtn').addEventListener('click', openSettings);
        $('settingsModalClose').addEventListener('click', function () { $('settingsModal').classList.remove('active'); });
        $('settingsCancelBtn').addEventListener('click', function () { $('settingsModal').classList.remove('active'); });
        $('settingsSaveBtn').addEventListener('click', function () {
            settings.overtimeAutoSwitch = $('settingOvertimeSwitch').checked;
            settings.overtimeTopSort = $('settingOvertimeTop').checked;
            settings.defaultMode = $('settingDefaultMode').value;
            settings.defaultDuration = parseInt($('settingDefaultDuration').value) || 60;
            saveState();
            $('settingsModal').classList.remove('active');
            renderGrid();
            showToast('设置已保存', 'success');
        });
        $('batchAddBtn').addEventListener('click', function () {
            var n = parseInt($('batchAddCount').value) || 1;
            addTables(Math.min(n, 20 - tables.length));
        });

        // Start modal
        $('startModalClose').addEventListener('click', closeStartModal);
        $('startCancelBtn').addEventListener('click', closeStartModal);
        $('startModal').addEventListener('click', function (e) { if (e.target === this) closeStartModal(); });

        $('modeUpBtn').addEventListener('click', function () {
            $('modeUpBtn').classList.add('active');
            $('modeDownBtn').classList.remove('active');
            $('countdownSection').style.display = 'none';
        });
        $('modeDownBtn').addEventListener('click', function () {
            $('modeDownBtn').classList.add('active');
            $('modeUpBtn').classList.remove('active');
            $('countdownSection').style.display = '';
        });

        document.querySelectorAll('.tb-dur-btn').forEach(function (btn) {
            btn.addEventListener('click', function () {
                document.querySelectorAll('.tb-dur-btn').forEach(function (b) { b.classList.remove('active'); });
                btn.classList.add('active');
                $('customDuration').value = btn.dataset.min;
            });
        });

        $('guestDec').addEventListener('click', function () {
            var v = parseInt($('guestCount').value) || 1;
            if (v > 1) $('guestCount').value = v - 1;
        });
        $('guestInc').addEventListener('click', function () {
            $('guestCount').value = (parseInt($('guestCount').value) || 0) + 1;
        });

        $('startConfirmBtn').addEventListener('click', function () {
            var mode = $('modeDownBtn').classList.contains('active') ? 'down' : 'up';
            var duration = parseInt($('customDuration').value) || 60;
            var guests = parseInt($('guestCount').value) || 1;
            var price = parseFloat($('startPrice').value) || 0;
            var note = $('guestNote').value.trim();
            var pattern = $('patternInput').value.trim();
            startTable(currentModalTableId, mode, duration, guests, price, note, pattern);
            closeStartModal();
        });

        // Edit modal
        $('editModalClose').addEventListener('click', closeEditModal);
        $('editCancelBtn').addEventListener('click', closeEditModal);
        $('editModal').addEventListener('click', function (e) { if (e.target === this) closeEditModal(); });

        $('editGuestDec').addEventListener('click', function () {
            var v = parseInt($('editGuestCount').value) || 1;
            if (v > 1) $('editGuestCount').value = v - 1;
        });
        $('editGuestInc').addEventListener('click', function () {
            $('editGuestCount').value = (parseInt($('editGuestCount').value) || 0) + 1;
        });

        document.querySelectorAll('.tb-dur-adjust-btns .tb-btn').forEach(function (btn) {
            btn.addEventListener('click', function () {
                var s = sessions[currentModalTableId];
                if (!s || s.timerMode !== 'down') return;
                var adj = parseInt(btn.dataset.adj) * 60;
                s.timerDuration = Math.max(60, (s.timerDuration || 0) + adj);
                s._wasOvertime = false;
                saveState();
                showToast('时长已调整', 'success');
            });
        });

        $('editSaveBtn').addEventListener('click', function () {
            var s = sessions[currentModalTableId];
            if (!s) return;
            s.guestCount = parseInt($('editGuestCount').value) || 1;
            s.price = parseFloat($('editPrice').value) || 0;
            s.guestNote = $('editGuestNote').value.trim();
            s.pattern = $('editPattern').value.trim();
            saveState();
            renderGrid();
            closeEditModal();
            showToast('已保存', 'success');
        });

        // End modal
        $('endModalClose').addEventListener('click', closeEndModal);
        $('endCancelBtn').addEventListener('click', closeEndModal);
        $('endModal').addEventListener('click', function (e) { if (e.target === this) closeEndModal(); });

        $('endConfirmBtn').addEventListener('click', function () {
            endTable(currentModalTableId, $('endNote').value.trim());
            closeEndModal();
        });


        // Help
        $('tbHelpBtn').addEventListener('click', function () { $('tbHelpModal').classList.add('active'); });
        $('tbHelpClose').addEventListener('click', function () { $('tbHelpModal').classList.remove('active'); });
        $('tbHelpOk').addEventListener('click', function () { $('tbHelpModal').classList.remove('active'); });
        $('tbHelpModal').addEventListener('click', function (e) { if (e.target === this) this.classList.remove('active'); });

        // Auto-save every 5 seconds
        setInterval(function () { saveState(); }, 5000);
    }

    init();
})();
