// app.js — Cat Peas 拼豆图纸生成编辑器 主逻辑

(function () {
    'use strict';

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
    const S = {
        gridW: 52,
        gridH: 52,
        cellSize: 16,
        zoom: 1,
        panX: 0,
        panY: 0,
        tool: 'pen',
        currentColorIdx: 0,
        grid: [],
        showGrid: true,
        showRuler: true,
        showNumbers: true,
        showBead: false,
        history: [],
        historyIdx: -1,
        maxHistory: 50,
        isPanning: false,
        panStart: null,
        isDrawing: false,
        lastDrawCell: null,
        refImage: null,
        refOpacity: 0.5,
        cellOpacity: 1,
        maxColors: 16,
        noColor: false,
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
    }

    function applyCustomThemeColors(primary, secondary, bg) {
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

        try {
            localStorage.setItem('catpeas_theme', 'custom');
            localStorage.setItem('catpeas_custom_theme', JSON.stringify({ primary, secondary, bg }));
        } catch (e) { }
    }

    function loadSavedTheme() {
        try {
            const theme = localStorage.getItem('catpeas_theme');
            if (theme && theme !== 'default') {
                if (theme === 'custom') {
                    const data = JSON.parse(localStorage.getItem('catpeas_custom_theme') || '{}');
                    if (data.primary) applyCustomThemeColors(data.primary, data.secondary, data.bg);
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
            if (localStorage.getItem('catpeas_disclaimer_accepted') === '1') return;
        } catch (e) { /* ignore */ }

        const modal = $('disclaimerModal');
        const btn = $('disclaimerConfirm');
        const countdown = $('disclaimerCountdown');
        modal.classList.add('active');

        let remaining = 5;
        btn.disabled = true;
        btn.textContent = '请等待 ' + remaining + ' 秒';
        countdown.textContent = '请阅读以上内容（' + remaining + '秒）';

        const timer = setInterval(function () {
            remaining--;
            if (remaining > 0) {
                btn.textContent = '请等待 ' + remaining + ' 秒';
                countdown.textContent = '请阅读以上内容（' + remaining + '秒）';
            } else {
                clearInterval(timer);
                btn.disabled = false;
                btn.textContent = '我已阅读，确认进入';
                countdown.textContent = '感谢阅读';
            }
        }, 1000);

        btn.addEventListener('click', function () {
            if (btn.disabled) return;
            modal.classList.remove('active');
            try {
                localStorage.setItem('catpeas_disclaimer_accepted', '1');
            } catch (e) { /* ignore */ }
        });
    }

    function init() {
        showDisclaimer();
        initGrid();
        loadCustomColors();
        buildPalette();
        selectColor(0);
        pushHistory();
        setupCanvas();
        render();
        bindAllEvents();
        openDB();  // 预热 IndexedDB 连接
    }

    function initGrid() {
        S.grid = [];
        for (let r = 0; r < S.gridH; r++) {
            S.grid[r] = new Array(S.gridW).fill(null);
        }
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
    }

    function updateCanvasResolution() {
        const cs = S.cellSize;
        const w = S.gridW * cs;
        const h = S.gridH * cs;
        const renderScale = Math.min(Math.ceil(S.zoom), 4) * DPR;

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
    function render() {
        renderBg();
        renderMain();
        renderRulers();
        updateUsage();
        updateLegend();
        updateMobilePaletteSelection();
    }

    function renderBg() {
        const cs = S.cellSize;
        const w = S.gridW * cs;
        const h = S.gridH * cs;
        bgCtx.clearRect(0, 0, w, h);

        // Checkerboard
        for (let r = 0; r < S.gridH; r++) {
            for (let c = 0; c < S.gridW; c++) {
                bgCtx.fillStyle = (r + c) % 2 === 0 ? '#fdfdfd' : '#f5f2f0';
                bgCtx.fillRect(c * cs, r * cs, cs, cs);
            }
        }

        // Reference image
        if (S.refImage) {
            bgCtx.globalAlpha = S.refOpacity;
            bgCtx.drawImage(S.refImage, 0, 0, w, h);
            bgCtx.globalAlpha = 1;
        }
    }

    function renderMain() {
        const cs = S.cellSize;
        const w = S.gridW * cs;
        const h = S.gridH * cs;
        ctx.clearRect(0, 0, w, h);

        // Draw filled cells
        ctx.globalAlpha = S.cellOpacity;
        for (let r = 0; r < S.gridH; r++) {
            for (let c = 0; c < S.gridW; c++) {
                const ci = S.grid[r][c];
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
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            const fontSize = Math.max(6, Math.min(cs * 0.48, 11));
            ctx.font = `bold ${fontSize}px -apple-system, sans-serif`;

            for (let r = 0; r < S.gridH; r++) {
                for (let c = 0; c < S.gridW; c++) {
                    const ci = S.grid[r][c];
                    if (ci === null) continue;
                const color = PALETTE[ci];
                    const lum = luminance(color.hex);
                    ctx.fillStyle = lum > 0.55 ? 'rgba(60,50,55,0.6)' : 'rgba(255,255,255,0.75)';
                    const label = color.id.length > 3 ? color.id.slice(-2) : color.id;
                    ctx.fillText(label, c * cs + cs / 2, r * cs + cs / 2 + 0.5);
                }
            }
        }
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

        const cs = S.cellSize;
        const rs = 30;

        // Top
        const tCtx = rulerTop.getContext('2d');
        tCtx.setTransform(DPR, 0, 0, DPR, 0, 0);
        const tw = S.gridW * cs;
        tCtx.clearRect(0, 0, tw, rs);
        tCtx.fillStyle = '#f6f1ee';
        tCtx.fillRect(0, 0, tw, rs);

        tCtx.textAlign = 'center';
        tCtx.textBaseline = 'top';

        for (let c = 0; c <= S.gridW; c++) {
            const major = c % 5 === 0;
            tCtx.strokeStyle = major ? '#8d7baa' : '#cdc4d6';
            tCtx.lineWidth = major ? 1.5 : 0.6;
            tCtx.beginPath();
            tCtx.moveTo(c * cs, major ? rs * 0.35 : rs * 0.65);
            tCtx.lineTo(c * cs, rs);
            tCtx.stroke();

            if (major && c < S.gridW) {
                tCtx.fillStyle = '#8d7baa';
                tCtx.font = `bold 9px -apple-system, sans-serif`;
                tCtx.fillText(String(c), c * cs + cs * 2.5, 3);
            }
        }

        // Left
        const lCtx = rulerLeft.getContext('2d');
        lCtx.setTransform(DPR, 0, 0, DPR, 0, 0);
        const lh = S.gridH * cs;
        lCtx.clearRect(0, 0, rs, lh);
        lCtx.fillStyle = '#f6f1ee';
        lCtx.fillRect(0, 0, rs, lh);

        lCtx.textAlign = 'right';
        lCtx.textBaseline = 'middle';

        for (let r = 0; r <= S.gridH; r++) {
            const major = r % 5 === 0;
            lCtx.strokeStyle = major ? '#8d7baa' : '#cdc4d6';
            lCtx.lineWidth = major ? 1.5 : 0.6;
            lCtx.beginPath();
            lCtx.moveTo(major ? rs * 0.35 : rs * 0.65, r * cs);
            lCtx.lineTo(rs, r * cs);
            lCtx.stroke();

            if (major && r < S.gridH) {
                lCtx.fillStyle = '#8d7baa';
                lCtx.font = `bold 9px -apple-system, sans-serif`;
                lCtx.fillText(String(r), rs - 4, r * cs + cs / 2);
            }
        }
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
            // 分组标题
            const header = document.createElement('div');
            header.className = 'palette-group-header';
            header.innerHTML = '<span class="palette-group-dot" style="background:' + groups[prefix][0].color.hex + '"></span>' +
                '<span class="palette-group-title">' + (groupNames[prefix] || prefix) + '</span>' +
                '<span class="palette-group-count">' + groups[prefix].length + '色</span>' +
                '<svg class="palette-group-arrow" viewBox="0 0 12 12" width="10" height="10"><path d="M3 4.5l3 3 3-3" stroke="currentColor" stroke-width="1.5" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>';
            header.addEventListener('click', function () {
                const wrapper = this.nextElementSibling;
                const isCollapsed = wrapper.classList.toggle('collapsed');
                this.classList.toggle('collapsed', isCollapsed);
            });
            // 默认折叠状态
            header.classList.add('collapsed');
            grid.appendChild(header);

            // 色块容器
            const wrapper = document.createElement('div');
            wrapper.className = 'palette-group-colors collapsed';

            groups[prefix].forEach(item => {
                const div = document.createElement('div');
                div.className = 'palette-color' + (item.index === S.currentColorIdx ? ' active' : '');
                div.style.background = item.color.hex;
                div.dataset.idx = item.index;
                div.title = item.color.id + ' ' + item.color.name;

                const lum = luminance(item.color.hex);
                const span = document.createElement('span');
                span.className = 'color-id';
                span.textContent = item.color.id;
                span.style.color = lum > 0.55 ? 'rgba(50,40,45,0.6)' : 'rgba(255,255,255,0.8)';
                div.appendChild(span);

                div.addEventListener('click', () => selectColor(item.index));
                wrapper.appendChild(div);
            });

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
        buildMobilePalette();
    }

    function buildMobilePalette() {
        var grid = $('mobilePaletteGrid');
        if (!grid) return;
        grid.innerHTML = '';

        PALETTE.forEach(function (color, idx) {
            var div = document.createElement('div');
            div.className = 'mob-color-cell' + (idx === S.currentColorIdx ? ' active' : '');
            div.style.background = color.hex;
            div.dataset.idx = idx;
            div.title = color.id + ' ' + color.name;

            var lum = luminance(color.hex);
            var span = document.createElement('span');
            span.className = 'mob-color-id';
            span.textContent = color.id;
            span.style.color = lum > 0.55 ? 'rgba(50,40,45,0.6)' : 'rgba(255,255,255,0.8)';
            div.appendChild(span);

            div.addEventListener('click', function () {
                selectColor(idx);
            });
            grid.appendChild(div);
        });
    }

    function updateMobileUsage() {
        var totalEl = $('mobTotalBeads');
        var listEl = $('mobUsageList');
        if (!totalEl || !listEl) return;

        var counts = {};
        var total = 0;
        for (var r = 0; r < S.gridH; r++) {
            for (var c = 0; c < S.gridW; c++) {
                var ci = S.grid[r][c];
                if (ci !== null) {
                    counts[ci] = (counts[ci] || 0) + 1;
                    total++;
                }
            }
        }
        totalEl.textContent = total;

        listEl.innerHTML = '';
        Object.entries(counts)
            .sort(function (a, b) { return b[1] - a[1]; })
            .forEach(function (entry) {
                var ci = entry[0];
                var count = entry[1];
                var color = PALETTE[ci];
                if (!color) return;
                var div = document.createElement('div');
                div.className = 'mob-usage-item';
                div.innerHTML =
                    '<div class="mob-usage-swatch" style="background:' + color.hex + '"></div>' +
                    '<span class="mob-usage-name">' + color.id + ' ' + color.name + '</span>' +
                    '<span class="mob-usage-count">' + count + '</span>';
                listEl.appendChild(div);
            });
    }

    function updateMobilePaletteSelection() {
        var grid = $('mobilePaletteGrid');
        if (!grid) return;
        grid.querySelectorAll('.mob-color-cell').forEach(function (el) {
            el.classList.toggle('active', parseInt(el.dataset.idx) === S.currentColorIdx);
        });
        var preview = $('mobPalettePreview');
        var info = $('mobPaletteInfo');
        if (preview && info) {
            if (S.noColor) {
                preview.style.background = 'repeating-conic-gradient(#e0e0e0 0% 25%, #fff 0% 50%) 50% / 12px 12px';
                info.textContent = '未选择';
            } else if (PALETTE[S.currentColorIdx]) {
                var c = PALETTE[S.currentColorIdx];
                preview.style.background = c.hex;
                info.textContent = c.id + ' ' + c.name;
            }
        }
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

        updateMobilePaletteSelection();
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
        updateMobilePaletteSelection();
    }


    // ===========================
    //  History
    // ===========================
    function pushHistory() {
        S.history = S.history.slice(0, S.historyIdx + 1);
        S.history.push({
            grid: S.grid.map(r => [...r]),
            w: S.gridW,
            h: S.gridH
        });
        if (S.history.length > S.maxHistory + 1) S.history.shift();
        S.historyIdx = S.history.length - 1;
        updateHistoryUI();
    }

    function undo() {
        if (S.historyIdx > 0) { S.historyIdx--; restoreSnap(); }
    }

    function redo() {
        if (S.historyIdx < S.history.length - 1) { S.historyIdx++; restoreSnap(); }
    }

    function restoreSnap() {
        const snap = S.history[S.historyIdx];
        S.gridW = snap.w;
        S.gridH = snap.h;
        S.grid = snap.grid.map(r => [...r]);
        $('canvasWidth').value = S.gridW;
        $('canvasHeight').value = S.gridH;
        setupCanvas();
        render();
        updateHistoryUI();
    }

    function updateHistoryUI() {
        $('historyInfo').textContent = S.historyIdx + ' / ' + (S.history.length - 1);
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

        updateMobileUsage();
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
        const cs = S.cellSize;
        if (S.tool === 'pen') {
            if (S.noColor) return;
            if (S.grid[row][col] !== S.currentColorIdx) {
                S.grid[row][col] = S.currentColorIdx;
                renderCellFast(row, col, cs);
            }
        } else if (S.tool === 'eraser') {
            if (S.grid[row][col] !== null) {
                S.grid[row][col] = null;
                renderCellFast(row, col, cs);
            }
        }
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
        // 从底图采样该像素颜色
        const tmp = document.createElement('canvas');
        tmp.width = S.gridW;
        tmp.height = S.gridH;
        const tc = tmp.getContext('2d');
        tc.drawImage(S.refImage, 0, 0, S.gridW, S.gridH);
        const pixel = tc.getImageData(col, row, 1, 1).data;
        const pr = pixel[0], pg = pixel[1], pb = pixel[2];

        // 找最接近的色板颜色
        let bestI = 0, bestD = Infinity;
        for (let j = 0; j < PALETTE.length; j++) {
            const mc = hexToRgb(PALETTE[j].hex);
            const d = 2 * (pr - mc.r) ** 2 + 4 * (pg - mc.g) ** 2 + 3 * (pb - mc.b) ** 2;
            if (d < bestD) { bestD = d; bestI = j; }
        }
        selectColor(bestI);
        setTool('pen');
    }

    function fillReplace(row, col) {
        const oldCI = S.grid[row][col];
        const newCI = S.currentColorIdx;
        if (oldCI === newCI) return;
        let changed = false;
        for (let r = 0; r < S.gridH; r++)
            for (let c = 0; c < S.gridW; c++)
                if (S.grid[r][c] === oldCI) { S.grid[r][c] = newCI; changed = true; }
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
        canvasWrapper.classList.toggle('hand-mode', t === 'hand');
        mainCanvas.style.pointerEvents = t === 'hand' ? 'none' : 'auto';
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

        // Two-finger pan for mobile
        let pinchStartDist = 0, pinchStartZoom = 1;
        let panTouchStart = null;
        canvasWrapper.addEventListener('touchstart', e => {
            if (e.touches.length === 2) {
                e.preventDefault();
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
            if (e.touches.length === 2) {
                e.preventDefault();
                const dx = e.touches[0].clientX - e.touches[1].clientX;
                const dy = e.touches[0].clientY - e.touches[1].clientY;
                const dist = Math.sqrt(dx * dx + dy * dy);
                S.zoom = Math.min(Math.max(pinchStartZoom * (dist / pinchStartDist), 0.05), 6);
                if (panTouchStart) {
                    const mx = (e.touches[0].clientX + e.touches[1].clientX) / 2;
                    const my = (e.touches[0].clientY + e.touches[1].clientY) / 2;
                    S.panX = mx - panTouchStart.x;
                    S.panY = my - panTouchStart.y;
                }
                applyTransform();
            }
        }, { passive: false });

        // Toggles
        $('toggleGrid').addEventListener('change', e => { S.showGrid = e.target.checked; renderMain(); });
        $('toggleRuler').addEventListener('change', e => { S.showRuler = e.target.checked; renderRulers(); fitToView(); });
        $('toggleNumbers').addEventListener('change', e => { S.showNumbers = e.target.checked; renderMain(); });
        $('toggleBead').addEventListener('change', e => { S.showBead = e.target.checked; renderMain(); });

        // History
        $('undoBtn').addEventListener('click', undo);
        $('redoBtn').addEventListener('click', redo);
        $('clearCanvasBtn').addEventListener('click', function () {
            if (!confirm('确定要清空整个画布吗？此操作可以撤销。')) return;
            for (let r = 0; r < S.gridH; r++)
                for (let c = 0; c < S.gridW; c++)
                    S.grid[r][c] = null;
            pushHistory();
            render();
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
        $('convertBtn').addEventListener('click', convertImage);
        $('recognizeBtn').addEventListener('click', recognizeBlockImage);
        $('removeImage').addEventListener('click', () => {
            S.refImage = null;
            $('imageControls').style.display = 'none';
            $('imageInput').value = '';
            renderBg();
        });

        // Export
        $('exportPNG').addEventListener('click', () => doExport(false));
        $('exportBeadPNG').addEventListener('click', () => doExport(true));

        // Mobile panels
        if ($('mobPanelLeft')) $('mobPanelLeft').addEventListener('click', () => togglePanel('left'));
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
            var name = prompt('请输入分类名称：');
            if (!name || !name.trim()) return;
            var cat = { id: 'pcat_' + Date.now().toString(36), name: name.trim() };
            dbPut(STORE_CATEGORIES, cat).then(function () {
                _projectCategories.push(cat);
                updateProjectCategoryUI();
                $('projectCategory').value = cat.id;
            });
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
            applyCustomThemeColors(primary, secondary, bg);
        });

        $('resetTheme').addEventListener('click', function () {
            applyTheme('default');
            document.querySelectorAll('.theme-preset-btn').forEach(b => b.classList.toggle('active', b.dataset.theme === 'default'));
        });

        // Load saved theme
        loadSavedTheme();
        // Load saved theme
        loadSavedTheme();

        // 移动端色板面板事件
        var mobToggle = $('mobPaletteToggle');
        var mobPanel = $('mobilePalettePanel');
        if (mobToggle && mobPanel) {
            mobToggle.addEventListener('click', function () {
                mobPanel.classList.toggle('expanded');
            });
        }

        // 移动端色板 Tab 切换
        document.querySelectorAll('.mob-palette-tab').forEach(function (tab) {
            tab.addEventListener('click', function () {
                document.querySelectorAll('.mob-palette-tab').forEach(function (t) {
                    t.classList.remove('active');
                });
                tab.classList.add('active');
                var target = tab.dataset.tab;
                document.querySelectorAll('.mobile-palette-content').forEach(function (c) {
                    c.classList.toggle('active', c.dataset.content === target);
                });
            });
        });

    }

    // Mouse drawing
    function onMouseDown(e) {
        if (e.button !== 0) return;
        e.preventDefault();
        if (S.tool === 'hand') return;
        const cell = cellFromMouse(e);
        if (!cell) return;

        if (S.tool === 'picker') { pickColorAt(cell.row, cell.col); return; }
        if (S.tool === 'bgpicker') { pickBgColorAt(cell.row, cell.col); return; }
        if (S.tool === 'fill') { fillReplace(cell.row, cell.col); return; }

        S.isDrawing = true;
        S.lastDrawCell = cell.row + ',' + cell.col;
        paintCell(cell.row, cell.col);
    }

    function onMouseMove(e) {
        if (!S.isDrawing) return;
        const cell = cellFromMouse(e);
        if (!cell) return;
        const key = cell.row + ',' + cell.col;
        if (key !== S.lastDrawCell) {
            // Bresenham 线段插值，防止快速拖动跳格
            if (S.lastDrawCell) {
                const parts = S.lastDrawCell.split(',');
                const r0 = parseInt(parts[0]), c0 = parseInt(parts[1]);
                interpolateLine(r0, c0, cell.row, cell.col);
            }
            S.lastDrawCell = key;
            paintCell(cell.row, cell.col);
        }
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
        if (S.isDrawing) {
            S.isDrawing = false;
            pushHistory();
            updateUsage();
            updateLegend();
        }
    }

    // Touch drawing
    function onTouchStart(e) {
        if (e.touches.length !== 1) return;
        e.preventDefault();
        if (S.tool === 'hand') return;
        const cell = cellFromTouch(e);
        if (!cell) return;

        if (S.tool === 'picker') { pickColorAt(cell.row, cell.col); return; }
        if (S.tool === 'bgpicker') { pickBgColorAt(cell.row, cell.col); return; }
        if (S.tool === 'fill') { fillReplace(cell.row, cell.col); return; }

        S.isDrawing = true;
        S.lastDrawCell = cell.row + ',' + cell.col;
        paintCell(cell.row, cell.col);
    }

    function onTouchMove(e) {
        if (!S.isDrawing || e.touches.length !== 1) return;
        e.preventDefault();
        const cell = cellFromTouch(e);
        if (!cell) return;
        const key = cell.row + ',' + cell.col;
        if (key !== S.lastDrawCell) {
            if (S.lastDrawCell) {
                const parts = S.lastDrawCell.split(',');
                const r0 = parseInt(parts[0]), c0 = parseInt(parts[1]);
                interpolateLine(r0, c0, cell.row, cell.col);
            }
            S.lastDrawCell = key;
            paintCell(cell.row, cell.col);
        }
    }


    function onTouchEnd() {
        if (S.isDrawing) {
            S.isDrawing = false;
            pushHistory();
            updateUsage();
            updateLegend();
        }
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
        img.onload = () => {
            S.refImage = img;
            $('imageControls').style.display = 'block';
            renderBg();
        };
        img.src = URL.createObjectURL(file);
    }

    function convertImage() {
        if (!S.refImage) return;

        S.maxColors = Math.min(Math.max(parseInt($('maxColors').value) || 16, 2), 32);

        // Sample image at grid resolution
        const tmp = document.createElement('canvas');
        tmp.width = S.gridW;
        tmp.height = S.gridH;
        const tc = tmp.getContext('2d');
        tc.drawImage(S.refImage, 0, 0, S.gridW, S.gridH);
        const imgData = tc.getImageData(0, 0, S.gridW, S.gridH).data;

        // 背景屏蔽检测
        const filterBg = $('toggleBgFilter') && $('toggleBgFilter').checked;
        let bgColor = null;
        let bgTolSq = 0;
        if (filterBg) {
            const tol = parseInt($('bgToleranceSlider').value) || 30;
            bgTolSq = tol * tol * 3;
            const w4 = S.gridW * 4;
            const corners = [
                0,
                (S.gridW - 1) * 4,
                (S.gridH - 1) * w4,
                (S.gridH - 1) * w4 + (S.gridW - 1) * 4
            ];
            let sr = 0, sg = 0, sb = 0, cnt = 0;
            corners.forEach(function (ci) {
                if (imgData[ci + 3] > 100) {
                    sr += imgData[ci];
                    sg += imgData[ci + 1];
                    sb += imgData[ci + 2];
                    cnt++;
                }
            });
            if (cnt > 0) {
                bgColor = { r: sr / cnt, g: sg / cnt, b: sb / cnt };
            }
        }

        // Map each pixel to closest palette color
        const pmap = [];
        const counts = {};

        for (let i = 0; i < imgData.length; i += 4) {
            const pr = imgData[i], pg = imgData[i + 1], pb = imgData[i + 2], pa = imgData[i + 3];
            if (pa < 100) { pmap.push(null); continue; }

            // 背景屏蔽判断
            if (filterBg && bgColor) {
                const dr = pr - bgColor.r, dg = pg - bgColor.g, db = pb - bgColor.b;
                if (dr * dr + dg * dg + db * db < bgTolSq) {
                    pmap.push(null);
                    continue;
                }
            }

            let bestI = 0, bestD = Infinity;
            const brightness = (pr + pg + pb) / 3;

            for (let j = 0; j < PALETTE.length; j++) {
                const mc = hexToRgb(PALETTE[j].hex);
                let d = 2 * (pr - mc.r) ** 2 + 4 * (pg - mc.g) ** 2 + 3 * (pb - mc.b) ** 2;

                // Penalize white matching for non-bright pixels
                if (PALETTE[j].id === 'A01' && brightness < 210) d += 8000;
                // Penalize cream for non-cream pixels
                if (PALETTE[j].id === 'A02' && brightness < 200) d += 4000;

                if (d < bestD) { bestD = d; bestI = j; }
            }
            pmap.push(bestI);
            counts[bestI] = (counts[bestI] || 0) + 1;
        }

        // Keep only top N colors
        const topColors = Object.entries(counts)
            .sort((a, b) => b[1] - a[1])
            .slice(0, S.maxColors)
            .map(e => parseInt(e[0]));
        const allowed = new Set(topColors);

        for (let i = 0; i < pmap.length; i++) {
            if (pmap[i] === null || allowed.has(pmap[i])) continue;
            const src = hexToRgb(PALETTE[pmap[i]].hex);
            let bestI = topColors[0], bestD = Infinity;
            for (const ai of topColors) {
                const mc = hexToRgb(PALETTE[ai].hex);
                const d = (src.r - mc.r) ** 2 + (src.g - mc.g) ** 2 + (src.b - mc.b) ** 2;
                if (d < bestD) { bestD = d; bestI = ai; }
            }
            pmap[i] = bestI;
        }

        // Apply
        for (let r = 0; r < S.gridH; r++)
            for (let c = 0; c < S.gridW; c++)
                S.grid[r][c] = pmap[r * S.gridW + c];

        pushHistory();
        render();
    }


    function recognizeBlockImage() {
        if (!S.refImage) { alert('请先上传图片'); return; }

        S.maxColors = Math.min(Math.max(parseInt($('maxColors').value) || 16, 2), 32);

        const img = S.refImage;
        const imgW = img.naturalWidth;
        const imgH = img.naturalHeight;

        // 将图片绘制到临时 canvas 取像素
        const tmp = document.createElement('canvas');
        tmp.width = imgW;
        tmp.height = imgH;
        const tc = tmp.getContext('2d');
        tc.drawImage(img, 0, 0, imgW, imgH);
        const imgData = tc.getImageData(0, 0, imgW, imgH).data;

        // 自动检测色块格子大小
        const detectedCellSize = detectCellSize(imgData, imgW, imgH);
        const gridCols = Math.round(imgW / detectedCellSize);
        const gridRows = Math.round(imgH / detectedCellSize);

        $('detectedSize').textContent = gridCols + ' x ' + gridRows;
        $('recognizeHint').style.display = 'block';
        $('recognizeResizeToggle').style.display = 'flex';

        // 是否调整画布尺寸
        const shouldResize = $('recognizeResize') && $('recognizeResize').checked;
        const targetW = shouldResize ? gridCols : S.gridW;
        const targetH = shouldResize ? gridRows : S.gridH;

        if (shouldResize && (targetW !== S.gridW || targetH !== S.gridH)) {
            S.gridW = Math.min(Math.max(targetW, 4), 200);
            S.gridH = Math.min(Math.max(targetH, 4), 200);
            initGrid();
            $('canvasWidth').value = S.gridW;
            $('canvasHeight').value = S.gridH;
            setupCanvas();
        }

        // 采样：对每个格子取中心区域颜色
        const sampleCanvas = document.createElement('canvas');
        sampleCanvas.width = targetW;
        sampleCanvas.height = targetH;
        const sc = sampleCanvas.getContext('2d');
        sc.drawImage(img, 0, 0, targetW, targetH);
        const sampleData = sc.getImageData(0, 0, targetW, targetH).data;

        // 背景屏蔽
        const filterBg = $('toggleBgFilter') && $('toggleBgFilter').checked;
        let bgColor = null;
        let bgTolSq = 0;
        if (filterBg) {
            const tol = parseInt($('bgToleranceSlider').value) || 30;
            bgTolSq = tol * tol * 3;
            const w4 = targetW * 4;
            const corners = [
                0,
                (targetW - 1) * 4,
                (targetH - 1) * w4,
                (targetH - 1) * w4 + (targetW - 1) * 4
            ];
            let sr = 0, sg = 0, sb = 0, cnt = 0;
            corners.forEach(function (ci) {
                if (sampleData[ci + 3] > 100) {
                    sr += sampleData[ci];
                    sg += sampleData[ci + 1];
                    sb += sampleData[ci + 2];
                    cnt++;
                }
            });
            if (cnt > 0) {
                bgColor = { r: sr / cnt, g: sg / cnt, b: sb / cnt };
            }
        }

        // 映射到色板
        const pmap = [];
        const counts = {};

        for (let i = 0; i < sampleData.length; i += 4) {
            const pr = sampleData[i], pg = sampleData[i + 1], pb = sampleData[i + 2], pa = sampleData[i + 3];
            if (pa < 100) { pmap.push(null); continue; }

            if (filterBg && bgColor) {
                const dr = pr - bgColor.r, dg = pg - bgColor.g, db = pb - bgColor.b;
                if (dr * dr + dg * dg + db * db < bgTolSq) {
                    pmap.push(null);
                    continue;
                }
            }

            let bestI = 0, bestD = Infinity;
            for (let j = 0; j < PALETTE.length; j++) {
                const mc = hexToRgb(PALETTE[j].hex);
                const d = 2 * (pr - mc.r) ** 2 + 4 * (pg - mc.g) ** 2 + 3 * (pb - mc.b) ** 2;
                if (d < bestD) { bestD = d; bestI = j; }
            }
            pmap.push(bestI);
            counts[bestI] = (counts[bestI] || 0) + 1;
        }

        // 限制最大用色数
        const topColors = Object.entries(counts)
            .sort((a, b) => b[1] - a[1])
            .slice(0, S.maxColors)
            .map(e => parseInt(e[0]));
        const allowed = new Set(topColors);

        for (let i = 0; i < pmap.length; i++) {
            if (pmap[i] === null || allowed.has(pmap[i])) continue;
            const src = hexToRgb(PALETTE[pmap[i]].hex);
            let bestI = topColors[0], bestD = Infinity;
            for (const ai of topColors) {
                const mc = hexToRgb(PALETTE[ai].hex);
                const d = (src.r - mc.r) ** 2 + (src.g - mc.g) ** 2 + (src.b - mc.b) ** 2;
                if (d < bestD) { bestD = d; bestI = ai; }
            }
            pmap[i] = bestI;
        }

        // 写入画布
        for (let r = 0; r < targetH && r < S.gridH; r++)
            for (let c = 0; c < targetW && c < S.gridW; c++)
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

            ec.textAlign = 'center';
            ec.textBaseline = 'top';
            ec.font = 'bold 9px -apple-system, sans-serif';
            for (let c = 0; c <= S.gridW; c++) {
                const major = c % 5 === 0;
                ec.strokeStyle = major ? '#8d7baa' : '#cdc4d6';
                ec.lineWidth = major ? 1.5 : 0.6;
                ec.beginPath();
                ec.moveTo(rs + c * cs, major ? rs * 0.35 : rs * 0.65);
                ec.lineTo(rs + c * cs, rs);
                ec.stroke();
                if (major && c < S.gridW) {
                    ec.fillStyle = '#8d7baa';
                    ec.fillText(String(c), rs + c * cs + cs / 2, 3);
                }
            }

            ec.textAlign = 'right';
            ec.textBaseline = 'middle';
            for (let r = 0; r <= S.gridH; r++) {
                const major = r % 5 === 0;
                ec.strokeStyle = major ? '#8d7baa' : '#cdc4d6';
                ec.lineWidth = major ? 1.5 : 0.6;
                ec.beginPath();
                ec.moveTo(major ? rs * 0.35 : rs * 0.65, rs + r * cs);
                ec.lineTo(rs, rs + r * cs);
                ec.stroke();
                if (major && r < S.gridH) {
                    ec.fillStyle = '#8d7baa';
                    ec.fillText(String(r), rs - 4, rs + r * cs + cs / 2);
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
        ec.fillStyle = '#d4979c';
        ec.beginPath();
        ec.moveTo(logoX + 4, logoAreaH + logoY - 8);
        ec.quadraticCurveTo(logoX + 2, logoY + 6, logoX + 6, logoY + 2);
        ec.lineTo(logoX + 10, logoY - 3);
        ec.quadraticCurveTo(logoX + 11, logoY - 4, logoX + 12, logoY - 2);
        ec.lineTo(logoX + 13, logoY + 2);
        ec.lineTo(logoX + 19, logoY + 2);
        ec.lineTo(logoX + 20, logoY - 2);
        ec.quadraticCurveTo(logoX + 21, logoY - 4, logoX + 22, logoY - 3);
        ec.lineTo(logoX + 26, logoY + 2);
        ec.quadraticCurveTo(logoX + 30, logoY + 6, logoX + 28, logoAreaH + logoY - 8);
        ec.closePath();
        ec.fill();
        ec.strokeStyle = '#b07a80';
        ec.lineWidth = 0.5;
        ec.stroke();

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
        ec.globalAlpha = 0.04;
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

        // 下载
        var link = document.createElement('a');
        var ts = new Date().toISOString().slice(0, 10).replace(/-/g, '');
        link.download = 'CatPeas_' + (beadMode ? '仿真豆子' : '色块图纸') + '_' + S.gridW + 'x' + S.gridH + '_' + ts + '.png';
        link.href = exp.toDataURL('image/png');
        link.click();

        // 恢复
        S.showBead = prevBead;
        S.showGrid = prevGrid;
        S.showNumbers = prevNum;
        S.cellOpacity = prevCellOpacity;
        renderMain();
    }

    // ===========================
    //  Project Library 项目库功能
    // ===========================
    var _projectCategories = [{ id: 'default', name: '默认分类' }];
    var _selectedProjectIds = new Set();

    function generateProjectId() {
        return 'proj_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 6);
    }

    function generateThumbnail(grid, gridW, gridH) {
        var size = 128;
        var tmp = document.createElement('canvas');
        tmp.width = size;
        tmp.height = size;
        var tc = tmp.getContext('2d');
        tc.fillStyle = '#fff';
        tc.fillRect(0, 0, size, size);
        var cellW = size / gridW;
        var cellH = size / gridH;
        for (var r = 0; r < gridH; r++) {
            for (var c = 0; c < gridW; c++) {
                var ci = grid[r][c];
                if (ci !== null && PALETTE[ci]) {
                    tc.fillStyle = PALETTE[ci].hex;
                    tc.fillRect(c * cellW, r * cellH, Math.ceil(cellW), Math.ceil(cellH));
                }
            }
        }
        return tmp.toDataURL('image/png');
    }

    function saveProject() {
        var name = $('projectName').value.trim();
        if (!name) {
            alert('请输入项目名称');
            return;
        }
        var category = $('projectCategory').value || 'default';
        var now = Date.now();
        var thumbnail = generateThumbnail(S.grid, S.gridW, S.gridH);

        // 统计用色
        var total = 0;
        for (var r = 0; r < S.gridH; r++) {
            for (var c = 0; c < S.gridW; c++) {
                if (S.grid[r][c] !== null) total++;
            }
        }

        var projectData = {
            id: generateProjectId(),
            name: name,
            category: category,
            gridW: S.gridW,
            gridH: S.gridH,
            grid: S.grid.map(function (row) { return Array.from(row); }),
            thumbnail: thumbnail,
            totalBeads: total,
            createdAt: now,
            updatedAt: now,
            paletteSnapshot: PALETTE.map(function (c) {
                return { id: c.id, name: c.name, hex: c.hex };
            })
        };

        dbPut(STORE_PROJECTS, projectData).then(function () {
            alert('保存成功！项目"' + name + '"已存入项目库。');
            $('projectName').value = '';
            // 如果项目库页面正在显示，刷新列表
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

    function deleteProjects(ids) {
        if (ids.length === 0) return;
        if (!confirm('确定删除选中的 ' + ids.length + ' 个项目吗？此操作不可恢复。')) return;
        dbDeleteMultiple(STORE_PROJECTS, ids).then(function () {
            _selectedProjectIds.clear();
            triggerProjectRefresh();
        }).catch(function (err) {
            alert('删除失败：' + err.message);
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

                card.innerHTML =
                    '<div class="project-card-preview-wrap">' +
                        '<div class="project-card-check"></div>' +
                        '<img src="' + (proj.thumbnail || '') + '" alt="预览">' +
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
                            '<button class="project-card-btn btn-load" title="加载到画布">' +
                                '<svg viewBox="0 0 20 20" width="14" height="14"><path d="M4 16h12M10 4v9M7 10l3 3 3-3" stroke="currentColor" stroke-width="1.5" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>' +
                            '</button>' +
                            '<button class="project-card-btn btn-del" title="删除">' +
                                '<svg viewBox="0 0 20 20" width="14" height="14"><path d="M6 4V3a1 1 0 011-1h6a1 1 0 011 1v1M3 4h14M5 4v12a2 2 0 002 2h6a2 2 0 002-2V4" stroke="currentColor" stroke-width="1.3" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>' +
                            '</button>' +
                        '</div>' +
                    '</div>';

                // 勾选
                card.querySelector('.project-card-check').addEventListener('click', function (e) {
                    e.stopPropagation();
                    if (_selectedProjectIds.has(proj.id)) {
                        _selectedProjectIds.delete(proj.id);
                        card.classList.remove('selected');
                    } else {
                        _selectedProjectIds.add(proj.id);
                        card.classList.add('selected');
                    }
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
            triggerProjectRefresh();
            $('projectPage').classList.add('active');
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

    function escapeHtml(str) {
        var div = document.createElement('div');
        div.appendChild(document.createTextNode(str));
        return div.innerHTML;
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
    //  Utilities
    // ===========================
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
    //  Go!
    // ===========================
    init();
})();
