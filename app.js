// app.js — Cat Peas 拼豆图纸生成编辑器 主逻辑

(function () {
    'use strict';

    // 版本号 —— 每次功能更新后递增此值，将触发用户重新确认免责声明和查看使用说明
    var APP_VERSION = '1.4.0';

    // ===========================
    //  IndexedDB 项目库管理
    // ===========================
    const DB_NAME = 'CatPeasProjectDB';
    const DB_VERSION = 1;
    const STORE_PROJECTS = 'projects';
    const STORE_CATEGORIES = 'categories';

    let _db = null;

    function openDB() {
        return new Promise(function (resolve, reject) {
            if (_db) { resolve(_db); return; }
            var req = indexedDB.open(DB_NAME, DB_VERSION);
            req.onupgradeneeded = function (e) {
                var db = e.target.result;
                if (!db.objectStoreNames.contains(STORE_PROJECTS)) {
                    var store = db.createObjectStore(STORE_PROJECTS, { keyPath: 'id' });
                    store.createIndex('category', 'category', { unique: false });
                    store.createIndex('updatedAt', 'updatedAt', { unique: false });
                }
                if (!db.objectStoreNames.contains(STORE_CATEGORIES)) {
                    var catStore = db.createObjectStore(STORE_CATEGORIES, { keyPath: 'id' });
                    // 默认分类会在首次使用时自动创建
                }
            };
            req.onsuccess = function (e) {
                _db = e.target.result;
                resolve(_db);
            };
            req.onerror = function (e) {
                reject(e.target.error);
            };
        });
    }

    function dbPut(storeName, data) {
        return openDB().then(function (db) {
            return new Promise(function (resolve, reject) {
                var tx = db.transaction(storeName, 'readwrite');
                var store = tx.objectStore(storeName);
                var req = store.put(data);
                req.onsuccess = function () { resolve(req.result); };
                req.onerror = function () { reject(req.error); };
            });
        });
    }

    function dbGetAll(storeName) {
        return openDB().then(function (db) {
            return new Promise(function (resolve, reject) {
                var tx = db.transaction(storeName, 'readonly');
                var store = tx.objectStore(storeName);
                var req = store.getAll();
                req.onsuccess = function () { resolve(req.result); };
                req.onerror = function () { reject(req.error); };
            });
        });
    }

    function dbGet(storeName, id) {
        return openDB().then(function (db) {
            return new Promise(function (resolve, reject) {
                var tx = db.transaction(storeName, 'readonly');
                var store = tx.objectStore(storeName);
                var req = store.get(id);
                req.onsuccess = function () { resolve(req.result); };
                req.onerror = function () { reject(req.error); };
            });
        });
    }

    function dbDelete(storeName, id) {
        return openDB().then(function (db) {
            return new Promise(function (resolve, reject) {
                var tx = db.transaction(storeName, 'readwrite');
                var store = tx.objectStore(storeName);
                var req = store.delete(id);
                req.onsuccess = function () { resolve(); };
                req.onerror = function () { reject(req.error); };
            });
        });
    }

    function dbDeleteMultiple(storeName, ids) {
        return openDB().then(function (db) {
            return new Promise(function (resolve, reject) {
                var tx = db.transaction(storeName, 'readwrite');
                var store = tx.objectStore(storeName);
                var count = 0;
                ids.forEach(function (id) {
                    var req = store.delete(id);
                    req.onsuccess = function () {
                        count++;
                        if (count === ids.length) resolve();
                    };
                    req.onerror = function () { reject(req.error); };
                });
                if (ids.length === 0) resolve();
            });
        });
    }

    // roundRect polyfill
    if (!CanvasRenderingContext2D.prototype.roundRect) {
        CanvasRenderingContext2D.prototype.roundRect = function (x, y, w, h, r) {
            if (typeof r === 'number') r = [r, r, r, r];
            this.beginPath();
            this.moveTo(x + r[0], y);
            this.arcTo(x + w, y, x + w, y + h, r[1]);
            this.arcTo(x + w, y + h, x, y + h, r[2]);
            this.arcTo(x, y + h, x, y, r[3]);
            this.arcTo(x, y, x + w, y, r[0]);
            this.closePath();
        };
    }

    // ===========================
    //  DPR 处理
    // ===========================
    const DPR = window.devicePixelRatio || 1;


    // ===========================
    //  Combined Palette (固定 + 自定义)
    // ===========================
    let CUSTOM_COLORS = [];
    let CUSTOM_GROUPS = [{ name: '默认分组', id: 'default' }];
    let SHOW_DEFAULT_PALETTE = true;
    let PALETTE = [...MARD_PALETTE];

    function rebuildPalette() {
        if (SHOW_DEFAULT_PALETTE) {
            PALETTE = [...MARD_PALETTE, ...CUSTOM_COLORS];
        } else {
            PALETTE = [...CUSTOM_COLORS];
        }
        // 清除 Lab 缓存，下次使用时重建
        _paletteLabCache = null;
    }


    function loadCustomColors() {
        try {
            const saved = localStorage.getItem('catpeas_custom_colors');
            if (saved) {
                CUSTOM_COLORS = JSON.parse(saved);
            }
            const savedGroups = localStorage.getItem('catpeas_custom_groups');
            if (savedGroups) {
                CUSTOM_GROUPS = JSON.parse(savedGroups);
                if (!CUSTOM_GROUPS.some(g => g.id === 'default')) {
                    CUSTOM_GROUPS.unshift({ name: '默认分组', id: 'default' });
                }
            }
            const savedShowDefault = localStorage.getItem('catpeas_show_default_palette');
            if (savedShowDefault !== null) {
                SHOW_DEFAULT_PALETTE = savedShowDefault === '1';
            }
            rebuildPalette();
        } catch (e) { /* ignore */ }
    }

    function saveCustomColors() {
        try {
            localStorage.setItem('catpeas_custom_colors', JSON.stringify(CUSTOM_COLORS));
            localStorage.setItem('catpeas_custom_groups', JSON.stringify(CUSTOM_GROUPS));
            localStorage.setItem('catpeas_show_default_palette', SHOW_DEFAULT_PALETTE ? '1' : '0');
        } catch (e) { /* ignore */ }
    }

    // ===========================
    //  State
    // ===========================
    var _drawRAFPending = false;
    var _pinchActive = false;
    var _pinchMoved = false;
    var _pinchJustEnded = false;
    var _dirtyCells = [];
    const S = {
        gridW: 52,
        gridH: 52,
        cellSize: 16,
        zoom: 1,
        panX: 0,
        panY: 0,
        tool: 'pen',
        brushSize: 1,
        showCenterLine: false,
        symmetryMode: 'none',
        fillPreviewIdx: -1,
        currentColorIdx: 0,
        grid: [],
        showGrid: true,
        showRuler: true,
        showNumbers: true,
        showBead: false,
        history: [],
        historyIdx: -1,
        maxHistory: 80,
        isPanning: false,
        panStart: null,
        isDrawing: false,
        lastDrawCell: null,
        refImage: null,
        refOpacity: 0.5,
        cellOpacity: 1,
        maxColors: 16,
        noColor: false,
        // 辅助拼豆模式
        assistMode: false,
        assistHighlightIdx: -1,
        assistDirection: 'vertical',
        assistTimerRunning: false,
        assistTimerPaused: false,
        assistTimerSeconds: 0,
        assistTimerInterval: null,
        assistMiniMode: false,
        showSplitLine: false,
        splitSize: 52,
        // 选区状态
        selection: null,
        selectionClipboard: null,
        selectionDragging: false,
        selectionDragStart: null,
        selectionStartCell: null,
        selectionDrawing: false,
        currentProjectId: null,
        currentProjectName: '',
        // 网格对齐参数
        gridAlignImgOffX: 0,
        gridAlignImgOffY: 0,
        gridAlignGridOffX: 0,
        gridAlignGridOffY: 0,
        gridAlignImgScale: 1,
        // 图层
        activeLayer: 0,
        layers: [
            { name: '图层 1', visible: true, opacity: 1.0, grid: null }
        ],
    };

    // ===========================
    //  DOM
    // ===========================
    const $ = (s) => document.getElementById(s);
    const mainCanvas = $('mainCanvas');
    const bgCanvas = $('bgCanvas');
    const rulerTop = $('rulerTop');
    const rulerLeft = $('rulerLeft');
    const rulerCorner = $('rulerCorner');
    const canvasContainer = $('canvasContainer');
    const canvasWrapper = $('canvasWrapper');
    const canvasScroller = $('canvasScroller');
    const canvasLayers = $('canvasLayers');

    const ctx = mainCanvas.getContext('2d');
    const bgCtx = bgCanvas.getContext('2d');


    // ===========================
    //  Theme Management
    // ===========================
    function applyTheme(name) {
        if (name === 'default') {
            document.documentElement.removeAttribute('data-theme');
            document.documentElement.removeAttribute('style');
        } else {
            document.documentElement.setAttribute('data-theme', name);
            document.documentElement.removeAttribute('style');
        }
        try { localStorage.setItem('catpeas_theme', name); } catch (e) { }
        // 更新暗色模式图标
        updateThemeIcon(name);
        setTimeout(function() { render(); }, 50);
    }

    function applyCustomThemeColors(primary, secondary, bg, boardCell1, boardCell2, rulerBg, rulerText) {
        document.documentElement.removeAttribute('data-theme');
        const pl = hexToRgb(primary);
        const sl = hexToRgb(secondary);
        const bl = hexToRgb(bg);
        const isDark = (bl.r + bl.g + bl.b) / 3 < 128;

        const r = document.documentElement;
        r.style.setProperty('--pink', primary);
        r.style.setProperty('--pink-light', lightenHex(primary, 40));
        r.style.setProperty('--pink-lighter', isDark ? darkenHex(primary, 100) : lightenHex(primary, 70));
        r.style.setProperty('--pink-dark', darkenHex(primary, 30));
        r.style.setProperty('--iris', secondary);
        r.style.setProperty('--iris-light', lightenHex(secondary, 40));
        r.style.setProperty('--iris-lighter', isDark ? darkenHex(secondary, 100) : lightenHex(secondary, 70));
        r.style.setProperty('--iris-dark', isDark ? lightenHex(secondary, 30) : darkenHex(secondary, 30));
        r.style.setProperty('--bg', bg);
        r.style.setProperty('--bg-panel', bg + 'f8');
        r.style.setProperty('--bg-card', isDark ? lightenHex(bg, 15) : '#ffffff');
        r.style.setProperty('--text', isDark ? '#d8dee9' : '#3e3640');
        r.style.setProperty('--text-secondary', isDark ? '#b0b8c8' : '#6e6472');
        r.style.setProperty('--text-muted', isDark ? '#7a8498' : '#a69caa');
        r.style.setProperty('--border', isDark ? lightenHex(bg, 30) : darkenHex(bg, 20));
        r.style.setProperty('--border-light', isDark ? lightenHex(bg, 18) : darkenHex(bg, 10));

        // 画板棋盘格配色
        if (boardCell1) r.style.setProperty('--board-cell1', boardCell1);
        if (boardCell2) r.style.setProperty('--board-cell2', boardCell2);
        // 标尺配色
        if (rulerBg) r.style.setProperty('--ruler-bg', rulerBg);
        if (rulerText) {
            r.style.setProperty('--ruler-text', rulerText);
            // 自动生成次要文字色和刻度线色
            var rt = hexToRgb(rulerText);
            var bl2 = hexToRgb(bg);
            var isDark2 = (bl2.r + bl2.g + bl2.b) / 3 < 128;
            r.style.setProperty('--ruler-text-minor', isDark2 ? darkenHex(rulerText, 30) : lightenHex(rulerText, 40));
            r.style.setProperty('--ruler-line', isDark2 ? darkenHex(rulerText, 50) : lightenHex(rulerText, 70));
        }

        try {
            localStorage.setItem('catpeas_theme', 'custom');
            localStorage.setItem('catpeas_custom_theme', JSON.stringify({ primary, secondary, bg, boardCell1: boardCell1 || '', boardCell2: boardCell2 || '', rulerBg: rulerBg || '', rulerText: rulerText || '' }));
        } catch (e) { }

        setTimeout(function() { render(); }, 50);
    }


    function loadSavedTheme() {
        try {
            const theme = localStorage.getItem('catpeas_theme');
            if (theme && theme !== 'default') {
                if (theme === 'custom') {
                    const data = JSON.parse(localStorage.getItem('catpeas_custom_theme') || '{}');
                    if (data.primary) applyCustomThemeColors(data.primary, data.secondary, data.bg, data.boardCell1, data.boardCell2, data.rulerBg, data.rulerText);
                } else {
                    applyTheme(theme);
                }
                document.querySelectorAll('.theme-preset-btn').forEach(b => b.classList.toggle('active', b.dataset.theme === theme));
            }
        } catch (e) { }
    }

    function updateThemeIcon(name) {
        const btn = $('themeToggleBtn');
        if (name === 'dark') {
            btn.innerHTML = '<svg viewBox="0 0 24 24" width="18" height="18"><path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z" stroke="currentColor" stroke-width="1.5" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>';
        } else {
            btn.innerHTML = '<svg viewBox="0 0 24 24" width="18" height="18"><circle cx="12" cy="12" r="4" stroke="currentColor" stroke-width="1.5" fill="none"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>';
        }
    }

    // ===========================
    //  Init
    // ===========================
    // ===========================
    //  Disclaimer
    // ===========================
    function showDisclaimer() {
        try {
            var acceptedVersion = localStorage.getItem('catpeas_disclaimer_version');
            if (acceptedVersion === APP_VERSION) {
                // 当前版本已确认过，跳过
                return;
            }
            // 版本号不一致或从未确认过，需要重新弹出
            // 如果是老用户升级（之前用旧的 key 确认过），也会走到这里
        } catch (e) { /* ignore */ }

        // 判断是否为首次使用（从未确认过任何版本）
        var isFirstTime = false;
        try {
            isFirstTime = !localStorage.getItem('catpeas_disclaimer_version') &&
                           !localStorage.getItem('catpeas_disclaimer_accepted');
        } catch (e) { /* ignore */ }

        var modal = $('disclaimerModal');
        var btn = $('disclaimerConfirm');
        var countdown = $('disclaimerCountdown');
        modal.classList.add('active');

        // 显示版本号
        if ($('disclaimerVersion')) $('disclaimerVersion').textContent = 'v' + APP_VERSION;

        // 首次使用需要等待 15 秒，版本更新只需等待 5 秒
        var waitTime = isFirstTime ? 15 : 5;
        var remaining = waitTime;
        btn.disabled = true;
        btn.textContent = '请等待 ' + remaining + ' 秒';

        if (isFirstTime) {
            countdown.textContent = '首次使用，请阅读以上内容（' + remaining + '秒）';
        } else {
            countdown.textContent = '工具已更新至 v' + APP_VERSION + '，请重新确认（' + remaining + '秒）';
        }

        var timer = setInterval(function () {
            remaining--;
            if (remaining > 0) {
                btn.textContent = '请等待 ' + remaining + ' 秒';
                if (isFirstTime) {
                    countdown.textContent = '首次使用，请阅读以上内容（' + remaining + '秒）';
                } else {
                    countdown.textContent = '工具已更新至 v' + APP_VERSION + '，请重新确认（' + remaining + '秒）';
                }
            } else {
                clearInterval(timer);
                btn.disabled = false;
                btn.textContent = '我已阅读并同意，进入工具';
                if (isFirstTime) {
                    countdown.textContent = '感谢阅读';
                } else {
                    countdown.textContent = '已更新至 v' + APP_VERSION;
                }
            }
        }, 1000);

        // 用克隆替换的方式避免重复绑定事件
        var newBtn = btn.cloneNode(true);
        btn.parentNode.replaceChild(newBtn, btn);
        btn = newBtn;

        btn.addEventListener('click', function () {
            if (btn.disabled) return;
            modal.classList.remove('active');
            try {
                localStorage.setItem('catpeas_disclaimer_version', APP_VERSION);
                // 兼容旧 key，也标记一下
                localStorage.setItem('catpeas_disclaimer_accepted', '1');
            } catch (e) { /* ignore */ }
            // 免责声明关闭后显示使用说明
            showHelpAfterDisclaimer();
        });
    }

    function showHelpFirstTime() {
        // 保留此函数用于兼容，但不再被直接调用
        // 新逻辑由 showHelpAfterDisclaimer 处理
    }

    function showHelpAfterDisclaimer() {
        try {
            var helpShownVersion = localStorage.getItem('catpeas_help_shown_version');
            if (helpShownVersion === APP_VERSION) {
                // 当前版本的使用说明已经看过了
                return;
            }
        } catch (e) { return; }

        // 延迟一点显示，让免责声明弹窗的关闭动画先完成
        setTimeout(function () {
            openHelpModal();
            try {
                localStorage.setItem('catpeas_help_shown_version', APP_VERSION);
                // 兼容旧 key
                localStorage.setItem('catpeas_help_shown', '1');
            } catch (e) { /* ignore */ }
        }, 400);
    }

    function openHelpModal() {
        $('helpModal').classList.add('active');
        if ($('helpVersion')) $('helpVersion').textContent = 'v' + APP_VERSION;
    }

    function closeHelpModal() {
        $('helpModal').classList.remove('active');
    }

    function openDisclaimerFromHelp() {
        closeHelpModal();
        var modal = $('disclaimerModal');
        var btn = $('disclaimerConfirm');
        var countdown = $('disclaimerCountdown');
        modal.classList.add('active');
        // 从帮助页面打开时不需要倒计时
        btn.disabled = false;
        btn.textContent = '我已阅读，关闭';
        countdown.textContent = '';
        // 移除旧的事件监听，添加新的
        var newBtn = btn.cloneNode(true);
        btn.parentNode.replaceChild(newBtn, btn);
        newBtn.addEventListener('click', function () {
            modal.classList.remove('active');
        });
    }

    function dismissSplash() {
        var splash = $('splashScreen');
        if (!splash) return;
        // 最少显示1.8秒，最多3秒
        var minTime = 1800;
        var startTime = Date.now();
        function tryDismiss() {
            var elapsed = Date.now() - startTime;
            if (elapsed < minTime) {
                setTimeout(tryDismiss, minTime - elapsed);
                return;
            }
            splash.classList.add('fade-out');
            setTimeout(function () {
                splash.classList.add('hidden');
                // 移除 DOM 释放内存
                setTimeout(function () {
                    if (splash.parentNode) splash.parentNode.removeChild(splash);
                }, 500);
            }, 600);
        }
        // 页面加载完毕后开始倒计时
        if (document.readyState === 'complete') {
            setTimeout(tryDismiss, minTime);
        } else {
            window.addEventListener('load', function () {
                tryDismiss();
            });
            // 保底：3秒后无论如何关闭
            setTimeout(tryDismiss, 3000);
        }
    }

    function init() {
        // 开屏动画（必须在最前面调用，不依赖任何条件）
        dismissSplash();
        // 显示版本号
        if ($('logoVersion')) $('logoVersion').textContent = 'v' + APP_VERSION;
        showDisclaimer();
        initGrid();
        loadCustomColors();
        buildPalette();
        selectColor(0);
        loadAutoSave();
        pushHistory();
        setupCanvas();
        updateLayerUI();
        render();
        bindAllEvents();
        initMobileDrawer();
        openDB();
        startAutoSave();
        loadCustomCSS();
        initMinimapInteraction();
    }

    function startAutoSave() {
        setInterval(function () {
            try {
                // 检查画布是否有内容，空画布不保存
                var hasAny = false;
                for (var cr = 0; cr < S.gridH && !hasAny; cr++) {
                    for (var cc = 0; cc < S.gridW && !hasAny; cc++) {
                        if (S.grid[cr][cc] !== null) hasAny = true;
                    }
                }
                if (!hasAny) {
                    // 画布为空，删除已有的自动保存数据
                    localStorage.removeItem('catpeas_autosave');
                    return;
                }
                // 用 RLE 压缩减少存储体积
                var flat = [];
                for (var r = 0; r < S.gridH; r++) {
                    for (var c = 0; c < S.gridW; c++) {
                        var v = S.grid[r][c];
                        flat.push(v === null ? -1 : v);
                    }
                }
                var rle = [];
                var i = 0;
                while (i < flat.length) {
                    var val = flat[i];
                    var count = 1;
                    while (i + count < flat.length && flat[i + count] === val && count < 255) {
                        count++;
                    }
                    rle.push(count, val);
                    i += count;
                }
                var data = {
                    gridW: S.gridW,
                    gridH: S.gridH,
                    rle: rle,
                    currentColorIdx: S.currentColorIdx,
                    savedAt: Date.now()
                };
                localStorage.setItem('catpeas_autosave', JSON.stringify(data));
            } catch (e) { /* ignore */ }
        }, 30000);
    }

    function loadAutoSave() {
        try {
            var saved = localStorage.getItem('catpeas_autosave');
            if (!saved) return;
            var data = JSON.parse(saved);
            if (!data.gridW || !data.gridH) return;
            if (!data.grid && !data.rle) return;
            var age = Date.now() - (data.savedAt || 0);
            if (age > 7 * 24 * 3600 * 1000) return;

            // 还原 grid
            var grid;
            if (data.rle) {
                // 从 RLE 还原
                var flat = [];
                for (var i = 0; i < data.rle.length; i += 2) {
                    var count = data.rle[i];
                    var val = data.rle[i + 1];
                    for (var j = 0; j < count; j++) {
                        flat.push(val < 0 ? null : val);
                    }
                }
                grid = [];
                for (var r = 0; r < data.gridH; r++) {
                    grid[r] = [];
                    for (var c = 0; c < data.gridW; c++) {
                        var idx = r * data.gridW + c;
                        grid[r][c] = idx < flat.length ? flat[idx] : null;
                    }
                }
            } else {
                grid = data.grid;
            }

            var hasContent = false;
            for (var r2 = 0; r2 < data.gridH && !hasContent; r2++) {
                for (var c2 = 0; c2 < data.gridW && !hasContent; c2++) {
                    if (grid[r2][c2] !== null) hasContent = true;
                }
            }
            if (!hasContent) return;
            if (confirm('检测到上次未保存的画布数据（' + data.gridW + '×' + data.gridH + '），是否恢复？')) {
                S.gridW = data.gridW;
                S.gridH = data.gridH;
                S.grid = grid.map(function (row) { return Array.from(row); });
                // 同步到图层
                S.layers = [{ name: '图层 1', visible: true, opacity: 1.0, grid: null }];
                initLayers();
                for (var lr = 0; lr < S.gridH; lr++) {
                    for (var lc = 0; lc < S.gridW; lc++) {
                        S.layers[0].grid[lr][lc] = S.grid[lr][lc];
                    }
                }
                $('canvasWidth').value = S.gridW;
                $('canvasHeight').value = S.gridH;
                if (data.currentColorIdx >= 0 && data.currentColorIdx < PALETTE.length) {
                    S.currentColorIdx = data.currentColorIdx;
                }
            }
        } catch (e) { /* ignore */ }
    }

    function initGrid() {
        S.grid = [];
        for (var r = 0; r < S.gridH; r++) {
            S.grid[r] = new Array(S.gridW).fill(null);
        }
        // 初始化图层
        initLayers();
    }

    function initLayers() {
        // 如果图层数组为空（全新初始化），创建默认图层
        if (S.layers.length === 0) {
            S.layers = [
                { name: '图层 1', visible: true, opacity: 1.0, grid: null }
            ];
        }
        // 为每个图层初始化 grid
        for (var i = 0; i < S.layers.length; i++) {
            S.layers[i].grid = [];
            for (var r = 0; r < S.gridH; r++) {
                S.layers[i].grid[r] = new Array(S.gridW).fill(null);
            }
            // 确保 opacity 字段存在
            if (S.layers[i].opacity === undefined) S.layers[i].opacity = 1.0;
        }
        // 确保 activeLayer 有效
        if (S.activeLayer >= S.layers.length) S.activeLayer = S.layers.length - 1;
        if (S.activeLayer < 0) S.activeLayer = 0;
    }

    function syncGridFromLayers(row, col) {
        // 从下（索引0）到上（索引最大）合成
        // 上层有颜色则显示上层，否则显示下层
        if (row !== undefined && col !== undefined) {
            var val = null;
            for (var i = 0; i < S.layers.length; i++) {
                if (!S.layers[i].visible) continue;
                var lg = S.layers[i].grid;
                if (lg && lg[row] && lg[row][col] !== null) {
                    val = lg[row][col];
                }
            }
            S.grid[row][col] = val;
        } else {
            for (var r = 0; r < S.gridH; r++) {
                for (var c = 0; c < S.gridW; c++) {
                    var v = null;
                    for (var li = 0; li < S.layers.length; li++) {
                        if (!S.layers[li].visible) continue;
                        var lg2 = S.layers[li].grid;
                        if (lg2 && lg2[r] && lg2[r][c] !== null) {
                            v = lg2[r][c];
                        }
                    }
                    S.grid[r][c] = v;
                }
            }
        }
    }

    function mergeLayersToGrid() {
        // 将所有图层合并到一个图层
        syncGridFromLayers();
        // 只保留一个图层，写入合并结果
        var mergedGrid = [];
        for (var r = 0; r < S.gridH; r++) {
            mergedGrid[r] = new Array(S.gridW).fill(null);
            for (var c = 0; c < S.gridW; c++) {
                mergedGrid[r][c] = S.grid[r][c];
            }
        }
        S.layers = [
            { name: '合并图层', visible: true, opacity: 1.0, grid: mergedGrid }
        ];
        S.activeLayer = 0;
        updateLayerUI();
        pushHistory('合并全部图层');
        render();
    }

    function updateLayerUI() {
        var list = $('layerList');
        list.innerHTML = '';

        // 从最上面的图层到最下面（倒序显示，最上面的图层显示在列表顶部）
        for (var i = S.layers.length - 1; i >= 0; i--) {
            var layer = S.layers[i];
            var div = document.createElement('div');
            div.className = 'layer-item' + (i === S.activeLayer ? ' active' : '');
            div.dataset.layer = i;

            var opacityPct = Math.round((layer.opacity !== undefined ? layer.opacity : 1) * 100);

            div.innerHTML =
                '<button class="layer-vis-btn' + (layer.visible ? '' : ' hidden') + '" data-layer="' + i + '" title="显示/隐藏">' +
                    '<svg viewBox="0 0 16 16" width="12" height="12"><path d="M8 3C3 3 1 8 1 8s2 5 7 5 7-5 7-5-2-5-7-5z" stroke="currentColor" stroke-width="1.2" fill="none"/><circle cx="8" cy="8" r="2" stroke="currentColor" stroke-width="1.2" fill="none"/></svg>' +
                '</button>' +
                '<span class="layer-name" title="双击重命名">' + escapeHtml(layer.name) + '</span>' +
                '<div class="layer-opacity-wrap">' +
                    '<input type="range" class="layer-opacity-slider" min="0" max="100" value="' + opacityPct + '" data-layer="' + i + '" title="图层透明度">' +
                    '<span class="layer-opacity-val">' + opacityPct + '%</span>' +
                '</div>' +
                '<div class="layer-order-btns">' +
                    '<button class="layer-order-btn" data-layer="' + i + '" data-dir="up" title="上移">' +
                        '<svg viewBox="0 0 10 6" width="10" height="6"><path d="M1 5l4-4 4 4" stroke="currentColor" stroke-width="1.3" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>' +
                    '</button>' +
                    '<button class="layer-order-btn" data-layer="' + i + '" data-dir="down" title="下移">' +
                        '<svg viewBox="0 0 10 6" width="10" height="6"><path d="M1 1l4 4 4-4" stroke="currentColor" stroke-width="1.3" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>' +
                    '</button>' +
                '</div>' +
                '<span class="layer-active-badge">编辑中</span>';

            list.appendChild(div);
        }

        // 绑定事件
        bindLayerListEvents();
        // 同步移动端功能抽屉的图层列表
        if (window.innerWidth <= 960) {
            syncControlDrawerLayerUI();
        }

        // 同步移动端抽屉中的图层显示
        syncMobileLayerInfo();

    }

    function bindLayerListEvents() {
        var list = $('layerList');

        // 点击图层项 = 选中
        list.querySelectorAll('.layer-item').forEach(function (item) {
            item.addEventListener('click', function (e) {
                if (e.target.closest('.layer-vis-btn') ||
                    e.target.closest('.layer-opacity-slider') ||
                    e.target.closest('.layer-order-btn') ||
                    e.target.closest('.layer-name-input')) return;
                S.activeLayer = parseInt(item.dataset.layer);
                updateLayerUI();
            });
        });

        // 可见性按钮
        list.querySelectorAll('.layer-vis-btn').forEach(function (btn) {
            btn.addEventListener('click', function (e) {
                e.stopPropagation();
                var idx = parseInt(btn.dataset.layer);
                S.layers[idx].visible = !S.layers[idx].visible;
                syncGridFromLayers();
                updateLayerUI();
                render();
            });
        });

        // 透明度滑块
        list.querySelectorAll('.layer-opacity-slider').forEach(function (slider) {
            slider.addEventListener('input', function (e) {
                e.stopPropagation();
                var idx = parseInt(slider.dataset.layer);
                var val = parseInt(slider.value);
                S.layers[idx].opacity = val / 100;
                var valSpan = slider.parentElement.querySelector('.layer-opacity-val');
                if (valSpan) valSpan.textContent = val + '%';
                render();
            });
            // 阻止点击冒泡到图层项
            slider.addEventListener('click', function (e) { e.stopPropagation(); });
        });

        // 排序按钮
        list.querySelectorAll('.layer-order-btn').forEach(function (btn) {
            btn.addEventListener('click', function (e) {
                e.stopPropagation();
                var idx = parseInt(btn.dataset.layer);
                var dir = btn.dataset.dir;
                moveLayer(idx, dir);
            });
        });

        // 双击重命名
        list.querySelectorAll('.layer-name').forEach(function (nameEl) {
            nameEl.addEventListener('dblclick', function (e) {
                e.stopPropagation();
                var item = nameEl.closest('.layer-item');
                var idx = parseInt(item.dataset.layer);
                var currentName = S.layers[idx].name;

                // 替换为输入框
                var input = document.createElement('input');
                input.type = 'text';
                input.className = 'layer-name-input';
                input.value = currentName;
                input.maxLength = 20;
                nameEl.replaceWith(input);
                input.focus();
                input.select();

                function finishRename() {
                    var newName = input.value.trim() || currentName;
                    S.layers[idx].name = newName;
                    updateLayerUI();
                }

                input.addEventListener('blur', finishRename);
                input.addEventListener('keydown', function (ke) {
                    if (ke.key === 'Enter') { ke.preventDefault(); input.blur(); }
                    if (ke.key === 'Escape') { input.value = currentName; input.blur(); }
                });
            });
        });
    }

    function syncMobileLayerInfo() {
        // 更新移动端工具栏的当前图层指示
        var activeLayer = S.layers[S.activeLayer];
        if (!activeLayer) return;
        var mobPanelLeft = $('mobPanelLeft');
        if (mobPanelLeft) {
            var layerSpan = mobPanelLeft.querySelector('span');
            if (layerSpan) {
                layerSpan.textContent = '控制';
                if (S.layers.length > 1) {
                    layerSpan.textContent = activeLayer.name;
                }
            }
        }
    }

    function addLayer() {
        if (S.layers.length >= 10) {
            cdAlert('最多支持 10 个图层', { type: 'warn', title: '图层限制' });
            return;
        }
        var newGrid = [];
        for (var r = 0; r < S.gridH; r++) {
            newGrid[r] = new Array(S.gridW).fill(null);
        }
        var newName = '图层 ' + (S.layers.length + 1);
        S.layers.push({ name: newName, visible: true, opacity: 1.0, grid: newGrid });
        S.activeLayer = S.layers.length - 1;
        updateLayerUI();
        showToast('已添加「' + newName + '」', 'success', 1500);
    }

    function deleteCurrentLayer() {
        if (S.layers.length <= 1) {
            cdAlert('至少需要保留一个图层', { type: 'warn', title: '无法删除' });
            return;
        }
        var layerName = S.layers[S.activeLayer].name;
        cdConfirm('确定删除图层「' + layerName + '」吗？该图层上的内容将丢失。', {
            title: '删除图层',
            danger: true,
            okText: '删除'
        }).then(function (ok) {
            if (!ok) return;
            S.layers.splice(S.activeLayer, 1);
            if (S.activeLayer >= S.layers.length) {
                S.activeLayer = S.layers.length - 1;
            }
            syncGridFromLayers();
            updateLayerUI();
            pushHistory('删除图层「' + layerName + '」');
            render();
        });
    }

    function mergeDown() {
        if (S.activeLayer <= 0) {
            cdAlert('当前图层已在最底部，无法向下合并', { type: 'warn', title: '无法合并' });
            return;
        }
        var upperIdx = S.activeLayer;
        var lowerIdx = S.activeLayer - 1;
        var upperLayer = S.layers[upperIdx];
        var lowerLayer = S.layers[lowerIdx];

        // 将上层内容合并到下层（上层覆盖下层）
        for (var r = 0; r < S.gridH; r++) {
            for (var c = 0; c < S.gridW; c++) {
                if (upperLayer.grid[r] && upperLayer.grid[r][c] !== null) {
                    lowerLayer.grid[r][c] = upperLayer.grid[r][c];
                }
            }
        }

        // 删除上层
        var mergedName = lowerLayer.name;
        S.layers.splice(upperIdx, 1);
        S.activeLayer = lowerIdx;
        syncGridFromLayers();
        updateLayerUI();
        pushHistory('向下合并到「' + mergedName + '」');
        render();
    }

    function moveLayer(idx, direction) {
        if (direction === 'up' && idx < S.layers.length - 1) {
            // 上移 = 在数组中向后移动（因为数组末尾是最上层）
            var temp = S.layers[idx];
            S.layers[idx] = S.layers[idx + 1];
            S.layers[idx + 1] = temp;
            if (S.activeLayer === idx) S.activeLayer = idx + 1;
            else if (S.activeLayer === idx + 1) S.activeLayer = idx;
        } else if (direction === 'down' && idx > 0) {
            // 下移 = 在数组中向前移动
            var temp2 = S.layers[idx];
            S.layers[idx] = S.layers[idx - 1];
            S.layers[idx - 1] = temp2;
            if (S.activeLayer === idx) S.activeLayer = idx - 1;
            else if (S.activeLayer === idx - 1) S.activeLayer = idx;
        } else {
            return;
        }
        syncGridFromLayers();
        updateLayerUI();
        render();
    }

    function exportCurrentLayer() {
        var layer = S.layers[S.activeLayer];
        if (!layer) return;

        // 临时用当前图层的内容替换 S.grid
        var originalGrid = S.grid;
        S.grid = [];
        for (var r = 0; r < S.gridH; r++) {
            S.grid[r] = new Array(S.gridW).fill(null);
            if (layer.grid[r]) {
                for (var c = 0; c < S.gridW; c++) {
                    S.grid[r][c] = layer.grid[r][c];
                }
            }
        }

        // 检查是否有内容
        var hasContent = false;
        for (var r2 = 0; r2 < S.gridH && !hasContent; r2++) {
            for (var c2 = 0; c2 < S.gridW && !hasContent; c2++) {
                if (S.grid[r2][c2] !== null) hasContent = true;
            }
        }

        if (!hasContent) {
            S.grid = originalGrid;
            cdAlert('当前图层为空，没有内容可导出', { type: 'warn', title: '导出失败' });
            return;
        }

        // 临时修改项目名，加上图层名
        var origName = S.currentProjectName;
        S.currentProjectName = (origName || '') + (origName ? '_' : '') + layer.name;

        doExport(false);

        // 还原
        S.grid = originalGrid;
        S.currentProjectName = origName;
    }

    // ===========================
    //  Canvas Setup (DPR-aware)
    // ===========================
    function setupCanvas() {
        const w = S.gridW * S.cellSize;
        const h = S.gridH * S.cellSize;

        // Main canvas
        mainCanvas.width = w * DPR;
        mainCanvas.height = h * DPR;
        mainCanvas.style.width = w + 'px';
        mainCanvas.style.height = h + 'px';
        ctx.setTransform(DPR, 0, 0, DPR, 0, 0);

        // BG canvas
        bgCanvas.width = w * DPR;
        bgCanvas.height = h * DPR;
        bgCanvas.style.width = w + 'px';
        bgCanvas.style.height = h + 'px';
        bgCtx.setTransform(DPR, 0, 0, DPR, 0, 0);

        // Layers container
        canvasLayers.style.width = w + 'px';
        canvasLayers.style.height = h + 'px';

        // Rulers
        const rs = 30;
        rulerTop.width = w * DPR;
        rulerTop.height = rs * DPR;
        rulerTop.style.width = w + 'px';
        rulerTop.style.height = rs + 'px';

        rulerLeft.width = rs * DPR;
        rulerLeft.height = h * DPR;
        rulerLeft.style.width = rs + 'px';
        rulerLeft.style.height = h + 'px';

        fitToView();
    }

    function fitToView() {
        const rect = canvasWrapper.getBoundingClientRect();
        const margin = 32;
        const rs = S.showRuler ? 30 : 0;
        const totalW = rs + S.gridW * S.cellSize;
        const totalH = rs + S.gridH * S.cellSize;
        const sx = (rect.width - margin) / totalW;
        const sy = (rect.height - margin) / totalH;
        S.zoom = Math.min(sx, sy, 3);
        S.zoom = Math.max(S.zoom, 0.05);
        S.panX = 0;
        S.panY = 0;
        applyTransform();
    }

    function applyTransform() {
        canvasScroller.style.transform = `translate(${S.panX}px, ${S.panY}px) scale(${S.zoom})`;
        $('zoomValue').textContent = Math.round(S.zoom * 100) + '%';
        updateCanvasResolution();
        updateMinimap();
    }

    function updateCanvasResolution() {
        const cs = S.cellSize;
        const w = S.gridW * cs;
        const h = S.gridH * cs;
        var isMobile = window.innerWidth <= 960;
        var maxDPR = isMobile ? Math.min(DPR, 2) : DPR;
        const renderScale = Math.min(Math.ceil(S.zoom), isMobile ? 2 : 4) * maxDPR;

        if (mainCanvas._lastScale === renderScale) return;
        mainCanvas._lastScale = renderScale;

        mainCanvas.width = w * renderScale;
        mainCanvas.height = h * renderScale;
        mainCanvas.style.width = w + 'px';
        mainCanvas.style.height = h + 'px';
        ctx.setTransform(renderScale, 0, 0, renderScale, 0, 0);

        bgCanvas.width = w * renderScale;
        bgCanvas.height = h * renderScale;
        bgCanvas.style.width = w + 'px';
        bgCanvas.style.height = h + 'px';
        bgCtx.setTransform(renderScale, 0, 0, renderScale, 0, 0);

        render();
    }

    // ===========================
    //  Render
    // ===========================
    var _usageUpdateTimer = null;
    var _renderRAFPending = false;
    function render() {
        renderBg();
        renderMain();
        renderRulers();
        // 用料统计延迟更新，避免频繁重绘时卡顿
        clearTimeout(_usageUpdateTimer);
        _usageUpdateTimer = setTimeout(function () {
            updateUsage();
            updateLegend();
            if (S.assistMode) buildAssistColorGrid();
        }, 200);
        // 小地图单独更低频率更新
        updateMinimap();
    }

    function renderBg() {
        const cs = S.cellSize;
        const w = S.gridW * cs;
        const h = S.gridH * cs;
        bgCtx.clearRect(0, 0, w, h);

        // 读取主题棋盘格颜色
        var rootStyle = getComputedStyle(document.documentElement);
        var cell1 = rootStyle.getPropertyValue('--board-cell1').trim() || '#fdfdfd';
        var cell2 = rootStyle.getPropertyValue('--board-cell2').trim() || '#f5f2f0';

        // Checkerboard
        for (let r = 0; r < S.gridH; r++) {
            for (let c = 0; c < S.gridW; c++) {
                bgCtx.fillStyle = (r + c) % 2 === 0 ? cell1 : cell2;
                bgCtx.fillRect(c * cs, r * cs, cs, cs);
            }
        }

        // Reference image (保持比例居中 + 对齐偏移)
        if (S.refImage) {
            bgCtx.globalAlpha = S.refOpacity;
            var iw = S.refImage.naturalWidth;
            var ih = S.refImage.naturalHeight;
            var baseScale = Math.min(w / iw, h / ih);
            var finalScale = baseScale * S.gridAlignImgScale;
            var dw = iw * finalScale;
            var dh = ih * finalScale;
            var dx = (w - dw) / 2 + S.gridAlignImgOffX - S.gridAlignGridOffX;
            var dy = (h - dh) / 2 + S.gridAlignImgOffY - S.gridAlignGridOffY;
            bgCtx.drawImage(S.refImage, dx, dy, dw, dh);
            bgCtx.globalAlpha = 1;
        }
    }

    function renderMain() {
        const cs = S.cellSize;
        const w = S.gridW * cs;
        const h = S.gridH * cs;
        ctx.clearRect(0, 0, w, h);

        // Draw filled cells — 按图层顺序从下到上绘制，支持独立透明度
        for (var li = 0; li < S.layers.length; li++) {
            var layer = S.layers[li];
            if (!layer.visible || !layer.grid) continue;
            var layerOpacity = (layer.opacity !== undefined ? layer.opacity : 1) * S.cellOpacity;
            if (layerOpacity <= 0) continue;
            ctx.globalAlpha = layerOpacity;
            for (let r = 0; r < S.gridH; r++) {
                if (!layer.grid[r]) continue;
                for (let c = 0; c < S.gridW; c++) {
                    const ci = layer.grid[r][c];
                    if (ci === null) continue;
                    const color = PALETTE[ci];
                    if (!color) continue;

                    const x = c * cs;
                    const y = r * cs;

                    if (S.showBead) {
                        drawBead(ctx, x, y, cs, color.hex);
                    } else {
                        ctx.fillStyle = color.hex;
                        ctx.fillRect(x, y, cs, cs);
                    }
                }
            }
        }
        ctx.globalAlpha = 1;

        // Grid lines
        if (S.showGrid) {
            ctx.lineCap = 'butt';
            for (let r = 0; r <= S.gridH; r++) {
                const major = r % 5 === 0;
                ctx.strokeStyle = major ? 'rgba(141,123,170,0.45)' : 'rgba(200,190,200,0.3)';
                ctx.lineWidth = major ? 1.2 : 0.5;
                ctx.beginPath();
                ctx.moveTo(0, r * cs);
                ctx.lineTo(w, r * cs);
                ctx.stroke();
            }
            for (let c = 0; c <= S.gridW; c++) {
                const major = c % 5 === 0;
                ctx.strokeStyle = major ? 'rgba(141,123,170,0.45)' : 'rgba(200,190,200,0.3)';
                ctx.lineWidth = major ? 1.2 : 0.5;
                ctx.beginPath();
                ctx.moveTo(c * cs, 0);
                ctx.lineTo(c * cs, h);
                ctx.stroke();
            }
        }

        // Color number labels
        if (S.showNumbers && !S.showBead) {
            // 缩放太小时不画文字（看不清也浪费性能）
            if (S.zoom >= 0.35) {
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                const fontSize = Math.max(6, Math.min(cs * 0.48, 11));
                ctx.font = 'bold ' + fontSize + 'px -apple-system,sans-serif';

                // 预计算颜色对应的文字颜色和标签，避免重复计算
                var _labelCache = {};
                for (let r = 0; r < S.gridH; r++) {
                    for (let c = 0; c < S.gridW; c++) {
                        const ci = S.grid[r][c];
                        if (ci === null) continue;
                        if (!_labelCache[ci]) {
                            const color = PALETTE[ci];
                            const lum = luminance(color.hex);
                            _labelCache[ci] = {
                                style: lum > 0.55 ? 'rgba(60,50,55,0.6)' : 'rgba(255,255,255,0.75)',
                                label: color.id.length > 3 ? color.id.slice(-2) : color.id
                            };
                        }
                        var cached = _labelCache[ci];
                        ctx.fillStyle = cached.style;
                        ctx.fillText(cached.label, c * cs + cs / 2, r * cs + cs / 2 + 0.5);
                    }
                }
            }
        }

        // 分板线
        if (S.showSplitLine && (S.gridW > S.splitSize || S.gridH > S.splitSize)) {
            ctx.save();
            ctx.strokeStyle = 'rgba(220, 80, 80, 0.6)';
            ctx.lineWidth = 2;
            ctx.setLineDash([6, 4]);
            // 竖线
            for (var sc = S.splitSize; sc < S.gridW; sc += S.splitSize) {
                ctx.beginPath();
                ctx.moveTo(sc * cs, 0);
                ctx.lineTo(sc * cs, h);
                ctx.stroke();
            }
            // 横线
            for (var sr = S.splitSize; sr < S.gridH; sr += S.splitSize) {
                ctx.beginPath();
                ctx.moveTo(0, sr * cs);
                ctx.lineTo(w, sr * cs);
                ctx.stroke();
            }
            ctx.setLineDash([]);
            ctx.restore();

            // 板号标注
            ctx.save();
            var boardCols = Math.ceil(S.gridW / S.splitSize);
            var boardRows = Math.ceil(S.gridH / S.splitSize);
            ctx.font = 'bold 10px -apple-system, sans-serif';
            ctx.textAlign = 'left';
            ctx.textBaseline = 'top';
            for (var br = 0; br < boardRows; br++) {
                for (var bc = 0; bc < boardCols; bc++) {
                    var bx = bc * S.splitSize * cs + 3;
                    var by = br * S.splitSize * cs + 3;
                    var label = String.fromCharCode(65 + br) + (bc + 1);
                    // 背景
                    var tw = ctx.measureText(label).width;
                    ctx.fillStyle = 'rgba(220, 80, 80, 0.75)';
                    ctx.beginPath();
                    ctx.roundRect(bx - 1, by - 1, tw + 6, 14, 3);
                    ctx.fill();
                    ctx.fillStyle = '#fff';
                    ctx.fillText(label, bx + 2, by + 1);
                }
            }
            ctx.restore();
        }

        // 换色预览高亮
        if (S.tool === 'fill' && S.fillPreviewIdx >= 0 && S.fillPreviewIdx !== S.currentColorIdx) {
            var previewColor = PALETTE[S.currentColorIdx];
            for (var pr = 0; pr < S.gridH; pr++) {
                for (var pc = 0; pc < S.gridW; pc++) {
                    if (S.grid[pr][pc] === S.fillPreviewIdx) {
                        var px = pc * cs;
                        var py = pr * cs;
                        // 绘制将替换成的颜色半透明预览
                        if (previewColor) {
                            ctx.fillStyle = previewColor.hex;
                            ctx.globalAlpha = 0.5;
                            ctx.fillRect(px, py, cs, cs);
                            ctx.globalAlpha = 1;
                        }
                        // 闪烁边框
                        ctx.strokeStyle = 'rgba(220, 80, 80, 0.7)';
                        ctx.lineWidth = 1.5;
                        ctx.strokeRect(px + 0.5, py + 0.5, cs - 1, cs - 1);
                    }
                }
            }
        }

        // 中心参考线
        if (S.showCenterLine) {
            ctx.save();
            ctx.strokeStyle = 'rgba(220, 80, 80, 0.45)';
            ctx.lineWidth = 1;
            ctx.setLineDash([8, 4]);
            // 水平中心线
            var cy = Math.floor(S.gridH / 2) * cs;
            ctx.beginPath();
            ctx.moveTo(0, cy);
            ctx.lineTo(w, cy);
            ctx.stroke();
            // 垂直中心线
            var cx = Math.floor(S.gridW / 2) * cs;
            ctx.beginPath();
            ctx.moveTo(cx, 0);
            ctx.lineTo(cx, h);
            ctx.stroke();
            ctx.setLineDash([]);
            ctx.restore();
        }

        // 辅助拼豆模式覆盖层
        renderAssistOverlay();

        // 选区覆盖层
        renderSelectionOverlay();
    }


    // ===========================
    //  辅助拼豆模式 - 渲染覆盖层
    // ===========================
    function renderAssistOverlay() {
        if (!S.assistMode || S.assistHighlightIdx < 0) return;

        const cs = S.cellSize;
        const w = S.gridW * cs;
        const h = S.gridH * cs;
        const hi = S.assistHighlightIdx;

        // 读取当前主题颜色，让遮罩跟随主题变化
        var rootStyle = getComputedStyle(document.documentElement);
        var bgColor = rootStyle.getPropertyValue('--bg').trim() || '#f9f6f4';
        var irisColor = rootStyle.getPropertyValue('--iris-dark').trim() || '#8d7baa';

        // 将主题背景色转为 rgba 半透明
        var bgRgb = hexToRgb(bgColor);
        var overlayColor = 'rgba(' + bgRgb.r + ',' + bgRgb.g + ',' + bgRgb.b + ',0.75)';

        // 将主题强调色转为边框色
        var irisRgb = hexToRgb(irisColor);
        var borderColor = 'rgba(' + irisRgb.r + ',' + irisRgb.g + ',' + irisRgb.b + ',0.8)';

        // 半透明遮罩覆盖非高亮区域
        for (let r = 0; r < S.gridH; r++) {
            for (let c = 0; c < S.gridW; c++) {
                const ci = S.grid[r][c];
                if (ci === hi) continue; // 高亮颜色不遮罩
                const x = c * cs;
                const y = r * cs;
                ctx.fillStyle = overlayColor;
                ctx.fillRect(x, y, cs, cs);
            }
        }

        // 给高亮的色块加边框强调
        for (let r = 0; r < S.gridH; r++) {
            for (let c = 0; c < S.gridW; c++) {
                if (S.grid[r][c] !== hi) continue;
                const x = c * cs;
                const y = r * cs;
                ctx.strokeStyle = borderColor;
                ctx.lineWidth = 1.5;
                ctx.strokeRect(x + 0.5, y + 0.5, cs - 1, cs - 1);
            }
        }

        // 计算并显示连续色块数字
        var counted = {};
        if (S.assistDirection === 'vertical') {
            // 纵向：从上往下扫描每一列
            for (let c = 0; c < S.gridW; c++) {
                let r = 0;
                while (r < S.gridH) {
                    if (S.grid[r][c] !== hi) { r++; continue; }
                    // 找到连续段
                    var start = r;
                    while (r < S.gridH && S.grid[r][c] === hi) r++;
                    var len = r - start;
                    // 在连续段的中间位置显示数字
                    var midR = Math.floor(start + (len - 1) / 2);
                    var cx2 = c * cs + cs / 2;
                    var cy2 = midR * cs + cs / 2;
                    drawAssistNumber(cx2, cy2, len, cs);
                }
            }
        } else {
            // 横向：从左往右扫描每一行
            for (let r = 0; r < S.gridH; r++) {
                let c = 0;
                while (c < S.gridW) {
                    if (S.grid[r][c] !== hi) { c++; continue; }
                    var start = c;
                    while (c < S.gridW && S.grid[r][c] === hi) c++;
                    var len = c - start;
                    var midC = Math.floor(start + (len - 1) / 2);
                    var cx2 = midC * cs + cs / 2;
                    var cy2 = r * cs + cs / 2;
                    drawAssistNumber(cx2, cy2, len, cs);
                }
            }
        }
    }

    function drawAssistNumber(x, y, num, cs) {
        var fontSize = Math.max(8, Math.min(cs * 0.55, 14));
        ctx.font = 'bold ' + fontSize + 'px -apple-system, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';

        // 读取主题强调色用于数字背景
        var rootStyle = getComputedStyle(document.documentElement);
        var irisColor = rootStyle.getPropertyValue('--iris-dark').trim() || '#8d7baa';
        var irisRgb = hexToRgb(irisColor);

        // 数字背景圆
        var textW = ctx.measureText(String(num)).width;
        var bgR = Math.max(textW / 2 + 3, fontSize / 2 + 2);
        ctx.fillStyle = 'rgba(' + irisRgb.r + ',' + irisRgb.g + ',' + irisRgb.b + ',0.9)';
        ctx.beginPath();
        ctx.arc(x, y, bgR, 0, Math.PI * 2);
        ctx.fill();

        // 数字
        ctx.fillStyle = '#ffffff';
        ctx.fillText(String(num), x, y + 0.5);
    }

    function drawBead(c, x, y, size, hex) {
        const cx = x + size / 2;
        const cy = y + size / 2;
        const r = size / 2 - 1.2;

        // Shadow
        c.fillStyle = 'rgba(0,0,0,0.06)';
        c.beginPath();
        c.arc(cx + 0.4, cy + 0.6, r, 0, Math.PI * 2);
        c.fill();

        // Body gradient
        const grad = c.createRadialGradient(cx - r * 0.3, cy - r * 0.3, r * 0.05, cx, cy, r);
        grad.addColorStop(0, lightenHex(hex, 35));
        grad.addColorStop(0.6, hex);
        grad.addColorStop(1, darkenHex(hex, 25));
        c.fillStyle = grad;
        c.beginPath();
        c.arc(cx, cy, r, 0, Math.PI * 2);
        c.fill();

        // Rim
        c.strokeStyle = darkenHex(hex, 15);
        c.lineWidth = 0.5;
        c.beginPath();
        c.arc(cx, cy, r, 0, Math.PI * 2);
        c.stroke();

        // Center hole
        c.fillStyle = darkenHex(hex, 40);
        c.globalAlpha = 0.25;
        c.beginPath();
        c.arc(cx, cy, r * 0.18, 0, Math.PI * 2);
        c.fill();
        c.globalAlpha = 1;

        // Highlight
        c.fillStyle = 'rgba(255,255,255,0.25)';
        c.beginPath();
        c.arc(cx - r * 0.25, cy - r * 0.28, r * 0.22, 0, Math.PI * 2);
        c.fill();
    }

    function renderRulers() {
        const show = S.showRuler;
        rulerTop.style.display = show ? '' : 'none';
        rulerLeft.style.display = show ? '' : 'none';
        rulerCorner.style.display = show ? '' : 'none';

        if (show) {
            canvasContainer.classList.remove('no-ruler');
        } else {
            canvasContainer.classList.add('no-ruler');
        }

        if (!show) return;

        // 读取主题标尺颜色
        var rootStyle = getComputedStyle(document.documentElement);
        var rulerBg = rootStyle.getPropertyValue('--ruler-bg').trim() || '#f6f1ee';
        var rulerText = rootStyle.getPropertyValue('--ruler-text').trim() || '#8d7baa';
        var rulerTextMinor = rootStyle.getPropertyValue('--ruler-text-minor').trim() || '#b8aec4';
        var rulerLine = rootStyle.getPropertyValue('--ruler-line').trim() || '#cdc4d6';

        const cs = S.cellSize;
        const rs = 30;

        // Top
        const tCtx = rulerTop.getContext('2d');
        tCtx.setTransform(DPR, 0, 0, DPR, 0, 0);
        const tw = S.gridW * cs;
        tCtx.clearRect(0, 0, tw, rs);
        tCtx.fillStyle = rulerBg;
        tCtx.fillRect(0, 0, tw, rs);

        tCtx.textAlign = 'right';
        tCtx.textBaseline = 'bottom';

        var showDetail = S.zoom >= 0.6;
        for (let c = 0; c <= S.gridW; c++) {
            var major = c % 5 === 0;
            var minor = !major && showDetail;
            tCtx.strokeStyle = major ? rulerText : rulerLine;
            tCtx.lineWidth = major ? 1.5 : 0.6;
            tCtx.beginPath();
            tCtx.moveTo(c * cs, major ? rs * 0.35 : rs * 0.65);
            tCtx.lineTo(c * cs, rs);
            tCtx.stroke();

            if (major) {
                tCtx.fillStyle = rulerText;
                tCtx.font = 'bold 9px -apple-system, sans-serif';
                tCtx.fillText(String(c), c * cs - 2, rs - 4);
            } else if (minor) {
                tCtx.fillStyle = rulerTextMinor;
                tCtx.font = '7px -apple-system, sans-serif';
                tCtx.fillText(String(c), c * cs - 2, rs - 4);
            }
        }

        // Left
        const lCtx = rulerLeft.getContext('2d');
        lCtx.setTransform(DPR, 0, 0, DPR, 0, 0);
        const lh = S.gridH * cs;
        lCtx.clearRect(0, 0, rs, lh);
        lCtx.fillStyle = rulerBg;
        lCtx.fillRect(0, 0, rs, lh);

        lCtx.textAlign = 'right';
        lCtx.textBaseline = 'alphabetic';

        for (let r = 0; r <= S.gridH; r++) {
            var major = r % 5 === 0;
            var minor = !major && showDetail;
            lCtx.strokeStyle = major ? rulerText : rulerLine;
            lCtx.lineWidth = major ? 1.5 : 0.6;
            lCtx.beginPath();
            lCtx.moveTo(major ? rs * 0.35 : rs * 0.65, r * cs);
            lCtx.lineTo(rs, r * cs);
            lCtx.stroke();

            if (major) {
                lCtx.fillStyle = rulerText;
                lCtx.font = 'bold 9px -apple-system, sans-serif';
                lCtx.fillText(String(r), rs - 4, r * cs - 2);
            } else if (minor) {
                lCtx.fillStyle = rulerTextMinor;
                lCtx.font = '7px -apple-system, sans-serif';
                lCtx.fillText(String(r), rs - 4, r * cs - 2);
            }
        }
    }

    // 色板分组数据缓存
    var _paletteGroupsCache = {};

    function fillPaletteGroupItems(wrapper, items) {
        wrapper.innerHTML = '';
        items.forEach(function (item) {
            var div = document.createElement('div');
            div.className = 'palette-color' + (item.index === S.currentColorIdx ? ' active' : '');
            div.style.background = item.color.hex;
            div.dataset.idx = item.index;
            div.title = item.color.id + ' ' + item.color.name;

            var lum = luminance(item.color.hex);
            var span = document.createElement('span');
            span.className = 'color-id';
            span.textContent = item.color.id;
            span.style.color = lum > 0.55 ? 'rgba(50,40,45,0.6)' : 'rgba(255,255,255,0.8)';
            div.appendChild(span);

            div.addEventListener('click', function () { selectColor(item.index); });
            wrapper.appendChild(div);
        });
        wrapper.dataset.loaded = '1';
    }

    function lazyFillPaletteGroup(wrapper, prefix) {
        if (wrapper.dataset.loaded === '1') return;
        var items = _paletteGroupsCache[prefix];
        if (!items) return;
        fillPaletteGroupItems(wrapper, items);
    }

    // ===========================
    //  Palette
    // ===========================
    function buildPalette() {
        const grid = $('paletteGrid');
        grid.innerHTML = '';

        // 如果隐藏默认色板，跳过 MARD 部分
        if (!SHOW_DEFAULT_PALETTE) {
            // 直接渲染自定义颜色（下面的代码会处理）
        } else {

        // 按首字母分组
        const groups = {};
        const groupNames = {
            'A': 'A · 黄橙系（26色）',
            'B': 'B · 绿色系（32色）',
            'C': 'C · 蓝青系（29色）',
            'D': 'D · 蓝紫系（26色）',
            'E': 'E · 粉玫系（24色）',
            'F': 'F · 红色系（25色）',
            'G': 'G · 棕肤系（21色）',
            'H': 'H · 黑白灰系（23色）',
            'M': 'M · 大地系（15色）'
        };

        MARD_PALETTE.forEach((c, i) => {
            const prefix = c.id.charAt(0);
            if (!groups[prefix]) groups[prefix] = [];
            groups[prefix].push({ color: c, index: i });
        });

        // 逐组渲染
        Object.keys(groups).sort().forEach(prefix => {
            _paletteGroupsCache[prefix] = groups[prefix];
            // 分组标题
            const header = document.createElement('div');
            header.className = 'palette-group-header';
            header.innerHTML = '<span class="palette-group-dot" style="background:' + groups[prefix][0].color.hex + '"></span>' +
                '<span class="palette-group-title">' + (groupNames[prefix] || prefix) + '</span>' +
                '<span class="palette-group-count">' + groups[prefix].length + '色</span>' +
                '<svg class="palette-group-arrow" viewBox="0 0 12 12" width="10" height="10"><path d="M3 4.5l3 3 3-3" stroke="currentColor" stroke-width="1.5" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>';
            header.addEventListener('click', function () {
                var wrapper = this.nextElementSibling;
                var isCollapsed = wrapper.classList.toggle('collapsed');
                this.classList.toggle('collapsed', isCollapsed);
                // 懒加载：首次展开时才填充色块
                if (!isCollapsed && !wrapper.dataset.loaded) {
                    lazyFillPaletteGroup(wrapper, this.dataset.prefix);
                }
            });
            header.dataset.prefix = prefix;
            // 默认折叠状态
            header.classList.add('collapsed');
            grid.appendChild(header);

            // 色块容器
            const wrapper = document.createElement('div');
            wrapper.className = 'palette-group-colors collapsed';

            // 只预先渲染当前选中颜色所在的分组，其他懒加载
            var shouldPreload = groups[prefix].some(function (item) { return item.index === S.currentColorIdx; });
            if (shouldPreload) {
                fillPaletteGroupItems(wrapper, groups[prefix]);
                wrapper.dataset.loaded = '1';
                // 当前选中色的分组默认展开
                wrapper.classList.remove('collapsed');
                header.classList.remove('collapsed');
            }
            wrapper.dataset.groupPrefix = prefix;

            grid.appendChild(wrapper);
        });
        }  // end of if (SHOW_DEFAULT_PALETTE)

        // 自定义颜色（按分组）
        if (CUSTOM_COLORS.length > 0) {
            var baseIdx = SHOW_DEFAULT_PALETTE ? MARD_PALETTE.length : 0;

            CUSTOM_GROUPS.forEach(function (group) {
                var groupColors = [];
                CUSTOM_COLORS.forEach(function (c, ci) {
                    if ((c.group || 'default') === group.id) {
                        groupColors.push({ color: c, customIdx: ci });
                    }
                });
                if (groupColors.length === 0) return;

                var header = document.createElement('div');
                header.className = 'palette-group-header custom-group-header';
                header.innerHTML = '<svg class="palette-group-icon" viewBox="0 0 12 12" width="10" height="10"><path d="M6 1v10M1 6h10" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>' +
                    '<span class="palette-group-title">' + group.name + '</span>' +
                    '<span class="palette-group-count">' + groupColors.length + '色</span>' +
                    '<svg class="palette-group-arrow" viewBox="0 0 12 12" width="10" height="10"><path d="M3 4.5l3 3 3-3" stroke="currentColor" stroke-width="1.5" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>';
                header.addEventListener('click', function () {
                    var wrapper = this.nextElementSibling;
                    var isCollapsed = wrapper.classList.toggle('collapsed');
                    this.classList.toggle('collapsed', isCollapsed);
                });
                header.classList.add('collapsed');
                grid.appendChild(header);

                var wrapper = document.createElement('div');
                wrapper.className = 'palette-group-colors collapsed';

                groupColors.forEach(function (item) {
                    var idx = baseIdx + item.customIdx;
                    var div = document.createElement('div');
                    div.className = 'palette-color custom' + (idx === S.currentColorIdx ? ' active' : '');
                    div.style.background = item.color.hex;
                    div.dataset.idx = idx;
                    div.title = item.color.id + ' ' + item.color.name;

                    var lum = luminance(item.color.hex);
                    var span = document.createElement('span');
                    span.className = 'color-id';
                    span.textContent = item.color.id;
                    span.style.color = lum > 0.55 ? 'rgba(50,40,45,0.6)' : 'rgba(255,255,255,0.8)';
                    div.appendChild(span);

                    div.addEventListener('click', function () { selectColor(idx); });
                    wrapper.appendChild(div);
                });

                grid.appendChild(wrapper);
            });
        }

        buildCustomColorList();
        syncDrawerPalette();
    }

    function selectColor(idx) {
        if (idx < 0 || idx >= PALETTE.length) idx = 0;
        S.currentColorIdx = idx;
        S.noColor = false;
        const c = PALETTE[idx];
        $('currentColorPreview').style.background = c.hex;
        $('currentColorPreview').style.opacity = '1';
        if ($('mobCurrentColor')) $('mobCurrentColor').style.background = c.hex;
        if ($('mobCurrentColor')) $('mobCurrentColor').style.opacity = '1';
        $('currentColorId').textContent = c.id;
        $('currentColorName').textContent = c.name;

        $('paletteGrid').querySelectorAll('.palette-color').forEach(el => {
            el.classList.toggle('active', parseInt(el.dataset.idx) === idx);
        });

        // 自动展开选中颜色所在的分组
        const activeEl = $('paletteGrid').querySelector('.palette-color.active');
        if (activeEl) {
            const groupColors = activeEl.closest('.palette-group-colors');
            if (groupColors && groupColors.classList.contains('collapsed')) {
                groupColors.classList.remove('collapsed');
                const header = groupColors.previousElementSibling;
                if (header) header.classList.remove('collapsed');
            }
        }

        syncDrawerSelection();
    }

    function deselectCurrentColor() {
        S.noColor = true;
        S.currentColorIdx = -1;
        $('currentColorPreview').style.background = 'repeating-conic-gradient(#e0e0e0 0% 25%, #fff 0% 50%) 50% / 12px 12px';
        $('currentColorPreview').style.opacity = '0.6';
        if ($('mobCurrentColor')) $('mobCurrentColor').style.background = 'repeating-conic-gradient(#e0e0e0 0% 25%, #fff 0% 50%) 50% / 12px 12px';
        if ($('mobCurrentColor')) $('mobCurrentColor').style.opacity = '0.6';
        $('currentColorId').textContent = '--';
        $('currentColorName').textContent = '未选择';
        $('paletteGrid').querySelectorAll('.palette-color').forEach(el => el.classList.remove('active'));
        setTool('hand');
        syncDrawerSelection();
    }

    // ===========================
    //  History
    // ===========================
    function pushHistory(actionLabel) {
        S.history = S.history.slice(0, S.historyIdx + 1);

        // 增量记录：只记录变化的格子
        if (S.history.length > 0) {
            var prev = S.history[S.historyIdx];
            if (prev.w === S.gridW && prev.h === S.gridH) {
                // 尺寸没变，计算差异
                var diffs = [];
                var prevGrid = reconstructGrid(S.historyIdx);
                for (var r = 0; r < S.gridH; r++) {
                    for (var c = 0; c < S.gridW; c++) {
                        if (S.grid[r][c] !== prevGrid[r][c]) {
                            diffs.push(r * S.gridW + c);
                            diffs.push(S.grid[r][c] === null ? -1 : S.grid[r][c]);
                        }
                    }
                }
                // 如果没有实际变化，不记录
                if (diffs.length === 0) {
                    updateHistoryUI();
                    return;
                }
                // 如果差异不大（少于总格子数 30%），使用增量
                if (diffs.length / 2 < S.gridW * S.gridH * 0.3) {
                    S.history.push({
                        w: S.gridW,
                        h: S.gridH,
                        _diffs: diffs,
                        _baseIdx: S.historyIdx,
                        _label: actionLabel || ('编辑 x' + (diffs.length / 2) + '格')
                    });
                } else {
                    // 差异太大，存全量但用紧凑格式
                    S.history.push({
                        grid: compactGrid(S.grid, S.gridW, S.gridH),
                        w: S.gridW,
                        h: S.gridH,
                        _compact: true,
                        _label: actionLabel || '编辑'
                    });
                }
            } else {
                // 尺寸变了，存全量
                S.history.push({
                    grid: compactGrid(S.grid, S.gridW, S.gridH),
                    w: S.gridW,
                    h: S.gridH,
                    _compact: true,
                    _label: actionLabel || '调整尺寸'
                });
            }
        } else {
            // 第一条，存全量
            S.history.push({
                grid: compactGrid(S.grid, S.gridW, S.gridH),
                w: S.gridW,
                h: S.gridH,
                _compact: true,
                _label: actionLabel || '初始状态'
            });
        }

        // 增量链太长时，每隔 3 步强制存一个全量快照
        if (S.history.length > 3) {
            var lastFull = -1;
            for (var i = S.history.length - 1; i >= 0; i--) {
                if (S.history[i].grid) { lastFull = i; break; }
            }
            if (S.history.length - 1 - lastFull >= 3) {
                var lastEntry = S.history[S.history.length - 1];
                if (!lastEntry.grid) {
                    lastEntry.grid = compactGrid(S.grid, S.gridW, S.gridH);
                    lastEntry._compact = true;
                    delete lastEntry._diffs;
                    delete lastEntry._baseIdx;
                }
            }
        }

        if (S.history.length > S.maxHistory + 1) S.history.shift();
        S.historyIdx = S.history.length - 1;
        updateHistoryUI();
    }

    // 紧凑格式：用 Int16Array 存储，比普通数组省内存
    function compactGrid(grid, w, h) {
        var arr = new Int16Array(w * h);
        for (var r = 0; r < h; r++) {
            for (var c = 0; c < w; c++) {
                var v = grid[r][c];
                arr[r * w + c] = v === null ? -1 : v;
            }
        }
        return arr;
    }

    function reconstructGrid(idx) {
        // 从历史记录中重建指定索引的完整 grid
        // 先收集需要回溯的增量链
        var chain = [];
        var cur = idx;
        var maxChain = 10; // 限制回溯深度，防止卡顿
        while (cur >= 0 && S.history[cur] && !S.history[cur].grid && maxChain > 0) {
            chain.push(cur);
            cur = S.history[cur]._baseIdx;
            maxChain--;
        }
        // cur 现在指向一个全量快照
        var baseGrid;
        if (cur >= 0 && S.history[cur] && S.history[cur].grid) {
            var snap = S.history[cur];
            if (snap._compact) {
                // 从紧凑格式还原
                baseGrid = [];
                var arr = snap.grid;
                for (var rr = 0; rr < snap.h; rr++) {
                    baseGrid[rr] = [];
                    for (var cc = 0; cc < snap.w; cc++) {
                        var v = arr[rr * snap.w + cc];
                        baseGrid[rr][cc] = v < 0 ? null : v;
                    }
                }
            } else {
                baseGrid = snap.grid.map(function (r) { return r.slice(); });
            }
        } else {
            // 兜底：创建空 grid
            baseGrid = [];
            var w = S.history[idx].w;
            var h = S.history[idx].h;
            for (var rr2 = 0; rr2 < h; rr2++) {
                baseGrid[rr2] = new Array(w).fill(null);
            }
        }
        // 从最早的增量开始依次应用
        for (var i = chain.length - 1; i >= 0; i--) {
            var diffSnap = S.history[chain[i]];
            var diffs = diffSnap._diffs;
            if (!diffs) continue;
            for (var d = 0; d < diffs.length; d += 2) {
                var pos = diffs[d];
                var val = diffs[d + 1];
                var row = Math.floor(pos / diffSnap.w);
                var col = pos % diffSnap.w;
                if (row < baseGrid.length && col < baseGrid[0].length) {
                    baseGrid[row][col] = val < 0 ? null : val;
                }
            }
        }
        return baseGrid;
    }

    function undo() {
        if (S.historyIdx > 0) { S.historyIdx--; restoreSnap(); }
    }

    function redo() {
        if (S.historyIdx < S.history.length - 1) { S.historyIdx++; restoreSnap(); }
    }

    function restoreSnap() {
        var snap = S.history[S.historyIdx];
        var sizeChanged = (snap.w !== S.gridW || snap.h !== S.gridH);
        S.gridW = snap.w;
        S.gridH = snap.h;
        S.grid = reconstructGrid(S.historyIdx);
                // 还原到单图层
                S.layers = [{ name: '图层 1', visible: true, opacity: 1.0, grid: null }];
                initLayers();
                for (var lr = 0; lr < S.gridH; lr++) {
                    for (var lc = 0; lc < S.gridW; lc++) {
                        if (S.grid[lr] && S.grid[lr][lc] !== undefined)
                            S.layers[0].grid[lr][lc] = S.grid[lr][lc];
                    }
                }
        $('canvasWidth').value = S.gridW;
        $('canvasHeight').value = S.gridH;
        if (sizeChanged) {
            setupCanvas();
        } else {
            // 尺寸没变，只重绘，不重置缩放和平移
            var w = S.gridW * S.cellSize;
            var h = S.gridH * S.cellSize;
            var renderScale = Math.min(Math.ceil(S.zoom), 4) * DPR;
            mainCanvas.width = w * renderScale;
            mainCanvas.height = h * renderScale;
            mainCanvas.style.width = w + 'px';
            mainCanvas.style.height = h + 'px';
            ctx.setTransform(renderScale, 0, 0, renderScale, 0, 0);
            bgCanvas.width = w * renderScale;
            bgCanvas.height = h * renderScale;
            bgCanvas.style.width = w + 'px';
            bgCanvas.style.height = h + 'px';
            bgCtx.setTransform(renderScale, 0, 0, renderScale, 0, 0);
            mainCanvas._lastScale = renderScale;
        }
        updateLayerUI();
        render();
        updateHistoryUI();
    }

    function updateHistoryUI() {
        var label = '';
        if (S.history[S.historyIdx] && S.history[S.historyIdx]._label) {
            label = ' · ' + S.history[S.historyIdx]._label;
        }
        $('historyInfo').textContent = S.historyIdx + ' / ' + (S.history.length - 1) + label;
    }

    // ===========================
    //  Usage & Legend
    // ===========================
    function updateUsage() {
        const counts = {};
        let total = 0;
        for (let r = 0; r < S.gridH; r++) {
            for (let c = 0; c < S.gridW; c++) {
                const ci = S.grid[r][c];
                if (ci !== null) {
                    counts[ci] = (counts[ci] || 0) + 1;
                    total++;
                }
            }
        }
        $('totalBeads').textContent = total;

        const list = $('usageList');
        list.innerHTML = '';
        Object.entries(counts)
            .sort((a, b) => b[1] - a[1])
            .forEach(([ci, count]) => {
                const color = PALETTE[ci];
                const div = document.createElement('div');
                div.className = 'usage-item';
                div.innerHTML =
                    '<div class="usage-swatch" style="background:' + color.hex + '"></div>' +
                    '<span class="usage-name">' + color.id + ' ' + color.name + '</span>' +
                    '<span class="usage-count">' + count + '</span>';
                list.appendChild(div);
            });

        syncDrawerSelection();
    }

    function updateLegend() {
        const used = new Set();
        for (let r = 0; r < S.gridH; r++)
            for (let c = 0; c < S.gridW; c++)
                if (S.grid[r][c] !== null) used.add(S.grid[r][c]);

        const legend = $('colorLegend');
        legend.innerHTML = '';
        used.forEach(ci => {
            const color = PALETTE[ci];
            const div = document.createElement('div');
            div.className = 'legend-item';
            div.innerHTML =
                '<div class="legend-swatch" style="background:' + color.hex + '"></div>' +
                '<span>' + color.id + '</span>';
            legend.appendChild(div);
        });
    }

    // ===========================
    //  Custom Color Management
    // ===========================
    function addCustomColor() {
        const id = $('customColorId').value.trim();
        const name = $('customColorName').value.trim() || id;
        let hex = $('customColorHex').value;
        if (!id) { alert('请输入颜色编号'); return; }
        if (!/^#[0-9A-Fa-f]{6}$/.test(hex)) { alert('颜色格式不正确'); return; }
        hex = hex.toUpperCase();
        if (PALETTE.some(c => c.id === id)) {
            alert('编号 "' + id + '" 已存在，请换一个编号');
            return;
        }
        const groupId = $('customGroupSelect') ? $('customGroupSelect').value : 'default';
        CUSTOM_COLORS.push({ id: id, name: name, hex: hex, group: groupId });
        rebuildPalette();
        saveCustomColors();
        buildPalette();
        selectColor(PALETTE.length - 1);
        $('customColorId').value = '';
        $('customColorName').value = '';
    }

    function removeCustomColor(customIdx) {
        const paletteIdx = (SHOW_DEFAULT_PALETTE ? MARD_PALETTE.length : 0) + customIdx;
        let inUse = false;
        for (let r = 0; r < S.gridH; r++)
            for (let c = 0; c < S.gridW; c++)
                if (S.grid[r][c] === paletteIdx) { inUse = true; break; }

        if (inUse && !confirm('该颜色正在画布中使用，删除后对应格子将被清空。确定删除？')) return;

        for (let r = 0; r < S.gridH; r++)
            for (let c = 0; c < S.gridW; c++) {
                if (S.grid[r][c] === paletteIdx) S.grid[r][c] = null;
                else if (S.grid[r][c] !== null && S.grid[r][c] > paletteIdx) S.grid[r][c]--;
            }

        CUSTOM_COLORS.splice(customIdx, 1);
        rebuildPalette();
        saveCustomColors();
        if (S.currentColorIdx >= PALETTE.length) selectColor(0);
        buildPalette();
        // 清空历史（因为旧历史中的颜色索引已不正确）
        S.history = [];
        S.historyIdx = -1;
        pushHistory();
        render();
    }

    function buildCustomColorList() {
        const list = $('customColorList');
        if (!list) return;
        list.innerHTML = '';

        // 按分组显示
        CUSTOM_GROUPS.forEach(function (group) {
            const groupColors = CUSTOM_COLORS.filter(function (c) {
                return (c.group || 'default') === group.id;
            });
            if (groupColors.length === 0) return;

            const header = document.createElement('div');
            header.className = 'custom-color-item';
            header.style.background = 'var(--iris-lighter)';
            header.style.fontWeight = '700';
            header.style.fontSize = '10px';
            header.style.color = 'var(--iris-dark)';
            header.innerHTML = '<span>' + group.name + ' (' + groupColors.length + '色)</span>';
            list.appendChild(header);

            groupColors.forEach(function (c) {
                const i = CUSTOM_COLORS.indexOf(c);
                const div = document.createElement('div');
                div.className = 'custom-color-item';
                div.innerHTML =
                    '<div class="custom-color-swatch" style="background:' + c.hex + '"></div>' +
                    '<span class="custom-color-info">' + c.id + ' ' + c.name + '</span>' +
                    '<button class="custom-color-del" title="删除">×</button>';
                div.querySelector('.custom-color-del').addEventListener('click', function (e) {
                    e.stopPropagation();
                    removeCustomColor(i);
                });
                list.appendChild(div);
            });
        });

        // 更新分组下拉
        updateGroupSelect();
    }

    function updateGroupSelect() {
        const sel = $('customGroupSelect');
        if (!sel) return;
        const current = sel.value;
        sel.innerHTML = '';
        CUSTOM_GROUPS.forEach(function (g) {
            const opt = document.createElement('option');
            opt.value = g.id;
            opt.textContent = g.name;
            sel.appendChild(opt);
        });
        if (current && Array.from(sel.options).some(function (o) { return o.value === current; })) {
            sel.value = current;
        }
    }

    // ===========================
    //  Drawing Logic
    // ===========================
    function cellFromMouse(e) {
        const rect = mainCanvas.getBoundingClientRect();
        const scaleX = (S.gridW * S.cellSize) / rect.width;
        const scaleY = (S.gridH * S.cellSize) / rect.height;
        const x = (e.clientX - rect.left) * scaleX;
        const y = (e.clientY - rect.top) * scaleY;
        const col = Math.floor(x / S.cellSize);
        const row = Math.floor(y / S.cellSize);
        if (row < 0 || row >= S.gridH || col < 0 || col >= S.gridW) return null;
        return { row, col };
    }

    function cellFromTouch(e) {
        const t = e.touches[0] || e.changedTouches[0];
        return cellFromMouse(t);
    }

    function paintCell(row, col) {
        var cs = S.cellSize;
        var size = S.brushSize;
        var half = Math.floor(size / 2);

        // 收集所有要绘制的坐标（考虑对称）
        var points = [{ r: row, c: col }];

        if (S.symmetryMode === 'h' || S.symmetryMode === 'hv') {
            var mirrorC = S.gridW - 1 - col;
            points.push({ r: row, c: mirrorC });
        }
        if (S.symmetryMode === 'v' || S.symmetryMode === 'hv') {
            var mirrorR = S.gridH - 1 - row;
            points.push({ r: mirrorR, c: col });
        }
        if (S.symmetryMode === 'hv') {
            points.push({ r: S.gridH - 1 - row, c: S.gridW - 1 - col });
        }

        // 去重
        var seen = {};
        var uniquePoints = [];
        for (var p = 0; p < points.length; p++) {
            var key = points[p].r + ',' + points[p].c;
            if (!seen[key]) {
                seen[key] = true;
                uniquePoints.push(points[p]);
            }
        }

        // 对每个点应用画笔大小（只修改数据，不立即渲染）
        for (var pi = 0; pi < uniquePoints.length; pi++) {
            var pr = uniquePoints[pi].r;
            var pc = uniquePoints[pi].c;
            for (var dr = -half; dr < size - half; dr++) {
                for (var dc = -half; dc < size - half; dc++) {
                    var r = pr + dr;
                    var c = pc + dc;
                    if (r < 0 || r >= S.gridH || c < 0 || c >= S.gridW) continue;
                    if (S.tool === 'pen') {
                        if (S.noColor) return;
                        var layerGrid = S.layers[S.activeLayer].grid;
                        if (layerGrid && layerGrid[r] && layerGrid[r][c] !== S.currentColorIdx) {
                            layerGrid[r][c] = S.currentColorIdx;
                            syncGridFromLayers(r, c);
                            _dirtyCells.push(r, c);
                        }
                    } else if (S.tool === 'eraser') {
                        var layerGrid2 = S.layers[S.activeLayer].grid;
                        if (layerGrid2 && layerGrid2[r] && layerGrid2[r][c] !== null) {
                            layerGrid2[r][c] = null;
                            syncGridFromLayers(r, c);
                            _dirtyCells.push(r, c);
                        }
                    }
                }
            }
        }

        // 批量刷新脏格子
        if (_dirtyCells.length > 0 && !_renderRAFPending) {
            _renderRAFPending = true;
            requestAnimationFrame(flushDirtyCells);
        }
    }

    function flushDirtyCells() {
        _renderRAFPending = false;
        var cs = S.cellSize;
        // 如果脏格子太多（超过总格子的20%），直接全量重绘更快
        if (_dirtyCells.length > S.gridW * S.gridH * 0.4) {
            _dirtyCells.length = 0;
            renderMain();
            return;
        }
        for (var i = 0; i < _dirtyCells.length; i += 2) {
            renderCellFast(_dirtyCells[i], _dirtyCells[i + 1], cs);
        }
        _dirtyCells.length = 0;
    }

    function renderCellFast(row, col, cs) {
        const x = col * cs;
        const y = row * cs;
        // 清除该格
        ctx.clearRect(x, y, cs, cs);
        // 重画色块
        const ci = S.grid[row][col];
        if (ci !== null) {
            const color = PALETTE[ci];
            ctx.globalAlpha = S.cellOpacity;
            if (S.showBead) {
                drawBead(ctx, x, y, cs, color.hex);
            } else {
                ctx.fillStyle = color.hex;
                ctx.fillRect(x, y, cs, cs);
            }
            ctx.globalAlpha = 1;
        }
        // 重画该格的网格线
        if (S.showGrid) {
            const drawLine = (x1, y1, x2, y2, major) => {
                ctx.strokeStyle = major ? 'rgba(141,123,170,0.45)' : 'rgba(200,190,200,0.3)';
                ctx.lineWidth = major ? 1.2 : 0.5;
                ctx.beginPath();
                ctx.moveTo(x1, y1);
                ctx.lineTo(x2, y2);
                ctx.stroke();
            };
            drawLine(x, y, x + cs, y, row % 5 === 0);
            drawLine(x, y + cs, x + cs, y + cs, (row + 1) % 5 === 0);
            drawLine(x, y, x, y + cs, col % 5 === 0);
            drawLine(x + cs, y, x + cs, y + cs, (col + 1) % 5 === 0);
        }
        // 重画色号数字
        if (S.showNumbers && !S.showBead && ci !== null) {
            const color = PALETTE[ci];
            const fontSize = Math.max(6, Math.min(cs * 0.48, 11));
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.font = `bold ${fontSize}px -apple-system, sans-serif`;
            const lum = luminance(color.hex);
            ctx.fillStyle = lum > 0.55 ? 'rgba(60,50,55,0.6)' : 'rgba(255,255,255,0.75)';
            const label = color.id.length > 3 ? color.id.slice(-2) : color.id;
            ctx.fillText(label, x + cs / 2, y + cs / 2 + 0.5);
        }
    }

    function pickColorAt(row, col) {
        const ci = S.grid[row][col];
        if (ci !== null) selectColor(ci);
        setTool('pen');
    }

    function pickBgColorAt(row, col) {
        if (!S.refImage) {
            alert('请先上传参考底图');
            setTool('pen');
            return;
        }
        // 从底图采样该区块的平均颜色
        var imgW = S.refImage.naturalWidth;
        var imgH = S.refImage.naturalHeight;
        var tmp = document.createElement('canvas');
        tmp.width = imgW;
        tmp.height = imgH;
        var tc = tmp.getContext('2d');
        tc.drawImage(S.refImage, 0, 0, imgW, imgH);

        // 计算图片在画板上的实际映射区域（保持比例，不压扁）
        var canvasPixelW = S.gridW * S.cellSize;
        var canvasPixelH = S.gridH * S.cellSize;
        var imgScale = Math.min(canvasPixelW / imgW, canvasPixelH / imgH);
        var mappedW = imgW * imgScale;
        var mappedH = imgH * imgScale;
        var offsetX = (canvasPixelW - mappedW) / 2;
        var offsetY = (canvasPixelH - mappedH) / 2;

        var startCol = Math.floor(offsetX / S.cellSize);
        var startRow = Math.floor(offsetY / S.cellSize);
        var endCol = Math.ceil((offsetX + mappedW) / S.cellSize);
        var endRow = Math.ceil((offsetY + mappedH) / S.cellSize);
        startCol = Math.max(0, startCol);
        startRow = Math.max(0, startRow);
        endCol = Math.min(S.gridW, endCol);
        endRow = Math.min(S.gridH, endRow);

        var coveredCols = endCol - startCol;
        var coveredRows = endRow - startRow;

        var blockW = imgW / coveredCols;
        var blockH = imgH / coveredRows;
        var x0 = Math.round(col * blockW);
        var y0 = Math.round(row * blockH);
        var x1 = Math.round((col + 1) * blockW);
        var y1 = Math.round((row + 1) * blockH);
        if (x1 > imgW) x1 = imgW;
        if (y1 > imgH) y1 = imgH;
        if (x1 <= x0) x1 = x0 + 1;
        if (y1 <= y0) y1 = y0 + 1;

        var data = tc.getImageData(x0, y0, x1 - x0, y1 - y0).data;
        var sumR = 0, sumG = 0, sumB = 0, cnt = 0;
        for (var i = 0; i < data.length; i += 4) {
            if (data[i+3] < 100) continue;
            sumR += data[i]; sumG += data[i+1]; sumB += data[i+2]; cnt++;
        }
        if (cnt === 0) { setTool('pen'); return; }

        var avgR = Math.round(sumR / cnt);
        var avgG = Math.round(sumG / cnt);
        var avgB = Math.round(sumB / cnt);

        // 使 Lab 缓存失效后重建
        _paletteLabCache = null;
        var bestI = findClosestPaletteColor(avgR, avgG, avgB);
        selectColor(bestI);
        setTool('pen');
    }


    function fillReplace(row, col) {
        S.fillPreviewIdx = -1;
        const oldCI = S.grid[row][col];
        const newCI = S.currentColorIdx;
        if (oldCI === newCI) return;
        let changed = false;
        for (let r = 0; r < S.gridH; r++)
            for (let c = 0; c < S.gridW; c++)
                if (S.grid[r][c] === oldCI) {
                    S.grid[r][c] = newCI;
                    if (S.layers[S.activeLayer].grid && S.layers[S.activeLayer].grid[r])
                        S.layers[S.activeLayer].grid[r][c] = newCI;
                    changed = true;
                }
        if (changed) { pushHistory(); render(); }
    }


    function floodFill(startRow, startCol) {
        const oldCI = S.grid[startRow][startCol];
        const newCI = S.currentColorIdx;
        if (oldCI === newCI) return;

        const w = S.gridW;
        const visited = new Uint8Array(S.gridH * w);
        const stack = [[startRow, startCol]];
        visited[startRow * w + startCol] = 1;

        while (stack.length > 0) {
            const [r, c] = stack.pop();
            S.grid[r][c] = newCI;
            if (S.layers[S.activeLayer].grid) S.layers[S.activeLayer].grid[r][c] = newCI;

            const neighbors = [[r - 1, c], [r + 1, c], [r, c - 1], [r, c + 1]];
            for (const [nr, nc] of neighbors) {
                if (nr < 0 || nr >= S.gridH || nc < 0 || nc >= w) continue;
                const idx = nr * w + nc;
                if (visited[idx]) continue;
                if (S.grid[nr][nc] !== oldCI) continue;
                visited[idx] = 1;
                stack.push([nr, nc]);
            }
        }

        pushHistory();
        render();
    }

    function setTool(t) {
        S.tool = t;
        document.querySelectorAll('.btn-tool').forEach(b => b.classList.toggle('active', b.dataset.tool === t));
        document.querySelectorAll('.mob-tool[data-tool]').forEach(b => b.classList.toggle('active', b.dataset.tool === t));
        $('fillHint').style.display = t === 'fill' ? 'block' : 'none';
        if ($('bucketHint')) $('bucketHint').style.display = t === 'bucket' ? 'block' : 'none';
        canvasWrapper.classList.toggle('hand-mode', t === 'hand');
        // 移动端不禁用 pointerEvents，否则触摸事件无法触发
        var isMobile = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
        if (isMobile) {
            mainCanvas.style.pointerEvents = 'auto';
        } else {
            mainCanvas.style.pointerEvents = t === 'hand' ? 'none' : 'auto';
        }
        // 显示工具提示
        var toolHints = {
            'pen': '画笔 <span class="tool-hint-key">B</span>',
            'eraser': '橡皮 <span class="tool-hint-key">E</span>',
            'picker': '吸色 <span class="tool-hint-key">I</span>',
            'bgpicker': '吸底图色',
            'bucket': '填充 <span class="tool-hint-key">F</span>',
            'fill': '换色 <span class="tool-hint-key">G</span>',
            'hand': '抓手 <span class="tool-hint-key">H</span>',
            'select': '框选 <span class="tool-hint-key">M</span>'
        };
        var hintBar = $('toolHintBar');
        if (hintBar && toolHints[t]) {
            hintBar.innerHTML = toolHints[t];
            hintBar.classList.add('active');
            clearTimeout(hintBar._timer);
            hintBar._timer = setTimeout(function () {
                hintBar.classList.remove('active');
            }, 1200);
        }
    }

    // ===========================
    //  Events
    // ===========================
    function bindAllEvents() {
        // Size
        $('applySize').addEventListener('click', applySize);
        document.querySelectorAll('.btn-preset').forEach(btn => {
            btn.addEventListener('click', () => {
                $('canvasWidth').value = btn.dataset.w;
                $('canvasHeight').value = btn.dataset.h;
                document.querySelectorAll('.btn-preset').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                applySize();
            });
        });

        // Zoom
        $('zoomIn').addEventListener('click', () => { S.zoom = Math.min(S.zoom * 1.25, 6); applyTransform(); });
        $('zoomOut').addEventListener('click', () => { S.zoom = Math.max(S.zoom / 1.25, 0.05); applyTransform(); });
        $('zoomFit').addEventListener('click', fitToView);

        canvasWrapper.addEventListener('wheel', e => {
            e.preventDefault();
            const d = e.deltaY > 0 ? 0.9 : 1.1;
            S.zoom = Math.min(Math.max(S.zoom * d, 0.05), 6);
            applyTransform();
        }, { passive: false });

        // Tools
        document.querySelectorAll('.btn-tool').forEach(b => b.addEventListener('click', () => setTool(b.dataset.tool)));
        document.querySelectorAll('.mob-tool[data-tool]').forEach(b => b.addEventListener('click', () => setTool(b.dataset.tool)));

        // Draw Mouse
        mainCanvas.addEventListener('mousedown', onMouseDown);
        mainCanvas.addEventListener('mousemove', onCanvasHover);
        mainCanvas.addEventListener('mouseleave', function () {
            if (S.fillPreviewIdx >= 0) {
                S.fillPreviewIdx = -1;
                renderMain();
            }
            $('coordPos').textContent = '行: -- 列: --';
            $('coordColor').textContent = '';
        });
        window.addEventListener('mousemove', onMouseMove);
        window.addEventListener('mouseup', onMouseUp);

        // Draw Touch
        mainCanvas.addEventListener('touchstart', onTouchStart, { passive: false });
        mainCanvas.addEventListener('touchmove', onTouchMove, { passive: false });
        mainCanvas.addEventListener('touchend', onTouchEnd);

        // Pan (middle-click or wrapper bg)
        canvasWrapper.addEventListener('mousedown', e => {
            if (e.button === 1 || (e.button === 0 && (e.target === canvasWrapper || e.target === canvasScroller)) || (e.button === 0 && S.tool === 'hand')) {
                e.preventDefault();
                S.isPanning = true;
                S.panStart = { x: e.clientX - S.panX, y: e.clientY - S.panY };
                canvasWrapper.style.cursor = 'grabbing';
            }
        });
        window.addEventListener('mousemove', e => {
            if (S.isPanning) {
                S.panX = e.clientX - S.panStart.x;
                S.panY = e.clientY - S.panStart.y;
                applyTransform();
            }
        });
        window.addEventListener('mouseup', () => {
            if (S.isPanning) { S.isPanning = false; canvasWrapper.style.cursor = ''; }
        });

        // 移动端单指拖拽画布（在画布空白区域或 canvasScroller 上触发）
        canvasWrapper.addEventListener('touchstart', function (evt) {
            if (evt.touches.length === 1 && S.tool === 'hand' && !_pinchActive) {
                var touch = evt.target;
                // 检查是否触摸到了 canvasWrapper 或 canvasScroller（非 mainCanvas 已由自己的事件处理）
                if (evt.target === canvasWrapper || evt.target === canvasScroller) {
                    evt.preventDefault();
                    S.isPanning = true;
                    S.panStart = { x: evt.touches[0].clientX - S.panX, y: evt.touches[0].clientY - S.panY };
                }
            }
        }, { passive: false });
        canvasWrapper.addEventListener('touchmove', function (evt) {
            if (S.isPanning && S.tool === 'hand' && evt.touches.length === 1 && !_pinchActive) {
                evt.preventDefault();
                S.panX = evt.touches[0].clientX - S.panStart.x;
                S.panY = evt.touches[0].clientY - S.panStart.y;
                canvasScroller.style.transform = 'translate(' + S.panX + 'px,' + S.panY + 'px) scale(' + S.zoom + ')';
                $('zoomValue').textContent = Math.round(S.zoom * 100) + '%';
            }
        }, { passive: false });
        canvasWrapper.addEventListener('touchend', function (evt) {
            if (S.isPanning && S.tool === 'hand' && evt.touches.length === 0) {
                S.isPanning = false;
            }
        });

        // Two-finger pan/zoom for mobile (optimized)
        let pinchStartDist = 0, pinchStartZoom = 1;
        let panTouchStart = null;
        var _pinchRAFPending = false;
        canvasWrapper.addEventListener('touchstart', e => {
            if (e.touches.length === 2) {
                e.preventDefault();
                e.stopPropagation();
                // 取消正在进行的绘图
                if (S.isDrawing) {
                    S.isDrawing = false;
                    S.lastDrawCell = null;
                }
                _pinchActive = true;
                _pinchMoved = false;
                const dx = e.touches[0].clientX - e.touches[1].clientX;
                const dy = e.touches[0].clientY - e.touches[1].clientY;
                pinchStartDist = Math.sqrt(dx * dx + dy * dy);
                pinchStartZoom = S.zoom;
                const mx = (e.touches[0].clientX + e.touches[1].clientX) / 2;
                const my = (e.touches[0].clientY + e.touches[1].clientY) / 2;
                panTouchStart = { x: mx - S.panX, y: my - S.panY };
            }
        }, { passive: false });
        canvasWrapper.addEventListener('touchmove', e => {
            if (e.touches.length === 2 && _pinchActive) {
                e.preventDefault();
                e.stopPropagation();
                _pinchMoved = true;
                var t0x = e.touches[0].clientX, t0y = e.touches[0].clientY;
                var t1x = e.touches[1].clientX, t1y = e.touches[1].clientY;
                var dx = t0x - t1x;
                var dy = t0y - t1y;
                var dist = Math.sqrt(dx * dx + dy * dy);
                S.zoom = Math.min(Math.max(pinchStartZoom * (dist / pinchStartDist), 0.05), 6);
                if (panTouchStart) {
                    var mx = (t0x + t1x) / 2;
                    var my = (t0y + t1y) / 2;
                    S.panX = mx - panTouchStart.x;
                    S.panY = my - panTouchStart.y;
                }
                canvasScroller.style.transform = 'translate(' + S.panX + 'px,' + S.panY + 'px) scale(' + S.zoom + ')';
                $('zoomValue').textContent = Math.round(S.zoom * 100) + '%';
            }
        }, { passive: false });
        canvasWrapper.addEventListener('touchend', e => {
            if (_pinchActive && e.touches.length < 2) {
                _pinchActive = false;
                // 双指结束后更新分辨率（延迟执行避免卡顿）
                if (_pinchMoved) {
                    _pinchMoved = false;
                    setTimeout(function () {
                        updateCanvasResolution();
                    }, 200);
                }
                // 防止双指结束后误触发单指绘图
                _pinchJustEnded = true;
                setTimeout(function () {
                    _pinchJustEnded = false;
                }, 300);
            }
        }, { passive: false });

        // Toggles
        $('toggleGrid').addEventListener('change', e => { S.showGrid = e.target.checked; renderMain(); });
        $('toggleRuler').addEventListener('change', e => { S.showRuler = e.target.checked; renderRulers(); fitToView(); });
        $('toggleNumbers').addEventListener('change', e => { S.showNumbers = e.target.checked; renderMain(); });
        $('toggleBead').addEventListener('change', e => { S.showBead = e.target.checked; renderMain(); });
        $('toggleSplitLine').addEventListener('change', function (e) {
            S.showSplitLine = e.target.checked;
            renderMain();
        });

        // History
        $('undoBtn').addEventListener('click', undo);
        $('redoBtn').addEventListener('click', redo);
        $('clearCanvasBtn').addEventListener('click', function () {
            cdConfirm('确定要清空整个画布吗？此操作可以撤销。', { title: '清空画布', danger: true, okText: '清空' }).then(function (ok) {
            if (!ok) return;
            for (let r = 0; r < S.gridH; r++)
                for (let c = 0; c < S.gridW; c++)
                    S.grid[r][c] = null;
            // 清空图层
            for (var lr = 0; lr < S.layers.length; lr++) {
                if (S.layers[lr].grid) {
                    for (var lr2 = 0; lr2 < S.gridH; lr2++) {
                        S.layers[lr].grid[lr2] = new Array(S.gridW).fill(null);
                    }
                }
            }
            S.currentProjectId = null;
            S.currentProjectName = '';
            // 清空画布时立即删除自动保存数据
            try { localStorage.removeItem('catpeas_autosave'); } catch (e) { }
            pushHistory();
            render();
            }); // cdConfirm.then 结束
        });
        if ($('mobUndo')) $('mobUndo').addEventListener('click', undo);
        if ($('mobRedo')) $('mobRedo').addEventListener('click', redo);

        document.addEventListener('keydown', e => {
            // 如果正在输入框中则跳过
            if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

            if ((e.ctrlKey || e.metaKey) && e.key === 'z') { e.preventDefault(); undo(); }
            if ((e.ctrlKey || e.metaKey) && e.key === 'y') { e.preventDefault(); redo(); }
            if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'Z') { e.preventDefault(); redo(); }
            if ((e.ctrlKey || e.metaKey) && e.key === 's') { e.preventDefault(); saveProject(); }

            // 工具快捷键
            if (e.key === 'b' || e.key === 'B') setTool('pen');
            if (e.key === 'e' || e.key === 'E') setTool('eraser');
            if (e.key === 'i' || e.key === 'I') setTool('picker');
            if (e.key === 'g' || e.key === 'G') setTool('fill');
            if (e.key === 'h' || e.key === 'H') setTool('hand');
            if (e.key === 'm' || e.key === 'M') setTool('select');
            if (e.key === 'Home') { e.preventDefault(); fitToView(); }
            if (e.key === 'f' || e.key === 'F') setTool('bucket');
            
            // 选区快捷键
            if ((e.ctrlKey || e.metaKey) && e.key === 'c' && S.selection) { e.preventDefault(); copySelection(); }
            if ((e.ctrlKey || e.metaKey) && e.key === 'v' && S.selectionClipboard) { e.preventDefault(); pasteSelection(); }
            if (e.key === 'Delete' && S.selection) { e.preventDefault(); deleteSelection(); }
            if (e.key === 'Escape' && S.selection) { e.preventDefault(); clearSelection(); }
            // 方向键移动选区
            if (S.selection && !e.ctrlKey && !e.metaKey) {
                if (e.key === 'ArrowUp') { e.preventDefault(); moveSelectionBy(-1, 0); pushHistory(); }
                if (e.key === 'ArrowDown') { e.preventDefault(); moveSelectionBy(1, 0); pushHistory(); }
                if (e.key === 'ArrowLeft') { e.preventDefault(); moveSelectionBy(0, -1); pushHistory(); }
                if (e.key === 'ArrowRight') { e.preventDefault(); moveSelectionBy(0, 1); pushHistory(); }
            }
            if (e.key === '[') {
                S.brushSize = Math.max(1, S.brushSize - 1);
                document.querySelectorAll('.brush-sz').forEach(function (b) { b.classList.toggle('active', parseInt(b.dataset.size) === S.brushSize); });
                $('brushSizeVal').textContent = S.brushSize + 'x' + S.brushSize;
            }
            if (e.key === ']') {
                S.brushSize = Math.min(5, S.brushSize + 1);
                document.querySelectorAll('.brush-sz').forEach(function (b) { b.classList.toggle('active', parseInt(b.dataset.size) === S.brushSize); });
                $('brushSizeVal').textContent = S.brushSize + 'x' + S.brushSize;
            }

            // 数字键 1-9 快速选前9个颜色
            if (e.key >= '1' && e.key <= '9') {
                const idx = parseInt(e.key) - 1;
                if (idx < PALETTE.length) selectColor(idx);
            }
        });

        // Transform
        $('flipH').addEventListener('click', () => {
            for (let r = 0; r < S.gridH; r++) S.grid[r].reverse();
            pushHistory(); render();
        });
        $('flipV').addEventListener('click', () => {
            S.grid.reverse();
            pushHistory(); render();
        });
        $('rotate90').addEventListener('click', () => {
            const nw = S.gridH, nh = S.gridW;
            const ng = [];
            for (let r = 0; r < nh; r++) {
                ng[r] = [];
                for (let c = 0; c < nw; c++) ng[r][c] = S.grid[nw - 1 - c][r];
            }
            S.grid = ng; S.gridW = nw; S.gridH = nh;
            $('canvasWidth').value = nw; $('canvasHeight').value = nh;
            pushHistory(); setupCanvas(); render();
        });

        // Image
        $('uploadBtn').addEventListener('click', () => $('imageInput').click());
        $('imageInput').addEventListener('change', handleImage);
        $('opacitySlider').addEventListener('input', e => {
            S.refOpacity = e.target.value / 100;
            $('opacityVal').textContent = e.target.value + '%';
            renderBg();
        });
        $('cellOpacitySlider').addEventListener('input', e => {
            S.cellOpacity = e.target.value / 100;
            $('cellOpacityVal').textContent = e.target.value + '%';
            renderMain();
        });
        $('toggleBgFilter').addEventListener('change', function (e) {
            $('bgFilterControls').style.display = e.target.checked ? 'block' : 'none';
        });
        $('bgToleranceSlider').addEventListener('input', function (e) {
            $('bgToleranceVal').textContent = e.target.value;
        });
        $('convertBtn').addEventListener('click', function () {
            if (!S.refImage) { alert('请先上传参考底图'); return; }
            // 打开预览弹窗
            $('previewMaxColors').value = $('maxColors').value || 24;
            $('previewFilterBg').checked = $('toggleBgFilter') && $('toggleBgFilter').checked;
            $('previewBgTolerance').value = $('bgToleranceSlider') ? $('bgToleranceSlider').value : 30;
            $('convertPreviewModal').classList.add('active');
            // 自动生成一次预览
            setTimeout(function () {
                var maxC = Math.min(Math.max(parseInt($('previewMaxColors').value) || 24, 2), 64);
                var dither = $('previewDither').value;
                var filterBg = $('previewFilterBg').checked;
                var bgTol = parseInt($('previewBgTolerance').value) || 30;
                $('convertPreviewLoading').classList.add('active');
                setTimeout(function () {
                    _convertPreviewData = generateConvertPreview(maxC, dither, filterBg, bgTol);
                    if (_convertPreviewData) {
                        renderPreviewToCanvas(_convertPreviewData);
                    } else {
                        $('convertPreviewInfo').textContent = '生成预览失败，请检查是否已上传底图';
                    }
                    $('convertPreviewLoading').classList.remove('active');
                }, 100);
            }, 100);
        });
        $('recognizeBtn').addEventListener('click', recognizeBlockImage);
        // 网格对齐
        $('gridAlignBtn').addEventListener('click', function () {
            openGridAlignModal();
        });
        $('removeImage').addEventListener('click', () => {
            S.refImage = null;
            S.gridAlignImgOffX = 0;
            S.gridAlignImgOffY = 0;
            S.gridAlignGridOffX = 0;
            S.gridAlignGridOffY = 0;
            S.gridAlignImgScale = 1;
            $('imageControls').style.display = 'none';
            $('gridAlignBtn').style.display = 'none';
            $('imageInput').value = '';
            renderBg();
        });

        // Import sheet image
        $('importSheetBtn').addEventListener('click', function () {
            $('importSheetInput').click();
        });
        $('importSheetInput').addEventListener('change', function (e) {
            var file = e.target.files[0];
            if (!file) return;
            var img = new Image();
            img.onload = function () {
                try {
                    var data = decodeDataFromImage(img);
                    if (data) {
                        if (!confirm('检测到图纸数据！\n尺寸: ' + data.w + '×' + data.h + '\n\n确定要还原吗？（将覆盖当前画布）')) return;
                        var success = restoreFromEmbeddedData(data);
                        if (success) {
                            alert('图纸数据还原成功！');
                        } else {
                            alert('数据还原失败，文件可能已损坏');
                        }
                    } else {
                        alert('未检测到嵌入数据。\n\n可能原因：\n1. 这不是 Cat Peas 导出的图纸\n2. 图片被压缩或转换过（如微信传输、截图等会破坏像素数据）\n3. 请使用原始导出的 PNG 文件');
                    }
                } catch (err) {
                    alert('检测失败：' + err.message);
                }
            };
            img.src = URL.createObjectURL(file);
            e.target.value = '';
        });

        // Export
        $('exportPNG').addEventListener('click', () => doExport(false));
        $('exportBeadPNG').addEventListener('click', () => doExport(true));
        $('exportSplitPNG').addEventListener('click', exportSplitBoards);

        // Mobile panels
        if ($('mobPanelLeft')) $('mobPanelLeft').addEventListener('click', function () {
            var controlDrawer = $('mobileControlDrawer');
            if (controlDrawer && window.innerWidth <= 960) {
                // 移动端：切换功能控制抽屉
                var paletteDrawer = $('mobilePaletteDrawer');
                var isExpanding = !controlDrawer.classList.contains('expanded');
                if (isExpanding && paletteDrawer) {
                    paletteDrawer.classList.remove('expanded');
                }
                controlDrawer.classList.toggle('expanded');
            } else {
                togglePanel('left');
            }
        });
        if ($('mobPanelRight')) $('mobPanelRight').addEventListener('click', () => togglePanel('right'));
        $('overlay').addEventListener('click', closePanels);
        document.querySelectorAll('.panel-close').forEach(b => b.addEventListener('click', closePanels));
        $('mobileMenuBtn').addEventListener('click', () => togglePanel('left'));

        // Deselect color
        $('deselectColor').addEventListener('click', deselectCurrentColor);

        // Custom colors
        $('addCustomColor').addEventListener('click', addCustomColor);
        $('customColorId').addEventListener('keydown', e => { if (e.key === 'Enter') addCustomColor(); });

        // Custom groups
        $('addCustomGroup').addEventListener('click', function () {
            const name = $('customGroupName').value.trim();
            if (!name) { alert('请输入分组名称'); return; }
            const id = 'g_' + Date.now().toString(36);
            CUSTOM_GROUPS.push({ name: name, id: id });
            saveCustomColors();
            buildCustomColorList();
            $('customGroupName').value = '';
            // 自动选中新分组
            if ($('customGroupSelect')) $('customGroupSelect').value = id;
        });

        // Toggle default palette
        $('toggleDefaultPalette').addEventListener('change', function (e) {
            SHOW_DEFAULT_PALETTE = e.target.checked;
            // 切换时需要重新映射画布上的颜色索引
            if (!SHOW_DEFAULT_PALETTE && CUSTOM_COLORS.length === 0) {
                alert('请先添加自定义颜色，否则画布将没有可用颜色');
                e.target.checked = true;
                SHOW_DEFAULT_PALETTE = true;
                return;
            }
            rebuildPalette();
            saveCustomColors();
            buildPalette();
            if (S.currentColorIdx >= PALETTE.length) selectColor(0);
            render();
        });

        // Export/Import palette
        $('exportPaletteBtn').addEventListener('click', function () {
            const data = {
                colors: CUSTOM_COLORS,
                groups: CUSTOM_GROUPS
            };
            const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
            const link = document.createElement('a');
            link.download = 'CatPeas_自定义色板_' + new Date().toISOString().slice(0, 10) + '.json';
            link.href = URL.createObjectURL(blob);
            link.click();
        });

        $('importPaletteBtn').addEventListener('click', function () {
            $('paletteFileInput').click();
        });

        $('paletteFileInput').addEventListener('change', function (e) {
            const file = e.target.files[0];
            if (!file) return;
            const reader = new FileReader();
            reader.onload = function (ev) {
                try {
                    const data = JSON.parse(ev.target.result);
                    if (data.colors && Array.isArray(data.colors)) {
                        const overwrite = confirm('导入将追加到现有自定义颜色中。\n如需替换，请先手动清空。\n确认导入？');
                        if (!overwrite) return;
                        data.colors.forEach(function (c) {
                            if (c.id && c.hex && !CUSTOM_COLORS.some(function (cc) { return cc.id === c.id; })) {
                                CUSTOM_COLORS.push(c);
                            }
                        });
                        if (data.groups && Array.isArray(data.groups)) {
                            data.groups.forEach(function (g) {
                                if (!CUSTOM_GROUPS.some(function (cg) { return cg.id === g.id; })) {
                                    CUSTOM_GROUPS.push(g);
                                }
                            });
                        }
                        rebuildPalette();
                        saveCustomColors();
                        buildPalette();
                        render();
                        alert('导入成功！共导入 ' + data.colors.length + ' 个颜色');
                    } else {
                        alert('文件格式不正确');
                    }
                } catch (err) {
                    alert('导入失败：' + err.message);
                }
            };
            reader.readAsText(file);
            e.target.value = '';
        });

        // Resize
        window.addEventListener('resize', () => { fitToView(); render(); });

        // ===== Project Library 项目库事件 =====
        // 打开项目库页面
        $('projectLibBtn').addEventListener('click', function () {
            openProjectPage();
        });

        // 返回编辑器
        $('projectBackBtn').addEventListener('click', function () {
            closeProjectPage();
        });

        // 保存到项目库
        $('saveToProject').addEventListener('click', function () {
            saveProject();
        });

        // 新建分类
        $('addProjectCategory').addEventListener('click', function () {
            cdPrompt('', { title: '新建分类', placeholder: '请输入分类名称' }).then(function (name) {
                if (!name || !name.trim()) return;
                var cat = { id: 'pcat_' + Date.now().toString(36), name: name.trim() };
                dbPut(STORE_CATEGORIES, cat).then(function () {
                    _projectCategories.push(cat);
                    updateProjectCategoryUI();
                    $('projectCategory').value = cat.id;
                });
            });
        });

        // 管理分类（重命名/删除）
        $('manageCategoryBtn').addEventListener('click', function () {
            manageCategoriesDialog();
        });

        // 项目库页面筛选/搜索/排序
        $('projectFilterCategory2').addEventListener('change', function () {
            triggerProjectRefresh();
        });

        $('projectSearchInput').addEventListener('input', function () {
            triggerProjectRefresh();
        });

        $('projectSortSelect').addEventListener('change', function () {
            triggerProjectRefresh();
        });

        // 视图切换
        $('projectViewGrid').addEventListener('click', function () {
            $('projectGrid').classList.remove('list-view');
            $('projectViewGrid').classList.add('active');
            $('projectViewList').classList.remove('active');
        });

        $('projectViewList').addEventListener('click', function () {
            $('projectGrid').classList.add('list-view');
            $('projectViewList').classList.add('active');
            $('projectViewGrid').classList.remove('active');
        });

        // 删除选中
        $('projectDeleteSelected2').addEventListener('click', function () {
            deleteProjects(Array.from(_selectedProjectIds));
        });

        // 导出全部
        $('projectExportAll2').addEventListener('click', function () {
            exportAllProjects();
        });

        // 导出当前项目为 JSON
        $('exportProjectJSON').addEventListener('click', function () {
            exportProjectJSON();
        });

        // 导入项目 JSON
        $('importProjectJSON').addEventListener('click', function () {
            $('projectFileInput').click();
        });
        $('projectFileInput').addEventListener('change', function (e) {
            var file = e.target.files[0];
            if (!file) return;
            importProjectJSON(file);
            e.target.value = '';
        });

        // 初始化项目分类
        loadProjectCategories();

        // 辅助拼豆模式
        $('assistModeBtn').addEventListener('click', function () {
            toggleAssistMode();
        });

        $('assistPanelClose').addEventListener('click', function () {
            if (S.assistMode) toggleAssistMode();
        });

        $('assistTimerStart').addEventListener('click', function () {
            startAssistTimer();
        });

        $('assistTimerPause').addEventListener('click', function () {
            pauseAssistTimer();
        });

        $('assistTimerReset').addEventListener('click', function () {
            resetAssistTimer();
        });

        $('assistDirV').addEventListener('click', function () {
            S.assistDirection = 'vertical';
            $('assistDirV').classList.add('active');
            $('assistDirH').classList.remove('active');
            if (S.assistHighlightIdx >= 0) renderMain();
        });

        $('assistDirH').addEventListener('click', function () {
            S.assistDirection = 'horizontal';
            $('assistDirH').classList.add('active');
            $('assistDirV').classList.remove('active');
            if (S.assistHighlightIdx >= 0) renderMain();
        });

        $('assistClearHighlight').addEventListener('click', function () {
            clearAssistHighlight();
        });

    
        // 辅助拼豆 - 缩小/展开小窗
        $('assistPanelMinimize').addEventListener('click', function () {
            minimizeAssistPanel();
        });

        $('assistMiniExpand').addEventListener('click', function () {
            expandAssistPanel();
        });

        // 初始化小窗拖拽
        initMiniDrag();

        // 悬浮小窗切换颜色
        $('assistMiniPrev').addEventListener('click', function (e) {
            e.stopPropagation();
            switchAssistColor(-1);
        });
        $('assistMiniNext').addEventListener('click', function (e) {
            e.stopPropagation();
            switchAssistColor(1);
        });

        // Theme toggle
        $('themeToggleBtn').addEventListener('click', function () {
            const themes = ['default', 'ocean', 'forest', 'sunset', 'sakura', 'dark'];
            const current = document.documentElement.getAttribute('data-theme') || 'default';
            const idx = themes.indexOf(current);
            const next = themes[(idx + 1) % themes.length];
            applyTheme(next);
        });

        // Theme custom modal
        $('themeCustomBtn').addEventListener('click', function () {
            $('themeModal').classList.add('active');
        });
        $('themeModalClose').addEventListener('click', function () {
            $('themeModal').classList.remove('active');
        });
        $('themeModal').addEventListener('click', function (e) {
            if (e.target === this) this.classList.remove('active');
        });

        // Theme presets
        document.querySelectorAll('.theme-preset-btn').forEach(function (btn) {
            btn.addEventListener('click', function () {
                document.querySelectorAll('.theme-preset-btn').forEach(b => b.classList.remove('active'));
                this.classList.add('active');
                applyTheme(this.dataset.theme);
            });
        });

        // Custom theme apply
        $('applyCustomTheme').addEventListener('click', function () {
            const primary = $('themeColorPrimary').value;
            const secondary = $('themeColorSecondary').value;
            const bg = $('themeColorBg').value;
            const boardCell1 = $('themeColorBoardCell1').value;
            const boardCell2 = $('themeColorBoardCell2').value;
            const rulerBg = $('themeColorRulerBg').value;
            const rulerText = $('themeColorRulerText').value;
            applyCustomThemeColors(primary, secondary, bg, boardCell1, boardCell2, rulerBg, rulerText);
        });

        $('resetTheme').addEventListener('click', function () {
            applyTheme('default');
            document.querySelectorAll('.theme-preset-btn').forEach(b => b.classList.toggle('active', b.dataset.theme === 'default'));
        });

        // 帮助弹窗
        $('helpBtn').addEventListener('click', function () {
            openHelpModal();
        });

        $('helpModalClose').addEventListener('click', function () {
            closeHelpModal();
        });

        $('helpModalConfirm').addEventListener('click', function () {
            closeHelpModal();
        });

        $('helpModal').addEventListener('click', function (e) {
            if (e.target === this) closeHelpModal();
        });

        $('helpShowDisclaimer').addEventListener('click', function () {
            openDisclaimerFromHelp();
        });

        // 帮助弹窗标签切换
        document.querySelectorAll('.help-tab').forEach(function (tab) {
            tab.addEventListener('click', function () {
                var targetTab = this.dataset.tab;
                document.querySelectorAll('.help-tab').forEach(function (t) {
                    t.classList.toggle('active', t.dataset.tab === targetTab);
                });
                document.querySelectorAll('.help-content').forEach(function (c) {
                    c.classList.toggle('active', c.dataset.content === targetTab);
                });
            });
        });

        // 自定义 CSS
        $('applyCustomCSS').addEventListener('click', function () {
            var cssText = $('customCSSInput').value;
            applyCustomCSSToPage(cssText);
            saveCustomCSS(cssText);
            alert('自定义 CSS 已应用！');
        });

        $('clearCustomCSS').addEventListener('click', function () {
            $('customCSSInput').value = '';
            applyCustomCSSToPage('');
            saveCustomCSS('');
            alert('自定义 CSS 已清除！');
        });

        // CSS 帮助弹窗
        $('cssHelpBtn').addEventListener('click', function () {
            $('cssHelpModal').classList.add('active');
        });

        $('cssHelpModalClose').addEventListener('click', function () {
            $('cssHelpModal').classList.remove('active');
        });

        $('cssHelpModal').addEventListener('click', function (e) {
            if (e.target === this) this.classList.remove('active');
        });

        // CSS 示例折叠展开
        document.querySelectorAll('.css-example-toggle').forEach(function (toggle) {
            toggle.addEventListener('click', function () {
                var content = this.nextElementSibling;
                var isCollapsed = this.classList.toggle('collapsed');
                if (content) content.classList.toggle('collapsed', isCollapsed);
            });
        });

        // 复制按钮
        document.querySelectorAll('.css-copy-btn').forEach(function (btn) {
            btn.addEventListener('click', function () {
                var codeEl = this.closest('.css-example-code-wrap').querySelector('.css-example-code');
                var text = codeEl.textContent;
                var self = this;
                if (navigator.clipboard && navigator.clipboard.writeText) {
                    navigator.clipboard.writeText(text).then(function () {
                        self.classList.add('copied');
                        self.innerHTML = '<svg viewBox="0 0 16 16" width="14" height="14"><path d="M3 8.5l3 3 7-7" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>';
                        setTimeout(function () {
                            self.classList.remove('copied');
                            self.innerHTML = '<svg viewBox="0 0 16 16" width="14" height="14"><rect x="5" y="5" width="9" height="9" rx="1.5" stroke="currentColor" stroke-width="1.3" fill="none"/><path d="M11 5V3.5A1.5 1.5 0 009.5 2h-6A1.5 1.5 0 002 3.5v6A1.5 1.5 0 003.5 11H5" stroke="currentColor" stroke-width="1.3" fill="none"/></svg>';
                        }, 1500);
                    });
                } else {
                    var textarea = document.createElement('textarea');
                    textarea.value = text;
                    textarea.style.position = 'fixed';
                    textarea.style.opacity = '0';
                    document.body.appendChild(textarea);
                    textarea.select();
                    document.execCommand('copy');
                    document.body.removeChild(textarea);
                    self.classList.add('copied');
                    self.innerHTML = '<svg viewBox="0 0 16 16" width="14" height="14"><path d="M3 8.5l3 3 7-7" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>';
                    setTimeout(function () {
                        self.classList.remove('copied');
                        self.innerHTML = '<svg viewBox="0 0 16 16" width="14" height="14"><rect x="5" y="5" width="9" height="9" rx="1.5" stroke="currentColor" stroke-width="1.3" fill="none"/><path d="M11 5V3.5A1.5 1.5 0 009.5 2h-6A1.5 1.5 0 002 3.5v6A1.5 1.5 0 003.5 11H5" stroke="currentColor" stroke-width="1.3" fill="none"/></svg>';
                    }, 1500);
                }
            });
        });

        // 选区工具栏事件
        $('selCopy').addEventListener('click', function () { copySelection(); });
        $('selPaste').addEventListener('click', function () { pasteSelection(); });
        $('selDelete').addEventListener('click', function () { deleteSelection(); });
        $('selFlipH').addEventListener('click', function () { flipSelectionH(); });
        $('selFlipV').addEventListener('click', function () { flipSelectionV(); });
        $('selConfirm').addEventListener('click', function () {
            if (S.selection) {
                pushHistory('移动选区');
                clearSelection();
            }
        });
        $('selCancel').addEventListener('click', function () { clearSelection(); });
        $('selMoveMode').addEventListener('click', function () {
            if (S.selection) alert('在选区上拖拽即可移动选区内容，也可用方向键微调位置。');
        });

        // 画笔大小
        document.querySelectorAll('.brush-sz').forEach(function (btn) {
            btn.addEventListener('click', function () {
                S.brushSize = parseInt(btn.dataset.size) || 1;
                document.querySelectorAll('.brush-sz').forEach(function (b) {
                    b.classList.toggle('active', parseInt(b.dataset.size) === S.brushSize);
                });
                $('brushSizeVal').textContent = S.brushSize + 'x' + S.brushSize;
            });
        });

        // 中心参考线
        $('toggleCenterLine').addEventListener('change', function (e) {
            S.showCenterLine = e.target.checked;
            renderMain();
        });

        // 对称绘制模式
        document.querySelectorAll('.sym-btn').forEach(function (btn) {
            btn.addEventListener('click', function () {
                S.symmetryMode = btn.dataset.sym;
                document.querySelectorAll('.sym-btn').forEach(function (b) {
                    b.classList.toggle('active', b.dataset.sym === S.symmetryMode);
                });
            });
        });

        // 整体偏移
        function shiftGrid(dr, dc) {
            var newGrid = [];
            for (var r = 0; r < S.gridH; r++) {
                newGrid[r] = new Array(S.gridW).fill(null);
                for (var c = 0; c < S.gridW; c++) {
                    var sr = r - dr;
                    var sc = c - dc;
                    if (sr >= 0 && sr < S.gridH && sc >= 0 && sc < S.gridW) {
                        newGrid[r][c] = S.grid[sr][sc];
                    }
                }
            }
            S.grid = newGrid;
            pushHistory('整体偏移');
            render();
        }
        // 裁剪画板
        $('cropCanvasBtn').addEventListener('click', function () {
            cropCanvasToContent();
        });

        // 扩展画板
        $('expandCanvasBtn').addEventListener('click', function () {
            expandCanvasDialog();
        });


        $('shiftUp').addEventListener('click', function () { shiftGrid(-1, 0); });
        $('shiftDown').addEventListener('click', function () { shiftGrid(1, 0); });
        $('shiftLeft').addEventListener('click', function () { shiftGrid(0, -1); });
        $('shiftRight').addEventListener('click', function () { shiftGrid(0, 1); });
        // 转换预览弹窗事件
        $('convertPreviewClose').addEventListener('click', function () {
            $('convertPreviewModal').classList.remove('active');
        });
        $('convertPreviewCancel').addEventListener('click', function () {
            $('convertPreviewModal').classList.remove('active');
        });
        $('convertPreviewModal').addEventListener('click', function (e) {
            if (e.target === this) this.classList.remove('active');
        });

        $('previewRefreshBtn').addEventListener('click', function () {
            var maxC = Math.min(Math.max(parseInt($('previewMaxColors').value) || 24, 2), 64);
            var dither = $('previewDither').value;
            var filterBg = $('previewFilterBg').checked;
            var bgTol = parseInt($('previewBgTolerance').value) || 30;

            $('convertPreviewLoading').classList.add('active');

            setTimeout(function () {
                _convertPreviewData = generateConvertPreview(maxC, dither, filterBg, bgTol);
                if (_convertPreviewData) {
                    renderPreviewToCanvas(_convertPreviewData);
                } else {
                    $('convertPreviewInfo').textContent = '生成预览失败，请检查是否已上传底图';
                }
                $('convertPreviewLoading').classList.remove('active');
            }, 50);
        });

        $('convertPreviewApply').addEventListener('click', function () {
            if (!_convertPreviewData) {
                alert('请先点击"刷新预览"生成预览');
                return;
            }
            // 应用到画布
            for (var r = 0; r < S.gridH; r++) {
                for (var c = 0; c < S.gridW; c++) {
                    var val = _convertPreviewData[r][c];
                    S.grid[r][c] = val;
                    if (S.layers[S.activeLayer].grid && S.layers[S.activeLayer].grid[r])
                        S.layers[S.activeLayer].grid[r][c] = val;
                }
            }
            pushHistory('图片转换');
            render();
            $('convertPreviewModal').classList.remove('active');
            _convertPreviewData = null;
        });

        // 图层管理 — 按钮事件
        $('addLayerBtn').addEventListener('click', function () {
            addLayer();
        });

        $('mergeLayersBtn').addEventListener('click', function () {
            if (S.layers.length <= 1) {
                cdAlert('只有一个图层，无需合并', { type: 'warn', title: '无需合并' });
                return;
            }
            cdConfirm('将所有图层合并为一个图层，其他图层会被删除。确定合并？', { title: '合并全部图层', type: 'warn' }).then(function (ok) {
                if (!ok) return;
                mergeLayersToGrid();
            });
        });

        $('mergeDownBtn').addEventListener('click', function () {
            mergeDown();
        });

        $('deleteLayerBtn').addEventListener('click', function () {
            deleteCurrentLayer();
        });

        $('exportCurrentLayerBtn').addEventListener('click', function () {
            exportCurrentLayer();
        });

        // Load saved theme
        loadSavedTheme();

    }

    function onCanvasHover(e) {
        var cell = cellFromMouse(e);

        // 更新坐标状态栏
        if (cell) {
            $('coordPos').textContent = '行: ' + cell.row + '  列: ' + cell.col;
            var ci = S.grid[cell.row][cell.col];
            if (ci !== null && PALETTE[ci]) {
                $('coordColor').innerHTML = '<span class="coord-color-swatch" style="background:' + PALETTE[ci].hex + '"></span>' + PALETTE[ci].id + ' ' + PALETTE[ci].name;
            } else {
                $('coordColor').textContent = '空';
            }
        } else {
            $('coordPos').textContent = '行: -- 列: --';
            $('coordColor').textContent = '';
        }

        // 换色预览
        if (S.tool !== 'fill' || S.isDrawing) return;
        if (!cell) {
            if (S.fillPreviewIdx >= 0) { S.fillPreviewIdx = -1; renderMain(); }
            return;
        }
        var ci2 = S.grid[cell.row][cell.col];
        if (ci2 !== S.fillPreviewIdx) {
            S.fillPreviewIdx = (ci2 !== null) ? ci2 : -1;
            renderMain();
        }
    }

    // Mouse drawing
    function onMouseDown(e) {
        if (e.button !== 0) return;
        if (S.assistMode) { showAssistDrawBlock(); return; }
        e.preventDefault();
        if (S.tool === 'hand') return;
        var cell = cellFromMouse(e);
        if (!cell) return;

        // 框选工具
        if (S.tool === 'select') {
            if (S.selection && isInsideSelection(cell.row, cell.col)) {
                // 在选区内点击：开始拖拽移动
                S.selectionDragging = true;
                S.selectionDragStart = { row: cell.row, col: cell.col };
            } else {
                // 在选区外点击：开始新选区
                startSelection(cell.row, cell.col);
            }
            return;
        }

        // 切换到其他工具时清除选区
        if (S.selection && S.tool !== 'select') {
            clearSelection();
        }

        if (S.tool === 'picker') { pickColorAt(cell.row, cell.col); return; }
        if (S.tool === 'bgpicker') { pickBgColorAt(cell.row, cell.col); return; }
        if (S.tool === 'fill') { fillReplace(cell.row, cell.col); return; }
        if (S.tool === 'bucket') { floodFill(cell.row, cell.col); return; }

        S.isDrawing = true;
        S.lastDrawCell = cell.row * 10000 + cell.col;
        paintCell(cell.row, cell.col);
    }

    function onMouseMove(e) {
        // 框选拖拽
        if (S.tool === 'select') {
            if (S.selectionDrawing) {
                var cell = cellFromMouse(e);
                if (cell) updateSelectionRect(cell.row, cell.col);
                return;
            }
            if (S.selectionDragging && S.selectionDragStart) {
                var cell2 = cellFromMouse(e);
                if (cell2) {
                    var dr = cell2.row - S.selectionDragStart.row;
                    var dc = cell2.col - S.selectionDragStart.col;
                    if (dr !== 0 || dc !== 0) {
                        moveSelectionBy(dr, dc);
                        S.selectionDragStart = { row: cell2.row, col: cell2.col };
                    }
                }
                return;
            }
            return;
        }

        if (!S.isDrawing) return;
        if (_drawRAFPending) return;
        _drawRAFPending = true;
        var evt = { clientX: e.clientX, clientY: e.clientY };
        requestAnimationFrame(function () {
            _drawRAFPending = false;
            var cell = cellFromMouse(evt);
            if (!cell) return;
            var key = cell.row * 10000 + cell.col;
            var lastKey = S.lastDrawCell;
            if (key !== lastKey) {
                if (lastKey !== null) {
                    var r0 = Math.floor(lastKey / 10000);
                    var c0 = lastKey % 10000;
                    interpolateLine(r0, c0, cell.row, cell.col);
                }
                S.lastDrawCell = key;
                paintCell(cell.row, cell.col);
            }
        });
    }


    function interpolateLine(r0, c0, r1, c1) {
        const dr = Math.abs(r1 - r0);
        const dc = Math.abs(c1 - c0);
        const sr = r0 < r1 ? 1 : -1;
        const sc = c0 < c1 ? 1 : -1;
        let err = dr - dc;
        let r = r0, c = c0;
        let maxSteps = Math.max(dr, dc) * 2 + 4;

        while (maxSteps-- > 0) {
            if (r === r1 && c === c1) break;
            paintCell(r, c);
            const e2 = 2 * err;
            if (e2 > -dc) { err -= dc; r += sr; }
            if (e2 < dr) { err += dr; c += sc; }
        }
    }

    function onMouseUp() {
        if (S.tool === 'select') {
            if (S.selectionDrawing) {
                endSelection();
            }
            if (S.selectionDragging) {
                S.selectionDragging = false;
                S.selectionDragStart = null;
                pushHistory();
            }
            return;
        }
        if (S.isDrawing) {
            S.isDrawing = false;
            setTimeout(function () {
                pushHistory();
                updateUsage();
                updateLegend();
            }, 50);
        }
    }

    // Touch drawing
    function onTouchStart(e) {
        if (e.touches.length !== 1) return;
        if (_pinchActive) return;
        if (_pinchJustEnded) return;
        if (S.assistMode) { showAssistDrawBlock(); return; }
        e.preventDefault();

        if (S.tool === 'hand') {
            S.isPanning = true;
            var touch = e.touches[0];
            S.panStart = { x: touch.clientX - S.panX, y: touch.clientY - S.panY };
            return;
        }

        var cell = cellFromTouch(e);
        if (!cell) return;

        // 框选工具
        if (S.tool === 'select') {
            if (S.selection && isInsideSelection(cell.row, cell.col)) {
                S.selectionDragging = true;
                S.selectionDragStart = { row: cell.row, col: cell.col };
            } else {
                startSelection(cell.row, cell.col);
            }
            return;
        }

        if (S.selection && S.tool !== 'select') {
            clearSelection();
        }

        if (S.tool === 'picker') { pickColorAt(cell.row, cell.col); return; }
        if (S.tool === 'bgpicker') { pickBgColorAt(cell.row, cell.col); return; }
        if (S.tool === 'fill') { fillReplace(cell.row, cell.col); return; }
        if (S.tool === 'bucket') { floodFill(cell.row, cell.col); return; }

        S.isDrawing = true;
        S.lastDrawCell = cell.row * 10000 + cell.col;
        paintCell(cell.row, cell.col);
    }

    function onTouchMove(e) {
        if (e.touches.length !== 1) return;
        if (S.isPanning && S.tool === 'hand') {
            e.preventDefault();
            var touch = e.touches[0];
            S.panX = touch.clientX - S.panStart.x;
            S.panY = touch.clientY - S.panStart.y;
            applyTransform();
            return;
        }

        // 框选拖拽
        if (S.tool === 'select') {
            e.preventDefault();
            var cell = cellFromTouch(e);
            if (!cell) return;
            if (S.selectionDrawing) {
                updateSelectionRect(cell.row, cell.col);
            } else if (S.selectionDragging && S.selectionDragStart) {
                var dr = cell.row - S.selectionDragStart.row;
                var dc = cell.col - S.selectionDragStart.col;
                if (dr !== 0 || dc !== 0) {
                    moveSelectionBy(dr, dc);
                    S.selectionDragStart = { row: cell.row, col: cell.col };
                }
            }
            return;
        }

        if (!S.isDrawing) return;
        e.preventDefault();
        if (_drawRAFPending) return;
        _drawRAFPending = true;
        var _touchX = e.touches[0].clientX;
        var _touchY = e.touches[0].clientY;
        requestAnimationFrame(function () {
            _drawRAFPending = false;
            var cell2 = cellFromMouse({ clientX: _touchX, clientY: _touchY });
            if (!cell2) return;
            var key = cell2.row * 10000 + cell2.col;
            var lastKey = S.lastDrawCell;
            if (key !== lastKey) {
                if (lastKey !== null) {
                    var r0 = Math.floor(lastKey / 10000);
                    var c0 = lastKey % 10000;
                    interpolateLine(r0, c0, cell2.row, cell2.col);
                }
                S.lastDrawCell = key;
                paintCell(cell2.row, cell2.col);
            }
        });
    }


    function onTouchEnd() {
        if (S.isPanning && S.tool === 'hand') {
            S.isPanning = false;
            return;
        }
        if (S.tool === 'select') {
            if (S.selectionDrawing) endSelection();
            if (S.selectionDragging) {
                S.selectionDragging = false;
                S.selectionDragStart = null;
                pushHistory();
            }
            return;
        }
        if (S.isDrawing) {
            S.isDrawing = false;
            setTimeout(function () {
                pushHistory();
                updateUsage();
                updateLegend();
            }, 50);
        }
    }

    // ===========================
    //  裁剪画板（去除空白边缘）
    // ===========================
    async function cropCanvasToContent() {
        // 找到内容的边界
        var minR = S.gridH, maxR = -1, minC = S.gridW, maxC = -1;
        for (var r = 0; r < S.gridH; r++) {
            for (var c = 0; c < S.gridW; c++) {
                if (S.grid[r][c] !== null) {
                    if (r < minR) minR = r;
                    if (r > maxR) maxR = r;
                    if (c < minC) minC = c;
                    if (c > maxC) maxC = c;
                }
            }
        }

        if (maxR < 0) {
            cdAlert('画布为空，无法裁剪', { type: 'warn', title: '无法裁剪' });
            return;
        }

        var contentW = maxC - minC + 1;
        var contentH = maxR - minR + 1;

        if (contentW === S.gridW && contentH === S.gridH) {
            cdAlert('画布没有空白边缘可裁剪', { type: 'warn', title: '无需裁剪' });
            return;
        }

        // 提供两种模式
        var mode = await cdPrompt(
            '当前内容区域：' + contentW + '×' + contentH +
            '（行' + minR + '-' + maxR + '，列' + minC + '-' + maxC + '）\n\n' +
            '请选择裁剪模式：\n' +
            '1 = 自动裁剪到内容边界（' + contentW + '×' + contentH + '）\n' +
            '2 = 自定义裁剪范围\n' +
            '3 = 带边距裁剪（保留指定格数的边距）',
            { title: '裁剪画板', defaultValue: '1', placeholder: '输入 1、2 或 3' }
        );

        if (mode === null) return;
        mode = mode.trim();

        var newR1, newC1, newW, newH;

        if (mode === '1') {
            newR1 = minR;
            newC1 = minC;
            newW = contentW;
            newH = contentH;
        } else if (mode === '2') {
            var rangeStr = await cdPrompt(
                '请输入裁剪范围（格式：起始列,起始行,宽度,高度）\n' +
                '例如：' + minC + ',' + minR + ',' + contentW + ',' + contentH,
                { title: '自定义裁剪', defaultValue: minC + ',' + minR + ',' + contentW + ',' + contentH }
            );
            if (!rangeStr) return;
            var parts = rangeStr.split(',').map(function (s) { return parseInt(s.trim()); });
            if (parts.length !== 4 || parts.some(isNaN)) {
                cdAlert('格式不正确，请输入4个数字用逗号分隔', { type: 'error' });
                return;
            }
            newC1 = parts[0];
            newR1 = parts[1];
            newW = parts[2];
            newH = parts[3];
        } else if (mode === '3') {
            var marginStr = await cdPrompt('请输入保留的边距格数（上下左右相同）：', { title: '带边距裁剪', defaultValue: '2' });
            if (marginStr === null) return;
            var margin = parseInt(marginStr) || 0;
            newR1 = Math.max(0, minR - margin);
            newC1 = Math.max(0, minC - margin);
            newW = Math.min(S.gridW - newC1, contentW + margin * 2);
            newH = Math.min(S.gridH - newR1, contentH + margin * 2);
        } else {
            return;
        }

        // 验证范围
        if (newW < 4 || newH < 4) {
            cdAlert('裁剪后尺寸不能小于 4×4', { type: 'error' });
            return;
        }
        if (newW > 200 || newH > 200) {
            cdAlert('尺寸不能超过 200', { type: 'error' });
            return;
        }

        var cropOk = await cdConfirm('确定将画布裁剪为 ' + newW + '×' + newH + ' 吗？此操作可以撤销。', { title: '确认裁剪' });
        if (!cropOk) return;

        // 执行裁剪
        var newGrid = [];
        for (var r2 = 0; r2 < newH; r2++) {
            newGrid[r2] = new Array(newW).fill(null);
            var srcR = newR1 + r2;
            if (srcR >= 0 && srcR < S.gridH) {
                for (var c2 = 0; c2 < newW; c2++) {
                    var srcC = newC1 + c2;
                    if (srcC >= 0 && srcC < S.gridW) {
                        newGrid[r2][c2] = S.grid[srcR][srcC];
                    }
                }
            }
        }

        S.gridW = newW;
        S.gridH = newH;
        S.grid = newGrid;

        // 裁剪所有图层
        for (var li = 0; li < S.layers.length; li++) {
            var oldLG2 = S.layers[li].grid;
            S.layers[li].grid = [];
            for (var lr = 0; lr < newH; lr++) {
                S.layers[li].grid[lr] = new Array(newW).fill(null);
                var srcR3 = newR1 + lr;
                if (oldLG2 && srcR3 >= 0 && srcR3 < oldLG2.length) {
                    for (var lc = 0; lc < newW; lc++) {
                        var srcC3 = newC1 + lc;
                        if (oldLG2[srcR3] && srcC3 >= 0 && srcC3 < oldLG2[srcR3].length) {
                            S.layers[li].grid[lr][lc] = oldLG2[srcR3][srcC3];
                        }
                    }
                }
            }
        }

        $('canvasWidth').value = S.gridW;
        $('canvasHeight').value = S.gridH;
        document.querySelectorAll('.btn-preset').forEach(function (b) {
            b.classList.toggle('active',
                parseInt(b.dataset.w) === S.gridW && parseInt(b.dataset.h) === S.gridH
            );
        });

        pushHistory('裁剪画板');
        setupCanvas();
        render();
    }

    // ===========================
    //  扩展画板
    // ===========================
    async function expandCanvasDialog() {
        var dirStr = await cdPrompt(
            '当前画布：' + S.gridW + '×' + S.gridH + '\n\n' +
            '请选择扩展方向：\n' +
            '1 = 向上扩展\n' +
            '2 = 向下扩展\n' +
            '3 = 向左扩展\n' +
            '4 = 向右扩展\n' +
            '5 = 四周均匀扩展\n' +
            '6 = 自定义（分别设置上下左右）',
            { title: '扩展画板', defaultValue: '5', placeholder: '输入 1-6' }
        );

        if (dirStr === null) return;
        dirStr = dirStr.trim();

        var addTop = 0, addBottom = 0, addLeft = 0, addRight = 0;

        if (dirStr === '1') {
            var nStr = await cdPrompt('向上扩展多少格？', { title: '向上扩展', defaultValue: '10' });
            var n = parseInt(nStr);
            if (isNaN(n) || n <= 0) return;
            addTop = n;
        } else if (dirStr === '2') {
            var nStr2 = await cdPrompt('向下扩展多少格？', { title: '向下扩展', defaultValue: '10' });
            var n2 = parseInt(nStr2);
            if (isNaN(n2) || n2 <= 0) return;
            addBottom = n2;
        } else if (dirStr === '3') {
            var nStr3 = await cdPrompt('向左扩展多少格？', { title: '向左扩展', defaultValue: '10' });
            var n3 = parseInt(nStr3);
            if (isNaN(n3) || n3 <= 0) return;
            addLeft = n3;
        } else if (dirStr === '4') {
            var nStr4 = await cdPrompt('向右扩展多少格？', { title: '向右扩展', defaultValue: '10' });
            var n4 = parseInt(nStr4);
            if (isNaN(n4) || n4 <= 0) return;
            addRight = n4;
        } else if (dirStr === '5') {
            var nStr5 = await cdPrompt('四周各扩展多少格？', { title: '四周扩展', defaultValue: '5' });
            var n5 = parseInt(nStr5);
            if (isNaN(n5) || n5 <= 0) return;
            addTop = addBottom = addLeft = addRight = n5;
        } else if (dirStr === '6') {
            var custom = await cdPrompt(
                '请输入四个方向的扩展格数（格式：上,下,左,右）\n例如：5,5,10,10',
                { title: '自定义扩展', defaultValue: '0,0,0,0' }
            );
            if (!custom) return;
            var parts2 = custom.split(',').map(function (s) { return parseInt(s.trim()); });
            if (parts2.length !== 4 || parts2.some(isNaN)) {
                cdAlert('格式不正确，请输入4个数字用逗号分隔', { type: 'error' });
                return;
            }
            addTop = Math.max(0, parts2[0]);
            addBottom = Math.max(0, parts2[1]);
            addLeft = Math.max(0, parts2[2]);
            addRight = Math.max(0, parts2[3]);
        } else {
            return;
        }

        var newW = S.gridW + addLeft + addRight;
        var newH = S.gridH + addTop + addBottom;

        if (newW > 200 || newH > 200) {
            cdAlert('扩展后尺寸 ' + newW + '×' + newH + ' 超过最大限制 200×200', { type: 'error' });
            return;
        }

        if (newW === S.gridW && newH === S.gridH) {
            cdAlert('没有需要扩展的方向', { type: 'warn' });
            return;
        }

        // 执行扩展
        var newGrid = [];
        for (var r = 0; r < newH; r++) {
            newGrid[r] = new Array(newW).fill(null);
            var srcR = r - addTop;
            if (srcR >= 0 && srcR < S.gridH) {
                for (var c = 0; c < newW; c++) {
                    var srcC = c - addLeft;
                    if (srcC >= 0 && srcC < S.gridW) {
                        newGrid[r][c] = S.grid[srcR][srcC];
                    }
                }
            }
        }

        S.gridW = newW;
        S.gridH = newH;
        S.grid = newGrid;

        // 扩展所有图层
        for (var li = 0; li < S.layers.length; li++) {
            var oldLG = S.layers[li].grid;
            S.layers[li].grid = [];
            for (var lr = 0; lr < newH; lr++) {
                S.layers[li].grid[lr] = new Array(newW).fill(null);
                var srcR2 = lr - addTop;
                if (oldLG && srcR2 >= 0 && srcR2 < oldLG.length) {
                    for (var lc = 0; lc < newW; lc++) {
                        var srcC2 = lc - addLeft;
                        if (oldLG[srcR2] && srcC2 >= 0 && srcC2 < oldLG[srcR2].length) {
                            S.layers[li].grid[lr][lc] = oldLG[srcR2][srcC2];
                        }
                    }
                }
            }
        }

        $('canvasWidth').value = S.gridW;
        $('canvasHeight').value = S.gridH;
        document.querySelectorAll('.btn-preset').forEach(function (b) {
            b.classList.toggle('active',
                parseInt(b.dataset.w) === S.gridW && parseInt(b.dataset.h) === S.gridH
            );
        });

        pushHistory('扩展画板');
        setupCanvas();
        render();

        cdAlert('画板已扩展为 ' + newW + '×' + newH +
            (addTop ? '\n上 +' + addTop : '') +
            (addBottom ? '\n下 +' + addBottom : '') +
            (addLeft ? '\n左 +' + addLeft : '') +
            (addRight ? '\n右 +' + addRight : ''), { type: 'success', title: '扩展完成' });
    }

    // ===========================
    //  Apply Size
    // ===========================
    function applySize() {
        const w = parseInt($('canvasWidth').value);
        const h = parseInt($('canvasHeight').value);
        if (!w || !h || w < 4 || w > 200 || h < 4 || h > 200) {
            alert('尺寸范围须在 4 ~ 200 之间');
            return;
        }
        // 保留已有内容
        const oldGrid = S.grid;
        const oldW = S.gridW;
        const oldH = S.gridH;
        S.gridW = w;
        S.gridH = h;
        S.grid = [];
        for (let r = 0; r < h; r++) {
            S.grid[r] = new Array(w).fill(null);
            if (r < oldH) {
                for (let c = 0; c < Math.min(w, oldW); c++) {
                    S.grid[r][c] = oldGrid[r][c];
                }
            }
        }
        // 调整所有图层的 grid 尺寸
        for (var li = 0; li < S.layers.length; li++) {
            var oldLayerGrid = S.layers[li].grid;
            S.layers[li].grid = [];
            for (var lr = 0; lr < h; lr++) {
                S.layers[li].grid[lr] = new Array(w).fill(null);
                if (oldLayerGrid && lr < oldH) {
                    for (var lc = 0; lc < Math.min(w, oldW); lc++) {
                        S.layers[li].grid[lr][lc] = oldLayerGrid[lr] ? oldLayerGrid[lr][lc] : null;
                    }
                }
            }
        }
        S.currentProjectId = null;
        S.currentProjectName = '';
        pushHistory();
        setupCanvas();
        render();
    }

    // ===========================
    //  Image
    // ===========================
    function handleImage(e) {
        const file = e.target.files[0];
        if (!file) return;
        const img = new Image();
        img.onload = function () {
            // 先尝试从图片中提取嵌入的画布数据
            try {
                var embeddedData = decodeDataFromImage(img);
                if (embeddedData) {
                    var useData = confirm(
                        '检测到这张图片是 Cat Peas 导出的图纸！\n' +
                        '尺寸: ' + embeddedData.w + '×' + embeddedData.h + '\n\n' +
                        '点击「确定」直接还原图纸数据\n' +
                        '点击「取消」将图片作为参考底图使用'
                    );
                    if (useData) {
                        var success = restoreFromEmbeddedData(embeddedData);
                        if (success) {
                            alert('图纸数据还原成功！');
                            $('imageInput').value = '';
                            return;
                        } else {
                            alert('数据还原失败，将作为参考底图使用');
                        }
                    }
                }
            } catch (detectErr) {
                console.warn('检测嵌入数据时出错:', detectErr);
            }

            // 打开裁剪弹窗
            openCropModal(img);
        };
        img.src = URL.createObjectURL(file);
    }

    // ===========================
    //  Floyd-Steinberg 抖动算法
    // ===========================
    function floydSteinbergDither(pixelGrid, gridW, gridH, allowedLabs) {
        // pixelGrid[row][col] = {r, g, b} 原始像素颜色
        // 返回 resultGrid[row][col] = paletteIndex
        var errors = [];
        for (var r = 0; r < gridH; r++) {
            errors[r] = [];
            for (var c = 0; c < gridW; c++) {
                errors[r][c] = { r: 0, g: 0, b: 0 };
            }
        }

        var result = [];
        for (var r2 = 0; r2 < gridH; r2++) {
            result[r2] = [];
            for (var c2 = 0; c2 < gridW; c2++) {
                var px = pixelGrid[r2][c2];
                if (!px) { result[r2][c2] = null; continue; }

                // 加上累积误差
                var cr = Math.max(0, Math.min(255, Math.round(px.r + errors[r2][c2].r)));
                var cg = Math.max(0, Math.min(255, Math.round(px.g + errors[r2][c2].g)));
                var cb = Math.max(0, Math.min(255, Math.round(px.b + errors[r2][c2].b)));

                // 找最近色
                var srcLab = rgbToLab(cr, cg, cb);
                var bestIdx = allowedLabs[0].idx;
                var bestDist = Infinity;
                for (var k = 0; k < allowedLabs.length; k++) {
                    var dist = ciede2000(srcLab, allowedLabs[k].lab);
                    if (dist < bestDist) { bestDist = dist; bestIdx = allowedLabs[k].idx; }
                }
                result[r2][c2] = bestIdx;

                // 计算误差
                var matched = hexToRgb(PALETTE[bestIdx].hex);
                var errR = cr - matched.r;
                var errG = cg - matched.g;
                var errB = cb - matched.b;

                // 扩散误差到邻居
                var spread = [
                    { dr: 0, dc: 1, w: 7 / 16 },
                    { dr: 1, dc: -1, w: 3 / 16 },
                    { dr: 1, dc: 0, w: 5 / 16 },
                    { dr: 1, dc: 1, w: 1 / 16 }
                ];
                for (var s = 0; s < spread.length; s++) {
                    var nr = r2 + spread[s].dr;
                    var nc = c2 + spread[s].dc;
                    if (nr >= 0 && nr < gridH && nc >= 0 && nc < gridW) {
                        errors[nr][nc].r += errR * spread[s].w;
                        errors[nr][nc].g += errG * spread[s].w;
                        errors[nr][nc].b += errB * spread[s].w;
                    }
                }
            }
        }
        return result;
    }

    // ===========================
    //  转换预览缓存
    // ===========================
    var _convertPreviewData = null;

    function generateConvertPreview(maxColors, ditherMode, filterBg, bgTolerance) {
        if (!S.refImage) return null;

        var img = S.refImage;
        var imgW = img.naturalWidth;
        var imgH = img.naturalHeight;

        var tmp = document.createElement('canvas');
        tmp.width = imgW;
        tmp.height = imgH;
        var tc = tmp.getContext('2d');
        tc.drawImage(img, 0, 0, imgW, imgH);
        var fullData = tc.getImageData(0, 0, imgW, imgH).data;

        // 计算图片在画板上的实际映射区域（保持比例，不压扁）
        var canvasPixelW = S.gridW * S.cellSize;
        var canvasPixelH = S.gridH * S.cellSize;
        var imgScale = Math.min(canvasPixelW / imgW, canvasPixelH / imgH);
        var mappedW = imgW * imgScale;
        var mappedH = imgH * imgScale;
        var offsetX = (canvasPixelW - mappedW) / 2;
        var offsetY = (canvasPixelH - mappedH) / 2;

        var startCol = Math.floor(offsetX / S.cellSize);
        var startRow = Math.floor(offsetY / S.cellSize);
        var endCol = Math.ceil((offsetX + mappedW) / S.cellSize);
        var endRow = Math.ceil((offsetY + mappedH) / S.cellSize);
        startCol = Math.max(0, startCol);
        startRow = Math.max(0, startRow);
        endCol = Math.min(S.gridW, endCol);
        endRow = Math.min(S.gridH, endRow);

        var coveredCols = endCol - startCol;
        var coveredRows = endRow - startRow;

        var blockW = imgW / coveredCols;
        var blockH = imgH / coveredRows;

        // 背景色检测
        var bgColor = null;
        var bgTolSq = 0;
        if (filterBg) {
            bgTolSq = bgTolerance * bgTolerance * 3;
            var corners = [
                { x: 0, y: 0 }, { x: imgW - 5, y: 0 },
                { x: 0, y: imgH - 5 }, { x: imgW - 5, y: imgH - 5 }
            ];
            var sr = 0, sg = 0, sb = 0, cnt = 0;
            corners.forEach(function (corner) {
                for (var dy = 0; dy < 5 && corner.y + dy < imgH; dy++) {
                    for (var dx = 0; dx < 5 && corner.x + dx < imgW; dx++) {
                        var ci = ((corner.y + dy) * imgW + (corner.x + dx)) * 4;
                        if (fullData[ci + 3] > 100) {
                            sr += fullData[ci]; sg += fullData[ci + 1]; sb += fullData[ci + 2]; cnt++;
                        }
                    }
                }
            });
            if (cnt > 0) bgColor = { r: sr / cnt, g: sg / cnt, b: sb / cnt };
        }

        _paletteLabCache = null;

        // 第一遍：采样所有格子的平均色
        var pixelGrid = [];
        var pmap = [];
        var counts = {};

        for (var row = 0; row < S.gridH; row++) {
            pixelGrid[row] = [];
            for (var col = 0; col < S.gridW; col++) {
                // 判断该格子是否在图片覆盖范围内
                if (row < startRow || row >= endRow || col < startCol || col >= endCol) {
                    pixelGrid[row][col] = null;
                    pmap.push(null);
                    continue;
                }

                var localRow = row - startRow;
                var localCol = col - startCol;
                var x0 = Math.round(localCol * blockW);
                var y0 = Math.round(localRow * blockH);
                var x1 = Math.round((localCol + 1) * blockW);
                var y1 = Math.round((localRow + 1) * blockH);
                if (x1 > imgW) x1 = imgW;
                if (y1 > imgH) y1 = imgH;

                var sumR = 0, sumG = 0, sumB = 0, pixelCount = 0, transparentCount = 0;
                for (var py = y0; py < y1; py++) {
                    for (var px = x0; px < x1; px++) {
                        var idx = (py * imgW + px) * 4;
                        if (fullData[idx + 3] < 100) { transparentCount++; continue; }
                        sumR += fullData[idx]; sumG += fullData[idx + 1]; sumB += fullData[idx + 2]; pixelCount++;
                    }
                }

                var totalPixels = (x1 - x0) * (y1 - y0);
                if (pixelCount === 0 || transparentCount > totalPixels * 0.5) {
                    pixelGrid[row][col] = null;
                    pmap.push(null);
                    continue;
                }

                var avgR = Math.round(sumR / pixelCount);
                var avgG = Math.round(sumG / pixelCount);
                var avgB = Math.round(sumB / pixelCount);

                if (filterBg && bgColor) {
                    var dr2 = avgR - bgColor.r, dg2 = avgG - bgColor.g, db2 = avgB - bgColor.b;
                    if (dr2 * dr2 + dg2 * dg2 + db2 * db2 < bgTolSq) {
                        pixelGrid[row][col] = null;
                        pmap.push(null);
                        continue;
                    }
                }

                pixelGrid[row][col] = { r: avgR, g: avgG, b: avgB };
                var bestI = findClosestPaletteColor(avgR, avgG, avgB);
                pmap.push(bestI);
                counts[bestI] = (counts[bestI] || 0) + 1;
            }
        }

        // 限制用色数
        var topColors = Object.entries(counts)
            .sort(function (a, b) { return b[1] - a[1]; })
            .slice(0, maxColors)
            .map(function (e) { return parseInt(e[0]); });

        var labsAll = getPaletteLabs();
        var allowedLabs = [];
        topColors.forEach(function (ci) {
            allowedLabs.push({ idx: ci, lab: labsAll[ci] });
        });

        var resultGrid;

        if (ditherMode === 'floyd') {
            // Floyd-Steinberg 抖动
            resultGrid = floydSteinbergDither(pixelGrid, S.gridW, S.gridH, allowedLabs);
        } else {
            // 无抖动：直接映射
            resultGrid = [];
            var flatIdx = 0;
            var allowed = new Set(topColors);
            for (var r3 = 0; r3 < S.gridH; r3++) {
                resultGrid[r3] = [];
                for (var c3 = 0; c3 < S.gridW; c3++) {
                    var ci3 = pmap[flatIdx];
                    if (ci3 === null) { resultGrid[r3][c3] = null; }
                    else if (allowed.has(ci3)) { resultGrid[r3][c3] = ci3; }
                    else {
                        // 重新在允许集合中找最近色
                        var pg = pixelGrid[r3][c3];
                        if (!pg) { resultGrid[r3][c3] = null; }
                        else {
                            var sLab = rgbToLab(pg.r, pg.g, pg.b);
                            var bI = allowedLabs[0].idx, bD = Infinity;
                            for (var k2 = 0; k2 < allowedLabs.length; k2++) {
                                var d2 = ciede2000(sLab, allowedLabs[k2].lab);
                                if (d2 < bD) { bD = d2; bI = allowedLabs[k2].idx; }
                            }
                            resultGrid[r3][c3] = bI;
                        }
                    }
                    flatIdx++;
                }
            }
        }

        return resultGrid;
    }

    function renderPreviewToCanvas(resultGrid) {
        var previewCanvas = $('convertPreviewCanvas');
        // 根据画板宽高比计算预览尺寸，保持比例不压扁
        var maxSize = 560;
        var ratio = S.gridW / S.gridH;
        var cellSize;
        if (ratio >= 1) {
            // 宽图
            cellSize = maxSize / S.gridW;
        } else {
            // 高图
            cellSize = maxSize / S.gridH;
        }
        // 确保 cellSize 至少2像素
        cellSize = Math.max(2, cellSize);
        var pw = Math.round(S.gridW * cellSize);
        var ph = Math.round(S.gridH * cellSize);

        // 用2倍DPR渲染，但CSS尺寸保持逻辑尺寸
        var dpr = Math.min(window.devicePixelRatio || 1, 2);
        previewCanvas.width = pw * dpr;
        previewCanvas.height = ph * dpr;
        previewCanvas.style.width = pw + 'px';
        previewCanvas.style.height = ph + 'px';
        var pc = previewCanvas.getContext('2d');
        pc.setTransform(dpr, 0, 0, dpr, 0, 0);

        // 白色背景
        pc.fillStyle = '#fff';
        pc.fillRect(0, 0, pw, ph);

        // 渲染色块
        for (var r = 0; r < S.gridH; r++) {
            for (var c = 0; c < S.gridW; c++) {
                var ci = resultGrid[r][c];
                if (ci !== null && PALETTE[ci]) {
                    pc.fillStyle = PALETTE[ci].hex;
                    pc.fillRect(
                        Math.floor(c * cellSize),
                        Math.floor(r * cellSize),
                        Math.ceil(cellSize),
                        Math.ceil(cellSize)
                    );
                }
            }
        }

        // 统计用色
        var usedColors = {};
        var total = 0;
        for (var r2 = 0; r2 < S.gridH; r2++) {
            for (var c2 = 0; c2 < S.gridW; c2++) {
                if (resultGrid[r2][c2] !== null) {
                    usedColors[resultGrid[r2][c2]] = (usedColors[resultGrid[r2][c2]] || 0) + 1;
                    total++;
                }
            }
        }
        var colorCount = Object.keys(usedColors).length;
        $('convertPreviewInfo').textContent = '预览结果：' + total + ' 颗豆子，' + colorCount + ' 种颜色 | ' + S.gridW + 'x' + S.gridH;
    }

    function convertImage() {
        if (!S.refImage) return;

        S.maxColors = Math.min(Math.max(parseInt($('maxColors').value) || 24, 2), 64);

        // 先将图片绘制到原始尺寸，再分块采样
        var img = S.refImage;
        var imgW = img.naturalWidth;
        var imgH = img.naturalHeight;

        var tmp = document.createElement('canvas');
        tmp.width = imgW;
        tmp.height = imgH;
        var tc = tmp.getContext('2d');
        tc.drawImage(img, 0, 0, imgW, imgH);
        var fullData = tc.getImageData(0, 0, imgW, imgH).data;

        // 计算图片在画板上的实际映射区域（保持比例，不压扁）
        var canvasPixelW = S.gridW * S.cellSize;
        var canvasPixelH = S.gridH * S.cellSize;
        var imgScale = Math.min(canvasPixelW / imgW, canvasPixelH / imgH);
        var mappedW = imgW * imgScale;
        var mappedH = imgH * imgScale;
        var offsetX = (canvasPixelW - mappedW) / 2;
        var offsetY = (canvasPixelH - mappedH) / 2;

        // 计算图片实际覆盖的格子范围
        var startCol = Math.floor(offsetX / S.cellSize);
        var startRow = Math.floor(offsetY / S.cellSize);
        var endCol = Math.ceil((offsetX + mappedW) / S.cellSize);
        var endRow = Math.ceil((offsetY + mappedH) / S.cellSize);
        startCol = Math.max(0, startCol);
        startRow = Math.max(0, startRow);
        endCol = Math.min(S.gridW, endCol);
        endRow = Math.min(S.gridH, endRow);

        var coveredCols = endCol - startCol;
        var coveredRows = endRow - startRow;

        var blockW = imgW / coveredCols;
        var blockH = imgH / coveredRows;

        // 背景屏蔽检测
        var filterBg = $('toggleBgFilter') && $('toggleBgFilter').checked;
        var bgColor = null;
        var bgTolSq = 0;
        if (filterBg) {
            var tol = parseInt($('bgToleranceSlider').value) || 30;
            bgTolSq = tol * tol * 3;
            // 取四角 5×5 区域的平均色作为背景色
            var corners = [
                {x: 0, y: 0},
                {x: imgW - 5, y: 0},
                {x: 0, y: imgH - 5},
                {x: imgW - 5, y: imgH - 5}
            ];
            var sr = 0, sg = 0, sb = 0, cnt = 0;
            corners.forEach(function(corner) {
                for (var dy = 0; dy < 5 && corner.y + dy < imgH; dy++) {
                    for (var dx = 0; dx < 5 && corner.x + dx < imgW; dx++) {
                        var ci = ((corner.y + dy) * imgW + (corner.x + dx)) * 4;
                        if (fullData[ci + 3] > 100) {
                            sr += fullData[ci];
                            sg += fullData[ci + 1];
                            sb += fullData[ci + 2];
                            cnt++;
                        }
                    }
                }
            });
            if (cnt > 0) {
                bgColor = { r: sr / cnt, g: sg / cnt, b: sb / cnt };
            }
        }

        // 使 Lab 缓存失效后重建
        _paletteLabCache = null;

        // 对每个格子做区块平均色采样
        var pmap = [];
        var counts = {};

        for (var row = 0; row < S.gridH; row++) {
            for (var col = 0; col < S.gridW; col++) {
                if (row < startRow || row >= endRow || col < startCol || col >= endCol) {
                    pmap.push(null);
                    continue;
                }

                var localRow = row - startRow;
                var localCol = col - startCol;
                var x0 = Math.round(localCol * blockW);
                var y0 = Math.round(localRow * blockH);
                var x1 = Math.round((localCol + 1) * blockW);
                var y1 = Math.round((localRow + 1) * blockH);
                if (x1 > imgW) x1 = imgW;
                if (y1 > imgH) y1 = imgH;

                var sumR = 0, sumG = 0, sumB = 0;
                var pixelCount = 0;
                var transparentCount = 0;

                for (var py = y0; py < y1; py++) {
                    for (var px = x0; px < x1; px++) {
                        var idx = (py * imgW + px) * 4;
                        var pa = fullData[idx + 3];
                        if (pa < 100) {
                            transparentCount++;
                            continue;
                        }
                        sumR += fullData[idx];
                        sumG += fullData[idx + 1];
                        sumB += fullData[idx + 2];
                        pixelCount++;
                    }
                }

                var totalPixels = (x1 - x0) * (y1 - y0);

                if (pixelCount === 0 || transparentCount > totalPixels * 0.5) {
                    pmap.push(null);
                    continue;
                }

                var avgR = Math.round(sumR / pixelCount);
                var avgG = Math.round(sumG / pixelCount);
                var avgB = Math.round(sumB / pixelCount);

                if (filterBg && bgColor) {
                    var dr = avgR - bgColor.r;
                    var dg = avgG - bgColor.g;
                    var db = avgB - bgColor.b;
                    if (dr * dr + dg * dg + db * db < bgTolSq) {
                        pmap.push(null);
                        continue;
                    }
                }

                var bestI = findClosestPaletteColor(avgR, avgG, avgB);
                pmap.push(bestI);
                counts[bestI] = (counts[bestI] || 0) + 1;
            }
        }

        // Keep only top N colors
        var topColors = Object.entries(counts)
            .sort(function(a, b) { return b[1] - a[1]; })
            .slice(0, S.maxColors)
            .map(function(e) { return parseInt(e[0]); });
        var allowed = new Set(topColors);

        // 重映射被淘汰的颜色：回到原始像素重新在允许集合里找最近色
        var labsAll = getPaletteLabs();
        var allowedLabs = [];
        topColors.forEach(function(ci) {
            allowedLabs.push({ idx: ci, lab: labsAll[ci] });
        });

        for (var i = 0; i < pmap.length; i++) {
            if (pmap[i] === null || allowed.has(pmap[i])) continue;
            var ri = Math.floor(i / S.gridW);
            var ci2 = i % S.gridW;
            // 跳过不在图片覆盖范围内的格子
            if (ri < startRow || ri >= endRow || ci2 < startCol || ci2 >= endCol) {
                pmap[i] = null;
                continue;
            }
            var localR = ri - startRow;
            var localC = ci2 - startCol;
            var bx0 = Math.round(localC * blockW);
            var by0 = Math.round(localR * blockH);
            var bx1 = Math.round((localC + 1) * blockW);
            var by1 = Math.round((localR + 1) * blockH);
            if (bx1 > imgW) bx1 = imgW;
            if (by1 > imgH) by1 = imgH;
            var sR = 0, sG = 0, sB = 0, sC = 0;
            for (var py2 = by0; py2 < by1; py2++) {
                for (var px2 = bx0; px2 < bx1; px2++) {
                    var idx2 = (py2 * imgW + px2) * 4;
                    if (fullData[idx2 + 3] < 100) continue;
                    sR += fullData[idx2]; sG += fullData[idx2+1]; sB += fullData[idx2+2]; sC++;
                }
            }
            if (sC === 0) { pmap[i] = null; continue; }
            var srcLab = rgbToLab(Math.round(sR/sC), Math.round(sG/sC), Math.round(sB/sC));
            var bestIdx = allowedLabs[0].idx, bestDist = Infinity;
            for (var k = 0; k < allowedLabs.length; k++) {
                var dist = ciede2000(srcLab, allowedLabs[k].lab);
                if (dist < bestDist) { bestDist = dist; bestIdx = allowedLabs[k].idx; }
            }
            pmap[i] = bestIdx;
        }

        // Apply
        for (var r = 0; r < S.gridH; r++) {
            for (var c = 0; c < S.gridW; c++) {
                var val = pmap[r * S.gridW + c];
                S.grid[r][c] = val;
                if (S.layers[S.activeLayer].grid && S.layers[S.activeLayer].grid[r])
                    S.layers[S.activeLayer].grid[r][c] = val;
            }
        }

        pushHistory();
        render();
    }


    function recognizeBlockImage() {
        if (!S.refImage) { alert('请先上传图片'); return; }

        S.maxColors = Math.min(Math.max(parseInt($('maxColors').value) || 16, 2), 32);

        var img = S.refImage;
        var imgW = img.naturalWidth;
        var imgH = img.naturalHeight;

        // 将图片绘制到临时 canvas 取像素
        var tmp = document.createElement('canvas');
        tmp.width = imgW;
        tmp.height = imgH;
        var tc = tmp.getContext('2d');
        tc.drawImage(img, 0, 0, imgW, imgH);
        var imgData = tc.getImageData(0, 0, imgW, imgH).data;

        // 自动检测色块格子大小
        var detectedCellSize = detectCellSize(imgData, imgW, imgH);
        var gridCols = Math.round(imgW / detectedCellSize);
        var gridRows = Math.round(imgH / detectedCellSize);

        $('detectedSize').textContent = gridCols + ' x ' + gridRows;
        $('recognizeHint').style.display = 'block';
        $('recognizeResizeToggle').style.display = 'flex';

        // 是否调整画布尺寸
        var shouldResize = $('recognizeResize') && $('recognizeResize').checked;
        var targetW = shouldResize ? gridCols : S.gridW;
        var targetH = shouldResize ? gridRows : S.gridH;

        if (shouldResize && (targetW !== S.gridW || targetH !== S.gridH)) {
            S.gridW = Math.min(Math.max(targetW, 4), 200);
            S.gridH = Math.min(Math.max(targetH, 4), 200);
            initGrid();
            $('canvasWidth').value = S.gridW;
            $('canvasHeight').value = S.gridH;
            setupCanvas();
        }

        // 使 Lab 缓存失效后重建
        _paletteLabCache = null;

        // 分块采样
        var blockW = imgW / targetW;
        var blockH = imgH / targetH;

        // 背景屏蔽
        var filterBg = $('toggleBgFilter') && $('toggleBgFilter').checked;
        var bgColor = null;
        var bgTolSq = 0;
        if (filterBg) {
            var tol = parseInt($('bgToleranceSlider').value) || 30;
            bgTolSq = tol * tol * 3;
            var corners = [
                {x: 0, y: 0},
                {x: imgW - 5, y: 0},
                {x: 0, y: imgH - 5},
                {x: imgW - 5, y: imgH - 5}
            ];
            var sr = 0, sg = 0, sb = 0, cnt = 0;
            corners.forEach(function(corner) {
                for (var dy = 0; dy < 5 && corner.y + dy < imgH; dy++) {
                    for (var dx = 0; dx < 5 && corner.x + dx < imgW; dx++) {
                        var ci = ((corner.y + dy) * imgW + (corner.x + dx)) * 4;
                        if (imgData[ci + 3] > 100) {
                            sr += imgData[ci];
                            sg += imgData[ci + 1];
                            sb += imgData[ci + 2];
                            cnt++;
                        }
                    }
                }
            });
            if (cnt > 0) {
                bgColor = { r: sr / cnt, g: sg / cnt, b: sb / cnt };
            }
        }

        // 映射到色板（区块平均色）
        var pmap = [];
        var counts = {};

        for (var row = 0; row < targetH; row++) {
            for (var col = 0; col < targetW; col++) {
                var x0 = Math.round(col * blockW);
                var y0 = Math.round(row * blockH);
                var x1 = Math.round((col + 1) * blockW);
                var y1 = Math.round((row + 1) * blockH);
                if (x1 > imgW) x1 = imgW;
                if (y1 > imgH) y1 = imgH;

                // 取中心 60% 区域避免边缘干扰
                var marginX = Math.floor((x1 - x0) * 0.2);
                var marginY = Math.floor((y1 - y0) * 0.2);
                var cx0 = x0 + marginX;
                var cy0 = y0 + marginY;
                var cx1 = x1 - marginX;
                var cy1 = y1 - marginY;
                if (cx0 >= cx1) { cx0 = x0; cx1 = x1; }
                if (cy0 >= cy1) { cy0 = y0; cy1 = y1; }

                var sumR = 0, sumG = 0, sumB = 0, pixelCount = 0, transparentCount = 0;

                for (var py = cy0; py < cy1; py++) {
                    for (var px = cx0; px < cx1; px++) {
                        var idx = (py * imgW + px) * 4;
                        if (imgData[idx + 3] < 100) { transparentCount++; continue; }
                        sumR += imgData[idx];
                        sumG += imgData[idx + 1];
                        sumB += imgData[idx + 2];
                        pixelCount++;
                    }
                }

                var totalPixels = (cx1 - cx0) * (cy1 - cy0);
                if (pixelCount === 0 || transparentCount > totalPixels * 0.5) {
                    pmap.push(null);
                    continue;
                }

                var avgR = Math.round(sumR / pixelCount);
                var avgG = Math.round(sumG / pixelCount);
                var avgB = Math.round(sumB / pixelCount);

                if (filterBg && bgColor) {
                    var ddr = avgR - bgColor.r, ddg = avgG - bgColor.g, ddb = avgB - bgColor.b;
                    if (ddr * ddr + ddg * ddg + ddb * ddb < bgTolSq) {
                        pmap.push(null);
                        continue;
                    }
                }

                var bestI = findClosestPaletteColor(avgR, avgG, avgB);
                pmap.push(bestI);
                counts[bestI] = (counts[bestI] || 0) + 1;
            }
        }

        // 限制最大用色数
        var topColors = Object.entries(counts)
            .sort(function(a, b) { return b[1] - a[1]; })
            .slice(0, S.maxColors)
            .map(function(e) { return parseInt(e[0]); });
        var allowed = new Set(topColors);

        var labsAll = getPaletteLabs();
        var allowedLabs = [];
        topColors.forEach(function(ci) {
            allowedLabs.push({ idx: ci, lab: labsAll[ci] });
        });

        for (var i = 0; i < pmap.length; i++) {
            if (pmap[i] === null || allowed.has(pmap[i])) continue;
            var srcPaletteLab = labsAll[pmap[i]];
            var bestIdx = allowedLabs[0].idx, bestDist = Infinity;
            for (var k = 0; k < allowedLabs.length; k++) {
                var dist = ciede2000(srcPaletteLab, allowedLabs[k].lab);
                if (dist < bestDist) { bestDist = dist; bestIdx = allowedLabs[k].idx; }
            }
            pmap[i] = bestIdx;
        }

        // 写入画布
        for (var r = 0; r < targetH && r < S.gridH; r++)
            for (var c = 0; c < targetW && c < S.gridW; c++)
                S.grid[r][c] = pmap[r * targetW + c];

        pushHistory();
        render();
    }


    function detectCellSize(imgData, w, h) {
        // 沿第一行检测颜色变化点，估算格子宽度
        const changes = [];
        let prevR = imgData[0], prevG = imgData[1], prevB = imgData[2];
        const threshold = 30;

        // 检查水平方向中间行的颜色变化
        const midRow = Math.floor(h / 2);
        const rowOffset = midRow * w * 4;

        for (let x = 1; x < w; x++) {
            const i = rowOffset + x * 4;
            const r = imgData[i], g = imgData[i + 1], b = imgData[i + 2];
            const diff = Math.abs(r - prevR) + Math.abs(g - prevG) + Math.abs(b - prevB);
            if (diff > threshold) {
                changes.push(x);
            }
            prevR = r; prevG = g; prevB = b;
        }

        if (changes.length < 2) return Math.min(w, h);

        // 计算相邻变化点间距
        const gaps = [];
        for (let i = 1; i < changes.length; i++) {
            const gap = changes[i] - changes[i - 1];
            if (gap > 3) gaps.push(gap);
        }

        if (gaps.length === 0) return Math.min(w, h);

        // 取众数作为格子宽度
        const gapCounts = {};
        gaps.forEach(g => { gapCounts[g] = (gapCounts[g] || 0) + 1; });
        let bestGap = gaps[0], bestCount = 0;
        Object.entries(gapCounts).forEach(([g, c]) => {
            if (c > bestCount) { bestCount = c; bestGap = parseInt(g); }
        });

        return Math.max(bestGap, 1);
    }

    // ===========================
    //  Export
    // ===========================
    function doExport(beadMode) {

        // 如果还没有设置项目名称，提示用户输入一个
        if (!S.currentProjectName && $('projectName').value.trim()) {
            S.currentProjectName = $('projectName').value.trim();
        }

        const prevBead = S.showBead;
        const prevGrid = S.showGrid;
        const prevNum = S.showNumbers;

        var prevCellOpacity = S.cellOpacity;
        S.cellOpacity = 1;  // 导出时色块不透明
        if (beadMode) { S.showBead = true; S.showGrid = false; S.showNumbers = false; }

        renderMain();

        const cs = S.cellSize;
        const rs = S.showRuler ? 30 : 0;

        // 计算用色统计
        const counts = {};
        let total = 0;
        for (let r = 0; r < S.gridH; r++) {
            for (let c = 0; c < S.gridW; c++) {
                const ci = S.grid[r][c];
                if (ci !== null) {
                    counts[ci] = (counts[ci] || 0) + 1;
                    total++;
                }
            }
        }

        const usedColors = Object.entries(counts)
            .sort((a, b) => b[1] - a[1])
            .map(function (entry) { return { idx: parseInt(entry[0]), count: entry[1] }; });

        // 底部色号区域高度计算
        const legendPadding = 16;
        const legendRowH = 22;
        const legendColW = 130;
        const gridAreaW = rs + S.gridW * cs;
        const legendCols = Math.max(1, Math.floor((gridAreaW - legendPadding * 2) / legendColW));
        const legendRows = Math.ceil(usedColors.length / legendCols);
        const legendTitleH = 32;
        const legendH = legendTitleH + legendRows * legendRowH + legendPadding * 2 + 8;

        // Logo 区域高度
        const logoH = 40;

        const ew = rs + S.gridW * cs;
        const eh = rs + S.gridH * cs + legendH + logoH;
        const scale = 2;

        const exp = document.createElement('canvas');
        exp.width = ew * scale;
        exp.height = eh * scale;
        const ec = exp.getContext('2d');
        ec.setTransform(scale, 0, 0, scale, 0, 0);

        // 白色背景
        ec.fillStyle = '#fff';
        ec.fillRect(0, 0, ew, eh);

        // BG 棋盘格
        for (let r = 0; r < S.gridH; r++)
            for (let co = 0; co < S.gridW; co++) {
                ec.fillStyle = (r + co) % 2 === 0 ? '#fdfdfd' : '#f5f2f0';
                ec.fillRect(rs + co * cs, rs + r * cs, cs, cs);
            }

        // 绘制内容
        for (let r = 0; r < S.gridH; r++) {
            for (let c = 0; c < S.gridW; c++) {
                const ci = S.grid[r][c];
                if (ci === null) continue;
                const color = PALETTE[ci];
                const x = rs + c * cs;
                const y = rs + r * cs;
                if (beadMode) {
                    drawBead(ec, x, y, cs, color.hex);
                } else {
                    ec.fillStyle = color.hex;
                    ec.fillRect(x, y, cs, cs);
                }
            }
        }

        // 网格线
        if (S.showGrid && !beadMode) {
            for (let r = 0; r <= S.gridH; r++) {
                const major = r % 5 === 0;
                ec.strokeStyle = major ? 'rgba(141,123,170,0.45)' : 'rgba(200,190,200,0.3)';
                ec.lineWidth = major ? 1.2 : 0.5;
                ec.beginPath();
                ec.moveTo(rs, rs + r * cs);
                ec.lineTo(rs + S.gridW * cs, rs + r * cs);
                ec.stroke();
            }
            for (let c = 0; c <= S.gridW; c++) {
                const major = c % 5 === 0;
                ec.strokeStyle = major ? 'rgba(141,123,170,0.45)' : 'rgba(200,190,200,0.3)';
                ec.lineWidth = major ? 1.2 : 0.5;
                ec.beginPath();
                ec.moveTo(rs + c * cs, rs);
                ec.lineTo(rs + c * cs, rs + S.gridH * cs);
                ec.stroke();
            }
        }

        // 色号数字
        if (S.showNumbers && !beadMode) {
            ec.textAlign = 'center';
            ec.textBaseline = 'middle';
            const fontSize = Math.max(6, Math.min(cs * 0.48, 11));
            ec.font = 'bold ' + fontSize + 'px -apple-system, sans-serif';
            for (let r = 0; r < S.gridH; r++) {
                for (let c = 0; c < S.gridW; c++) {
                    const ci = S.grid[r][c];
                    if (ci === null) continue;
                    const color = PALETTE[ci];
                    const lum = luminance(color.hex);
                    ec.fillStyle = lum > 0.55 ? 'rgba(60,50,55,0.6)' : 'rgba(255,255,255,0.75)';
                    const label = color.id.length > 3 ? color.id.slice(-2) : color.id;
                    ec.fillText(label, rs + c * cs + cs / 2, rs + r * cs + cs / 2);
                }
            }
        }

        // 标尺
        if (S.showRuler) {
            ec.fillStyle = '#f6f1ee';
            ec.fillRect(0, 0, rs, rs + S.gridH * cs);
            ec.fillRect(0, 0, rs + S.gridW * cs, rs);

            ec.textAlign = 'right';
            ec.textBaseline = 'bottom';
            for (let c = 0; c <= S.gridW; c++) {
                var major = c % 5 === 0;
                ec.strokeStyle = major ? '#8d7baa' : '#cdc4d6';
                ec.lineWidth = major ? 1.5 : 0.6;
                ec.beginPath();
                ec.moveTo(rs + c * cs, major ? rs * 0.35 : rs * 0.65);
                ec.lineTo(rs + c * cs, rs);
                ec.stroke();
                if (major) {
                    ec.fillStyle = '#8d7baa';
                    ec.font = 'bold 9px -apple-system, sans-serif';
                    ec.fillText(String(c), rs + c * cs - 2, rs - 4);
                } else {
                    ec.fillStyle = '#b8aec4';
                    ec.font = '7px -apple-system, sans-serif';
                    ec.fillText(String(c), rs + c * cs - 2, rs - 4);
                }
            }

            ec.textAlign = 'right';
            ec.textBaseline = 'alphabetic';
            for (let r = 0; r <= S.gridH; r++) {
                var major = r % 5 === 0;
                ec.strokeStyle = major ? '#8d7baa' : '#cdc4d6';
                ec.lineWidth = major ? 1.5 : 0.6;
                ec.beginPath();
                ec.moveTo(major ? rs * 0.35 : rs * 0.65, rs + r * cs);
                ec.lineTo(rs, rs + r * cs);
                ec.stroke();
                if (major) {
                    ec.fillStyle = '#8d7baa';
                    ec.font = 'bold 9px -apple-system, sans-serif';
                    ec.fillText(String(r), rs - 4, rs + r * cs - 2);
                } else {
                    ec.fillStyle = '#b8aec4';
                    ec.font = '7px -apple-system, sans-serif';
                    ec.fillText(String(r), rs - 4, rs + r * cs - 2);
                }
            }
        }

        // === 左上角 Logo（不遮挡拼豆图案）===
        var logoAreaW = 140;
        var logoAreaH = 36;
        var logoX = 6;
        var logoY = 4;

        ec.save();
        ec.globalAlpha = 0.85;
        ec.fillStyle = 'rgba(255,255,255,0.8)';
        ec.beginPath();
        ec.roundRect(logoX - 4, logoY - 2, logoAreaW + 8, logoAreaH + 4, 6);
        ec.fill();

        ec.globalAlpha = 1;

        // 新版猫咪图标
        var catX = logoX + 16;
        var catY = logoY + logoAreaH / 2;
        var catS = 0.48;

        ec.save();
        ec.translate(catX, catY);
        ec.scale(catS, catS);

        // 左耳
        ec.fillStyle = '#f0c8c0';
        ec.beginPath();
        ec.moveTo(-10, -2);
        ec.quadraticCurveTo(-14, -18, -8, -24);
        ec.quadraticCurveTo(-6, -26, -4, -24);
        ec.lineTo(-3, -16);
        ec.quadraticCurveTo(-5, -8, -8, -4);
        ec.closePath();
        ec.fill();
        // 左耳内
        ec.fillStyle = '#f0a8a8';
        ec.globalAlpha = 0.7;
        ec.beginPath();
        ec.moveTo(-9, -5);
        ec.quadraticCurveTo(-12, -16, -7, -21);
        ec.quadraticCurveTo(-5.5, -23, -4.5, -21);
        ec.lineTo(-4, -14);
        ec.quadraticCurveTo(-5.5, -8, -7.5, -6);
        ec.closePath();
        ec.fill();
        ec.globalAlpha = 1;

        // 右耳
        ec.fillStyle = '#f0c8c0';
        ec.beginPath();
        ec.moveTo(10, -2);
        ec.quadraticCurveTo(14, -18, 8, -24);
        ec.quadraticCurveTo(6, -26, 4, -24);
        ec.lineTo(3, -16);
        ec.quadraticCurveTo(5, -8, 8, -4);
        ec.closePath();
        ec.fill();
        // 右耳内
        ec.fillStyle = '#f0a8a8';
        ec.globalAlpha = 0.7;
        ec.beginPath();
        ec.moveTo(9, -5);
        ec.quadraticCurveTo(12, -16, 7, -21);
        ec.quadraticCurveTo(5.5, -23, 4.5, -21);
        ec.lineTo(4, -14);
        ec.quadraticCurveTo(5.5, -8, 7.5, -6);
        ec.closePath();
        ec.fill();
        ec.globalAlpha = 1;

        // 头部
        ec.fillStyle = '#fff5f0';
        ec.beginPath();
        ec.ellipse(0, 4, 13, 12, 0, 0, Math.PI * 2);
        ec.fill();
        ec.strokeStyle = '#e8c4b8';
        ec.lineWidth = 0.6;
        ec.beginPath();
        ec.ellipse(0, 4, 13, 12, 0, 0, Math.PI * 2);
        ec.stroke();

        // 左眼
        ec.fillStyle = '#3a3040';
        ec.beginPath();
        ec.ellipse(-5, 2, 2.3, 2.5, 0, 0, Math.PI * 2);
        ec.fill();
        ec.fillStyle = '#fff';
        ec.globalAlpha = 0.85;
        ec.beginPath();
        ec.arc(-5.8, 0.8, 0.8, 0, Math.PI * 2);
        ec.fill();
        ec.globalAlpha = 0.4;
        ec.beginPath();
        ec.arc(-4, 3, 0.4, 0, Math.PI * 2);
        ec.fill();
        ec.globalAlpha = 1;

        // 右眼
        ec.fillStyle = '#3a3040';
        ec.beginPath();
        ec.ellipse(5, 2, 2.3, 2.5, 0, 0, Math.PI * 2);
        ec.fill();
        ec.fillStyle = '#fff';
        ec.globalAlpha = 0.85;
        ec.beginPath();
        ec.arc(4.2, 0.8, 0.8, 0, Math.PI * 2);
        ec.fill();
        ec.globalAlpha = 0.4;
        ec.beginPath();
        ec.arc(6, 3, 0.4, 0, Math.PI * 2);
        ec.fill();
        ec.globalAlpha = 1;

        // 鼻子
        ec.fillStyle = '#c07078';
        ec.beginPath();
        ec.ellipse(0, 6.5, 1.2, 0.8, 0, 0, Math.PI * 2);
        ec.fill();

        // 嘴
        ec.strokeStyle = '#c07880';
        ec.lineWidth = 0.7;
        ec.lineCap = 'round';
        ec.beginPath();
        ec.moveTo(-1.5, 7.8);
        ec.quadraticCurveTo(0, 10, 1.5, 7.8);
        ec.stroke();
        ec.beginPath();
        ec.moveTo(0, 6.5);
        ec.lineTo(0, 8);
        ec.stroke();

        // 腮红
        ec.fillStyle = 'rgba(240, 160, 160, 0.3)';
        ec.beginPath();
        ec.ellipse(-8.5, 6.5, 2.2, 1.6, 0, 0, Math.PI * 2);
        ec.fill();
        ec.beginPath();
        ec.ellipse(8.5, 6.5, 2.2, 1.6, 0, 0, Math.PI * 2);
        ec.fill();

        // 胡须
        ec.strokeStyle = '#d4b0b0';
        ec.lineWidth = 0.5;
        ec.globalAlpha = 0.5;
        ec.beginPath();
        ec.moveTo(-9, 4);
        ec.lineTo(-16, 3);
        ec.stroke();
        ec.beginPath();
        ec.moveTo(-9, 6.5);
        ec.lineTo(-16, 7.5);
        ec.stroke();
        ec.beginPath();
        ec.moveTo(9, 4);
        ec.lineTo(16, 3);
        ec.stroke();
        ec.beginPath();
        ec.moveTo(9, 6.5);
        ec.lineTo(16, 7.5);
        ec.stroke();
        ec.globalAlpha = 1;

        // 头顶小豆子
        ec.fillStyle = '#FFB7E7';
        ec.beginPath();
        ec.arc(-5, -12, 2, 0, Math.PI * 2);
        ec.fill();
        ec.fillStyle = '#A0E2FB';
        ec.beginPath();
        ec.arc(0, -14, 2.3, 0, Math.PI * 2);
        ec.fill();
        ec.fillStyle = '#CAEB7B';
        ec.beginPath();
        ec.arc(5, -12, 2, 0, Math.PI * 2);
        ec.fill();

        ec.restore();

        // 文字
        ec.fillStyle = '#8d7baa';
        ec.font = 'bold 13px -apple-system, sans-serif';
        ec.textAlign = 'left';
        ec.textBaseline = 'middle';
        ec.fillText('Cat Peas', logoX + 34, logoY + logoAreaH / 2 - 3);

        ec.fillStyle = '#a69caa';
        ec.font = '8px -apple-system, sans-serif';
        ec.fillText('拼豆图纸生成编辑器', logoX + 34, logoY + logoAreaH / 2 + 10);
        ec.restore();

        // === 25% 透明水印 ===
        ec.save();
        ec.globalAlpha = 0.06;
        ec.fillStyle = '#8d7baa';
        ec.font = 'bold 28px -apple-system, sans-serif';
        ec.textAlign = 'center';
        ec.textBaseline = 'middle';

        var wmText = 'Cat Peas';
        var wmSpacingX = 180;
        var wmSpacingY = 100;
        ec.translate(ew / 2, (rs + S.gridH * cs) / 2);
        ec.rotate(-25 * Math.PI / 180);

        for (var wy = -eh; wy < eh * 2; wy += wmSpacingY) {
            for (var wx = -ew; wx < ew * 2; wx += wmSpacingX) {
                ec.fillText(wmText, wx, wy);
            }
        }
        ec.restore();

        // === 隐形溯源码 ===
        var traceId = 'CP-' + Date.now().toString(36).toUpperCase() + '-' + Math.random().toString(36).slice(2, 6).toUpperCase();
        ec.save();
        ec.globalAlpha = 0.008;
        ec.fillStyle = '#000';
        ec.font = '6px monospace';
        ec.textAlign = 'left';
        ec.textBaseline = 'top';
        ec.fillText(traceId, 2, eh * scale / scale - 8);
        ec.fillText(traceId, ew - 80, 2);
        ec.restore();

        // === 底部色号统计区域 ===
        var legendTop = rs + S.gridH * cs;

        ec.fillStyle = '#f9f6f4';
        ec.fillRect(0, legendTop, ew, legendH + logoH);

        ec.strokeStyle = '#e6e0de';
        ec.lineWidth = 1;
        ec.beginPath();
        ec.moveTo(0, legendTop);
        ec.lineTo(ew, legendTop);
        ec.stroke();

        // 标题
        ec.fillStyle = '#8d7baa';
        ec.font = 'bold 11px -apple-system, sans-serif';
        ec.textAlign = 'left';
        ec.textBaseline = 'top';
        ec.fillText('用料清单  |  共 ' + total + ' 颗  |  ' + usedColors.length + ' 色  |  ' + S.gridW + 'x' + S.gridH, legendPadding, legendTop + 10);

        // 色号列表
        var startY = legendTop + legendTitleH;
        usedColors.forEach(function (item, i) {
            var col = i % legendCols;
            var row = Math.floor(i / legendCols);
            var x = legendPadding + col * legendColW;
            var y = startY + row * legendRowH;

            var color = PALETTE[item.idx];

            // 色块
            ec.fillStyle = color.hex;
            ec.fillRect(x, y + 2, 14, 14);
            ec.strokeStyle = '#ddd';
            ec.lineWidth = 0.5;
            ec.strokeRect(x, y + 2, 14, 14);

            // 色号和名称
            ec.fillStyle = '#3e3640';
            ec.font = 'bold 10px -apple-system, sans-serif';
            ec.textAlign = 'left';
            ec.textBaseline = 'middle';
            ec.fillText(color.id, x + 18, y + 9);

            // 名称
            ec.fillStyle = '#6e6472';
            ec.font = '9px -apple-system, sans-serif';
            ec.fillText(color.name, x + 48, y + 9);

            // 数量
            ec.fillStyle = '#8d7baa';
            ec.font = 'bold 10px -apple-system, sans-serif';
            ec.textAlign = 'right';
            ec.fillText(item.count + '颗', x + legendColW - 6, y + 9);
            ec.textAlign = 'left';
        });

        // === 最底部小字 ===
        ec.fillStyle = '#a69caa';
        ec.font = '8px -apple-system, sans-serif';
        ec.textAlign = 'center';
        ec.textBaseline = 'bottom';
        ec.fillText('由 Cat Peas 拼豆图纸生成编辑器生成  |  色值仅供参考，请以实物色卡为准', ew / 2, eh - 6);

        // === 嵌入画布数据到底部像素行 ===
        try {
            var gridDataStr = encodeGridData();
            // 写入到画布像素的最后几行（eh * scale 是总像素高度）
            var embedY = eh - 1; // 逻辑坐标最后1行
            encodeDataToPixels(exp, gridDataStr, embedY);
        } catch (embedErr) {
            console.warn('嵌入数据失败:', embedErr);
        }

        // 下载（使用 toBlob 减少内存占用）
        var now = new Date();
        var ts = now.getFullYear().toString() +
            String(now.getMonth() + 1).padStart(2, '0') +
            String(now.getDate()).padStart(2, '0') + '_' +
            String(now.getHours()).padStart(2, '0') +
            String(now.getMinutes()).padStart(2, '0') +
            String(now.getSeconds()).padStart(2, '0');
        var projectLabel = S.currentProjectName ? S.currentProjectName.replace(/[\\/:*?"<>|]/g, '_').slice(0, 20) + '_' : '';
        var fileName = 'CatPeas_' + projectLabel + (beadMode ? '仿真豆子' : '色块图纸') + '_' + S.gridW + 'x' + S.gridH + '_' + ts + '.png';

        // 恢复（先恢复再异步下载）
        S.showBead = prevBead;
        S.showGrid = prevGrid;
        S.showNumbers = prevNum;
        S.cellOpacity = prevCellOpacity;
        renderMain();

        if (exp.toBlob) {
            exp.toBlob(function (blob) {
                if (!blob) return;
                var url = URL.createObjectURL(blob);
                var link = document.createElement('a');
                link.download = fileName;
                link.href = url;
                link.click();
                setTimeout(function () { URL.revokeObjectURL(url); }, 5000);
            }, 'image/png');
        } else {
            var link = document.createElement('a');
            link.download = fileName;
            link.href = exp.toDataURL('image/png');
            link.click();
        }
    }


    async function exportSplitBoards() {
        // 弹出选择分板尺寸
        var sizeStr = await cdPrompt(
            '请输入每块板的格数（正方形）：\n' +
            '· 26 = 半板（26×26）\n' +
            '· 29 = 中半板（29×29）\n' +
            '· 52 = 标准板（52×52）',
            { title: '分板导出', defaultValue: '26', placeholder: '输入格数' }
        );
        if (sizeStr === null) return;
        var boardSize = parseInt(sizeStr) || 26;
        if (boardSize < 4 || boardSize > 200) {
            alert('板尺寸须在 4~200 之间');
            return;
        }

        var boardCols = Math.ceil(S.gridW / boardSize);
        var boardRows = Math.ceil(S.gridH / boardSize);
        var totalBoards = boardCols * boardRows;

        if (totalBoards === 1) {
            alert('当前画布尺寸只需要 1 块板，无需分板导出。请使用普通导出。');
            return;
        }

        var splitOk = await cdConfirm('将画布分为 ' + boardCols + '×' + boardRows + ' = ' + totalBoards + ' 块板（每块 ' + boardSize + '×' + boardSize + '），确认导出？', { title: '确认分板导出' });
        if (!splitOk) return;

        var cs = S.cellSize;
        var scale = 2;
        var rs = S.showRuler ? 30 : 0;
        var now2 = new Date();
        var ts = now2.getFullYear().toString() +
            String(now2.getMonth() + 1).padStart(2, '0') +
            String(now2.getDate()).padStart(2, '0') + '_' +
            String(now2.getHours()).padStart(2, '0') +
            String(now2.getMinutes()).padStart(2, '0') +
            String(now2.getSeconds()).padStart(2, '0');
        for (var br = 0; br < boardRows; br++) {
            for (var bc = 0; bc < boardCols; bc++) {
                var startR = br * boardSize;
                var startC = bc * boardSize;
                var bw = Math.min(boardSize, S.gridW - startC);
                var bh = Math.min(boardSize, S.gridH - startR);
                var label = String.fromCharCode(65 + br) + (bc + 1);

                // 统计该板用色
                var counts = {};
                var total = 0;
                for (var r = startR; r < startR + bh; r++) {
                    for (var c = startC; c < startC + bw; c++) {
                        var ci = S.grid[r][c];
                        if (ci !== null) {
                            counts[ci] = (counts[ci] || 0) + 1;
                            total++;
                        }
                    }
                }

                var usedColors = Object.entries(counts)
                    .sort(function (a, b) { return b[1] - a[1]; })
                    .map(function (e) { return { idx: parseInt(e[0]), count: e[1] }; });

                // 底部色号区域
                var legendPadding = 12;
                var legendRowH = 18;
                var legendColW = 110;
                var gridAreaW = rs + bw * cs;
                var legendCols2 = Math.max(1, Math.floor((gridAreaW - legendPadding * 2) / legendColW));
                var legendRows2 = Math.ceil(usedColors.length / legendCols2);
                var legendTitleH = 24;
                var legendH = legendTitleH + legendRows2 * legendRowH + legendPadding * 2;
                var logoH = 30;

                var ew = rs + bw * cs;
                var eh = rs + bh * cs + legendH + logoH;

                var exp = document.createElement('canvas');
                exp.width = ew * scale;
                exp.height = eh * scale;
                var ec = exp.getContext('2d');
                ec.setTransform(scale, 0, 0, scale, 0, 0);

                // 白色背景
                ec.fillStyle = '#fff';
                ec.fillRect(0, 0, ew, eh);

                // 棋盘格
                for (var dr = 0; dr < bh; dr++) {
                    for (var dc = 0; dc < bw; dc++) {
                        ec.fillStyle = (dr + dc) % 2 === 0 ? '#fdfdfd' : '#f5f2f0';
                        ec.fillRect(rs + dc * cs, rs + dr * cs, cs, cs);
                    }
                }

                // 色块
                for (var dr2 = 0; dr2 < bh; dr2++) {
                    for (var dc2 = 0; dc2 < bw; dc2++) {
                        var ci2 = S.grid[startR + dr2][startC + dc2];
                        if (ci2 === null) continue;
                        var color = PALETTE[ci2];
                        if (!color) continue;
                        ec.fillStyle = color.hex;
                        ec.fillRect(rs + dc2 * cs, rs + dr2 * cs, cs, cs);
                    }
                }

                // 网格线
                if (S.showGrid) {
                    for (var gr = 0; gr <= bh; gr++) {
                        var major = (startR + gr) % 5 === 0;
                        ec.strokeStyle = major ? 'rgba(141,123,170,0.45)' : 'rgba(200,190,200,0.3)';
                        ec.lineWidth = major ? 1.2 : 0.5;
                        ec.beginPath();
                        ec.moveTo(rs, rs + gr * cs);
                        ec.lineTo(rs + bw * cs, rs + gr * cs);
                        ec.stroke();
                    }
                    for (var gc = 0; gc <= bw; gc++) {
                        var major2 = (startC + gc) % 5 === 0;
                        ec.strokeStyle = major2 ? 'rgba(141,123,170,0.45)' : 'rgba(200,190,200,0.3)';
                        ec.lineWidth = major2 ? 1.2 : 0.5;
                        ec.beginPath();
                        ec.moveTo(rs + gc * cs, rs);
                        ec.lineTo(rs + gc * cs, rs + bh * cs);
                        ec.stroke();
                    }
                }

                // 色号数字
                if (S.showNumbers) {
                    ec.textAlign = 'center';
                    ec.textBaseline = 'middle';
                    var fontSize = Math.max(6, Math.min(cs * 0.48, 11));
                    ec.font = 'bold ' + fontSize + 'px -apple-system, sans-serif';
                    for (var nr = 0; nr < bh; nr++) {
                        for (var nc = 0; nc < bw; nc++) {
                            var nci = S.grid[startR + nr][startC + nc];
                            if (nci === null) continue;
                            var ncolor = PALETTE[nci];
                            var lum = luminance(ncolor.hex);
                            ec.fillStyle = lum > 0.55 ? 'rgba(60,50,55,0.6)' : 'rgba(255,255,255,0.75)';
                            var nlabel = ncolor.id.length > 3 ? ncolor.id.slice(-2) : ncolor.id;
                            ec.fillText(nlabel, rs + nc * cs + cs / 2, rs + nr * cs + cs / 2);
                        }
                    }
                }

                // 标尺
                if (S.showRuler) {
                    ec.fillStyle = '#f6f1ee';
                    ec.fillRect(0, 0, rs, rs + bh * cs);
                    ec.fillRect(0, 0, rs + bw * cs, rs);

                    ec.textAlign = 'right';
                    ec.textBaseline = 'bottom';
                    for (var rc = 0; rc <= bw; rc++) {
                        var rm = (startC + rc) % 5 === 0;
                        ec.strokeStyle = rm ? '#8d7baa' : '#cdc4d6';
                        ec.lineWidth = rm ? 1.5 : 0.6;
                        ec.beginPath();
                        ec.moveTo(rs + rc * cs, rm ? rs * 0.35 : rs * 0.65);
                        ec.lineTo(rs + rc * cs, rs);
                        ec.stroke();
                        if (rm) {
                            ec.fillStyle = '#8d7baa';
                            ec.font = 'bold 9px -apple-system, sans-serif';
                            ec.fillText(String(startC + rc), rs + rc * cs - 2, rs - 4);
                        } else {
                            ec.fillStyle = '#b8aec4';
                            ec.font = '7px -apple-system, sans-serif';
                            ec.fillText(String(startC + rc), rs + rc * cs - 2, rs - 4);
                        }
                    }
                    ec.textAlign = 'right';
                    ec.textBaseline = 'alphabetic';
                    for (var rr = 0; rr <= bh; rr++) {
                        var rm2 = (startR + rr) % 5 === 0;
                        ec.strokeStyle = rm2 ? '#8d7baa' : '#cdc4d6';
                        ec.lineWidth = rm2 ? 1.5 : 0.6;
                        ec.beginPath();
                        ec.moveTo(rm2 ? rs * 0.35 : rs * 0.65, rs + rr * cs);
                        ec.lineTo(rs, rs + rr * cs);
                        ec.stroke();
                        if (rm2) {
                            ec.fillStyle = '#8d7baa';
                            ec.font = 'bold 9px -apple-system, sans-serif';
                            ec.fillText(String(startR + rr), rs - 4, rs + rr * cs - 2);
                        } else {
                            ec.fillStyle = '#b8aec4';
                            ec.font = '7px -apple-system, sans-serif';
                            ec.fillText(String(startR + rr), rs - 4, rs + rr * cs - 2);
                        }
                    }
                }

                // 板号标题
                var legendTop = rs + bh * cs;
                ec.fillStyle = '#f9f6f4';
                ec.fillRect(0, legendTop, ew, legendH + logoH);
                ec.strokeStyle = '#e6e0de';
                ec.lineWidth = 1;
                ec.beginPath();
                ec.moveTo(0, legendTop);
                ec.lineTo(ew, legendTop);
                ec.stroke();

                ec.fillStyle = '#8d7baa';
                ec.font = 'bold 10px -apple-system, sans-serif';
                ec.textAlign = 'left';
                ec.textBaseline = 'top';
                ec.fillText('板 ' + label + '  |  行' + startR + '-' + (startR + bh - 1) + ' 列' + startC + '-' + (startC + bw - 1) + '  |  ' + total + '颗 ' + usedColors.length + '色', legendPadding, legendTop + 6);

                // 色号列表
                var sY = legendTop + legendTitleH;
                usedColors.forEach(function (item, i) {
                    var col = i % legendCols2;
                    var row = Math.floor(i / legendCols2);
                    var x = legendPadding + col * legendColW;
                    var y = sY + row * legendRowH;
                    var cc = PALETTE[item.idx];
                    ec.fillStyle = cc.hex;
                    ec.fillRect(x, y + 1, 12, 12);
                    ec.strokeStyle = '#ddd';
                    ec.lineWidth = 0.5;
                    ec.strokeRect(x, y + 1, 12, 12);
                    ec.fillStyle = '#3e3640';
                    ec.font = 'bold 9px -apple-system, sans-serif';
                    ec.textAlign = 'left';
                    ec.textBaseline = 'middle';
                    ec.fillText(cc.id, x + 15, y + 7);
                    ec.fillStyle = '#8d7baa';
                    ec.font = 'bold 9px -apple-system, sans-serif';
                    ec.textAlign = 'right';
                    ec.fillText(item.count + '颗', x + legendColW - 4, y + 7);
                    ec.textAlign = 'left';
                });

                // 底部小字
                ec.fillStyle = '#a69caa';
                ec.font = '7px -apple-system, sans-serif';
                ec.textAlign = 'center';
                ec.textBaseline = 'bottom';
                ec.fillText('Cat Peas · 板' + label + ' · ' + S.gridW + 'x' + S.gridH + ' 分板' + boardSize, ew / 2, eh - 4);

                // 下载（使用 toBlob）
                (function (expCanvas, downloadName) {
                    if (expCanvas.toBlob) {
                        expCanvas.toBlob(function (blob) {
                            if (!blob) return;
                            var url = URL.createObjectURL(blob);
                            var a = document.createElement('a');
                            a.download = downloadName;
                            a.href = url;
                            a.click();
                            setTimeout(function () { URL.revokeObjectURL(url); }, 5000);
                        }, 'image/png');
                    } else {
                        var a = document.createElement('a');
                        a.download = downloadName;
                        a.href = expCanvas.toDataURL('image/png');
                        a.click();
                    }
                })(exp, 'CatPeas_分板' + label + '_' + boardSize + 'x' + boardSize + '_' + ts + '.png');
            }
        }

        alert('已导出 ' + totalBoards + ' 块分板图纸！');
    }

    // ===========================
    //  Project Library 项目库功能
    // ===========================
    var _projectCategories = [{ id: 'default', name: '默认分类' }];
    var _selectedProjectIds = new Set();

    function generateProjectId() {
        return 'proj_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 6);
    }

    function generateThumbnail(grid, gridW, gridH, paletteSnapshot) {
        try {
            if (!grid || gridW <= 0 || gridH <= 0) return '';

            var tw = 200;
            var th = 200;
            if (gridW > gridH) {
                th = Math.round(200 * gridH / gridW);
            } else if (gridH > gridW) {
                tw = Math.round(200 * gridW / gridH);
            }
            if (tw < 10) tw = 10;
            if (th < 10) th = 10;

            var tmp = document.createElement('canvas');
            tmp.width = tw;
            tmp.height = th;
            var tc = tmp.getContext('2d');

            tc.fillStyle = '#ffffff';
            tc.fillRect(0, 0, tw, th);

            var hasContent = false;

            // 构建一个可靠的颜色查找函数
            function getHex(ci) {
                // 优先从快照中查找
                if (paletteSnapshot && ci < paletteSnapshot.length && paletteSnapshot[ci]) {
                    var entry = paletteSnapshot[ci];
                    if (typeof entry === 'string') return entry;
                    if (entry.hex) return entry.hex;
                }
                // 回退到全局色板
                if (PALETTE && ci < PALETTE.length && PALETTE[ci]) {
                    if (typeof PALETTE[ci] === 'string') return PALETTE[ci];
                    if (PALETTE[ci].hex) return PALETTE[ci].hex;
                }
                return '';
            }

            for (var r = 0; r < gridH; r++) {
                var row = grid[r];
                if (!row) continue;
                for (var c = 0; c < gridW; c++) {
                    var ci = row[c];
                    if (ci === null || ci === undefined || ci < 0) continue;

                    var hex = getHex(ci);
                    if (!hex) continue;

                    var x1 = Math.floor(c * tw / gridW);
                    var y1 = Math.floor(r * th / gridH);
                    var x2 = Math.floor((c + 1) * tw / gridW);
                    var y2 = Math.floor((r + 1) * th / gridH);
                    var w = x2 - x1;
                    var h = y2 - y1;
                    if (w < 1) w = 1;
                    if (h < 1) h = 1;

                    tc.fillStyle = hex;
                    tc.fillRect(x1, y1, w, h);
                    hasContent = true;
                }
            }

            if (!hasContent) return '';
            return tmp.toDataURL('image/png');
        } catch (e) {
            console.warn('生成缩略图异常:', e);
            return '';
        }
    }

    async function saveProject() {
        var name = $('projectName').value.trim();
        if (!name) {
            cdAlert('请输入项目名称', { type: 'warn', title: '保存项目' });
            return;
        }
        var category = $('projectCategory').value || 'default';
        var now = Date.now();

        // 统计用色
        var total = 0;
        for (var r = 0; r < S.gridH; r++) {
            for (var c = 0; c < S.gridW; c++) {
                if (S.grid[r][c] !== null) total++;
            }
        }

        if (total === 0) {
            cdAlert('画布为空，请先绘制内容再保存', { type: 'warn', title: '保存项目' });
            return;
        }

        var thumbnail = generateThumbnail(S.grid, S.gridW, S.gridH, null);

        // 用紧凑格式存储 grid，减小 IndexedDB 存储体积
        var gridData = [];
        for (var r2 = 0; r2 < S.gridH; r2++) {
            gridData[r2] = Array.from(S.grid[r2]);
        }

        // 判断是覆盖保存还是新建
        var isOverwrite = false;
        var projectId;
        var createdAt = now;

        if (S.currentProjectId) {
            // 当前是从项目库加载的，询问用户
            var choice = await cdConfirm(
                '当前画布来自项目"' + S.currentProjectName + '"。\n\n确定 → 覆盖保存到原项目\n取消 → 另存为新项目',
                { title: '保存方式', okText: '覆盖保存', cancelText: '另存为新的' }
            );
            if (choice) {
                isOverwrite = true;
                projectId = S.currentProjectId;
            }
        }

        if (!isOverwrite) {
            projectId = generateProjectId();
        }

        if (isOverwrite) {
            // 覆盖模式：先获取原项目的 createdAt
            dbGet(STORE_PROJECTS, projectId).then(function (oldProj) {
                if (oldProj) {
                    createdAt = oldProj.createdAt || now;
                }
                doSave(projectId, name, category, gridData, thumbnail, total, createdAt, now, isOverwrite);
            }).catch(function () {
                doSave(projectId, name, category, gridData, thumbnail, total, now, now, isOverwrite);
            });
        } else {
            doSave(projectId, name, category, gridData, thumbnail, total, now, now, false);
        }
    }

    function doSave(projectId, name, category, gridData, thumbnail, total, createdAt, now, isOverwrite) {
        // 使用传入的 gridData（而非 S.grid）来生成缩略图，确保数据一致
        thumbnail = generateThumbnail(gridData, S.gridW, S.gridH, null);

        // 保存色板快照
        var palSnap = [];
        for (var i = 0; i < PALETTE.length; i++) {
            if (PALETTE[i]) {
                palSnap.push({ id: PALETTE[i].id, name: PALETTE[i].name, hex: PALETTE[i].hex });
            } else {
                palSnap.push(null);
            }
        }

        var projectData = {
            id: projectId,
            name: name,
            category: category,
            gridW: S.gridW,
            gridH: S.gridH,
            grid: gridData,
            thumbnail: thumbnail,
            totalBeads: total,
            createdAt: createdAt,
            updatedAt: now,
            paletteSnapshot: palSnap
        };

        dbPut(STORE_PROJECTS, projectData).then(function () {
            S.currentProjectId = projectId;
            S.currentProjectName = name;

            if (isOverwrite) {
                showToast('已覆盖保存到项目"' + name + '"', 'success');
            } else {
                showToast('已另存为新项目"' + name + '"', 'success');
            }
            $('projectName').value = name;
            if ($('projectPage').classList.contains('active')) {
                triggerProjectRefresh();
            }
        }).catch(function (err) {
            alert('保存失败：' + err.message);
        });
    }


    function loadProject(projectId) {
        dbGet(STORE_PROJECTS, projectId).then(function (proj) {
            if (!proj) { alert('项目不存在'); return; }
            if (!confirm('加载项目"' + proj.name + '"将覆盖当前画布，确定吗？')) return;

            S.gridW = proj.gridW;
            S.gridH = proj.gridH;
            S.grid = proj.grid.map(function (row) { return Array.from(row); });
            $('canvasWidth').value = S.gridW;
            $('canvasHeight').value = S.gridH;

            // 记住当前项目的 ID 和名称，方便覆盖保存
            S.currentProjectId = proj.id;
            S.currentProjectName = proj.name;
            $('projectName').value = proj.name;
            if ($('projectCategory')) {
                $('projectCategory').value = proj.category || 'default';
            }

            // 如果项目保存了色板快照且当前色板长度不同，提示用户
            if (proj.paletteSnapshot && proj.paletteSnapshot.length !== PALETTE.length) {
                var mismatch = false;
                for (var r = 0; r < S.gridH; r++) {
                    for (var c = 0; c < S.gridW; c++) {
                        if (S.grid[r][c] !== null && S.grid[r][c] >= PALETTE.length) {
                            mismatch = true;
                            S.grid[r][c] = null;
                        }
                    }
                }
                if (mismatch) {
                    alert('提示：该项目使用的色板与当前色板不同，部分超出范围的颜色已被清空。建议先导入对应的自定义色板。');
                }
            }

            pushHistory();
            setupCanvas();
            render();

            // 关闭项目库页面
            closeProjectPage();
        }).catch(function (err) {
            alert('加载失败：' + err.message);
        });
    }

    async function deleteProjects(ids) {
        if (ids.length === 0) return;
        var ok = await cdConfirm('确定删除选中的 ' + ids.length + ' 个项目吗？此操作不可恢复。', { title: '删除项目', danger: true, okText: '确认删除' });
        if (!ok) return;
        dbDeleteMultiple(STORE_PROJECTS, ids).then(function () {
            _selectedProjectIds.clear();
            triggerProjectRefresh();
        }).catch(function (err) {
            alert('删除失败：' + err.message);
        });
    }

    // ===========================
    //  分类管理弹窗
    // ===========================
    function manageCategoriesDialog() {
        loadProjectCategories().then(async function () {
            if (_projectCategories.length <= 1) {
                alert('当前只有默认分类，请先新建分类');
                return;
            }

            var lines = ['当前分类列表：\n'];
            _projectCategories.forEach(function (cat, i) {
                lines.push((i + 1) + '. ' + cat.name + (cat.id === 'default' ? '（默认，不可删除）' : ''));
            });
            lines.push('\n请选择操作：');
            lines.push('输入 "删除 序号" 删除分类（如：删除 3）');
            lines.push('输入 "重命名 序号 新名称" 重命名（如：重命名 2 我的收藏）');
            lines.push('输入 "取消" 或留空退出');

            var input = await cdPrompt(lines.join('\n'), { title: '分类管理', placeholder: '如：删除 3 或 重命名 2 新名称' });
            if (!input || !input.trim()) return;
            input = input.trim();

            // 解析删除命令
            var deleteMatch = input.match(/^删除\s*(\d+)$/);
            if (deleteMatch) {
                var delIdx = parseInt(deleteMatch[1]) - 1;
                if (delIdx < 0 || delIdx >= _projectCategories.length) {
                    alert('序号不存在');
                    return;
                }
                var delCat = _projectCategories[delIdx];
                if (delCat.id === 'default') {
                    alert('默认分类不可删除');
                    return;
                }

                // 检查该分类下是否有项目
                dbGetAll(STORE_PROJECTS).then(async function (projects) {
                    var catProjects = projects.filter(function (p) {
                        return p.category === delCat.id;
                    });

                    var msg = '确定删除分类「' + delCat.name + '」吗？';
                    if (catProjects.length > 0) {
                        msg += '\n\n该分类下有 ' + catProjects.length + ' 个项目，删除分类后这些项目将被移到「默认分类」。';
                    }

                    var delOk = await cdConfirm(msg, { title: '删除分类', danger: true, okText: '删除' });
                    if (!delOk) return;

                    // 将该分类下的项目移到默认分类
                    var movePromises = [];
                    catProjects.forEach(function (proj) {
                        proj.category = 'default';
                        movePromises.push(dbPut(STORE_PROJECTS, proj));
                    });

                    Promise.all(movePromises).then(function () {
                        // 删除分类
                        return dbDelete(STORE_CATEGORIES, delCat.id);
                    }).then(function () {
                        // 从内存中移除
                        _projectCategories = _projectCategories.filter(function (c) {
                            return c.id !== delCat.id;
                        });
                        updateProjectCategoryUI();
                        alert('分类「' + delCat.name + '」已删除' +
                            (catProjects.length > 0 ? '，' + catProjects.length + ' 个项目已移至默认分类' : ''));

                        // 如果项目库页面是打开的，刷新列表
                        if ($('projectPage').classList.contains('active')) {
                            triggerProjectRefresh();
                        }
                    }).catch(function (err) {
                        alert('删除失败：' + err.message);
                    });
                });
                return;
            }

            // 解析重命名命令
            var renameMatch = input.match(/^重命名\s*(\d+)\s+(.+)$/);
            if (renameMatch) {
                var renIdx = parseInt(renameMatch[1]) - 1;
                var newName = renameMatch[2].trim();
                if (renIdx < 0 || renIdx >= _projectCategories.length) {
                    alert('序号不存在');
                    return;
                }
                if (!newName) {
                    alert('名称不能为空');
                    return;
                }
                var renCat = _projectCategories[renIdx];
                if (renCat.id === 'default') {
                    alert('默认分类不可重命名');
                    return;
                }

                renCat.name = newName;
                dbPut(STORE_CATEGORIES, renCat).then(function () {
                    updateProjectCategoryUI();
                    alert('分类已重命名为「' + newName + '」');
                    if ($('projectPage').classList.contains('active')) {
                        triggerProjectRefresh();
                    }
                }).catch(function (err) {
                    alert('重命名失败：' + err.message);
                });
                return;
            }

            if (input !== '取消') {
                alert('无法识别的命令。\n\n正确格式：\n  删除 序号\n  重命名 序号 新名称');
            }
        });
    }

    function loadProjectCategories() {
        return dbGetAll(STORE_CATEGORIES).then(function (cats) {
            _projectCategories = [{ id: 'default', name: '默认分类' }];
            cats.forEach(function (c) {
                if (c.id !== 'default') {
                    _projectCategories.push(c);
                }
            });
            updateProjectCategoryUI();
        });
    }

    function updateProjectCategoryUI() {
        // 保存面板的分类下拉
        var sel = $('projectCategory');
        if (sel) {
            var current = sel.value;
            sel.innerHTML = '';
            _projectCategories.forEach(function (cat) {
                var opt = document.createElement('option');
                opt.value = cat.id;
                opt.textContent = cat.name;
                sel.appendChild(opt);
            });
            if (current && Array.from(sel.options).some(function (o) { return o.value === current; })) {
                sel.value = current;
            }
        }

        // 项目库页面筛选下拉
        updateProjectPageFilters();
    }

    function refreshProjectList(filterCategory, searchKeyword, sortBy) {
        dbGetAll(STORE_PROJECTS).then(function (projects) {
            // 分类筛选
            if (filterCategory && filterCategory !== '__all__') {
                projects = projects.filter(function (p) {
                    return p.category === filterCategory;
                });
            }

            // 搜索筛选
            if (searchKeyword && searchKeyword.trim()) {
                var kw = searchKeyword.trim().toLowerCase();
                projects = projects.filter(function (p) {
                    return p.name.toLowerCase().indexOf(kw) !== -1;
                });
            }

            // 排序
            sortBy = sortBy || 'updatedAt_desc';
            var parts = sortBy.split('_');
            var field = parts[0];
            var dir = parts[1] === 'asc' ? 1 : -1;
            projects.sort(function (a, b) {
                var va = a[field] || '';
                var vb = b[field] || '';
                if (typeof va === 'string') {
                    return va.localeCompare(vb) * dir;
                }
                return ((va > vb ? 1 : va < vb ? -1 : 0)) * dir;
            });

            // 更新计数
            var countEl = $('projectPageCount');
            if (countEl) countEl.textContent = projects.length + ' 个项目';

            var grid = $('projectGrid');
            grid.innerHTML = '';

            if (projects.length === 0) {
                grid.innerHTML = '<div class="project-empty">暂无匹配的项目</div>';
                return;
            }

            projects.forEach(function (proj) {
                var card = document.createElement('div');
                card.className = 'project-card' + (_selectedProjectIds.has(proj.id) ? ' selected' : '');
                card.dataset.id = proj.id;

                var catName = '默认分类';
                _projectCategories.forEach(function (c) {
                    if (c.id === proj.category) catName = c.name;
                });

                var dateStr = new Date(proj.updatedAt).toLocaleString('zh-CN', {
                    year: 'numeric',
                    month: '2-digit',
                    day: '2-digit',
                    hour: '2-digit',
                    minute: '2-digit'
                });

                var thumbHtml;
                var hasThumb = proj.thumbnail && proj.thumbnail.length > 100 && proj.thumbnail.indexOf('data:') === 0;
                if (!hasThumb) {
                    // 尝试即时生成缩略图
                    try {
                        var freshThumb = generateThumbnail(proj.grid, proj.gridW, proj.gridH, proj.paletteSnapshot);
                        if (!freshThumb || freshThumb.length < 100) {
                            freshThumb = generateThumbnail(proj.grid, proj.gridW, proj.gridH, null);
                        }
                        if (freshThumb && freshThumb.length > 100) {
                            proj.thumbnail = freshThumb;
                            hasThumb = true;
                            dbPut(STORE_PROJECTS, proj).catch(function () {});
                        }
                    } catch (e) {
                        // 忽略
                    }
                }
                if (hasThumb) {
                    thumbHtml = '<img src="' + proj.thumbnail + '" alt="预览" loading="lazy">' +
                        '<div class="preview-placeholder" style="display:none;">加载失败</div>';
                } else {
                    thumbHtml = '<div class="preview-placeholder">无预览</div>';
                }
                card.innerHTML =
                    '<div class="project-card-preview-wrap">' +
                        thumbHtml +
                    '</div>' +
                    '<div class="project-card-body">' +
                        '<div class="project-card-name" title="' + escapeHtml(proj.name) + '">' + escapeHtml(proj.name) + '</div>' +
                        '<div class="project-card-meta">' +
                            '<span>' + proj.gridW + '×' + proj.gridH + '</span>' +
                            '<span>' + (proj.totalBeads || 0) + '颗</span>' +
                            '<span>' + dateStr + '</span>' +
                        '</div>' +
                    '</div>' +
                    '<div class="project-card-footer">' +
                        '<span class="project-card-category">' + escapeHtml(catName) + '</span>' +
                        '<div class="project-card-actions">' +
                            '<button class="project-card-btn btn-thumb-upload" title="上传预览图">' +
                                '<svg viewBox="0 0 20 20" width="14" height="14"><path d="M10 3v10M6 7l4-4 4 4M3 14v2a1 1 0 001 1h12a1 1 0 001-1v-2" stroke="currentColor" stroke-width="1.5" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>' +
                            '</button>' +
                            '<button class="project-card-btn btn-rename" title="重命名">' +
                                '<svg viewBox="0 0 20 20" width="14" height="14"><path d="M13.586 3.586a2 2 0 112.828 2.828l-8.486 8.486L4 16l1.1-3.928 8.486-8.486z" stroke="currentColor" stroke-width="1.3" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>' +
                            '</button>' +
                            '<button class="project-card-btn btn-load" title="加载到画布">' +
                                '<svg viewBox="0 0 20 20" width="14" height="14"><path d="M4 16h12M10 4v9M7 10l3 3 3-3" stroke="currentColor" stroke-width="1.5" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>' +
                            '</button>' +
                            '<button class="project-card-btn btn-del" title="删除">' +
                                '<svg viewBox="0 0 20 20" width="14" height="14"><path d="M6 4V3a1 1 0 011-1h6a1 1 0 011 1v1M3 4h14M5 4v12a2 2 0 002 2h6a2 2 0 002-2V4" stroke="currentColor" stroke-width="1.3" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>' +
                            '</button>' +
                        '</div>' +
                    '</div>';

                // 整张卡片点击 = 选中/取消选中
                card.addEventListener('click', function (e) {
                    // 如果点到了按钮，不触发选中
                    if (e.target.closest('.project-card-btn')) return;
                    if (_selectedProjectIds.has(proj.id)) {
                        _selectedProjectIds.delete(proj.id);
                        card.classList.remove('selected');
                    } else {
                        _selectedProjectIds.add(proj.id);
                        card.classList.add('selected');
                    }
                });

                // 上传预览图
                card.querySelector('.btn-thumb-upload').addEventListener('click', function (e) {
                    e.stopPropagation();
                    var fileInput = document.createElement('input');
                    fileInput.type = 'file';
                    fileInput.accept = 'image/*';
                    fileInput.style.display = 'none';
                    document.body.appendChild(fileInput);
                    fileInput.addEventListener('change', function () {
                        var file = fileInput.files[0];
                        if (!file) { document.body.removeChild(fileInput); return; }
                        var reader = new FileReader();
                        reader.onload = function (ev) {
                            var img2 = new Image();
                            img2.onload = function () {
                                var maxSz = 200;
                                var tw2 = img2.width;
                                var th2 = img2.height;
                                if (tw2 > maxSz || th2 > maxSz) {
                                    var ratio2 = Math.min(maxSz / tw2, maxSz / th2);
                                    tw2 = Math.round(tw2 * ratio2);
                                    th2 = Math.round(th2 * ratio2);
                                }
                                var tmpC = document.createElement('canvas');
                                tmpC.width = tw2;
                                tmpC.height = th2;
                                var tmpX = tmpC.getContext('2d');
                                tmpX.drawImage(img2, 0, 0, tw2, th2);
                                var dataUrl = tmpC.toDataURL('image/png');
                                dbGet(STORE_PROJECTS, proj.id).then(function (pd) {
                                    if (pd) {
                                        pd.thumbnail = dataUrl;
                                        dbPut(STORE_PROJECTS, pd).then(function () {
                                            triggerProjectRefresh();
                                        });
                                    }
                                });
                            };
                            img2.src = ev.target.result;
                        };
                        reader.readAsDataURL(file);
                        document.body.removeChild(fileInput);
                    });
                    fileInput.click();
                });

                // 重命名
                card.querySelector('.btn-rename').addEventListener('click', function (e) {
                    e.stopPropagation();
                    cdPrompt('', { title: '重命名项目', defaultValue: proj.name, placeholder: '输入新的项目名称' }).then(function (newName) {
                        if (newName === null || !newName.trim()) return;
                        newName = newName.trim();
                        dbGet(STORE_PROJECTS, proj.id).then(function (pd) {
                            if (pd) {
                                pd.name = newName;
                                pd.updatedAt = Date.now();
                                dbPut(STORE_PROJECTS, pd).then(function () {
                                    if (S.currentProjectId === proj.id) {
                                        S.currentProjectName = newName;
                                        $('projectName').value = newName;
                                    }
                                    triggerProjectRefresh();
                                });
                            }
                        });
                    });
                });

                // 加载
                card.querySelector('.btn-load').addEventListener('click', function (e) {
                    e.stopPropagation();
                    loadProject(proj.id);
                });

                // 删除
                card.querySelector('.btn-del').addEventListener('click', function (e) {
                    e.stopPropagation();
                    deleteProjects([proj.id]);
                });

                // 双击加载
                card.addEventListener('dblclick', function () {
                    loadProject(proj.id);
                });

                grid.appendChild(card);
            });
        }).catch(function (err) {
            var grid = $('projectGrid');
            if (grid) grid.innerHTML = '<div class="project-empty">加载失败：' + err.message + '</div>';
        });
    }

    function openProjectPage() {
        loadProjectCategories().then(function () {
            _selectedProjectIds.clear();
            updateProjectPageFilters();
            $('projectPage').classList.add('active');
            // 确保页面显示后再加载卡片
            setTimeout(function () {
                // 先修复缺失缩略图的项目
                fixMissingThumbnails().then(function () {
                    triggerProjectRefresh();
                });
            }, 50);
        });
    }

    function fixMissingThumbnails() {
        return dbGetAll(STORE_PROJECTS).then(function (projects) {
            var promises = [];
            projects.forEach(function (proj) {
                try {
                    // 检查缩略图是否缺失或无效
                    var needFix = !proj.thumbnail || proj.thumbnail.length < 100 || proj.thumbnail === 'data:,';

                    if (needFix) {
                        var thumb = generateThumbnail(proj.grid, proj.gridW, proj.gridH, proj.paletteSnapshot);
                        if (!thumb || thumb.length < 100) {
                            thumb = generateThumbnail(proj.grid, proj.gridW, proj.gridH, null);
                        }
                        if (thumb && thumb.length > 100) {
                            proj.thumbnail = thumb;
                            promises.push(dbPut(STORE_PROJECTS, proj));
                        }
                    }
                } catch (e) {
                    console.warn('修复缩略图失败:', proj.id, e);
                }
            });
            if (promises.length > 0) {
                return Promise.all(promises);
            }
            return Promise.resolve();
        });
    }

    function closeProjectPage() {
        $('projectPage').classList.remove('active');
    }

    function updateProjectPageFilters() {
        var filter = $('projectFilterCategory2');
        if (filter) {
            var currentFilter = filter.value;
            filter.innerHTML = '<option value="__all__">全部分类</option>';
            _projectCategories.forEach(function (cat) {
                var opt = document.createElement('option');
                opt.value = cat.id;
                opt.textContent = cat.name;
                filter.appendChild(opt);
            });
            if (currentFilter) filter.value = currentFilter;
        }
    }

    function triggerProjectRefresh() {
        var filterEl = $('projectFilterCategory2');
        var searchEl = $('projectSearchInput');
        var sortEl = $('projectSortSelect');
        var filterVal = filterEl ? filterEl.value : '__all__';
        var searchVal = searchEl ? searchEl.value : '';
        var sortVal = sortEl ? sortEl.value : 'updatedAt_desc';
        refreshProjectList(filterVal, searchVal, sortVal);
    }

    function exportProjectJSON() {
        // 导出当前画布为 JSON（不经过项目库）
        var name = $('projectName').value.trim() || '未命名项目';
        var data = {
            format: 'catpeas_project',
            version: 1,
            name: name,
            gridW: S.gridW,
            gridH: S.gridH,
            grid: S.grid,
            palette: PALETTE.map(function (c) {
                return { id: c.id, name: c.name, hex: c.hex };
            }),
            customColors: CUSTOM_COLORS,
            customGroups: CUSTOM_GROUPS,
            exportedAt: new Date().toISOString()
        };
        var blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        var link = document.createElement('a');
        link.download = 'CatPeas_' + name + '_' + new Date().toISOString().slice(0, 10) + '.json';
        link.href = URL.createObjectURL(blob);
        link.click();
    }

    function importProjectJSON(file) {
        var reader = new FileReader();
        reader.onload = function (e) {
            try {
                var data = JSON.parse(e.target.result);
                if (data.format !== 'catpeas_project' || !data.grid) {
                    alert('文件格式不正确，请选择 Cat Peas 项目文件');
                    return;
                }
                if (!confirm('导入项目"' + (data.name || '未命名') + '"将覆盖当前画布，确定吗？')) return;

                // 恢复自定义色板（如果有）
                if (data.customColors && data.customColors.length > 0) {
                    var importColors = confirm('该项目包含 ' + data.customColors.length + ' 个自定义颜色，是否同时导入？');
                    if (importColors) {
                        data.customColors.forEach(function (c) {
                            if (!CUSTOM_COLORS.some(function (cc) { return cc.id === c.id; })) {
                                CUSTOM_COLORS.push(c);
                            }
                        });
                        if (data.customGroups) {
                            data.customGroups.forEach(function (g) {
                                if (!CUSTOM_GROUPS.some(function (cg) { return cg.id === g.id; })) {
                                    CUSTOM_GROUPS.push(g);
                                }
                            });
                        }
                        rebuildPalette();
                        saveCustomColors();
                        buildPalette();
                    }
                }

                S.gridW = data.gridW;
                S.gridH = data.gridH;
                S.grid = data.grid.map(function (row) { return Array.from(row); });
                $('canvasWidth').value = S.gridW;
                $('canvasHeight').value = S.gridH;

                pushHistory();
                setupCanvas();
                render();
                alert('导入成功！');
            } catch (err) {
                alert('导入失败：' + err.message);
            }
        };
        reader.readAsText(file);
    }

    function exportAllProjects() {
        dbGetAll(STORE_PROJECTS).then(function (projects) {
            if (projects.length === 0) {
                alert('项目库为空，没有可导出的项目');
                return;
            }

            // 去掉缩略图以减小体积
            var exportData = {
                format: 'catpeas_project_library',
                version: 1,
                categories: _projectCategories,
                projects: projects.map(function (p) {
                    var copy = Object.assign({}, p);
                    delete copy.thumbnail;  // 缩略图太大，不导出
                    return copy;
                }),
                exportedAt: new Date().toISOString()
            };

            var blob = new Blob([JSON.stringify(exportData)], { type: 'application/json' });
            var link = document.createElement('a');
            link.download = 'CatPeas_项目库备份_' + new Date().toISOString().slice(0, 10) + '.json';
            link.href = URL.createObjectURL(blob);
            link.click();
        }).catch(function (err) {
            alert('导出失败：' + err.message);
        });
    }

    // ===========================
    //  PNG 嵌入数据编解码
    // ===========================
    function encodeGridData() {
        // 将画布数据压缩编码为字符串
        var data = {
            v: 1,
            w: S.gridW,
            h: S.gridH,
            g: [],
            p: []
        };

        // RLE 压缩 grid 数据
        var flat = [];
        for (var r = 0; r < S.gridH; r++) {
            for (var c = 0; c < S.gridW; c++) {
                var ci = S.grid[r][c];
                flat.push(ci === null ? -1 : ci);
            }
        }

        // 简单 RLE
        var rle = [];
        var i = 0;
        while (i < flat.length) {
            var val = flat[i];
            var count = 1;
            while (i + count < flat.length && flat[i + count] === val && count < 255) {
                count++;
            }
            rle.push(count);
            rle.push(val + 1); // +1 让 -1 变 0, 0 变 1
            i += count;
        }
        data.g = rle;

        // 只保存用到的颜色
        var usedSet = new Set();
        for (var r2 = 0; r2 < S.gridH; r2++) {
            for (var c2 = 0; c2 < S.gridW; c2++) {
                if (S.grid[r2][c2] !== null) usedSet.add(S.grid[r2][c2]);
            }
        }
        usedSet.forEach(function (ci) {
            if (PALETTE[ci]) {
                data.p.push([ci, PALETTE[ci].id, PALETTE[ci].hex]);
            }
        });

        return JSON.stringify(data);
    }

    function encodeDataToPixels(canvas, dataStr, yOffset) {
        var canvasW = canvas.width;
        var canvasH = canvas.height;
        var bytes = [];

        // 魔术字节
        var magic = 'CATPEAS';
        for (var m = 0; m < magic.length; m++) {
            bytes.push(magic.charCodeAt(m));
        }

        // 用 Base64 编码数据（比 encodeURIComponent 更紧凑）
        var encoded = btoa(unescape(encodeURIComponent(dataStr)));
        var len = encoded.length;

        // 写入长度（4字节大端）
        bytes.push((len >> 24) & 0xFF);
        bytes.push((len >> 16) & 0xFF);
        bytes.push((len >> 8) & 0xFF);
        bytes.push(len & 0xFF);

        // 写入编码标记（1字节，'B' 表示 Base64）
        bytes.push(66); // 'B'

        // 写入数据
        for (var d = 0; d < encoded.length; d++) {
            bytes.push(encoded.charCodeAt(d));
        }

        var pixelCount = Math.ceil(bytes.length / 3);
        var maxPixelsPerRow = canvasW;
        var rowsNeeded = Math.ceil(pixelCount / maxPixelsPerRow);

        var scale = 2;
        var startPixelY = Math.floor(yOffset * scale);

        if (startPixelY + rowsNeeded > canvasH) {
            startPixelY = canvasH - rowsNeeded;
        }
        if (startPixelY < 0) startPixelY = canvasH - 1;

        var ec = canvas.getContext('2d');
        var byteIdx = 0;

        for (var row = 0; row < rowsNeeded; row++) {
            var py = startPixelY + row;
            if (py >= canvasH) break;

            var rowPixels = Math.min(maxPixelsPerRow, pixelCount - row * maxPixelsPerRow);
            var imgData = ec.createImageData(rowPixels, 1);

            for (var p = 0; p < rowPixels; p++) {
                var r = byteIdx < bytes.length ? bytes[byteIdx++] : 0;
                var g = byteIdx < bytes.length ? bytes[byteIdx++] : 0;
                var b = byteIdx < bytes.length ? bytes[byteIdx++] : 0;
                imgData.data[p * 4] = r;
                imgData.data[p * 4 + 1] = g;
                imgData.data[p * 4 + 2] = b;
                imgData.data[p * 4 + 3] = 255;
            }

            ec.putImageData(imgData, 0, py);
        }

        return pixelCount;
    }


    function decodeDataFromImage(img) {
        // 从图片底部读取编码数据
        var tmp = document.createElement('canvas');
        tmp.width = img.naturalWidth;
        tmp.height = img.naturalHeight;
        var tc = tmp.getContext('2d');
        tc.drawImage(img, 0, 0);

        // 从倒数几行扫描寻找魔术字节
        var magic = 'CATPEAS';
        var magicBytes = [];
        for (var m = 0; m < magic.length; m++) {
            magicBytes.push(magic.charCodeAt(m));
        }

        // 扫描底部30行
        for (var scanY = img.naturalHeight - 1; scanY >= Math.max(0, img.naturalHeight - 30); scanY--) {
            // 先读前20个像素检查魔术字节
            var previewWidth = Math.min(img.naturalWidth, 20);
            var previewData = tc.getImageData(0, scanY, previewWidth, 1).data;

            // 提取字节（每像素3字节 RGB，跳过 Alpha）
            var previewBytes = [];
            for (var px = 0; px < previewWidth; px++) {
                previewBytes.push(previewData[px * 4]);     // R
                previewBytes.push(previewData[px * 4 + 1]); // G
                previewBytes.push(previewData[px * 4 + 2]); // B
            }

            // 检查魔术字节
            var found = true;
            for (var mi = 0; mi < magicBytes.length; mi++) {
                if (previewBytes[mi] !== magicBytes[mi]) {
                    found = false;
                    break;
                }
            }

            if (!found) continue;

            // 读取长度
            var offset = magic.length;
            var dataLen = (previewBytes[offset] << 24) |
                          (previewBytes[offset + 1] << 16) |
                          (previewBytes[offset + 2] << 8) |
                          previewBytes[offset + 3];
            offset += 4;

            if (dataLen <= 0 || dataLen > 500000) continue;

            // 计算需要多少像素
            var totalBytesNeeded = offset + dataLen;
            var totalPixelsNeeded = Math.ceil(totalBytesNeeded / 3);

            // 可能需要多行
            var rowsNeeded = Math.ceil(totalPixelsNeeded / img.naturalWidth);
            var allBytes = [];

            for (var rowIdx = 0; rowIdx < rowsNeeded; rowIdx++) {
                var readY = scanY + rowIdx;
                if (readY >= img.naturalHeight) break;
                var pixelsInRow = Math.min(img.naturalWidth, totalPixelsNeeded - rowIdx * img.naturalWidth);
                var rowData = tc.getImageData(0, readY, pixelsInRow, 1).data;
                for (var rp = 0; rp < pixelsInRow; rp++) {
                    allBytes.push(rowData[rp * 4]);
                    allBytes.push(rowData[rp * 4 + 1]);
                    allBytes.push(rowData[rp * 4 + 2]);
                }
            }

            // 检查编码类型标记
            var encodingType = allBytes[offset + dataLen] !== undefined ? 0 : 0; // 默认旧格式
            // 读取紧跟长度后面的标记字节
            var markByte = allBytes[magic.length + 4];
            var isBase64 = (markByte === 66); // 'B' = Base64

            var dataStart = offset;
            if (isBase64) {
                dataStart = offset + 1; // 跳过标记字节
                dataLen = dataLen; // 长度不变
            }

            // 提取编码字符串
            var chars = [];
            for (var di = 0; di < dataLen; di++) {
                if (dataStart + di >= allBytes.length) break;
                chars.push(String.fromCharCode(allBytes[dataStart + di]));
            }
            var encodedStr = chars.join('');

            try {
                var jsonStr;
                if (isBase64) {
                    jsonStr = decodeURIComponent(escape(atob(encodedStr)));
                } else {
                    jsonStr = decodeURIComponent(encodedStr);
                }
                var data = JSON.parse(jsonStr);
                if (data.v && data.w && data.h && data.g) {
                    return data;
                }
            } catch (e) {
                continue;
            }
        }

        return null;
    }

    function restoreFromEmbeddedData(data) {
        if (!data || !data.g || !data.w || !data.h) return false;

        // 先检查色板是否匹配，如果需要补充颜色
        if (data.p && data.p.length > 0) {
            data.p.forEach(function (entry) {
                var ci = entry[0];
                var id = entry[1];
                var hex = entry[2];
                // 检查当前色板中是否存在
                if (ci < PALETTE.length && PALETTE[ci].id === id) return;
                // 不存在则尝试在色板中找到同 id 的颜色
                // 如果找不到，暂时忽略
            });
        }

        S.gridW = data.w;
        S.gridH = data.h;

        // RLE 解码
        var flat = [];
        for (var i = 0; i < data.g.length; i += 2) {
            var count = data.g[i];
            var val = data.g[i + 1] - 1; // 还原：0 -> -1 (null), 1 -> 0
            for (var j = 0; j < count; j++) {
                flat.push(val < 0 ? null : val);
            }
        }

        // 重建 grid
        S.grid = [];
        for (var r = 0; r < S.gridH; r++) {
            S.grid[r] = [];
            for (var c = 0; c < S.gridW; c++) {
                var idx = r * S.gridW + c;
                S.grid[r][c] = idx < flat.length ? flat[idx] : null;
            }
        }

        // 验证颜色索引有效性
        for (var r2 = 0; r2 < S.gridH; r2++) {
            for (var c2 = 0; c2 < S.gridW; c2++) {
                if (S.grid[r2][c2] !== null && S.grid[r2][c2] >= PALETTE.length) {
                    S.grid[r2][c2] = null;
                }
            }
        }

        $('canvasWidth').value = S.gridW;
        $('canvasHeight').value = S.gridH;

        pushHistory();
        setupCanvas();
        render();

        return true;
    }

    function escapeHtml(str) {
        var div = document.createElement('div');
        div.appendChild(document.createTextNode(str));
        return div.innerHTML;
    }


    // ===========================
    //  辅助拼豆模式
    // ===========================
    function toggleAssistMode() {
        S.assistMode = !S.assistMode;
        var panel = $('assistPanel');
        var btn = $('assistModeBtn');

        if (S.assistMode) {
            S.assistMiniMode = false;
            $('assistMini').classList.remove('active');
            panel.classList.add('active');
            btn.classList.add('active');
            buildAssistColorGrid();
        } else {
            panel.classList.remove('active');
            $('assistMini').classList.remove('active');
            btn.classList.remove('active');
            S.assistHighlightIdx = -1;
            S.assistMiniMode = false;
            stopAssistTimer();
            renderMain();
        }
    }

    function buildAssistColorGrid() {
        var grid = $('assistColorGrid');
        grid.innerHTML = '';

        // 找出画布上实际使用的颜色
        var usedColors = {};
        for (var r = 0; r < S.gridH; r++) {
            for (var c = 0; c < S.gridW; c++) {
                var ci = S.grid[r][c];
                if (ci !== null) {
                    usedColors[ci] = (usedColors[ci] || 0) + 1;
                }
            }
        }

        // 按数量排序
        var sorted = Object.entries(usedColors)
            .sort(function (a, b) { return b[1] - a[1]; })
            .map(function (e) { return { idx: parseInt(e[0]), count: e[1] }; });

        if (sorted.length === 0) {
            grid.innerHTML = '<div style="grid-column:1/-1;text-align:center;font-size:11px;color:var(--text-muted);padding:12px;">画布为空，请先绘制图案</div>';
            return;
        }

        sorted.forEach(function (item) {
            var color = PALETTE[item.idx];
            if (!color) return;

            var div = document.createElement('div');
            div.className = 'assist-color-item' + (item.idx === S.assistHighlightIdx ? ' active' : '');
            div.style.background = color.hex;
            div.dataset.idx = item.idx;
            div.title = color.id + ' ' + color.name + ' (' + item.count + '颗)';

            var lum = luminance(color.hex);

            var idSpan = document.createElement('span');
            idSpan.className = 'assist-color-id';
            idSpan.textContent = color.id;
            idSpan.style.color = lum > 0.55 ? 'rgba(50,40,45,0.6)' : 'rgba(255,255,255,0.8)';
            div.appendChild(idSpan);

            var countSpan = document.createElement('span');
            countSpan.className = 'assist-color-count';
            countSpan.textContent = item.count;
            div.appendChild(countSpan);

            div.addEventListener('click', function () {
                S.assistHighlightIdx = item.idx;
                // 更新选中状态
                grid.querySelectorAll('.assist-color-item').forEach(function (el) {
                    el.classList.toggle('active', parseInt(el.dataset.idx) === item.idx);
                });
                // 更新进度文字
                $('assistProgressText').textContent = color.id + ' ' + color.name + ' · 共 ' + item.count + ' 颗';
                $('assistProgressBar').style.width = '0%';
                // 同步小窗信息
                updateAssistMiniInfo();
                renderMain();
            });

            grid.appendChild(div);
        });
    }

    // 计时器
    function startAssistTimer() {
        if (S.assistTimerRunning && !S.assistTimerPaused) return;

        if (S.assistTimerPaused) {
            // 从暂停恢复
            S.assistTimerPaused = false;
        } else {
            S.assistTimerSeconds = 0;
        }

        S.assistTimerRunning = true;
        $('assistTimerStart').disabled = true;
        $('assistTimerPause').disabled = false;

        S.assistTimerInterval = setInterval(function () {
            S.assistTimerSeconds++;
            updateAssistTimerDisplay();
        }, 1000);
    }

    function pauseAssistTimer() {
        if (!S.assistTimerRunning || S.assistTimerPaused) return;
        S.assistTimerPaused = true;
        clearInterval(S.assistTimerInterval);
        $('assistTimerStart').disabled = false;
        $('assistTimerPause').disabled = true;
        $('assistTimerStart').innerHTML = '<svg viewBox="0 0 20 20" width="12" height="12"><path d="M6 4l10 6-10 6V4z" fill="currentColor"/></svg> 继续';
    }

    function stopAssistTimer() {
        S.assistTimerRunning = false;
        S.assistTimerPaused = false;
        clearInterval(S.assistTimerInterval);
        $('assistTimerStart').disabled = false;
        $('assistTimerPause').disabled = true;
        $('assistTimerStart').innerHTML = '<svg viewBox="0 0 20 20" width="12" height="12"><path d="M6 4l10 6-10 6V4z" fill="currentColor"/></svg> 开始';
    }

    function resetAssistTimer() {
        stopAssistTimer();
        S.assistTimerSeconds = 0;
        updateAssistTimerDisplay();
    }

    function updateAssistTimerDisplay() {
        var total = S.assistTimerSeconds;
        var h = Math.floor(total / 3600);
        var m = Math.floor((total % 3600) / 60);
        var s = total % 60;
        var str = String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0');
        $('assistTimerDisplay').textContent = str;
        // 同步更新小窗计时器
        var miniTimer = $('assistMiniTimer');
        if (miniTimer) miniTimer.textContent = str;
    }

    function clearAssistHighlight() {
        S.assistHighlightIdx = -1;
        var grid = $('assistColorGrid');
        grid.querySelectorAll('.assist-color-item').forEach(function (el) {
            el.classList.remove('active');
        });
        $('assistProgressText').textContent = '选择颜色查看拼豆进度';
        $('assistProgressBar').style.width = '0%';
        // 同步小窗信息
        updateAssistMiniInfo();
        renderMain();
    }


    var _assistBlockTimer = null;
    function showAssistDrawBlock() {
        var el = document.querySelector('.assist-draw-block');
        if (!el) {
            el = document.createElement('div');
            el.className = 'assist-draw-block';
            el.textContent = '辅助模式中，请先关闭辅助模式再绘图';
            document.querySelector('.canvas-wrapper').appendChild(el);
        }
        el.classList.add('show');
        clearTimeout(_assistBlockTimer);
        _assistBlockTimer = setTimeout(function () {
            el.classList.remove('show');
        }, 2000);
    }

    // ===========================
    //  辅助拼豆 - 悬浮小窗
    // ===========================
    function minimizeAssistPanel() {
        S.assistMiniMode = true;
        $('assistPanel').classList.remove('active');
        var mini = $('assistMini');
        mini.classList.add('active');

        // 如果小窗没有设定位置，放到右下角
        if (!mini.dataset.positioned) {
            var viewW = window.innerWidth;
            var viewH = window.innerHeight;
            mini.style.right = '12px';
            mini.style.bottom = '80px';
            mini.style.left = 'auto';
            mini.style.top = 'auto';
            mini.dataset.positioned = '1';
        }

        updateAssistMiniInfo();
        updateAssistTimerDisplay();
    }

    function expandAssistPanel() {
        S.assistMiniMode = false;
        $('assistMini').classList.remove('active');
        $('assistPanel').classList.add('active');
        buildAssistColorGrid();
    }

    function updateAssistMiniInfo() {
        var colorEl = $('assistMiniColor');
        var idEl = $('assistMiniId');
        var countEl = $('assistMiniCount');
        if (!colorEl || !idEl || !countEl) return;

        if (S.assistHighlightIdx >= 0 && PALETTE[S.assistHighlightIdx]) {
            var color = PALETTE[S.assistHighlightIdx];
            colorEl.style.background = color.hex;
            colorEl.style.borderColor = 'var(--iris)';
            idEl.textContent = color.id + ' ' + color.name;

            // 统计数量
            var count = 0;
            for (var r = 0; r < S.gridH; r++) {
                for (var c = 0; c < S.gridW; c++) {
                    if (S.grid[r][c] === S.assistHighlightIdx) count++;
                }
            }
            countEl.textContent = count + ' 颗';
        } else {
            colorEl.style.background = 'repeating-conic-gradient(#e0e0e0 0% 25%, #fff 0% 50%) 50% / 10px 10px';
            colorEl.style.borderColor = 'var(--border)';
            idEl.textContent = '未选择颜色';
            countEl.textContent = '';
        }
    }

    function initMiniDrag() {
        var mini = $('assistMini');
        var header = $('assistMiniHeader');
        if (!mini || !header) return;

        var isDragging = false;
        var startX, startY, origX, origY;

        function onStart(e) {
            // 不拦截展开按钮的点击
            if (e.target.closest('.assist-mini-expand')) return;

            isDragging = true;
            var touch = e.touches ? e.touches[0] : e;
            startX = touch.clientX;
            startY = touch.clientY;

            var rect = mini.getBoundingClientRect();
            origX = rect.left;
            origY = rect.top;

            // 切换为 left/top 定位模式
            mini.style.left = origX + 'px';
            mini.style.top = origY + 'px';
            mini.style.right = 'auto';
            mini.style.bottom = 'auto';

            e.preventDefault();
        }

        function onMove(e) {
            if (!isDragging) return;
            var touch = e.touches ? e.touches[0] : e;
            var dx = touch.clientX - startX;
            var dy = touch.clientY - startY;
            var newX = origX + dx;
            var newY = origY + dy;

            // 限制不超出屏幕
            var maxX = window.innerWidth - mini.offsetWidth;
            var maxY = window.innerHeight - mini.offsetHeight;
            newX = Math.max(0, Math.min(newX, maxX));
            newY = Math.max(0, Math.min(newY, maxY));

            mini.style.left = newX + 'px';
            mini.style.top = newY + 'px';
            e.preventDefault();
        }

        function onEnd() {
            isDragging = false;
        }

        header.addEventListener('mousedown', onStart);
        window.addEventListener('mousemove', onMove);
        window.addEventListener('mouseup', onEnd);

        header.addEventListener('touchstart', onStart, { passive: false });
        window.addEventListener('touchmove', onMove, { passive: false });
        window.addEventListener('touchend', onEnd);
    }


    function getAssistUsedColors() {
        var usedColors = {};
        for (var r = 0; r < S.gridH; r++) {
            for (var c = 0; c < S.gridW; c++) {
                var ci = S.grid[r][c];
                if (ci !== null) {
                    usedColors[ci] = (usedColors[ci] || 0) + 1;
                }
            }
        }
        return Object.entries(usedColors)
            .sort(function (a, b) { return b[1] - a[1]; })
            .map(function (e) { return parseInt(e[0]); });
    }

    function switchAssistColor(direction) {
        var colorList = getAssistUsedColors();
        if (colorList.length === 0) return;

        var currentPos = colorList.indexOf(S.assistHighlightIdx);
        var newPos;
        if (currentPos < 0) {
            newPos = 0;
        } else {
            newPos = currentPos + direction;
            if (newPos < 0) newPos = colorList.length - 1;
            if (newPos >= colorList.length) newPos = 0;
        }

        S.assistHighlightIdx = colorList[newPos];
        updateAssistMiniInfo();

        // 同步大面板的选中状态
        var grid = $('assistColorGrid');
        if (grid) {
            grid.querySelectorAll('.assist-color-item').forEach(function (el) {
                el.classList.toggle('active', parseInt(el.dataset.idx) === S.assistHighlightIdx);
            });
        }

        // 更新进度文字
        if (PALETTE[S.assistHighlightIdx]) {
            var color = PALETTE[S.assistHighlightIdx];
            var count = 0;
            for (var r = 0; r < S.gridH; r++)
                for (var c = 0; c < S.gridW; c++)
                    if (S.grid[r][c] === S.assistHighlightIdx) count++;
            $('assistProgressText').textContent = color.id + ' ' + color.name + ' · 共 ' + count + ' 颗';
        }

        renderMain();
    }

    // ===========================
    //  Mobile Panels
    // ===========================
    function togglePanel(side) {
        const panel = side === 'left' ? $('panelLeft') : $('panelRight');
        const isOpen = panel.classList.contains('open');
        closePanels();
        if (!isOpen) {
            panel.classList.add('open');
            $('overlay').classList.add('active');
        }
    }

    function closePanels() {
        $('panelLeft').classList.remove('open');
        $('panelRight').classList.remove('open');
        $('overlay').classList.remove('active');
    }

    // ===========================
    //  选区操作
    // ===========================
    function startSelection(row, col) {
        S.selectionDrawing = true;
        S.selectionStartCell = { row: row, col: col };
        S.selection = { r1: row, c1: col, r2: row, c2: col };
        updateSelectionUI();
        renderMain();
    }

    function updateSelectionRect(row, col) {
        if (!S.selectionDrawing || !S.selectionStartCell) return;
        var sr = S.selectionStartCell.row;
        var sc = S.selectionStartCell.col;
        S.selection = {
            r1: Math.min(sr, row),
            c1: Math.min(sc, col),
            r2: Math.max(sr, row),
            c2: Math.max(sc, col)
        };
        renderMain();
    }

    function endSelection() {
        S.selectionDrawing = false;
        S.selectionStartCell = null;
        if (S.selection) {
            var w = S.selection.c2 - S.selection.c1 + 1;
            var h = S.selection.r2 - S.selection.r1 + 1;
            if (w < 1 || h < 1) {
                clearSelection();
                return;
            }
            updateSelectionUI();
        }
    }

    function clearSelection() {
        S.selection = null;
        S.selectionDrawing = false;
        S.selectionDragging = false;
        S.selectionStartCell = null;
        $('selectionToolbar').classList.remove('active');
        renderMain();
    }

    function updateSelectionUI() {
        if (!S.selection) {
            $('selectionToolbar').classList.remove('active');
            return;
        }
        var w = S.selection.c2 - S.selection.c1 + 1;
        var h = S.selection.r2 - S.selection.r1 + 1;
        $('selInfo').textContent = w + ' x ' + h;
        $('selectionToolbar').classList.add('active');
    }

    function copySelection() {
        if (!S.selection) return;
        var sel = S.selection;
        var w = sel.c2 - sel.c1 + 1;
        var h = sel.r2 - sel.r1 + 1;
        var data = [];
        for (var r = 0; r < h; r++) {
            data[r] = [];
            for (var c = 0; c < w; c++) {
                var gr = sel.r1 + r;
                var gc = sel.c1 + c;
                data[r][c] = (gr < S.gridH && gc < S.gridW) ? S.grid[gr][gc] : null;
            }
        }
        S.selectionClipboard = { w: w, h: h, data: data };
        showToast('已复制 ' + w + '×' + h + ' 区域', 'success', 1500);

    }

    function pasteSelection() {
        if (!S.selectionClipboard) { alert('剪贴板为空，请先复制选区'); return; }
        var clip = S.selectionClipboard;
        var startR = S.selection ? S.selection.r1 : 0;
        var startC = S.selection ? S.selection.c1 : 0;
        for (var r = 0; r < clip.h; r++) {
            for (var c = 0; c < clip.w; c++) {
                var gr = startR + r;
                var gc = startC + c;
                if (gr < S.gridH && gc < S.gridW) {
                    S.grid[gr][gc] = clip.data[r][c];
                }
            }
        }
        S.selection = {
            r1: startR,
            c1: startC,
            r2: Math.min(startR + clip.h - 1, S.gridH - 1),
            c2: Math.min(startC + clip.w - 1, S.gridW - 1)
        };
        pushHistory();
        updateSelectionUI();
        render();
    }

    function deleteSelection() {
        if (!S.selection) return;
        var sel = S.selection;
        for (var r = sel.r1; r <= sel.r2; r++) {
            for (var c = sel.c1; c <= sel.c2; c++) {
                if (r < S.gridH && c < S.gridW) {
                    S.grid[r][c] = null;
                }
            }
        }
        pushHistory();
        render();
        clearSelection();
    }

    function flipSelectionH() {
        if (!S.selection) return;
        var sel = S.selection;
        var w = sel.c2 - sel.c1 + 1;
        var h = sel.r2 - sel.r1 + 1;
        for (var r = sel.r1; r <= sel.r2; r++) {
            var temp = [];
            for (var c = 0; c < w; c++) {
                temp[c] = S.grid[r][sel.c1 + c];
            }
            temp.reverse();
            for (var c2 = 0; c2 < w; c2++) {
                S.grid[r][sel.c1 + c2] = temp[c2];
            }
        }
        pushHistory();
        render();
    }

    function flipSelectionV() {
        if (!S.selection) return;
        var sel = S.selection;
        var w = sel.c2 - sel.c1 + 1;
        var h = sel.r2 - sel.r1 + 1;
        for (var c = sel.c1; c <= sel.c2; c++) {
            var temp = [];
            for (var r = 0; r < h; r++) {
                temp[r] = S.grid[sel.r1 + r][c];
            }
            temp.reverse();
            for (var r2 = 0; r2 < h; r2++) {
                S.grid[sel.r1 + r2][c] = temp[r2];
            }
        }
        pushHistory();
        render();
    }

    function moveSelectionBy(dr, dc) {
        if (!S.selection) return;
        var sel = S.selection;
        var w = sel.c2 - sel.c1 + 1;
        var h = sel.r2 - sel.r1 + 1;

        // 提取选区数据
        var data = [];
        for (var r = 0; r < h; r++) {
            data[r] = [];
            for (var c = 0; c < w; c++) {
                data[r][c] = S.grid[sel.r1 + r][sel.c1 + c];
            }
        }

        // 清空原位置
        for (var r2 = sel.r1; r2 <= sel.r2; r2++) {
            for (var c2 = sel.c1; c2 <= sel.c2; c2++) {
                if (r2 < S.gridH && c2 < S.gridW) S.grid[r2][c2] = null;
            }
        }

        // 写入新位置
        var nr1 = Math.max(0, Math.min(sel.r1 + dr, S.gridH - h));
        var nc1 = Math.max(0, Math.min(sel.c1 + dc, S.gridW - w));
        for (var r3 = 0; r3 < h; r3++) {
            for (var c3 = 0; c3 < w; c3++) {
                if (nr1 + r3 < S.gridH && nc1 + c3 < S.gridW) {
                    S.grid[nr1 + r3][nc1 + c3] = data[r3][c3];
                }
            }
        }

        S.selection = {
            r1: nr1,
            c1: nc1,
            r2: nr1 + h - 1,
            c2: nc1 + w - 1
        };
        updateSelectionUI();
        render();
    }

    function isInsideSelection(row, col) {
        if (!S.selection) return false;
        return row >= S.selection.r1 && row <= S.selection.r2 &&
               col >= S.selection.c1 && col <= S.selection.c2;
    }

    function renderSelectionOverlay() {
        if (!S.selection) return;
        var sel = S.selection;
        var cs = S.cellSize;
        var x = sel.c1 * cs;
        var y = sel.r1 * cs;
        var w = (sel.c2 - sel.c1 + 1) * cs;
        var h = (sel.r2 - sel.r1 + 1) * cs;

        // 半透明蓝色填充
        ctx.fillStyle = 'rgba(141, 123, 170, 0.12)';
        ctx.fillRect(x, y, w, h);

        // 虚线边框
        ctx.save();
        ctx.strokeStyle = 'rgba(141, 123, 170, 0.7)';
        ctx.lineWidth = 1.5;
        ctx.setLineDash([5, 3]);
        ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
        ctx.setLineDash([]);

        // 四个角的把手
        var handleSize = 5;
        ctx.fillStyle = 'rgba(141, 123, 170, 0.85)';
        // 左上
        ctx.fillRect(x - handleSize / 2, y - handleSize / 2, handleSize, handleSize);
        // 右上
        ctx.fillRect(x + w - handleSize / 2, y - handleSize / 2, handleSize, handleSize);
        // 左下
        ctx.fillRect(x - handleSize / 2, y + h - handleSize / 2, handleSize, handleSize);
        // 右下
        ctx.fillRect(x + w - handleSize / 2, y + h - handleSize / 2, handleSize, handleSize);

        ctx.restore();
    }

    // ===========================
    //  Mobile Drawer
    // ===========================
    function initMobileDrawer() {
        var paletteDrawer = $('mobilePaletteDrawer');
        var paletteHandle = $('mobileDrawerHandle');
        var controlDrawer = $('mobileControlDrawer');
        var controlHandle = $('mobileControlHandle');

        if (!paletteDrawer || !paletteHandle) return;

        // 色板抽屉：点击把手展开/收起
        paletteHandle.addEventListener('click', function () {
            var isExpanding = !paletteDrawer.classList.contains('expanded');
            // 关闭另一个抽屉
            if (isExpanding && controlDrawer) {
                controlDrawer.classList.remove('expanded');
            }
            paletteDrawer.classList.toggle('expanded');
        });

        // 功能控制抽屉：点击把手展开/收起
        if (controlDrawer && controlHandle) {
            controlHandle.addEventListener('click', function () {
                var isExpanding = !controlDrawer.classList.contains('expanded');
                // 关闭另一个抽屉
                if (isExpanding) {
                    paletteDrawer.classList.remove('expanded');
                }
                controlDrawer.classList.toggle('expanded');
            });
        }

        // 首次填充内容
        cloneRightPanelToDrawer();
        cloneLeftPanelToDrawer();
    }

    function cloneLeftPanelToDrawer() {
        var body = $('mobileControlBody');
        var source = document.querySelector('#panelLeft .panel-content');
        if (!body || !source) return;

        body.innerHTML = '';

        // 深度克隆左侧面板内容
        var clone = source.cloneNode(true);

        // 给克隆的元素加前缀避免 ID 冲突
        var allIds = clone.querySelectorAll('[id]');
        allIds.forEach(function (el) {
            el.setAttribute('data-original-id', el.id);
            el.id = 'mobl_' + el.id;
        });

        body.appendChild(clone);

        // 绑定事件
        bindControlDrawerEvents(body);
    }

    function bindControlDrawerEvents(container) {
        // 画布尺寸 - 应用按钮
        var mobApplySize = container.querySelector('[data-original-id="applySize"]');
        if (mobApplySize) {
            mobApplySize.addEventListener('click', function () {
                // 同步值到主面板
                var mobW = container.querySelector('[data-original-id="canvasWidth"]');
                var mobH = container.querySelector('[data-original-id="canvasHeight"]');
                if (mobW) $('canvasWidth').value = mobW.value;
                if (mobH) $('canvasHeight').value = mobH.value;
                applySize();
                // 同步回来
                if (mobW) mobW.value = S.gridW;
                if (mobH) mobH.value = S.gridH;
            });
        }

        // 预设按钮
        container.querySelectorAll('.btn-preset').forEach(function (btn) {
            btn.addEventListener('click', function () {
                var mobW = container.querySelector('[data-original-id="canvasWidth"]');
                var mobH = container.querySelector('[data-original-id="canvasHeight"]');
                if (mobW) mobW.value = btn.dataset.w;
                if (mobH) mobH.value = btn.dataset.h;
                $('canvasWidth').value = btn.dataset.w;
                $('canvasHeight').value = btn.dataset.h;
                container.querySelectorAll('.btn-preset').forEach(function (b) { b.classList.remove('active'); });
                btn.classList.add('active');
                document.querySelectorAll('#panelLeft .btn-preset').forEach(function (b) {
                    b.classList.toggle('active', b.dataset.w === btn.dataset.w && b.dataset.h === btn.dataset.h);
                });
                applySize();
                if (mobW) mobW.value = S.gridW;
                if (mobH) mobH.value = S.gridH;
            });
        });

        // 工具按钮
        container.querySelectorAll('.btn-tool').forEach(function (b) {
            b.addEventListener('click', function () {
                setTool(b.dataset.tool);
                // 同步抽屉内的选中状态
                container.querySelectorAll('.btn-tool').forEach(function (tb) {
                    tb.classList.toggle('active', tb.dataset.tool === S.tool);
                });
            });
        });

        // 缩放
        var mobZoomIn = container.querySelector('[data-original-id="zoomIn"]');
        var mobZoomOut = container.querySelector('[data-original-id="zoomOut"]');
        var mobZoomFit = container.querySelector('[data-original-id="zoomFit"]');
        if (mobZoomIn) mobZoomIn.addEventListener('click', function () { S.zoom = Math.min(S.zoom * 1.25, 6); applyTransform(); });
        if (mobZoomOut) mobZoomOut.addEventListener('click', function () { S.zoom = Math.max(S.zoom / 1.25, 0.05); applyTransform(); });
        if (mobZoomFit) mobZoomFit.addEventListener('click', fitToView);

        // 显示选项开关
        var toggleMap = {
            'toggleGrid': function (v) { S.showGrid = v; renderMain(); },
            'toggleRuler': function (v) { S.showRuler = v; renderRulers(); fitToView(); },
            'toggleNumbers': function (v) { S.showNumbers = v; renderMain(); },
            'toggleBead': function (v) { S.showBead = v; renderMain(); },
            'toggleSplitLine': function (v) { S.showSplitLine = v; renderMain(); },
            'toggleCenterLine': function (v) { S.showCenterLine = v; renderMain(); }
        };

        Object.keys(toggleMap).forEach(function (origId) {
            var mobToggle = container.querySelector('[data-original-id="' + origId + '"]');
            var mainToggle = $(origId);
            if (mobToggle) {
                // 同步初始状态
                if (mainToggle) mobToggle.checked = mainToggle.checked;
                mobToggle.addEventListener('change', function () {
                    toggleMap[origId](mobToggle.checked);
                    if (mainToggle) mainToggle.checked = mobToggle.checked;
                });
            }
        });

        // 图案变换
        var mobFlipH = container.querySelector('[data-original-id="flipH"]');
        var mobFlipV = container.querySelector('[data-original-id="flipV"]');
        var mobRotate = container.querySelector('[data-original-id="rotate90"]');
        if (mobFlipH) mobFlipH.addEventListener('click', function () {
            for (var r = 0; r < S.gridH; r++) S.grid[r].reverse();
            pushHistory(); render();
        });
        if (mobFlipV) mobFlipV.addEventListener('click', function () {
            S.grid.reverse();
            pushHistory(); render();
        });
        if (mobRotate) mobRotate.addEventListener('click', function () {
            var nw = S.gridH, nh = S.gridW;
            var ng = [];
            for (var r = 0; r < nh; r++) {
                ng[r] = [];
                for (var c = 0; c < nw; c++) ng[r][c] = S.grid[nw - 1 - c][r];
            }
            S.grid = ng; S.gridW = nw; S.gridH = nh;
            $('canvasWidth').value = nw; $('canvasHeight').value = nh;
            pushHistory(); setupCanvas(); render();
        });

        // 撤销/重做
        var mobUndo = container.querySelector('[data-original-id="undoBtn"]');
        var mobRedo = container.querySelector('[data-original-id="redoBtn"]');
        if (mobUndo) mobUndo.addEventListener('click', undo);
        if (mobRedo) mobRedo.addEventListener('click', redo);

        // 清空画布
        var mobClear = container.querySelector('[data-original-id="clearCanvasBtn"]');
        if (mobClear) mobClear.addEventListener('click', function () {
            cdConfirm('确定要清空整个画布吗？此操作可以撤销。', { title: '清空画布', danger: true, okText: '清空' }).then(function (ok) {
                if (!ok) return;
                for (var r = 0; r < S.gridH; r++)
                    for (var c = 0; c < S.gridW; c++)
                        S.grid[r][c] = null;
                for (var lr = 0; lr < S.layers.length; lr++) {
                    if (S.layers[lr].grid) {
                        for (var lr2 = 0; lr2 < S.gridH; lr2++) {
                            S.layers[lr].grid[lr2] = new Array(S.gridW).fill(null);
                        }
                    }
                }
                S.currentProjectId = null;
                S.currentProjectName = '';
                try { localStorage.removeItem('catpeas_autosave'); } catch (e) { }
                pushHistory();
                render();
            });
        });

        // 画笔大小
        container.querySelectorAll('.brush-sz').forEach(function (btn) {
            btn.addEventListener('click', function () {
                S.brushSize = parseInt(btn.dataset.size) || 1;
                container.querySelectorAll('.brush-sz').forEach(function (b) {
                    b.classList.toggle('active', parseInt(b.dataset.size) === S.brushSize);
                });
                document.querySelectorAll('#panelLeft .brush-sz').forEach(function (b) {
                    b.classList.toggle('active', parseInt(b.dataset.size) === S.brushSize);
                });
                $('brushSizeVal').textContent = S.brushSize + 'x' + S.brushSize;
                var mobVal = container.querySelector('[data-original-id="brushSizeVal"]');
                if (mobVal) mobVal.textContent = S.brushSize + 'x' + S.brushSize;
            });
        });

        // 对称模式
        container.querySelectorAll('.sym-btn').forEach(function (btn) {
            btn.addEventListener('click', function () {
                S.symmetryMode = btn.dataset.sym;
                container.querySelectorAll('.sym-btn').forEach(function (b) {
                    b.classList.toggle('active', b.dataset.sym === S.symmetryMode);
                });
                document.querySelectorAll('#panelLeft .sym-btn').forEach(function (b) {
                    b.classList.toggle('active', b.dataset.sym === S.symmetryMode);
                });
            });
        });

        // 整体偏移
        function shiftGridMob(dr, dc) {
            var newGrid = [];
            for (var r = 0; r < S.gridH; r++) {
                newGrid[r] = new Array(S.gridW).fill(null);
                for (var c = 0; c < S.gridW; c++) {
                    var sr = r - dr;
                    var sc = c - dc;
                    if (sr >= 0 && sr < S.gridH && sc >= 0 && sc < S.gridW) {
                        newGrid[r][c] = S.grid[sr][sc];
                    }
                }
            }
            S.grid = newGrid;
            pushHistory('整体偏移');
            render();
        }
        var mobShiftUp = container.querySelector('[data-original-id="shiftUp"]');
        var mobShiftDown = container.querySelector('[data-original-id="shiftDown"]');
        var mobShiftLeft = container.querySelector('[data-original-id="shiftLeft"]');
        var mobShiftRight = container.querySelector('[data-original-id="shiftRight"]');
        if (mobShiftUp) mobShiftUp.addEventListener('click', function () { shiftGridMob(-1, 0); });
        if (mobShiftDown) mobShiftDown.addEventListener('click', function () { shiftGridMob(1, 0); });
        if (mobShiftLeft) mobShiftLeft.addEventListener('click', function () { shiftGridMob(0, -1); });
        if (mobShiftRight) mobShiftRight.addEventListener('click', function () { shiftGridMob(0, 1); });

        // 图层管理
        var mobAddLayer = container.querySelector('[data-original-id="addLayerBtn"]');
        var mobMergeLayers = container.querySelector('[data-original-id="mergeLayersBtn"]');
        var mobMergeDown = container.querySelector('[data-original-id="mergeDownBtn"]');
        var mobDeleteLayer = container.querySelector('[data-original-id="deleteLayerBtn"]');
        var mobExportLayer = container.querySelector('[data-original-id="exportCurrentLayerBtn"]');

        if (mobAddLayer) mobAddLayer.addEventListener('click', function () { addLayer(); syncControlDrawerLayerUI(); });
        if (mobMergeLayers) mobMergeLayers.addEventListener('click', function () {
            if (S.layers.length <= 1) { cdAlert('只有一个图层，无需合并', { type: 'warn', title: '无需合并' }); return; }
            cdConfirm('将所有图层合并为一个图层，其他图层会被删除。确定合并？', { title: '合并全部图层', type: 'warn' }).then(function (ok) {
                if (!ok) return;
                mergeLayersToGrid();
                syncControlDrawerLayerUI();
            });
        });
        if (mobMergeDown) mobMergeDown.addEventListener('click', function () { mergeDown(); syncControlDrawerLayerUI(); });
        if (mobDeleteLayer) mobDeleteLayer.addEventListener('click', function () { deleteCurrentLayer(); });
        if (mobExportLayer) mobExportLayer.addEventListener('click', function () { exportCurrentLayer(); });

        // 图层列表项的事件
        syncControlDrawerLayerUI();

        // 图片上传
        var mobUploadBtn = container.querySelector('[data-original-id="uploadBtn"]');
        if (mobUploadBtn) {
            mobUploadBtn.addEventListener('click', function () {
                $('imageInput').click();
            });
        }

        // 导出按钮
        var mobExportPNG = container.querySelector('[data-original-id="exportPNG"]');
        var mobExportBead = container.querySelector('[data-original-id="exportBeadPNG"]');
        var mobExportSplit = container.querySelector('[data-original-id="exportSplitPNG"]');
        if (mobExportPNG) mobExportPNG.addEventListener('click', function () { doExport(false); });
        if (mobExportBead) mobExportBead.addEventListener('click', function () { doExport(true); });
        if (mobExportSplit) mobExportSplit.addEventListener('click', function () { exportSplitBoards(); });

        // 裁剪/扩展
        var mobCropBtn = container.querySelector('[data-original-id="cropCanvasBtn"]');
        var mobExpandBtn = container.querySelector('[data-original-id="expandCanvasBtn"]');
        if (mobCropBtn) mobCropBtn.addEventListener('click', function () { cropCanvasToContent(); });
        if (mobExpandBtn) mobExpandBtn.addEventListener('click', function () { expandCanvasDialog(); });

        // 保存项目
        var mobSaveProject = container.querySelector('[data-original-id="saveToProject"]');
        if (mobSaveProject) {
            mobSaveProject.addEventListener('click', function () {
                // 同步项目名称到主面板
                var mobName = container.querySelector('[data-original-id="projectName"]');
                if (mobName && mobName.value.trim()) {
                    $('projectName').value = mobName.value.trim();
                }
                var mobCat = container.querySelector('[data-original-id="projectCategory"]');
                if (mobCat) {
                    $('projectCategory').value = mobCat.value;
                }
                saveProject();
            });
        }

        // 导入图纸
        var mobImportSheet = container.querySelector('[data-original-id="importSheetBtn"]');
        if (mobImportSheet) {
            mobImportSheet.addEventListener('click', function () {
                $('importSheetInput').click();
            });
        }

        // 导出/导入项目JSON
        var mobExportJSON = container.querySelector('[data-original-id="exportProjectJSON"]');
        if (mobExportJSON) mobExportJSON.addEventListener('click', function () { exportProjectJSON(); });

        var mobImportJSON = container.querySelector('[data-original-id="importProjectJSON"]');
        if (mobImportJSON) {
            mobImportJSON.addEventListener('click', function () {
                $('projectFileInput').click();
            });
        }

        // 底图相关
        var mobConvertBtn = container.querySelector('[data-original-id="convertBtn"]');
        if (mobConvertBtn) {
            mobConvertBtn.addEventListener('click', function () {
                $('convertBtn').click();
            });
        }
        var mobRecognizeBtn = container.querySelector('[data-original-id="recognizeBtn"]');
        if (mobRecognizeBtn) {
            mobRecognizeBtn.addEventListener('click', function () {
                recognizeBlockImage();
            });
        }
        var mobRemoveImage = container.querySelector('[data-original-id="removeImage"]');
        if (mobRemoveImage) {
            mobRemoveImage.addEventListener('click', function () {
                $('removeImage').click();
            });
        }
        var mobGridAlignBtn = container.querySelector('[data-original-id="gridAlignBtn"]');
        if (mobGridAlignBtn) {
            mobGridAlignBtn.addEventListener('click', function () {
                openGridAlignModal();
            });
        }

        // 底图透明度
        var mobOpacitySlider = container.querySelector('[data-original-id="opacitySlider"]');
        if (mobOpacitySlider) {
            mobOpacitySlider.addEventListener('input', function () {
                S.refOpacity = mobOpacitySlider.value / 100;
                var mobVal = container.querySelector('[data-original-id="opacityVal"]');
                if (mobVal) mobVal.textContent = mobOpacitySlider.value + '%';
                $('opacitySlider').value = mobOpacitySlider.value;
                $('opacityVal').textContent = mobOpacitySlider.value + '%';
                renderBg();
            });
        }
        var mobCellOpacitySlider = container.querySelector('[data-original-id="cellOpacitySlider"]');
        if (mobCellOpacitySlider) {
            mobCellOpacitySlider.addEventListener('input', function () {
                S.cellOpacity = mobCellOpacitySlider.value / 100;
                var mobVal2 = container.querySelector('[data-original-id="cellOpacityVal"]');
                if (mobVal2) mobVal2.textContent = mobCellOpacitySlider.value + '%';
                $('cellOpacitySlider').value = mobCellOpacitySlider.value;
                $('cellOpacityVal').textContent = mobCellOpacitySlider.value + '%';
                renderMain();
            });
        }
    }

    function syncControlDrawerLayerUI() {
        var container = $('mobileControlBody');
        if (!container) return;
        var mobLayerList = container.querySelector('[data-original-id="layerList"]');
        if (!mobLayerList) return;

        // 用和主面板相同的逻辑重建图层列表
        mobLayerList.innerHTML = '';
        for (var i = S.layers.length - 1; i >= 0; i--) {
            var layer = S.layers[i];
            var div = document.createElement('div');
            div.className = 'layer-item' + (i === S.activeLayer ? ' active' : '');
            div.dataset.layer = i;

            var opacityPct = Math.round((layer.opacity !== undefined ? layer.opacity : 1) * 100);

            div.innerHTML =
                '<button class="layer-vis-btn' + (layer.visible ? '' : ' hidden') + '" data-layer="' + i + '" title="显示/隐藏">' +
                    '<svg viewBox="0 0 16 16" width="12" height="12"><path d="M8 3C3 3 1 8 1 8s2 5 7 5 7-5 7-5-2-5-7-5z" stroke="currentColor" stroke-width="1.2" fill="none"/><circle cx="8" cy="8" r="2" stroke="currentColor" stroke-width="1.2" fill="none"/></svg>' +
                '</button>' +
                '<span class="layer-name">' + escapeHtml(layer.name) + '</span>' +
                '<div class="layer-opacity-wrap">' +
                    '<input type="range" class="layer-opacity-slider" min="0" max="100" value="' + opacityPct + '" data-layer="' + i + '" title="图层透明度">' +
                '</div>' +
                '<span class="layer-active-badge">编辑中</span>';

            mobLayerList.appendChild(div);
        }

        // 绑定事件
        mobLayerList.querySelectorAll('.layer-item').forEach(function (item) {
            item.addEventListener('click', function (e) {
                if (e.target.closest('.layer-vis-btn') || e.target.closest('.layer-opacity-slider')) return;
                S.activeLayer = parseInt(item.dataset.layer);
                updateLayerUI();
                syncControlDrawerLayerUI();
            });
        });

        mobLayerList.querySelectorAll('.layer-vis-btn').forEach(function (btn) {
            btn.addEventListener('click', function (e) {
                e.stopPropagation();
                var idx = parseInt(btn.dataset.layer);
                S.layers[idx].visible = !S.layers[idx].visible;
                syncGridFromLayers();
                updateLayerUI();
                syncControlDrawerLayerUI();
                render();
            });
        });

        mobLayerList.querySelectorAll('.layer-opacity-slider').forEach(function (slider) {
            slider.addEventListener('input', function (e) {
                e.stopPropagation();
                var idx = parseInt(slider.dataset.layer);
                S.layers[idx].opacity = parseInt(slider.value) / 100;
                render();
            });
            slider.addEventListener('click', function (e) { e.stopPropagation(); });
        });
    }

    function cloneRightPanelToDrawer() {
        var body = $('mobileDrawerBody');
        var source = document.querySelector('#panelRight .panel-content');
        if (!body || !source) return;

        // 清空
        body.innerHTML = '';

        // 克隆前先填充所有懒加载的色板分组
        var allGroups = source.querySelectorAll('.palette-group-colors');
        allGroups.forEach(function (wrapper) {
            if (wrapper.dataset.loaded === '1') return;
            var prefix = wrapper.dataset.groupPrefix;
            if (prefix && _paletteGroupsCache[prefix]) {
                fillPaletteGroupItems(wrapper, _paletteGroupsCache[prefix]);
            }
        });


        // 深度克隆右侧面板内容
        var clone = source.cloneNode(true);

        // 给克隆的元素加前缀避免 ID 冲突
        var allIds = clone.querySelectorAll('[id]');
        allIds.forEach(function (el) {
            el.setAttribute('data-original-id', el.id);
            el.id = 'mob_' + el.id;
        });

        body.appendChild(clone);

        // 重新绑定克隆内容中的事件
        bindDrawerEvents(body);
    }

    function bindDrawerEvents(container) {
        // 色板颜色点击
        container.querySelectorAll('.palette-color').forEach(function (el) {
            el.addEventListener('click', function () {
                var idx = parseInt(el.dataset.idx);
                if (!isNaN(idx)) selectColor(idx);
            });
        });

        // 分组折叠展开
        container.querySelectorAll('.palette-group-header').forEach(function (header) {
            header.addEventListener('click', function () {
                var wrapper = this.nextElementSibling;
                if (wrapper && wrapper.classList.contains('palette-group-colors')) {
                    var isCollapsed = wrapper.classList.toggle('collapsed');
                    this.classList.toggle('collapsed', isCollapsed);
                }
            });
        });

        // 移动端默认折叠所有分组
        container.querySelectorAll('.palette-group-colors').forEach(function (wrapper) {
            wrapper.classList.add('collapsed');
            var header2 = wrapper.previousElementSibling;
            if (header2 && header2.classList.contains('palette-group-header')) {
                header2.classList.add('collapsed');
            }
        });

        // 自定义颜色添加按钮
        var mobAddBtn = container.querySelector('[data-original-id="addCustomColor"]');
        if (mobAddBtn) {
            mobAddBtn.addEventListener('click', function () {
                var mobId = container.querySelector('[data-original-id="customColorId"]');
                var mobName = container.querySelector('[data-original-id="customColorName"]');
                var mobHex = container.querySelector('[data-original-id="customColorHex"]');
                var mobGroup = container.querySelector('[data-original-id="customGroupSelect"]');

                var id = mobId ? mobId.value.trim() : '';
                var name = mobName ? (mobName.value.trim() || id) : id;
                var hex = mobHex ? mobHex.value : '';
                if (!id) { alert('请输入颜色编号'); return; }
                if (!/^#[0-9A-Fa-f]{6}$/.test(hex)) { alert('颜色格式不正确'); return; }
                hex = hex.toUpperCase();
                if (PALETTE.some(function (c) { return c.id === id; })) {
                    alert('编号 "' + id + '" 已存在，请换一个编号');
                    return;
                }
                var groupId = mobGroup ? mobGroup.value : 'default';
                CUSTOM_COLORS.push({ id: id, name: name, hex: hex, group: groupId });
                rebuildPalette();
                saveCustomColors();
                buildPalette();
                selectColor(PALETTE.length - 1);
                if (mobId) mobId.value = '';
                if (mobName) mobName.value = '';
            });
        }

        // 自定义分组添加按钮
        var mobAddGroup = container.querySelector('[data-original-id="addCustomGroup"]');
        if (mobAddGroup) {
            mobAddGroup.addEventListener('click', function () {
                var mobGroupName = container.querySelector('[data-original-id="customGroupName"]');
                var name = mobGroupName ? mobGroupName.value.trim() : '';
                if (!name) { alert('请输入分组名称'); return; }
                var id = 'g_' + Date.now().toString(36);
                CUSTOM_GROUPS.push({ name: name, id: id });
                saveCustomColors();
                buildCustomColorList();
                if (mobGroupName) mobGroupName.value = '';
                var mobGroupSelect = container.querySelector('[data-original-id="customGroupSelect"]');
                if (mobGroupSelect) mobGroupSelect.value = id;
            });
        }

        // 显示/隐藏默认色板
        var mobToggleDefault = container.querySelector('[data-original-id="toggleDefaultPalette"]');
        if (mobToggleDefault) {
            mobToggleDefault.addEventListener('change', function (e) {
                SHOW_DEFAULT_PALETTE = e.target.checked;
                if (!SHOW_DEFAULT_PALETTE && CUSTOM_COLORS.length === 0) {
                    alert('请先添加自定义颜色，否则画布将没有可用颜色');
                    e.target.checked = true;
                    SHOW_DEFAULT_PALETTE = true;
                    return;
                }
                rebuildPalette();
                saveCustomColors();
                buildPalette();
                if (S.currentColorIdx >= PALETTE.length) selectColor(0);
                render();
            });
        }
    }

    function syncDrawerPalette() {
        var body = $('mobileDrawerBody');
        if (!body) return;

        // 如果窗口不是移动端宽度，跳过
        if (window.innerWidth > 960) return;

        cloneRightPanelToDrawer();

        // 同步选中状态
        syncDrawerSelection();
    }

    function syncDrawerSelection() {
        var body = $('mobileDrawerBody');
        if (!body) return;

        // 同步色板选中
        body.querySelectorAll('.palette-color').forEach(function (el) {
            el.classList.toggle('active', parseInt(el.dataset.idx) === S.currentColorIdx);
        });

        // 同步用料统计
        var totalEl = body.querySelector('[data-original-id="totalBeads"]');
        if (totalEl) {
            totalEl.textContent = $('totalBeads').textContent;
        }

        var usageList = body.querySelector('[data-original-id="usageList"]');
        var srcList = $('usageList');
        if (usageList && srcList) {
            usageList.innerHTML = srcList.innerHTML;
        }

        // 同步当前颜色信息到把手
        updateDrawerHandle();
    }

    function updateDrawerHandle() {
        var colorEl = $('drawerCurrentColor');
        var textEl = $('drawerCurrentText');
        if (!colorEl || !textEl) return;

        if (S.noColor) {
            colorEl.style.background = 'repeating-conic-gradient(#e0e0e0 0% 25%, #fff 0% 50%) 50% / 12px 12px';
            textEl.textContent = '未选择';
        } else if (PALETTE[S.currentColorIdx]) {
            var c = PALETTE[S.currentColorIdx];
            colorEl.style.background = c.hex;
            textEl.textContent = c.id + ' ' + c.name;
        }
    }

    // ===========================
    //  Utilities
    // ===========================

    // ===========================
    //  Lab 色彩空间与 CIEDE2000 色差
    // ===========================
    function rgbToLab(r, g, b) {
        // sRGB -> linear
        var rl = r / 255, gl = g / 255, bl = b / 255;
        rl = rl > 0.04045 ? Math.pow((rl + 0.055) / 1.055, 2.4) : rl / 12.92;
        gl = gl > 0.04045 ? Math.pow((gl + 0.055) / 1.055, 2.4) : gl / 12.92;
        bl = bl > 0.04045 ? Math.pow((bl + 0.055) / 1.055, 2.4) : bl / 12.92;
        // linear RGB -> XYZ (D65)
        var x = (rl * 0.4124564 + gl * 0.3575761 + bl * 0.1804375) / 0.95047;
        var y = (rl * 0.2126729 + gl * 0.7151522 + bl * 0.0721750) / 1.00000;
        var z = (rl * 0.0193339 + gl * 0.1191920 + bl * 0.9503041) / 1.08883;
        var fx = x > 0.008856 ? Math.pow(x, 1/3) : (903.3 * x + 16) / 116;
        var fy = y > 0.008856 ? Math.pow(y, 1/3) : (903.3 * y + 16) / 116;
        var fz = z > 0.008856 ? Math.pow(z, 1/3) : (903.3 * z + 16) / 116;
        return {
            L: 116 * fy - 16,
            a: 500 * (fx - fy),
            b: 200 * (fy - fz)
        };
    }

    function ciede2000(lab1, lab2) {
        var L1 = lab1.L, a1 = lab1.a, b1 = lab1.b;
        var L2 = lab2.L, a2 = lab2.a, b2 = lab2.b;
        var kL = 1, kC = 1, kH = 1;
        var C1 = Math.sqrt(a1*a1 + b1*b1);
        var C2 = Math.sqrt(a2*a2 + b2*b2);
        var Cb = (C1 + C2) / 2;
        var Cb7 = Math.pow(Cb, 7);
        var G = 0.5 * (1 - Math.sqrt(Cb7 / (Cb7 + 6103515625)));
        var ap1 = a1 * (1 + G);
        var ap2 = a2 * (1 + G);
        var Cp1 = Math.sqrt(ap1*ap1 + b1*b1);
        var Cp2 = Math.sqrt(ap2*ap2 + b2*b2);
        var hp1 = Math.atan2(b1, ap1); if (hp1 < 0) hp1 += 2*Math.PI;
        var hp2 = Math.atan2(b2, ap2); if (hp2 < 0) hp2 += 2*Math.PI;
        var dLp = L2 - L1;
        var dCp = Cp2 - Cp1;
        var dhp;
        if (Cp1 * Cp2 === 0) { dhp = 0; }
        else if (Math.abs(hp2 - hp1) <= Math.PI) { dhp = hp2 - hp1; }
        else if (hp2 - hp1 > Math.PI) { dhp = hp2 - hp1 - 2*Math.PI; }
        else { dhp = hp2 - hp1 + 2*Math.PI; }
        var dHp = 2 * Math.sqrt(Cp1 * Cp2) * Math.sin(dhp / 2);
        var Lbp = (L1 + L2) / 2;
        var Cbp = (Cp1 + Cp2) / 2;
        var hbp;
        if (Cp1 * Cp2 === 0) { hbp = hp1 + hp2; }
        else if (Math.abs(hp1 - hp2) <= Math.PI) { hbp = (hp1 + hp2) / 2; }
        else if (hp1 + hp2 < 2*Math.PI) { hbp = (hp1 + hp2 + 2*Math.PI) / 2; }
        else { hbp = (hp1 + hp2 - 2*Math.PI) / 2; }
        var T = 1
            - 0.17 * Math.cos(hbp - Math.PI/6)
            + 0.24 * Math.cos(2*hbp)
            + 0.32 * Math.cos(3*hbp + Math.PI/30)
            - 0.20 * Math.cos(4*hbp - 63*Math.PI/180);
        var SL = 1 + 0.015 * Math.pow(Lbp - 50, 2) / Math.sqrt(20 + Math.pow(Lbp - 50, 2));
        var SC = 1 + 0.045 * Cbp;
        var SH = 1 + 0.015 * Cbp * T;
        var Cbp7 = Math.pow(Cbp, 7);
        var RT = -2 * Math.sqrt(Cbp7 / (Cbp7 + 6103515625))
            * Math.sin(Math.PI/3 * Math.exp(-Math.pow((hbp - 275*Math.PI/180) / (25*Math.PI/180), 2)));
        var dE = Math.sqrt(
            Math.pow(dLp / (kL*SL), 2) +
            Math.pow(dCp / (kC*SC), 2) +
            Math.pow(dHp / (kH*SH), 2) +
            RT * (dCp / (kC*SC)) * (dHp / (kH*SH))
        );
        return dE;
    }

    // 预计算色板的 Lab 值缓存
    var _paletteLabCache = null;
    var _paletteLabCacheLen = -1;

    function getPaletteLabs() {
        if (_paletteLabCache && _paletteLabCacheLen === PALETTE.length) {
            return _paletteLabCache;
        }
        _paletteLabCache = [];
        for (var i = 0; i < PALETTE.length; i++) {
            var c = hexToRgb(PALETTE[i].hex);
            _paletteLabCache.push(rgbToLab(c.r, c.g, c.b));
        }
        _paletteLabCacheLen = PALETTE.length;
        return _paletteLabCache;
    }

    function findClosestPaletteColor(r, g, b) {
        var labs = getPaletteLabs();
        var srcLab = rgbToLab(r, g, b);
        var bestI = 0, bestD = Infinity;
        for (var j = 0; j < labs.length; j++) {
            var d = ciede2000(srcLab, labs[j]);
            if (d < bestD) { bestD = d; bestI = j; }
        }
        return bestI;
    }

    function hexToRgb(hex) {
        return {
            r: parseInt(hex.slice(1, 3), 16),
            g: parseInt(hex.slice(3, 5), 16),
            b: parseInt(hex.slice(5, 7), 16)
        };
    }

    function luminance(hex) {
        const { r, g, b } = hexToRgb(hex);
        return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    }

    function lightenHex(hex, amt) {
        const { r, g, b } = hexToRgb(hex);
        return 'rgb(' + Math.min(255, r + amt) + ',' + Math.min(255, g + amt) + ',' + Math.min(255, b + amt) + ')';
    }

    function darkenHex(hex, amt) {
        const { r, g, b } = hexToRgb(hex);
        return 'rgb(' + Math.max(0, r - amt) + ',' + Math.max(0, g - amt) + ',' + Math.max(0, b - amt) + ')';
    }

    // ===========================
    //  缩略图小地图
    // ===========================
    var MINIMAP_MAX_SIZE = 140;

    function updateMinimap() {
        var minimap = $('minimap');
        var mmCanvas = $('minimapCanvas');
        var mmViewport = $('minimapViewport');
        if (!minimap || !mmCanvas) return;

        // 只在缩放大于 1.2 倍时显示小地图
        if (S.zoom <= 1.2) {
            minimap.classList.remove('active');
            return;
        }
        minimap.classList.add('active');

        // 计算缩略图尺寸，保持画布比例
        var gridPixelW = S.gridW * S.cellSize;
        var gridPixelH = S.gridH * S.cellSize;
        var scale = Math.min(MINIMAP_MAX_SIZE / gridPixelW, MINIMAP_MAX_SIZE / gridPixelH);
        var mmW = Math.round(gridPixelW * scale);
        var mmH = Math.round(gridPixelH * scale);

        mmCanvas.width = mmW * 2;
        mmCanvas.height = mmH * 2;
        mmCanvas.style.width = mmW + 'px';
        mmCanvas.style.height = mmH + 'px';

        var mc = mmCanvas.getContext('2d');
        mc.setTransform(2, 0, 0, 2, 0, 0);

        // 绘制背景
        mc.fillStyle = '#fff';
        mc.fillRect(0, 0, mmW, mmH);

        // 绘制色块
        var cellW = mmW / S.gridW;
        var cellH = mmH / S.gridH;
        for (var r = 0; r < S.gridH; r++) {
            for (var c = 0; c < S.gridW; c++) {
                var ci = S.grid[r][c];
                if (ci !== null && PALETTE[ci]) {
                    mc.fillStyle = PALETTE[ci].hex;
                    mc.fillRect(c * cellW, r * cellH, Math.ceil(cellW), Math.ceil(cellH));
                }
            }
        }

        // 计算视口矩形（当前可见区域在缩略图上的位置）
        var wrapperRect = canvasWrapper.getBoundingClientRect();
        var rs = S.showRuler ? 30 : 0;
        var totalW = (rs + gridPixelW) * S.zoom;
        var totalH = (rs + gridPixelH) * S.zoom;

        // 画布中心点在 wrapper 中的位置
        var centerX = wrapperRect.width / 2 + S.panX * 0 ;
        var centerY = wrapperRect.height / 2 + S.panY * 0;

        // canvasScroller 左上角在 wrapper 中的实际位置
        var scrollerLeft = wrapperRect.width / 2 - totalW / 2 + S.panX;
        var scrollerTop = wrapperRect.height / 2 - totalH / 2 + S.panY;

        // 画布内容区域（去掉标尺）的左上角
        var contentLeft = scrollerLeft + rs * S.zoom;
        var contentTop = scrollerTop + rs * S.zoom;

        // 可见区域相对于画布内容的偏移（像素）
        var visibleLeft = Math.max(0, -contentLeft) / S.zoom;
        var visibleTop = Math.max(0, -contentTop) / S.zoom;
        var visibleRight = Math.min(gridPixelW, (wrapperRect.width - contentLeft) / S.zoom);
        var visibleBottom = Math.min(gridPixelH, (wrapperRect.height - contentTop) / S.zoom);

        // 转换到缩略图坐标
        var vpLeft = visibleLeft * scale;
        var vpTop = visibleTop * scale;
        var vpWidth = (visibleRight - visibleLeft) * scale;
        var vpHeight = (visibleBottom - visibleTop) * scale;

        // 限制边界
        vpLeft = Math.max(0, vpLeft);
        vpTop = Math.max(0, vpTop);
        vpWidth = Math.min(vpWidth, mmW - vpLeft);
        vpHeight = Math.min(vpHeight, mmH - vpTop);

        mmViewport.style.left = vpLeft + 'px';
        mmViewport.style.top = vpTop + 'px';
        mmViewport.style.width = Math.max(4, vpWidth) + 'px';
        mmViewport.style.height = Math.max(4, vpHeight) + 'px';
    }

    // ===========================
    //  小地图交互
    // ===========================
    function initMinimapInteraction() {
        var minimap = $('minimap');
        var mmCanvas = $('minimapCanvas');
        if (!minimap || !mmCanvas) return;

        var isDragging = false;

        function jumpToMinimapPos(clientX, clientY) {
            var rect = mmCanvas.getBoundingClientRect();
            var mx = clientX - rect.left;
            var my = clientY - rect.top;
            var mmW = mmCanvas.clientWidth;
            var mmH = mmCanvas.clientHeight;

            // 转换为画布坐标比例
            var ratioX = mx / mmW;
            var ratioY = my / mmH;

            var gridPixelW = S.gridW * S.cellSize;
            var gridPixelH = S.gridH * S.cellSize;
            var rs = S.showRuler ? 30 : 0;

            var wrapperRect = canvasWrapper.getBoundingClientRect();

            // 目标：让 ratio 对应的位置在视口中心
            var targetX = ratioX * gridPixelW;
            var targetY = ratioY * gridPixelH;

            var totalW = (rs + gridPixelW) * S.zoom;
            var totalH = (rs + gridPixelH) * S.zoom;

            S.panX = wrapperRect.width / 2 - (rs * S.zoom + targetX * S.zoom);
            S.panY = wrapperRect.height / 2 - (rs * S.zoom + targetY * S.zoom);

            applyTransform();
        }

        mmCanvas.addEventListener('dblclick', function (e) {
            e.preventDefault();
            jumpToMinimapPos(e.clientX, e.clientY);
        });

        mmCanvas.addEventListener('mousedown', function (e) {
            if (e.button !== 0) return;
            e.preventDefault();
            isDragging = true;
            jumpToMinimapPos(e.clientX, e.clientY);
        });

        window.addEventListener('mousemove', function (e) {
            if (!isDragging) return;
            jumpToMinimapPos(e.clientX, e.clientY);
        });

        window.addEventListener('mouseup', function () {
            isDragging = false;
        });

        // 触摸支持
        mmCanvas.addEventListener('touchstart', function (e) {
            if (e.touches.length !== 1) return;
            e.preventDefault();
            isDragging = true;
            jumpToMinimapPos(e.touches[0].clientX, e.touches[0].clientY);
        }, { passive: false });

        mmCanvas.addEventListener('touchmove', function (e) {
            if (!isDragging || e.touches.length !== 1) return;
            e.preventDefault();
            jumpToMinimapPos(e.touches[0].clientX, e.touches[0].clientY);
        }, { passive: false });

        mmCanvas.addEventListener('touchend', function () {
            isDragging = false;
        });
    }

    // ===========================
    //  自定义 CSS 功能
    // ===========================
    function loadCustomCSS() {
        try {
            var savedCSS = localStorage.getItem('catpeas_custom_css');
            if (savedCSS) {
                applyCustomCSSToPage(savedCSS);
                var textarea = $('customCSSInput');
                if (textarea) textarea.value = savedCSS;
            }
        } catch (e) { /* ignore */ }
    }

    function applyCustomCSSToPage(cssText) {
        // 移除旧的自定义样式
        var oldStyle = document.getElementById('catpeas-custom-style');
        if (oldStyle) oldStyle.remove();

        if (!cssText || !cssText.trim()) return;

        // 创建新的 style 标签
        var style = document.createElement('style');
        style.id = 'catpeas-custom-style';
        style.textContent = cssText;
        document.head.appendChild(style);
    }

    function saveCustomCSS(cssText) {
        try {
            if (cssText && cssText.trim()) {
                localStorage.setItem('catpeas_custom_css', cssText);
            } else {
                localStorage.removeItem('catpeas_custom_css');
            }
        } catch (e) { /* ignore */ }
    }

    // ===========================
    //  图片裁剪功能
    // ===========================
    var _cropState = {
        img: null,
        displayW: 0,
        displayH: 0,
        naturalW: 0,
        naturalH: 0,
        scaleRatio: 1,
        // 选区坐标（相对于canvas显示区域的像素坐标）
        selX: 0,
        selY: 0,
        selW: 0,
        selH: 0,
        hasSelection: false,
        isDragging: false,
        dragType: '', // 'new', 'move', 'tl','tr','bl','br','t','b','l','r'
        dragStartX: 0,
        dragStartY: 0,
        dragStartSel: null,
        canvasOffsetX: 0,
        canvasOffsetY: 0
    };

    function openCropModal(img) {
        _cropState.img = img;
        _cropState.naturalW = img.naturalWidth;
        _cropState.naturalH = img.naturalHeight;
        _cropState.hasSelection = false;

        var modal = $('cropModal');
        modal.classList.add('active');

        // 延迟渲染，让弹窗先显示
        setTimeout(function () {
            renderCropCanvas();
            updateCropBoardSize();
            bindCropEvents();
        }, 50);
    }

    function closeCropModal() {
        $('cropModal').classList.remove('active');
        unbindCropEvents();
        _cropState.img = null;
    }

    function renderCropCanvas() {
        var canvas = $('cropCanvas');
        var wrap = $('cropCanvasWrap');
        var img = _cropState.img;
        if (!img) return;

        // 计算画布可用空间
        var maxW = wrap.clientWidth - 4;
        var maxH = Math.min(wrap.clientHeight || 500, window.innerHeight * 0.58);

        // 保持图片比例缩放到可用区域内
        var ratio = Math.min(maxW / img.naturalWidth, maxH / img.naturalHeight, 1);
        var dw = Math.round(img.naturalWidth * ratio);
        var dh = Math.round(img.naturalHeight * ratio);

        canvas.width = dw;
        canvas.height = dh;
        canvas.style.width = dw + 'px';
        canvas.style.height = dh + 'px';

        var ctx2 = canvas.getContext('2d');
        ctx2.clearRect(0, 0, dw, dh);
        ctx2.drawImage(img, 0, 0, dw, dh);

        _cropState.displayW = dw;
        _cropState.displayH = dh;
        _cropState.scaleRatio = ratio;

        // 清除选区
        resetCropSelection();

        // 更新信息
        $('cropInfoText').textContent = '原始图片: ' + img.naturalWidth + '×' + img.naturalHeight + ' 像素 | 拖拽框选裁剪区域，或直接使用整张图片';
    }

    function resetCropSelection() {
        _cropState.hasSelection = false;
        _cropState.selX = 0;
        _cropState.selY = 0;
        _cropState.selW = 0;
        _cropState.selH = 0;
        var sel = $('cropSelection');
        sel.classList.remove('active');
        updateCropHandles();
        updateCropBoardSize();
    }

    function updateCropSelection() {
        var sel = $('cropSelection');
        var canvas = $('cropCanvas');
        if (!_cropState.hasSelection || _cropState.selW < 2 || _cropState.selH < 2) {
            sel.classList.remove('active');
            updateCropHandles();
            return;
        }

        sel.classList.add('active');

        // 计算选区相对于 wrap 的位置
        var canvasRect = canvas.getBoundingClientRect();
        var wrapRect = $('cropCanvasWrap').getBoundingClientRect();
        var offsetX = canvasRect.left - wrapRect.left;
        var offsetY = canvasRect.top - wrapRect.top;

        var sx = offsetX + _cropState.selX;
        var sy = offsetY + _cropState.selY;

        sel.style.left = sx + 'px';
        sel.style.top = sy + 'px';
        sel.style.width = _cropState.selW + 'px';
        sel.style.height = _cropState.selH + 'px';

        updateCropHandles();
        updateCropBoardSize();
    }

    function updateCropHandles() {
        var sel = $('cropSelection');
        var handles = document.querySelectorAll('.crop-handle');
        if (!_cropState.hasSelection || _cropState.selW < 2 || _cropState.selH < 2) {
            handles.forEach(function (h) { h.style.display = 'none'; });
            return;
        }

        var canvas = $('cropCanvas');
        var canvasRect = canvas.getBoundingClientRect();
        var wrapRect = $('cropCanvasWrap').getBoundingClientRect();
        var offsetX = canvasRect.left - wrapRect.left;
        var offsetY = canvasRect.top - wrapRect.top;

        var sx = offsetX + _cropState.selX;
        var sy = offsetY + _cropState.selY;
        var sw = _cropState.selW;
        var sh = _cropState.selH;
        var hs = 6; // 把手半尺寸

        var positions = {
            'tl': { left: sx - hs, top: sy - hs },
            'tr': { left: sx + sw - hs, top: sy - hs },
            'bl': { left: sx - hs, top: sy + sh - hs },
            'br': { left: sx + sw - hs, top: sy + sh - hs },
            't':  { left: sx + sw / 2 - hs, top: sy - hs },
            'b':  { left: sx + sw / 2 - hs, top: sy + sh - hs },
            'l':  { left: sx - hs, top: sy + sh / 2 - hs },
            'r':  { left: sx + sw - hs, top: sy + sh / 2 - hs }
        };

        handles.forEach(function (h) {
            var handleType = h.dataset.handle;
            if (positions[handleType]) {
                h.style.display = 'block';
                h.style.left = positions[handleType].left + 'px';
                h.style.top = positions[handleType].top + 'px';
            }
        });
    }

    function updateCropBoardSize() {
        var autoBoard = $('cropAutoBoard').checked;
        var img = _cropState.img;
        if (!img) return;

        var cropW, cropH;
        if (_cropState.hasSelection && _cropState.selW > 2 && _cropState.selH > 2) {
            // 裁剪区域对应原图的像素
            cropW = Math.round(_cropState.selW / _cropState.scaleRatio);
            cropH = Math.round(_cropState.selH / _cropState.scaleRatio);
        } else {
            cropW = img.naturalWidth;
            cropH = img.naturalHeight;
        }

        if (autoBoard) {
            // 计算需要的格子数：每格代表的像素 = 图片像素 / 格数
            // 反过来：格数 = 图片宽 / (图片最大边 / 当前画板最大边)
            // 更直观的做法：保持像素比例，按52格的倍数向上取
            var boardUnit = S.splitSize || 52;
            var ratio = cropW / cropH;

            var gridW, gridH;
            if (ratio >= 1) {
                // 宽图：以宽边为基准
                gridW = Math.max(boardUnit, Math.ceil(cropW / Math.max(1, Math.floor(cropW / boardUnit))) );
                // 按比例计算高
                gridH = Math.round(gridW / ratio);
                // 向上对齐到 boardUnit 的倍数
                gridW = Math.ceil(gridW / boardUnit) * boardUnit;
                gridH = Math.max(boardUnit, Math.ceil(gridH / boardUnit) * boardUnit);
            } else {
                // 高图
                gridH = Math.max(boardUnit, Math.ceil(cropH / Math.max(1, Math.floor(cropH / boardUnit))) );
                gridW = Math.round(gridH * ratio);
                gridH = Math.ceil(gridH / boardUnit) * boardUnit;
                gridW = Math.max(boardUnit, Math.ceil(gridW / boardUnit) * boardUnit);
            }

            // 限制最大
            gridW = Math.min(gridW, 200);
            gridH = Math.min(gridH, 200);
            // 至少是一个板
            gridW = Math.max(gridW, boardUnit);
            gridH = Math.max(gridH, boardUnit);

            $('cropBoardSize').textContent = gridW + '×' + gridH;

            // 显示板数
            var boardCols = Math.ceil(gridW / boardUnit);
            var boardRows = Math.ceil(gridH / boardUnit);
            if (boardCols * boardRows > 1) {
                $('cropBoardSize').textContent += ' (' + boardCols + '×' + boardRows + ' = ' + (boardCols * boardRows) + '块板)';
            }
        } else {
            $('cropBoardSize').textContent = S.gridW + '×' + S.gridH + '（保持当前）';
        }

        // 更新选区尺寸信息
        if (_cropState.hasSelection && _cropState.selW > 2) {
            $('cropInfoText').textContent = '选区: ' + cropW + '×' + cropH + ' 像素 | 比例 ' + (cropW / cropH).toFixed(2);
        } else {
            $('cropInfoText').textContent = '原始图片: ' + img.naturalWidth + '×' + img.naturalHeight + ' 像素 | 拖拽框选裁剪区域';
        }

        $('cropSizeInfo').style.display = autoBoard ? 'block' : 'none';
    }

    function getCropResult() {
        var img = _cropState.img;
        if (!img) return null;

        var sx, sy, sw, sh;
        if (_cropState.hasSelection && _cropState.selW > 2 && _cropState.selH > 2) {
            sx = Math.round(_cropState.selX / _cropState.scaleRatio);
            sy = Math.round(_cropState.selY / _cropState.scaleRatio);
            sw = Math.round(_cropState.selW / _cropState.scaleRatio);
            sh = Math.round(_cropState.selH / _cropState.scaleRatio);
        } else {
            sx = 0;
            sy = 0;
            sw = img.naturalWidth;
            sh = img.naturalHeight;
        }

        // 边界检查
        sx = Math.max(0, sx);
        sy = Math.max(0, sy);
        sw = Math.min(sw, img.naturalWidth - sx);
        sh = Math.min(sh, img.naturalHeight - sy);

        // 创建裁剪后的图片
        var tmpCanvas = document.createElement('canvas');
        tmpCanvas.width = sw;
        tmpCanvas.height = sh;
        var tmpCtx = tmpCanvas.getContext('2d');
        tmpCtx.drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);

        var croppedImg = new Image();
        croppedImg.src = tmpCanvas.toDataURL('image/png');

        return {
            img: croppedImg,
            canvas: tmpCanvas,
            width: sw,
            height: sh
        };
    }

    function applyCropAndSetRef(skipCrop) {
        var img = _cropState.img;
        if (!img) return;

        var autoBoard = $('cropAutoBoard').checked;

        if (skipCrop) {
            // 使用整图
            if (autoBoard) {
                autoResizeBoardForImage(img.naturalWidth, img.naturalHeight);
            }
            S.refImage = img;
            $('imageControls').style.display = 'block';
            $('gridAlignBtn').style.display = '';
            renderBg();
            closeCropModal();
            return;
        }

        // 有裁剪
        var result = getCropResult();
        if (!result) {
            closeCropModal();
            return;
        }

        if (autoBoard) {
            autoResizeBoardForImage(result.width, result.height);
        }

        // 等裁剪后的图片加载完成
        if (result.img.complete) {
            S.refImage = result.img;
            $('imageControls').style.display = 'block';
            $('gridAlignBtn').style.display = '';
            renderBg();
            closeCropModal();
        } else {
            result.img.onload = function () {
                S.refImage = result.img;
                $('imageControls').style.display = 'block';
                $('gridAlignBtn').style.display = '';
                renderBg();
                closeCropModal();
            };
        }
    }

    function autoResizeBoardForImage(imgW, imgH) {
        var boardUnit = S.splitSize || 52;
        var ratio = imgW / imgH;

        var gridW, gridH;
        if (ratio >= 1) {
            gridW = Math.max(boardUnit, Math.ceil(imgW / Math.max(1, Math.floor(imgW / boardUnit))));
            gridH = Math.round(gridW / ratio);
            gridW = Math.ceil(gridW / boardUnit) * boardUnit;
            gridH = Math.max(boardUnit, Math.ceil(gridH / boardUnit) * boardUnit);
        } else {
            gridH = Math.max(boardUnit, Math.ceil(imgH / Math.max(1, Math.floor(imgH / boardUnit))));
            gridW = Math.round(gridH * ratio);
            gridH = Math.ceil(gridH / boardUnit) * boardUnit;
            gridW = Math.max(boardUnit, Math.ceil(gridW / boardUnit) * boardUnit);
        }

        gridW = Math.min(Math.max(gridW, boardUnit), 200);
        gridH = Math.min(Math.max(gridH, boardUnit), 200);

        // 检查是否需要改变画布尺寸
        if (gridW !== S.gridW || gridH !== S.gridH) {
            var oldGrid = S.grid;
            var oldW = S.gridW;
            var oldH = S.gridH;

            S.gridW = gridW;
            S.gridH = gridH;
            S.grid = [];

            for (var r = 0; r < gridH; r++) {
                S.grid[r] = new Array(gridW).fill(null);
                if (r < oldH) {
                    for (var c = 0; c < Math.min(gridW, oldW); c++) {
                        S.grid[r][c] = oldGrid[r][c];
                    }
                }
            }

            initLayers();
            for (var lr = 0; lr < Math.min(gridH, oldH); lr++) {
                for (var lc = 0; lc < Math.min(gridW, oldW); lc++) {
                    S.layers[0].grid[lr][lc] = S.grid[lr][lc];
                }
            }

            $('canvasWidth').value = gridW;
            $('canvasHeight').value = gridH;

            // 同步更新预设按钮的高亮状态
            document.querySelectorAll('.btn-preset').forEach(function (b) {
                b.classList.toggle('active',
                    parseInt(b.dataset.w) === gridW && parseInt(b.dataset.h) === gridH
                );
            });

            pushHistory('自动扩展画板');
            setupCanvas();
            render();
        }
    }

    // 裁剪事件绑定
    var _cropBoundEvents = false;
    var _cropMouseDown = null;
    var _cropMouseMove = null;
    var _cropMouseUp = null;

    function bindCropEvents() {
        if (_cropBoundEvents) return;
        _cropBoundEvents = true;

        var wrap = $('cropCanvasWrap');
        var canvas = $('cropCanvas');

        _cropMouseDown = function (e) {
            e.preventDefault();
            var rect = canvas.getBoundingClientRect();
            var mx = e.clientX - rect.left;
            var my = e.clientY - rect.top;

            // 检查是否点在把手上
            var handle = e.target.closest('.crop-handle');
            if (handle && _cropState.hasSelection) {
                _cropState.isDragging = true;
                _cropState.dragType = handle.dataset.handle;
                _cropState.dragStartX = e.clientX;
                _cropState.dragStartY = e.clientY;
                _cropState.dragStartSel = {
                    x: _cropState.selX,
                    y: _cropState.selY,
                    w: _cropState.selW,
                    h: _cropState.selH
                };
                return;
            }

            // 检查是否在选区内（移动）
            if (_cropState.hasSelection) {
                if (mx >= _cropState.selX && mx <= _cropState.selX + _cropState.selW &&
                    my >= _cropState.selY && my <= _cropState.selY + _cropState.selH) {
                    _cropState.isDragging = true;
                    _cropState.dragType = 'move';
                    _cropState.dragStartX = e.clientX;
                    _cropState.dragStartY = e.clientY;
                    _cropState.dragStartSel = {
                        x: _cropState.selX,
                        y: _cropState.selY,
                        w: _cropState.selW,
                        h: _cropState.selH
                    };
                    return;
                }
            }

            // 新选区
            _cropState.isDragging = true;
            _cropState.dragType = 'new';
            _cropState.selX = mx;
            _cropState.selY = my;
            _cropState.selW = 0;
            _cropState.selH = 0;
            _cropState.hasSelection = true;
            _cropState.dragStartX = e.clientX;
            _cropState.dragStartY = e.clientY;
            _cropState.dragStartSel = { x: mx, y: my, w: 0, h: 0 };
        };

        _cropMouseMove = function (e) {
            if (!_cropState.isDragging) return;
            e.preventDefault();

            var rect = canvas.getBoundingClientRect();
            var dx = e.clientX - _cropState.dragStartX;
            var dy = e.clientY - _cropState.dragStartY;
            var keepRatio = $('cropKeepRatio').checked;
            var ss = _cropState.dragStartSel;

            if (_cropState.dragType === 'new') {
                var mx = e.clientX - rect.left;
                var my = e.clientY - rect.top;
                mx = Math.max(0, Math.min(mx, _cropState.displayW));
                my = Math.max(0, Math.min(my, _cropState.displayH));

                var x1 = ss.x;
                var y1 = ss.y;
                var x2 = mx;
                var y2 = my;

                if (keepRatio) {
                    var side = Math.max(Math.abs(x2 - x1), Math.abs(y2 - y1));
                    x2 = x1 + (x2 >= x1 ? side : -side);
                    y2 = y1 + (y2 >= y1 ? side : -side);
                }

                _cropState.selX = Math.min(x1, x2);
                _cropState.selY = Math.min(y1, y2);
                _cropState.selW = Math.abs(x2 - x1);
                _cropState.selH = Math.abs(y2 - y1);
            } else if (_cropState.dragType === 'move') {
                var nx = ss.x + dx;
                var ny = ss.y + dy;
                nx = Math.max(0, Math.min(nx, _cropState.displayW - ss.w));
                ny = Math.max(0, Math.min(ny, _cropState.displayH - ss.h));
                _cropState.selX = nx;
                _cropState.selY = ny;
                _cropState.selW = ss.w;
                _cropState.selH = ss.h;
            } else {
                // 把手拖拽
                var ht = _cropState.dragType;
                var nx2 = ss.x, ny2 = ss.y, nw = ss.w, nh = ss.h;

                if (ht === 'br' || ht === 'r' || ht === 'tr') {
                    nw = Math.max(4, ss.w + dx);
                }
                if (ht === 'bl' || ht === 'l' || ht === 'tl') {
                    nx2 = ss.x + dx;
                    nw = ss.w - dx;
                    if (nw < 4) { nx2 = ss.x + ss.w - 4; nw = 4; }
                }
                if (ht === 'br' || ht === 'b' || ht === 'bl') {
                    nh = Math.max(4, ss.h + dy);
                }
                if (ht === 'tl' || ht === 't' || ht === 'tr') {
                    ny2 = ss.y + dy;
                    nh = ss.h - dy;
                    if (nh < 4) { ny2 = ss.y + ss.h - 4; nh = 4; }
                }

                if (keepRatio) {
                    var side2 = Math.max(nw, nh);
                    nw = side2;
                    nh = side2;
                }

                // 边界约束
                nx2 = Math.max(0, nx2);
                ny2 = Math.max(0, ny2);
                if (nx2 + nw > _cropState.displayW) nw = _cropState.displayW - nx2;
                if (ny2 + nh > _cropState.displayH) nh = _cropState.displayH - ny2;

                _cropState.selX = nx2;
                _cropState.selY = ny2;
                _cropState.selW = nw;
                _cropState.selH = nh;
            }

            // 约束到画布范围
            if (_cropState.selX < 0) _cropState.selX = 0;
            if (_cropState.selY < 0) _cropState.selY = 0;
            if (_cropState.selX + _cropState.selW > _cropState.displayW) {
                _cropState.selW = _cropState.displayW - _cropState.selX;
            }
            if (_cropState.selY + _cropState.selH > _cropState.displayH) {
                _cropState.selH = _cropState.displayH - _cropState.selY;
            }

            updateCropSelection();
        };

        _cropMouseUp = function () {
            _cropState.isDragging = false;
            if (_cropState.selW < 4 || _cropState.selH < 4) {
                _cropState.hasSelection = false;
            }
            updateCropSelection();
        };

        wrap.addEventListener('mousedown', _cropMouseDown);
        window.addEventListener('mousemove', _cropMouseMove);
        window.addEventListener('mouseup', _cropMouseUp);

        // 触摸支持
        wrap.addEventListener('touchstart', function (e) {
            if (e.touches.length !== 1) return;
            var t = e.touches[0];
            _cropMouseDown({ clientX: t.clientX, clientY: t.clientY, target: e.target, preventDefault: function () { e.preventDefault(); } });
        }, { passive: false });

        wrap.addEventListener('touchmove', function (e) {
            if (e.touches.length !== 1) return;
            var t = e.touches[0];
            _cropMouseMove({ clientX: t.clientX, clientY: t.clientY, preventDefault: function () { e.preventDefault(); } });
        }, { passive: false });

        wrap.addEventListener('touchend', function () {
            _cropMouseUp();
        });

        // 按钮事件
        $('cropModalClose').addEventListener('click', closeCropModal);
        $('cropResetBtn').addEventListener('click', resetCropSelection);
        $('cropAutoBoard').addEventListener('change', updateCropBoardSize);
        $('cropKeepRatio').addEventListener('change', function () {
            if ($('cropKeepRatio').checked && _cropState.hasSelection) {
                var side = Math.min(_cropState.selW, _cropState.selH);
                _cropState.selW = side;
                _cropState.selH = side;
                updateCropSelection();
            }
        });

        $('cropSkipBtn').addEventListener('click', function () {
            applyCropAndSetRef(true);
        });

        $('cropApplyBtn').addEventListener('click', function () {
            applyCropAndSetRef(false);
        });

        // 网格对齐弹窗事件
        $('gridAlignClose').addEventListener('click', function () {
            closeGridAlignModal();
        });
        $('gaCancel').addEventListener('click', function () {
            closeGridAlignModal();
        });
        $('gridAlignModal').addEventListener('click', function (e) {
            if (e.target === this) closeGridAlignModal();
        });
        $('gaApply').addEventListener('click', function () {
            applyGridAlign();
        });

    }

    function unbindCropEvents() {
        var wrap = $('cropCanvasWrap');
        if (_cropMouseDown) wrap.removeEventListener('mousedown', _cropMouseDown);
        if (_cropMouseMove) window.removeEventListener('mousemove', _cropMouseMove);
        if (_cropMouseUp) window.removeEventListener('mouseup', _cropMouseUp);
        _cropBoundEvents = false;
    }

    // ===========================
    //  网格对齐功能
    // ===========================
    var _ga = {
        mode: 'image', // 'image' or 'grid'
        imgOffX: 0,
        imgOffY: 0,
        gridOffX: 0,
        gridOffY: 0,
        imgScale: 100,
        cellSizePx: 16.0,
        gridOpacity: 60,
        gridColor: 'red',
        zoom: 1,
        panX: 0,
        panY: 0,
        isPanning: false,
        panStartX: 0,
        panStartY: 0,
        panStartPanX: 0,
        panStartPanY: 0,
        isDragging: false,
        dragStartX: 0,
        dragStartY: 0,
        dragStartOffX: 0,
        dragStartOffY: 0,
        boundEvents: false
    };

    function openGridAlignModal() {
        if (!S.refImage) {
            alert('请先上传参考底图');
            return;
        }
        // 初始化对齐参数为当前值
        _ga.imgOffX = S.gridAlignImgOffX;
        _ga.imgOffY = S.gridAlignImgOffY;
        _ga.gridOffX = S.gridAlignGridOffX;
        _ga.gridOffY = S.gridAlignGridOffY;
        _ga.imgScale = Math.round(S.gridAlignImgScale * 100);
        _ga.zoom = 1;
        _ga.panX = 0;
        _ga.panY = 0;
        _ga.mode = 'image';

        // 尝试根据图片自动推算格子尺寸
        if (_ga.cellSizePx === 16.0 && S.refImage) {
            var iw = S.refImage.naturalWidth;
            var ih = S.refImage.naturalHeight;
            var totalW = S.gridW * S.cellSize;
            var totalH = S.gridH * S.cellSize;
            var baseScale = Math.min(totalW / iw, totalH / ih);
            _ga.cellSizePx = S.cellSize;
            _ga.imgScale = 100;
        }

        $('gaScaleSlider').value = _ga.imgScale;
        $('gaScaleVal').textContent = _ga.imgScale + '%';
        $('gaGridOpacitySlider').value = _ga.gridOpacity;
        $('gaGridOpacityVal').textContent = _ga.gridOpacity + '%';
        $('gaCellSizeSlider').value = Math.round(_ga.cellSizePx * 10);
        $('gaCellSizeVal').textContent = _ga.cellSizePx.toFixed(1) + ' px';
        $('gaCellSizeInput').value = _ga.cellSizePx.toFixed(1);

        document.querySelectorAll('.ga-mode-btn').forEach(function (b) {
            b.classList.toggle('active', b.dataset.mode === _ga.mode);
        });

        $('gridAlignModal').classList.add('active');

        setTimeout(function () {
            renderGridAlignPreview();
            bindGridAlignEvents();
        }, 50);
    }

    function closeGridAlignModal() {
        $('gridAlignModal').classList.remove('active');
    }

    function applyGridAlign() {
        S.gridAlignImgOffX = _ga.imgOffX;
        S.gridAlignImgOffY = _ga.imgOffY;
        S.gridAlignGridOffX = _ga.gridOffX;
        S.gridAlignGridOffY = _ga.gridOffY;
        S.gridAlignImgScale = _ga.imgScale / 100;
        closeGridAlignModal();
        renderBg();
    }

    function updateGaOffsetInfo() {
        $('gaOffsetInfo').textContent =
            '图片偏移: (' + _ga.imgOffX + ', ' + _ga.imgOffY +
            ') | 网格偏移: (' + _ga.gridOffX + ', ' + _ga.gridOffY +
            ') | 格子: ' + _ga.cellSizePx.toFixed(1) + 'px';
    }

    function renderGridAlignPreview() {
        var canvas = $('gaPreviewCanvas');
        var wrap = $('gaPreviewWrap');
        if (!canvas || !wrap || !S.refImage) return;

        var cellPx = _ga.cellSizePx;
        var totalW = S.gridW * cellPx;
        var totalH = S.gridH * cellPx;

        var dpr = Math.min(window.devicePixelRatio || 1, 2);
        var displayW = wrap.clientWidth || 700;
        var displayH = wrap.clientHeight || 400;

        canvas.width = displayW * dpr;
        canvas.height = displayH * dpr;
        canvas.style.width = displayW + 'px';
        canvas.style.height = displayH + 'px';

        var gc = canvas.getContext('2d');
        gc.setTransform(dpr, 0, 0, dpr, 0, 0);

        // 清除背景
        gc.fillStyle = '#e8e4e0';
        gc.fillRect(0, 0, displayW, displayH);

        gc.save();

        // 平移到中心 + 缩放
        var centerX = displayW / 2 + _ga.panX;
        var centerY = displayH / 2 + _ga.panY;
        gc.translate(centerX, centerY);
        gc.scale(_ga.zoom, _ga.zoom);
        gc.translate(-totalW / 2, -totalH / 2);

        // 绘制棋盘格背景
        for (var r = 0; r < S.gridH; r++) {
            for (var c = 0; c < S.gridW; c++) {
                gc.fillStyle = (r + c) % 2 === 0 ? '#fdfdfd' : '#f0edeb';
                gc.fillRect(c * cellPx, r * cellPx, cellPx, cellPx);
            }
        }

        // 绘制底图
        var iw = S.refImage.naturalWidth;
        var ih = S.refImage.naturalHeight;
        // 图片缩放：让图片按 imgScale 比例铺在网格区域上
        var baseScale = Math.min(totalW / iw, totalH / ih);
        var finalScale = baseScale * (_ga.imgScale / 100);
        var dw = iw * finalScale;
        var dh = ih * finalScale;
        var dx = (totalW - dw) / 2 + _ga.imgOffX - _ga.gridOffX;
        var dy = (totalH - dh) / 2 + _ga.imgOffY - _ga.gridOffY;

        gc.globalAlpha = 0.88;
        gc.drawImage(S.refImage, dx, dy, dw, dh);
        gc.globalAlpha = 1;

        // 绘制网格线
        var colorMap = {
            'red': 'rgba(220, 60, 60, ',
            'blue': 'rgba(54, 119, 210, ',
            'green': 'rgba(53, 227, 82, ',
            'white': 'rgba(255, 255, 255, '
        };
        var colorBase = colorMap[_ga.gridColor] || colorMap['red'];
        var opacity = _ga.gridOpacity / 100;

        for (var gr = 0; gr <= S.gridH; gr++) {
            var major = gr % 5 === 0;
            gc.strokeStyle = colorBase + (major ? Math.min(1, opacity * 1.4) : opacity * 0.65) + ')';
            gc.lineWidth = major ? 1.8 / _ga.zoom : 0.7 / _ga.zoom;
            gc.beginPath();
            gc.moveTo(0, gr * cellPx);
            gc.lineTo(totalW, gr * cellPx);
            gc.stroke();
        }
        for (var gc2 = 0; gc2 <= S.gridW; gc2++) {
            var major2 = gc2 % 5 === 0;
            gc.strokeStyle = colorBase + (major2 ? Math.min(1, opacity * 1.4) : opacity * 0.65) + ')';
            gc.lineWidth = major2 ? 1.8 / _ga.zoom : 0.7 / _ga.zoom;
            gc.beginPath();
            gc.moveTo(gc2 * cellPx, 0);
            gc.lineTo(gc2 * cellPx, totalH);
            gc.stroke();
        }

        gc.restore();

        updateGaOffsetInfo();
    }

    function bindGridAlignEvents() {
        if (_ga.boundEvents) return;
        _ga.boundEvents = true;

        var wrap = $('gaPreviewWrap');
        var canvas = $('gaPreviewCanvas');

        // 模式切换
        document.querySelectorAll('.ga-mode-btn').forEach(function (btn) {
            btn.addEventListener('click', function () {
                _ga.mode = btn.dataset.mode;
                document.querySelectorAll('.ga-mode-btn').forEach(function (b) {
                    b.classList.toggle('active', b.dataset.mode === _ga.mode);
                });
            });
        });

        // 网格格子间距滑块
        $('gaCellSizeSlider').addEventListener('input', function () {
            _ga.cellSizePx = parseInt(this.value) / 10;
            $('gaCellSizeVal').textContent = _ga.cellSizePx.toFixed(1) + ' px';
            $('gaCellSizeInput').value = _ga.cellSizePx.toFixed(1);
            renderGridAlignPreview();
        });

        // 精确数字输入
        $('gaCellSizeInput').addEventListener('change', function () {
            var val = parseFloat(this.value);
            if (isNaN(val) || val < 3) val = 3;
            if (val > 50) val = 50;
            _ga.cellSizePx = val;
            this.value = val.toFixed(1);
            $('gaCellSizeSlider').value = Math.round(val * 10);
            $('gaCellSizeVal').textContent = val.toFixed(1) + ' px';
            renderGridAlignPreview();
        });

        // 自动检测格子间距
        $('gaAutoDetect').addEventListener('click', function () {
            autoDetectCellSizePx();
        });

        // 图片缩放滑块
        $('gaScaleSlider').addEventListener('input', function () {
            _ga.imgScale = parseInt(this.value);
            $('gaScaleVal').textContent = _ga.imgScale + '%';
            renderGridAlignPreview();
        });

        // 网格透明度
        $('gaGridOpacitySlider').addEventListener('input', function () {
            _ga.gridOpacity = parseInt(this.value);
            $('gaGridOpacityVal').textContent = _ga.gridOpacity + '%';
            renderGridAlignPreview();
        });

        // 网格颜色
        document.querySelectorAll('.ga-color-btn').forEach(function (btn) {
            btn.addEventListener('click', function () {
                _ga.gridColor = btn.dataset.color;
                document.querySelectorAll('.ga-color-btn').forEach(function (b) {
                    b.classList.toggle('active', b.dataset.color === _ga.gridColor);
                });
                renderGridAlignPreview();
            });
        });

        // 微调按钮
        $('gaImgUp').addEventListener('click', function () { _ga.imgOffY -= 1; renderGridAlignPreview(); });
        $('gaImgDown').addEventListener('click', function () { _ga.imgOffY += 1; renderGridAlignPreview(); });
        $('gaImgLeft').addEventListener('click', function () { _ga.imgOffX -= 1; renderGridAlignPreview(); });
        $('gaImgRight').addEventListener('click', function () { _ga.imgOffX += 1; renderGridAlignPreview(); });

        $('gaGridUp').addEventListener('click', function () { _ga.gridOffY -= 1; renderGridAlignPreview(); });
        $('gaGridDown').addEventListener('click', function () { _ga.gridOffY += 1; renderGridAlignPreview(); });
        $('gaGridLeft').addEventListener('click', function () { _ga.gridOffX -= 1; renderGridAlignPreview(); });
        $('gaGridRight').addEventListener('click', function () { _ga.gridOffX += 1; renderGridAlignPreview(); });

        // 重置
        $('gaResetOffset').addEventListener('click', function () {
            _ga.imgOffX = 0;
            _ga.imgOffY = 0;
            _ga.gridOffX = 0;
            _ga.gridOffY = 0;
            _ga.imgScale = 100;
            _ga.cellSizePx = 16.0;
            $('gaScaleSlider').value = 100;
            $('gaScaleVal').textContent = '100%';
            $('gaCellSizeSlider').value = 160;
            $('gaCellSizeVal').textContent = '16.0 px';
            $('gaCellSizeInput').value = '16.0';
            renderGridAlignPreview();
        });

        // 缩放按钮
        $('gaZoomIn').addEventListener('click', function () {
            _ga.zoom = Math.min(_ga.zoom * 1.3, 10);
            $('gaZoomVal').textContent = Math.round(_ga.zoom * 100) + '%';
            renderGridAlignPreview();
        });
        $('gaZoomOut').addEventListener('click', function () {
            _ga.zoom = Math.max(_ga.zoom / 1.3, 0.1);
            $('gaZoomVal').textContent = Math.round(_ga.zoom * 100) + '%';
            renderGridAlignPreview();
        });
        $('gaZoomFit').addEventListener('click', function () {
            _ga.zoom = 1;
            _ga.panX = 0;
            _ga.panY = 0;
            $('gaZoomVal').textContent = '100%';
            renderGridAlignPreview();
        });

        // 滚轮缩放
        wrap.addEventListener('wheel', function (e) {
            e.preventDefault();
            var d = e.deltaY > 0 ? 0.9 : 1.1;
            _ga.zoom = Math.min(Math.max(_ga.zoom * d, 0.1), 10);
            $('gaZoomVal').textContent = Math.round(_ga.zoom * 100) + '%';
            renderGridAlignPreview();
        }, { passive: false });

        // 鼠标拖拽
        canvas.addEventListener('mousedown', function (e) {
            if (e.button === 1 || e.button === 2) {
                // 中键或右键 = 平移视角
                e.preventDefault();
                _ga.isPanning = true;
                _ga.panStartX = e.clientX;
                _ga.panStartY = e.clientY;
                _ga.panStartPanX = _ga.panX;
                _ga.panStartPanY = _ga.panY;
                wrap.style.cursor = 'grabbing';
                return;
            }
            if (e.button === 0) {
                // 左键 = 拖拽图片或网格
                e.preventDefault();
                _ga.isDragging = true;
                _ga.dragStartX = e.clientX;
                _ga.dragStartY = e.clientY;
                if (_ga.mode === 'image') {
                    _ga.dragStartOffX = _ga.imgOffX;
                    _ga.dragStartOffY = _ga.imgOffY;
                } else {
                    _ga.dragStartOffX = _ga.gridOffX;
                    _ga.dragStartOffY = _ga.gridOffY;
                }
                wrap.style.cursor = 'move';
            }
        });

        window.addEventListener('mousemove', function (e) {
            if (_ga.isPanning) {
                _ga.panX = _ga.panStartPanX + (e.clientX - _ga.panStartX);
                _ga.panY = _ga.panStartPanY + (e.clientY - _ga.panStartY);
                renderGridAlignPreview();
                return;
            }
            if (_ga.isDragging) {
                var dx = (e.clientX - _ga.dragStartX) / _ga.zoom;
                var dy = (e.clientY - _ga.dragStartY) / _ga.zoom;
                if (_ga.mode === 'image') {
                    _ga.imgOffX = Math.round(_ga.dragStartOffX + dx);
                    _ga.imgOffY = Math.round(_ga.dragStartOffY + dy);
                } else {
                    _ga.gridOffX = Math.round(_ga.dragStartOffX + dx);
                    _ga.gridOffY = Math.round(_ga.dragStartOffY + dy);
                }
                renderGridAlignPreview();
            }
        });

        window.addEventListener('mouseup', function () {
            if (_ga.isPanning) {
                _ga.isPanning = false;
                wrap.style.cursor = 'grab';
            }
            if (_ga.isDragging) {
                _ga.isDragging = false;
                wrap.style.cursor = 'grab';
            }
        });

        // 阻止右键菜单
        canvas.addEventListener('contextmenu', function (e) {
            e.preventDefault();
        });

        // 触摸支持
        var _gaTouchId = null;
        var _gaPinchStart = 0;
        var _gaPinchZoom = 1;
        canvas.addEventListener('touchstart', function (e) {
            if (e.touches.length === 2) {
                // 双指缩放
                e.preventDefault();
                e.stopPropagation();
                _ga.isDragging = false;
                var dx2 = e.touches[0].clientX - e.touches[1].clientX;
                var dy2 = e.touches[0].clientY - e.touches[1].clientY;
                _gaPinchStart = Math.sqrt(dx2 * dx2 + dy2 * dy2);
                _gaPinchZoom = _ga.zoom;
                var mx = (e.touches[0].clientX + e.touches[1].clientX) / 2;
                var my = (e.touches[0].clientY + e.touches[1].clientY) / 2;
                _ga.panStartX = mx;
                _ga.panStartY = my;
                _ga.panStartPanX = _ga.panX;
                _ga.panStartPanY = _ga.panY;
                _ga.isPanning = true;
                return;
            }
            if (e.touches.length === 1) {
                e.preventDefault();
                e.stopPropagation();
                var t = e.touches[0];
                _gaTouchId = t.identifier;
                _ga.isDragging = true;
                _ga.dragStartX = t.clientX;
                _ga.dragStartY = t.clientY;
                if (_ga.mode === 'image') {
                    _ga.dragStartOffX = _ga.imgOffX;
                    _ga.dragStartOffY = _ga.imgOffY;
                } else {
                    _ga.dragStartOffX = _ga.gridOffX;
                    _ga.dragStartOffY = _ga.gridOffY;
                }
            }
        }, { passive: false });

        canvas.addEventListener('touchmove', function (e) {
            if (e.touches.length === 2 && _ga.isPanning) {
                e.preventDefault();
                e.stopPropagation();
                var dx2 = e.touches[0].clientX - e.touches[1].clientX;
                var dy2 = e.touches[0].clientY - e.touches[1].clientY;
                var dist = Math.sqrt(dx2 * dx2 + dy2 * dy2);
                _ga.zoom = Math.min(Math.max(_gaPinchZoom * (dist / _gaPinchStart), 0.1), 10);
                var mx = (e.touches[0].clientX + e.touches[1].clientX) / 2;
                var my = (e.touches[0].clientY + e.touches[1].clientY) / 2;
                _ga.panX = _ga.panStartPanX + (mx - _ga.panStartX);
                _ga.panY = _ga.panStartPanY + (my - _ga.panStartY);
                $('gaZoomVal').textContent = Math.round(_ga.zoom * 100) + '%';
                renderGridAlignPreview();
                return;
            }
            if (_ga.isDragging && e.touches.length === 1) {
                e.preventDefault();
                e.stopPropagation();
                var t = e.touches[0];
                var dx = (t.clientX - _ga.dragStartX) / _ga.zoom;
                var dy = (t.clientY - _ga.dragStartY) / _ga.zoom;
                if (_ga.mode === 'image') {
                    _ga.imgOffX = Math.round(_ga.dragStartOffX + dx);
                    _ga.imgOffY = Math.round(_ga.dragStartOffY + dy);
                } else {
                    _ga.gridOffX = Math.round(_ga.dragStartOffX + dx);
                    _ga.gridOffY = Math.round(_ga.dragStartOffY + dy);
                }
                renderGridAlignPreview();
            }
        }, { passive: false });

        canvas.addEventListener('touchend', function (e) {
            if (e.touches.length < 2) {
                _ga.isPanning = false;
            }
            if (e.touches.length === 0) {
                _ga.isDragging = false;
            }
        });
    }

    function autoDetectCellSizePx() {
        if (!S.refImage) { alert('请先上传底图'); return; }

        var img = S.refImage;
        var iw = img.naturalWidth;
        var ih = img.naturalHeight;

        // 把图片画到临时 canvas 上取像素
        var tmp = document.createElement('canvas');
        tmp.width = iw;
        tmp.height = ih;
        var tc = tmp.getContext('2d');
        tc.drawImage(img, 0, 0, iw, ih);
        var imgData = tc.getImageData(0, 0, iw, ih).data;

        // 沿多行检测颜色变化，找格子边界
        var rowsToScan = [
            Math.floor(ih * 0.25),
            Math.floor(ih * 0.4),
            Math.floor(ih * 0.5),
            Math.floor(ih * 0.6),
            Math.floor(ih * 0.75)
        ];

        var allGaps = [];
        var threshold = 25;

        rowsToScan.forEach(function (scanRow) {
            if (scanRow >= ih) return;
            var changes = [];
            var offset = scanRow * iw * 4;
            var prevR = imgData[offset], prevG = imgData[offset + 1], prevB = imgData[offset + 2];

            for (var x = 1; x < iw; x++) {
                var i = offset + x * 4;
                var r = imgData[i], g = imgData[i + 1], b = imgData[i + 2];
                var diff = Math.abs(r - prevR) + Math.abs(g - prevG) + Math.abs(b - prevB);
                if (diff > threshold) {
                    changes.push(x);
                }
                prevR = r; prevG = g; prevB = b;
            }

            // 计算相邻变化间距
            for (var j = 1; j < changes.length; j++) {
                var gap = changes[j] - changes[j - 1];
                if (gap >= 4 && gap <= 100) {
                    allGaps.push(gap);
                }
            }
        });

        if (allGaps.length < 3) {
            alert('未能自动检测到格子边界，请手动调整');
            return;
        }

        // 统计众数
        var gapCounts = {};
        allGaps.forEach(function (g) {
            gapCounts[g] = (gapCounts[g] || 0) + 1;
        });

        var bestGap = allGaps[0];
        var bestCount = 0;
        Object.entries(gapCounts).forEach(function (entry) {
            if (entry[1] > bestCount) {
                bestCount = parseInt(entry[1]);
                bestGap = parseInt(entry[0]);
            }
        });

        // 图片中的格子像素大小 = bestGap
        // 但预览中图片被缩放了，需要换算到预览坐标系
        var cellPx = _ga.cellSizePx;
        var totalW = S.gridW * cellPx;
        var totalH = S.gridH * cellPx;
        var baseScale = Math.min(totalW / iw, totalH / ih);
        var finalScale = baseScale * (_ga.imgScale / 100);

        // 在预览中，图片中的 bestGap 像素 = bestGap * finalScale 预览像素
        // 我们需要 cellPx = bestGap * finalScale
        var detectedCellPx = bestGap * finalScale;

        // 限制范围
        detectedCellPx = Math.max(3, Math.min(50, detectedCellPx));

        _ga.cellSizePx = Math.round(detectedCellPx * 10) / 10;
        $('gaCellSizeSlider').value = Math.round(_ga.cellSizePx * 10);
        $('gaCellSizeVal').textContent = _ga.cellSizePx.toFixed(1) + ' px';
        $('gaCellSizeInput').value = _ga.cellSizePx.toFixed(1);

        renderGridAlignPreview();

        alert('检测到图片中每格约 ' + bestGap + ' 像素\n已自动调整网格间距为 ' + _ga.cellSizePx.toFixed(1) + ' px\n\n如不准确，请手动微调');
    }

    // ===========================
    //  自定义弹窗（替代 alert/confirm/prompt）
    // ===========================
    function showCustomAlert(message, title) {
        return new Promise(function (resolve) {
            var overlay = $('customDialogOverlay');
            var dialog = $('customDialog');
            var titleEl = $('customDialogTitle');
            var bodyEl = $('customDialogBody');
            var confirmBtn = $('customDialogConfirm');
            var cancelBtn = $('customDialogCancel');

            titleEl.textContent = title || '提示';
            bodyEl.textContent = message;
            cancelBtn.style.display = 'none';
            confirmBtn.textContent = '好的';

            overlay.classList.add('active');

            function close() {
                overlay.classList.remove('active');
                confirmBtn.removeEventListener('click', onConfirm);
                resolve();
            }

            function onConfirm() { close(); }
            confirmBtn.addEventListener('click', onConfirm);

            overlay.addEventListener('click', function handler(e) {
                if (e.target === overlay) {
                    overlay.removeEventListener('click', handler);
                    close();
                }
            });
        });
    }

    function showCustomConfirm(message, title) {
        return new Promise(function (resolve) {
            var overlay = $('customDialogOverlay');
            var titleEl = $('customDialogTitle');
            var bodyEl = $('customDialogBody');
            var confirmBtn = $('customDialogConfirm');
            var cancelBtn = $('customDialogCancel');

            titleEl.textContent = title || '确认';
            bodyEl.textContent = message;
            cancelBtn.style.display = '';
            confirmBtn.textContent = '确定';
            cancelBtn.textContent = '取消';

            overlay.classList.add('active');

            function close(result) {
                overlay.classList.remove('active');
                confirmBtn.removeEventListener('click', onConfirm);
                cancelBtn.removeEventListener('click', onCancel);
                resolve(result);
            }

            function onConfirm() { close(true); }
            function onCancel() { close(false); }

            confirmBtn.addEventListener('click', onConfirm);
            cancelBtn.addEventListener('click', onCancel);
        });
    }

    // ===========================
    //  Toast 轻量提示
    // ===========================
    function showToast(message, type, duration) {
        type = type || 'info'; // 'success' | 'error' | 'info'
        duration = duration || 2500;

        var container = $('toastContainer');
        if (!container) return;

        var toast = document.createElement('div');
        toast.className = 'toast toast-' + type;
        toast.textContent = message;
        container.appendChild(toast);

        setTimeout(function () {
            toast.classList.add('fade-out');
            setTimeout(function () {
                if (toast.parentNode) toast.parentNode.removeChild(toast);
            }, 300);
        }, duration);
    }

    // ===========================
    //  自定义弹窗系统
    // ===========================
    function _cdReset() {
        var ov = $('cdOverlay');
        var icon = $('cdIcon');
        var title = $('cdTitle');
        var body = $('cdBody');
        var inputWrap = $('cdInputWrap');
        var input = $('cdInput');
        var cancelBtn = $('cdCancel');
        var okBtn = $('cdOk');

        icon.className = 'cd-icon cd-icon-info';
        icon.innerHTML = '<svg viewBox="0 0 24 24" width="22" height="22"><circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="1.5" fill="none"/><path d="M12 8v4M12 16h.01" stroke="currentColor" stroke-width="1.5" fill="none" stroke-linecap="round"/></svg>';
        title.textContent = '提示';
        body.textContent = '';
        inputWrap.classList.remove('active');
        input.value = '';
        input.placeholder = '';
        input.type = 'text';
        cancelBtn.style.display = '';
        cancelBtn.textContent = '取消';
        okBtn.textContent = '确定';
        okBtn.className = 'btn btn-apply cd-btn-ok';

        // 移除旧事件
        var newOk = okBtn.cloneNode(true);
        okBtn.parentNode.replaceChild(newOk, okBtn);
        var newCancel = cancelBtn.cloneNode(true);
        cancelBtn.parentNode.replaceChild(newCancel, cancelBtn);

        return {
            ov: ov,
            icon: $('cdIcon'),
            title: title,
            body: body,
            inputWrap: inputWrap,
            input: input,
            cancel: $('cdCancel'),
            ok: $('cdOk')
        };
    }

    // alert 替代
    function cdAlert(message, opts) {
        opts = opts || {};
        return new Promise(function (resolve) {
            var d = _cdReset();
            d.title.textContent = opts.title || '提示';
            d.body.textContent = message;
            d.cancel.style.display = 'none';
            d.ok.textContent = opts.okText || '好的';

            if (opts.type === 'success') {
                d.icon.className = 'cd-icon cd-icon-success';
                d.icon.innerHTML = '<svg viewBox="0 0 24 24" width="22" height="22"><circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="1.5" fill="none"/><path d="M8 12l2.5 2.5L16 9" stroke="currentColor" stroke-width="1.8" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>';
            } else if (opts.type === 'error') {
                d.icon.className = 'cd-icon cd-icon-danger';
                d.icon.innerHTML = '<svg viewBox="0 0 24 24" width="22" height="22"><circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="1.5" fill="none"/><path d="M15 9l-6 6M9 9l6 6" stroke="currentColor" stroke-width="1.5" fill="none" stroke-linecap="round"/></svg>';
            } else if (opts.type === 'warn') {
                d.icon.className = 'cd-icon cd-icon-warn';
                d.icon.innerHTML = '<svg viewBox="0 0 24 24" width="22" height="22"><path d="M12 2L2 20h20L12 2z" stroke="currentColor" stroke-width="1.5" fill="none" stroke-linecap="round" stroke-linejoin="round"/><path d="M12 9v4M12 17h.01" stroke="currentColor" stroke-width="1.5" fill="none" stroke-linecap="round"/></svg>';
            }

            d.ov.classList.add('active');

            d.ok.addEventListener('click', function () {
                d.ov.classList.remove('active');
                resolve();
            });
        });
    }

    // confirm 替代
    function cdConfirm(message, opts) {
        opts = opts || {};
        return new Promise(function (resolve) {
            var d = _cdReset();
            d.title.textContent = opts.title || '确认';
            d.body.textContent = message;
            d.ok.textContent = opts.okText || '确定';
            d.cancel.textContent = opts.cancelText || '取消';

            if (opts.danger) {
                d.icon.className = 'cd-icon cd-icon-danger';
                d.icon.innerHTML = '<svg viewBox="0 0 24 24" width="22" height="22"><circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="1.5" fill="none"/><path d="M12 8v4M12 16h.01" stroke="currentColor" stroke-width="1.5" fill="none" stroke-linecap="round"/></svg>';
                d.ok.classList.add('cd-btn-danger');
            } else if (opts.type === 'warn') {
                d.icon.className = 'cd-icon cd-icon-warn';
                d.icon.innerHTML = '<svg viewBox="0 0 24 24" width="22" height="22"><path d="M12 2L2 20h20L12 2z" stroke="currentColor" stroke-width="1.5" fill="none" stroke-linecap="round" stroke-linejoin="round"/><path d="M12 9v4M12 17h.01" stroke="currentColor" stroke-width="1.5" fill="none" stroke-linecap="round"/></svg>';
            }

            d.ov.classList.add('active');

            d.ok.addEventListener('click', function () {
                d.ov.classList.remove('active');
                resolve(true);
            });

            d.cancel.addEventListener('click', function () {
                d.ov.classList.remove('active');
                resolve(false);
            });
        });
    }

    // prompt 替代
    function cdPrompt(message, opts) {
        opts = opts || {};
        return new Promise(function (resolve) {
            var d = _cdReset();
            d.title.textContent = opts.title || '请输入';
            d.body.textContent = message;
            d.inputWrap.classList.add('active');
            d.input.value = opts.defaultValue || '';
            d.input.placeholder = opts.placeholder || '';
            if (opts.inputType) d.input.type = opts.inputType;
            d.ok.textContent = opts.okText || '确定';
            d.cancel.textContent = opts.cancelText || '取消';

            d.ov.classList.add('active');

            // 自动聚焦输入框
            setTimeout(function () { d.input.focus(); d.input.select(); }, 100);

            // 回车确认
            d.input.addEventListener('keydown', function (e) {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    d.ov.classList.remove('active');
                    resolve(d.input.value);
                }
                if (e.key === 'Escape') {
                    d.ov.classList.remove('active');
                    resolve(null);
                }
            });

            d.ok.addEventListener('click', function () {
                d.ov.classList.remove('active');
                resolve(d.input.value);
            });

            d.cancel.addEventListener('click', function () {
                d.ov.classList.remove('active');
                resolve(null);
            });
        });
    }

    // ===========================
    //  Go!
    // ===========================
    init();
})();
