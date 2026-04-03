// ══════════════════════════════════════════════════════════════════
// MODULE: AUTO JOIN (page-autojoin) — File riêng, không sửa renderer.js
// BUG FIX: Đọc login state qua el.store thay vì window.S
// ══════════════════════════════════════════════════════════════════
(function initAutoJoinModule() {
    'use strict';
    const el = window.electron || {};
    const ez = el.zalo || {};
    const $ = id => document.getElementById(id);

    let _running = false;
    let _cookie = null;
    let _ajListenerRegistered = false;

    // ── Lấy login state từ store ──
    async function checkLogin() {
        try {
            const all = await el.store.getAll();
            const loggedIn = !!(all && all.loggedIn);
            _cookie = (all && all.cookie) || null;
            return loggedIn;
        } catch (e) {
            return false;
        }
    }

    // ── Helper: Log ──
    function ajLog(msg, type) {
        const logEl = $('ajLog');
        if (!logEl) return;
        const div = document.createElement('div');
        div.style.cssText = 'font-size:11px;padding:3px 0;border-bottom:1px solid rgba(255,255,255,0.04)';
        const colors = { info: '#8b8fa3', ok: '#10b981', warn: '#f59e0b', err: '#ef4444', head: '#667eea' };
        div.style.color = colors[type] || colors.info;
        div.textContent = '[' + new Date().toLocaleTimeString() + '] ' + msg;
        logEl.appendChild(div);
        if (logEl.childElementCount > 300) logEl.removeChild(logEl.firstChild);
        logEl.scrollTop = logEl.scrollHeight;
    }

    // ── Helper: Progress ──
    function ajProgress(pct) {
        const bar = $('ajProgressBar');
        const txt = $('ajProgressText');
        if (bar) bar.style.width = Math.min(100, pct) + '%';
        if (txt) txt.textContent = Math.round(pct) + '%';
    }

    // ── Nút Paste ──
    const btnPaste = $('btnAJPaste');
    if (btnPaste) {
        btnPaste.addEventListener('click', async function () {
            try {
                const txt = await navigator.clipboard.readText();
                const el = $('ajGroupLinks');
                if (el) el.value = (el.value ? el.value + '\n' : '') + txt;
            } catch (e) {
                if (typeof toast === 'function') toast('Không đọc được clipboard', 'warning');
            }
        });
    }

    // ── Nút Clear ──
    const btnClear = $('btnAJClear');
    if (btnClear) {
        btnClear.addEventListener('click', function () {
            const el = $('ajGroupLinks');
            if (el) el.value = '';
        });
    }

    // ── Nút Start ──
    const btnStart = $('btnAJStart');
    if (btnStart) {
        btnStart.addEventListener('click', async function () {
            if (_running) return;

            const loggedIn = await window.checkLoginGlobal();
            if (!loggedIn) {
                if (typeof toast === 'function') toast('Cần đăng nhập!', 'error');
                return;
            }

            const linksEl = $('ajGroupLinks');
            const links = linksEl ? linksEl.value.trim().split('\n').map(l => l.trim()).filter(Boolean) : [];
            if (!links.length) {
                if (typeof toast === 'function') toast('Nhập link nhóm!', 'warning');
                return;
            }

            // Lấy cookies từ pool (nếu có) hoặc cookie chính
            let cookies = [];
            try {
                const pool = await ez.poolGetAll();
                if (pool && pool.length) {
                    cookies = pool.map(a => a.cookie).filter(Boolean);
                }
            } catch (e) { }
            if (!cookies.length && _cookie) cookies.push(_cookie);
            if (!cookies.length) cookies.push('QR_SESSION');

            _running = true;
            btnStart.style.display = 'none';
            const btnStopEl = $('btnAJStop');
            if (btnStopEl) btnStopEl.style.display = '';

            ajLog('Auto Join: ' + links.length + ' nhóm, ' + cookies.length + ' TK', 'head');
            ajProgress(0);

            // Lắng nghe progress event nếu có (chỉ đăng ký 1 lần)
            if (el.onAutoJoinProgress && !_ajListenerRegistered) {
                _ajListenerRegistered = true;
                el.onAutoJoinProgress(function (p) {
                    if (p.pct) ajProgress(p.pct);
                    if (p.status) ajLog(p.status, 'info');
                });
            }

            try {
                const result = await ez.autoJoinGroups(cookies, links);

                if (result && result.summary) {
                    const s = result.summary;
                    ajLog('Hoàn tất: Joined=' + (s.joined || 0) + ' | Đã có=' + (s.already || 0) + ' | Lỗi=' + (s.failed || 0), (s.joined || 0) > 0 ? 'ok' : 'warn');

                    const jc = $('ajJoinedCount');
                    const pc = $('ajAlreadyCount');
                    const fc = $('ajFailedCount');
                    if (jc) jc.textContent = s.joined || 0;
                    if (pc) pc.textContent = s.already || 0;
                    if (fc) fc.textContent = s.failed || 0;

                    const listEl = $('ajResultList');
                    if (listEl && result.details && result.details.length) {
                        listEl.innerHTML = result.details.map(function (d) {
                            const icon = d.status === 'joined' ? '✅' : d.status === 'already' ? '🔵' : '❌';
                            const color = d.status === 'joined' ? '#10b981' : d.status === 'already' ? '#667eea' : '#ef4444';
                            return '<div style="display:flex;justify-content:space-between;padding:4px 8px;border-bottom:1px solid rgba(255,255,255,0.04);font-size:11px">'
                                + '<span style="color:' + color + '">' + icon + ' ' + (d.name || d.link || '—') + '</span>'
                                + '<span style="color:#888;font-size:10px">' + (d.account || '') + '</span>'
                                + '</div>';
                        }).join('');
                    }

                    if (typeof toast === 'function') toast('Join: ' + (s.joined || 0) + ' OK / ' + (s.failed || 0) + ' lỗi', (s.failed || 0) === 0 ? 'success' : 'warning');
                } else {
                    ajLog('Kết quả: ' + JSON.stringify(result).substring(0, 200), 'info');
                }
            } catch (e) {
                ajLog('Lỗi: ' + e.message, 'err');
                if (typeof toast === 'function') toast('Lỗi Auto Join: ' + e.message, 'error');
            }

            ajProgress(100);
            _running = false;
            btnStart.style.display = '';
            btnStart.textContent = '▶ Chạy lại';
            if ($('btnAJStop')) $('btnAJStop').style.display = 'none';
        });
    }

    // ── Nút Lưu Nhóm Mở Chat ──
    window._lastScannedOpenChats = [];
    const btnSaveOpen = $('btnAJSaveOpen');
    if (btnSaveOpen) {
        btnSaveOpen.addEventListener('click', () => {
            if (!window._lastScannedOpenChats || window._lastScannedOpenChats.length === 0) {
                if (typeof toast === 'function') toast('Không có nhóm mở chat nào để lưu!', 'warning');
                return;
            }
            const txt = window._lastScannedOpenChats.join('\n');
            const blob = new Blob([txt], { type: 'text/plain;charset=utf-8' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `ZaloTool_NhomMoChat_${new Date().getTime()}.txt`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
            if (typeof toast === 'function') toast(`Đã lưu ${window._lastScannedOpenChats.length} link vào mục Downloads!`, 'success');
        });
    }

    // ── Nút Quét Link (Scan) ──
    const btnScan = $('btnAJScan');
    if (btnScan) {
        btnScan.addEventListener('click', async function () {
            if (_running) return;

            window.S = window.S || {};
            const loggedIn = await window.checkLoginGlobal();
            if (!loggedIn) {
                if (typeof toast === 'function') toast('Cần đăng nhập!', 'error');
                return;
            }

            const linksEl = $('ajGroupLinks');
            const links = linksEl ? linksEl.value.trim().split('\n').map(l => l.trim()).filter(Boolean) : [];
            if (!links.length) {
                if (typeof toast === 'function') toast('Nhập link nhóm!', 'warning');
                return;
            }

            let cookies = [];
            try {
                const pool = await ez.poolGetAll();
                if (pool && pool.length) {
                    cookies = pool.map(a => a.cookie).filter(Boolean);
                }
            } catch (e) { }
            if (!cookies.length && _cookie) cookies.push(_cookie);
            if (!cookies.length) cookies.push('QR_SESSION');

            _running = true;
            btnScan.style.opacity = '0.5';
            btnStart.style.display = 'none';
            const btnStopEl = $('btnAJStop');
            if (btnStopEl) btnStopEl.style.display = '';

            ajLog('Bắt đầu Quét/Lọc: ' + links.length + ' nhóm, ' + cookies.length + ' TK', 'head');
            ajProgress(0);

            if (el.onAutoJoinProgress && !_ajListenerRegistered) {
                _ajListenerRegistered = true;
                el.onAutoJoinProgress(function (p) {
                    if (p.pct) ajProgress(p.pct);
                    if (p.status) ajLog(p.status, 'info');
                });
            }

            try {
                const result = await ez.scanGroupLinks(cookies, links);

                if (result && result.scanned) {
                    ajLog('Hoàn tất quét! Thành công: ' + result.scanned.length + ' | Lỗi: ' + (result.failed ? result.failed.length : 0), 'ok');

                    // Lọc ra các nhóm Mở Chat
                    const openChats = result.scanned.filter(g => g.isOpenChat).map(g => g.link);
                    window._lastScannedOpenChats = openChats;
                    const btnSaveOpenEl = $('btnAJSaveOpen');
                    if (btnSaveOpenEl) btnSaveOpenEl.style.display = openChats.length > 0 ? '' : 'none';

                    if (openChats.length > 0) {
                        linksEl.value = openChats.join('\n');
                        ajLog(`🎉 Đã tự động chọn ${openChats.length} link Mở Chat, loại bỏ link khóa chat. Anh có thể bấm Tham Gia ngay!`, 'head');
                        if (typeof toast === 'function') toast(`Lọc được ${openChats.length} nhóm mở chat!`, 'success');
                    } else {
                        ajLog(`Tất cả link đều bị Khóa Chat hoặc Lỗi. Không tìm thấy mỏ vàng.`, 'warn');
                        if (typeof toast === 'function') toast('Không có nhóm mở chat!', 'warning');
                    }

                    const listEl = $('ajResultList');
                    if (listEl) {
                        listEl.innerHTML = result.scanned.map(function (d) {
                            const icon = d.isOpenChat ? '✅' : '🔒';
                            const color = d.isOpenChat ? '#10b981' : '#ef4444';
                            return '<div style="display:flex;justify-content:space-between;padding:4px 8px;border-bottom:1px solid rgba(255,255,255,0.04);font-size:11px">'
                                + '<span style="color:' + color + '">' + icon + ' ' + (d.groupName || d.link || '—') + '</span>'
                                + '<span style="color:#888;font-size:10px">' + (d.totalMember || 0) + ' mems</span>'
                                + '</div>';
                        }).join('');
                    }

                } else {
                    ajLog('Lỗi server: ' + JSON.stringify(result).substring(0, 200), 'err');
                }
            } catch (e) {
                ajLog('Lỗi: ' + e.message, 'err');
            }

            ajProgress(100);
            _running = false;
            btnScan.style.opacity = '1';
            btnStart.style.display = '';
            if ($('btnAJStop')) $('btnAJStop').style.display = 'none';
        });
    }

    // ── Nút Stop ──
    const btnStopMain = $('btnAJStop');
    if (btnStopMain) {
        btnStopMain.addEventListener('click', function () {
            try { ez.cancelBulkSend && ez.cancelBulkSend(); } catch (e) { }
            _running = false;
            btnStopMain.style.display = 'none';
            if (btnStart) btnStart.style.display = '';
            ajLog('Đã dừng', 'warn');
        });
    }

    // ── Nút Clear Log ──
    const btnClearLog = $('btnAJClearLog');
    if (btnClearLog) {
        btnClearLog.addEventListener('click', function () {
            const logEl = $('ajLog');
            if (logEl) logEl.innerHTML = '';
        });
    }

    console.log('[AutoJoin Module] Initialized');
})();
