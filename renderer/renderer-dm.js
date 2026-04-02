// ══════════════════════════════════════════════════════════════════
// MODULE: GỬI DM (page-dm) — File riêng, không sửa renderer.js
// v2: + Session Lifecycle Simulator + Read-Before-Send Pattern
// ══════════════════════════════════════════════════════════════════
(function initDMModule() {
    'use strict';
    const el = window.electron || {};
    const ez = el.zalo || {};
    const $ = id => document.getElementById(id);

    let _targets = [];
    let _running = false;
    let _stopRequested = false;
    let _cookie = null;
    let _loggedIn = false;
    let _sentUids = new Set();  // Duplicate filter
    let _adminUids = new Set(); // Admin filter

    // ══════════════════════════════════════════════════════════════
    // ANTI-DETECTION: Session Lifecycle Simulator
    // Mô phỏng: gửi 25-35 tin → nghỉ 1-3 phút (đóng app) → tiếp
    // ══════════════════════════════════════════════════════════════
    function getSessionSize() {
        const h = new Date().getHours();
        // Buổi tối 18h-23h: session lớn hơn → gửi nhiều hơn (50-80 tin)
        if (h >= 18 && h < 23) return 50 + Math.floor(Math.random() * 31); 
        // Ban ngày: bình thường (25-35 tin)
        return 25 + Math.floor(Math.random() * 11); 
    }

    function getBreakDuration() {
        const h = new Date().getHours();
        // Buổi tối: nghỉ ngắn hơn → gửi nhanh hơn (20-40s)
        if (h >= 18 && h < 23) return (20 + Math.random() * 20) * 1000; 
        // Ban ngày: nghỉ bình thường (60-180s)
        return (60 + Math.random() * 120) * 1000; 
    }

    // ══════════════════════════════════════════════════════════════
    // ANTI-DETECTION: Read-Before-Send Pattern
    // getUserInfo → delay 2-5s "đọc profile" → rồi mới gửi
    // 85% chance cho người lạ, mô phỏng "xem trước khi nhắn"
    // ══════════════════════════════════════════════════════════════
    const READ_PROFILE_CHANCE = 0.85;
    const READ_DELAY_MIN = 2000;
    const READ_DELAY_MAX = 5000;

    async function readBeforeSend(uid, name, logFn) {
        const h = new Date().getHours();
        const isEvening = h >= 18 && h < 23;

        // Buổi tối: 75% chance đọc profile (nhanh hơn), Ban ngày: 85%
        const readChance = isEvening ? 0.75 : 0.85;

        if (Math.random() > readChance) return; // skip tự nhiên

        logFn('   👤 Đang xem profile ' + name + '...', 'info');

        // Gọi getUserInfo qua bridge API (không dùng raw IPC — bị block bởi allowlist)
        try {
            if (ez.findUser) {
                await ez.findUser(_cookie || 'QR_SESSION', uid);
            }
        } catch (e) {
            // Không sao — mục đích chính là tạo delay giả lập xem profile
        }

        // Buổi tối lướt nhanh hơn (1 - 2.5s), Ban ngày lướt chậm hơn (2 - 5s)
        const minDelay = isEvening ? 1000 : 2000;
        const maxDelay = isEvening ? 2500 : 5000;
        const readTime = minDelay + Math.random() * (maxDelay - minDelay);
        await new Promise(r => setTimeout(r, readTime));
    }

    // ══════════════════════════════════════════════════════════════
    // ANTI-DETECTION: Human-like delay (Poisson distribution)
    // ══════════════════════════════════════════════════════════════
    function getHumanDelay() {
        const h = new Date().getHours();
        const isEvening = h >= 18 && h < 23;
        const r = Math.random();

        if (isEvening) {
            // Buổi tối: Gõ nhanh hơn cực kỳ
            if (r < 0.20) return 500 + Math.random() * 1000;    // 20%: burst nhanh 0.5-1.5s
            if (r < 0.80) return 1500 + Math.random() * 1500;   // 60%: bình thường 1.5-3s
            if (r < 0.95) return 3000 + Math.random() * 2000;   // 15%: chậm 3-5s
            return 6000 + Math.random() * 3000;                 // 5%: suy nghĩ 6-9s
        } else {
            // Ban ngày: Theo phân bố chậm
            if (r < 0.10) return 1000 + Math.random() * 1500;
            if (r < 0.75) return 3000 + Math.random() * 3000;
            if (r < 0.92) return 6000 + Math.random() * 4000;
            return 10000 + Math.random() * 5000;
        }
    }

    // ══════════════════════════════════════════════════════════════
    // ANTI-DETECTION: Lời chào ngẫu nhiên + zero-width
    // Nội dung tin nhắn giữ nguyên 100% — chỉ thêm lời chào phía trước
    // ══════════════════════════════════════════════════════════════
    const _zwChars = ['\u200b', '\u200c', '\u200d', '\ufeff'];

    const _greetings = [
        'Hi',
        'Hello',
        'Chào bạn',
        'Xin chào',
        'Hey',
        'Chào buổi sáng',
        'Chào buổi chiều',
        'Chào buổi tối',
        'Ê bạn ơi',
        'Bạn ơi',
        'Hi bạn nha',
        'Yo',
        'Hế lô',
        'Chào bạn nhé',
        'Hi hi',
        'Alo alo',
    ];

    function getGreeting() {
        // Ưu tiên chào buổi tối (40%)
        if (Math.random() < 0.40) {
            return 'Chào buổi tối';
        }
        return _greetings[Math.floor(Math.random() * _greetings.length)];
    }

    function spinMessage(baseMsg, targetName) {
        // 1. Thay <Name> bằng tên thật của người nhận
        let result = baseMsg.replace(/<Name>/gi, targetName || 'bạn');

        // 2. Spin syntax {A|B|C} → chọn ngẫu nhiên 1 phần tử
        result = result.replace(/\{([^}]+)\}/g, function(_, opts) {
            var arr = opts.split('|');
            return arr[Math.floor(Math.random() * arr.length)];
        });

        // 3. Thêm lời chào — nội dung gốc giữ nguyên
        result = getGreeting() + ',\n' + result;

        // 4. Chèn zero-width char để mỗi tin unique ở mức byte
        const zwPos = Math.floor(Math.random() * Math.max(1, result.length - 1)) + 1;
        const zw = _zwChars[Math.floor(Math.random() * _zwChars.length)];
        result = result.slice(0, zwPos) + zw + result.slice(zwPos);

        return result;
    }

    // ── Lấy login state từ store ──
    async function checkLogin() {
        try {
            const all = await el.store.getAll();
            _loggedIn = !!(all && all.loggedIn);
            _cookie = (all && all.cookie) || null;
            return _loggedIn;
        } catch (e) {
            return false;
        }
    }

    // ── Helper: Log ──
    function dmLog(msg, type) {
        const logEl = $('dmLog');
        if (!logEl) return;
        const div = document.createElement('div');
        div.style.cssText = 'font-size:11px;padding:3px 0;border-bottom:1px solid rgba(255,255,255,0.04)';
        const colors = { info: '#8b8fa3', ok: '#10b981', warn: '#f59e0b', err: '#ef4444', head: '#667eea' };
        div.style.color = colors[type] || colors.info;
        div.textContent = '[' + new Date().toLocaleTimeString() + '] ' + msg;
        logEl.appendChild(div);
        logEl.scrollTop = logEl.scrollHeight;
    }

    // ── Helper: Progress ──
    function dmProgress(pct) {
        const bar = $('dmProgressBar');
        const txt = $('dmProgressText');
        if (bar) bar.style.width = Math.min(100, pct) + '%';
        if (txt) txt.textContent = Math.round(pct) + '%';
    }

    // ── Load Groups vào dropdown ──
    async function loadGroupsToDropdown() {
        const sel = $('dmGroupSelect');
        if (!sel) return;

        const loggedIn = await checkLogin();
        if (!loggedIn) {
            sel.innerHTML = '<option value="">-- Chưa đăng nhập --</option>';
            return;
        }

        try {
            const cookie = _cookie || 'QR_SESSION';
            const result = await ez.getGroups(cookie);
            if (result && result.success && result.groups) {
                const groups = result.groups;
                sel.innerHTML = '<option value="">-- Chọn nhóm (' + groups.length + ') --</option>';
                groups.forEach(function (g) {
                    const opt = document.createElement('option');
                    opt.value = g.id || g.groupId || '';
                    opt.textContent = (g.name || g.groupName || g.id) + ' (' + (g.totalMember || g.memberCount || g.members || '?') + ' TV)';
                    sel.appendChild(opt);
                });
                dmLog('Tải được ' + groups.length + ' nhóm', 'ok');
            } else {
                sel.innerHTML = '<option value="">-- Lỗi tải nhóm --</option>';
                dmLog('Lỗi: ' + ((result && result.error) || 'Không lấy được nhóm'), 'err');
            }
        } catch (e) {
            sel.innerHTML = '<option value="">-- Lỗi: ' + e.message + ' --</option>';
            dmLog('Lỗi tải nhóm: ' + e.message, 'err');
        }
    }

    // ── Nút Tải nhóm ──
    const btnLoad = $('btnDMLoadGroups');
    if (btnLoad) {
        btnLoad.addEventListener('click', async function () {
            const loggedIn = await checkLogin();
            if (!loggedIn) {
                if (typeof toast === 'function') toast('Cần đăng nhập trước!', 'error');
                return;
            }
            btnLoad.disabled = true;
            btnLoad.textContent = '⏳ Đang tải...';
            await loadGroupsToDropdown();
            btnLoad.disabled = false;
            btnLoad.textContent = '🔄 Tải nhóm';
        });
    }

    // ── Khi chọn nhóm từ dropdown ──
    const dmGroupSelect = $('dmGroupSelect');
    if (dmGroupSelect) {
        dmGroupSelect.addEventListener('change', function () {
            const inp = $('dmSourceGroup');
            if (inp && this.value) inp.value = this.value;
        });
    }

    // ── Nút Harvest thành viên ──
    const btnHarvest = $('btnDMHarvest');
    if (btnHarvest) {
        btnHarvest.addEventListener('click', async function () {
            const loggedIn = await checkLogin();
            if (!loggedIn) {
                if (typeof toast === 'function') toast('Cần đăng nhập!', 'error');
                return;
            }
            const groupId = ($('dmSourceGroup') && $('dmSourceGroup').value || '').trim();
            if (!groupId) {
                if (typeof toast === 'function') toast('Chọn hoặc nhập ID nhóm!', 'warning');
                return;
            }

            btnHarvest.disabled = true;
            dmLog('Harvest nhóm: ' + groupId, 'head');
            dmProgress(20);

            try {
                const cookie = _cookie || 'QR_SESSION';
                const result = await ez.getGroupMembers(cookie, groupId);
                const members = (result && result.members) || result || [];

                if (!Array.isArray(members) || members.length === 0) {
                    dmLog('Không lấy được thành viên', 'warn');
                    btnHarvest.disabled = false;
                    dmProgress(0);
                    return;
                }

                _targets = members;
                dmLog('Harvest xong: ' + _targets.length + ' thành viên', 'ok');
                dmProgress(100);

                // Lưu adminIds để lọc sau
                _adminUids = new Set();
                if (result.adminIds && Array.isArray(result.adminIds)) {
                    result.adminIds.forEach(function(id) { _adminUids.add(String(id)); });
                }
                if (result.creatorId) _adminUids.add(String(result.creatorId));
                if (_adminUids.size > 0) dmLog('Phát hiện ' + _adminUids.size + ' admin/creator', 'info');

                const countEl = $('dmTargetCount');
                if (countEl) countEl.textContent = _targets.length;

                const listEl = $('dmTargetList');
                if (listEl) {
                    const show = _targets.slice(0, 50);
                    listEl.innerHTML = show.map(function (t) {
                        const name = t.displayName || t.dName || t.name || t.uid || '?';
                        return '<div style="display:flex;justify-content:space-between;padding:4px 8px;border-bottom:1px solid rgba(255,255,255,0.04);font-size:11px">'
                            + '<span>' + name + '</span>'
                            + '<span style="color:#888;font-size:10px">' + (t.uid || '') + '</span>'
                            + '</div>';
                    }).join('') + (_targets.length > 50
                        ? '<div style="padding:6px;color:#667eea;font-size:11px;text-align:center">+' + (_targets.length - 50) + ' người nữa...</div>'
                        : '');
                }

                if (typeof toast === 'function') toast('Harvest: ' + _targets.length + ' thành viên', 'success');
            } catch (e) {
                dmLog('Lỗi harvest: ' + e.message, 'err');
                dmProgress(0);
            }

            btnHarvest.disabled = false;
        });
    }

    // ══════════════════════════════════════════════════════════════
    // NÚT GỬI DM — v2 với Session Lifecycle + Read-Before-Send
    // ══════════════════════════════════════════════════════════════
    const btnSend = $('btnDMSend');
    if (btnSend) {
        btnSend.addEventListener('click', async function () {
            if (_running) return;
            if (!_targets.length) {
                if (typeof toast === 'function') toast('Cần harvest thành viên trước!', 'warning');
                return;
            }
            const msgEl = $('dmMsgContent');
            const msg = msgEl ? msgEl.value.trim() : '';
            if (!msg) {
                if (typeof toast === 'function') toast('Nhập nội dung tin nhắn!', 'warning');
                return;
            }

            const loggedIn = await checkLogin();
            if (!loggedIn) {
                if (typeof toast === 'function') toast('Cần đăng nhập!', 'error');
                return;
            }

            _running = true;
            _stopRequested = false;
            btnSend.disabled = true;
            const btnStopEl = $('btnDMStop');
            if (btnStopEl) btnStopEl.style.display = '';

            const cookie = _cookie || 'QR_SESSION';
            const total = _targets.length;
            let sent = 0, failed = 0;

            // Session Lifecycle: random session size
            let sessionSize = getSessionSize();
            let sessionSent = 0;
            let sessionNum = 1;

            dmLog('Bắt đầu gửi DM cho ' + total + ' người (session #1, mỗi session ~' + sessionSize + ' tin)...', 'head');

            for (let i = 0; i < total; i++) {
                if (_stopRequested) {
                    dmLog('Đã dừng theo yêu cầu', 'warn');
                    break;
                }

                // ── SESSION BREAK: Nghỉ giữa các session ──
                if (sessionSent >= sessionSize && i < total - 1) {
                    const breakMs = getBreakDuration();
                    const breakS = Math.round(breakMs / 1000);
                    sessionNum++;
                    dmLog('⏸ Nghỉ session ' + breakS + 's (giả lập đóng app)...', 'warn');

                    // Countdown hiển thị trên UI
                    for (let s = breakS; s > 0 && !_stopRequested; s--) {
                        const sentEl = $('dmSentCount');
                        if (sentEl) sentEl.textContent = sent + ' (nghỉ ' + s + 's)';
                        await new Promise(r => setTimeout(r, 1000));
                    }

                    // Reset session counter
                    sessionSize = getSessionSize();
                    sessionSent = 0;
                    dmLog('▶ Tiếp session #' + sessionNum + ' (mỗi session ~' + sessionSize + ' tin)', 'head');
                }

                const target = _targets[i];
                const uid = target.uid || target.id;
                const name = target.displayName || target.dName || target.name || uid;

                if (!uid) {
                    failed++;
                    dmLog('[' + (i + 1) + '/' + total + '] Không có UID: ' + name, 'warn');
                    continue;
                }

                // ── ADMIN FILTER ──
                var chkAdmin = $('dmFilterAdmin');
                if (chkAdmin && chkAdmin.checked && _adminUids.has(String(uid))) {
                    dmLog('[' + (i + 1) + '/' + total + '] ⏭ Bỏ qua admin: ' + name, 'info');
                    continue;
                }

                // ── DUPLICATE FILTER ──
                var chkDup = $('dmFilterDuplicate');
                if (chkDup && chkDup.checked && _sentUids.has(String(uid))) {
                    dmLog('[' + (i + 1) + '/' + total + '] ⏭ Đã gửi trước: ' + name, 'info');
                    continue;
                }

                // ── READ-BEFORE-SEND: Xem profile trước khi nhắn ──
                if (!_stopRequested) {
                    await readBeforeSend(uid, name, dmLog);
                }

                try {
                    // ── MESSAGE SPIN: <Name> + {A|B|C} + greeting + zero-width ──
                    const spunMsg = spinMessage(msg, name);
                    const r = await ez.sendMessageByUid(cookie, uid, spunMsg);
                    if (r && r.success) {
                        sent++;
                        sessionSent++;
                        _sentUids.add(String(uid));
                        dmLog('[' + (i + 1) + '/' + total + '] ✅ ' + name, 'ok');

                        // ── COMBO: KẾT BẠN sau khi gửi DM ──
                        var chkFriend = $('dmAddFriend');
                        if (chkFriend && chkFriend.checked) {
                            await new Promise(function(r) { setTimeout(r, 2000 + Math.random() * 2000); });
                            try {
                                await ez.sendFriendRequestByUid(cookie, uid, '');
                                dmLog('   🤝 Đã gửi lời mời kết bạn ' + name, 'ok');
                            } catch(fe) {
                                dmLog('   ⚠ Kết bạn lỗi: ' + fe.message, 'warn');
                            }
                        }
                    } else {
                        failed++;
                        dmLog('[' + (i + 1) + '/' + total + '] ❌ ' + name + ': ' + ((r && r.error) || 'failed'), 'err');
                    }
                } catch (e) {
                    failed++;
                    dmLog('[' + (i + 1) + '/' + total + '] ❌ ' + name + ': ' + e.message, 'err');
                }

                dmProgress(((i + 1) / total) * 100);

                const sentEl = $('dmSentCount');
                const failEl = $('dmFailCount');
                if (sentEl) sentEl.textContent = sent;
                if (failEl) failEl.textContent = failed;

                // ── HUMAN DELAY: Custom UI hoặc Poisson fallback ──
                if (i < total - 1 && !_stopRequested) {
                    var minEl = $('dmDelayMin'), maxEl = $('dmDelayMax');
                    var userMin = minEl ? parseFloat(minEl.value) : 0;
                    var userMax = maxEl ? parseFloat(maxEl.value) : 0;
                    var delayMs;
                    if (userMin > 0 && userMax >= userMin) {
                        delayMs = (userMin + Math.random() * (userMax - userMin)) * 1000;
                    } else {
                        delayMs = getHumanDelay();
                    }
                    await new Promise(function(r) { setTimeout(r, delayMs); });
                }
            }

            dmLog('Hoàn tất: ' + sent + ' OK, ' + failed + ' lỗi (' + sessionNum + ' sessions)', sent > 0 ? 'ok' : 'err');
            if (typeof toast === 'function') toast('DM: ' + sent + ' OK / ' + failed + ' lỗi', failed === 0 ? 'success' : 'warning');

            _running = false;
            btnSend.disabled = false;
            if (btnStopEl) btnStopEl.style.display = 'none';
        });
    }

    // ── Nút Dừng ──
    const btnStop = $('btnDMStop');
    if (btnStop) {
        btnStop.addEventListener('click', function () {
            _stopRequested = true;
            dmLog('Yêu cầu dừng...', 'warn');
        });
    }

    // ── Nút Copy UIDs ──
    const btnCopy = $('btnDMCopyUIDs');
    if (btnCopy) {
        btnCopy.addEventListener('click', function () {
            const uids = _targets.map(t => t.uid || t.id || '').filter(Boolean).join('\n');
            if (uids) {
                navigator.clipboard.writeText(uids).then(function () {
                    if (typeof toast === 'function') toast('Đã copy ' + _targets.length + ' UIDs', 'success');
                });
            }
        });
    }

    // ── Nút Xóa danh sách ──
    const btnClear = $('btnDMClearList');
    if (btnClear) {
        btnClear.addEventListener('click', function () {
            _targets = [];
            _sentUids.clear();
            _adminUids.clear();
            const listEl = $('dmTargetList');
            if (listEl) listEl.innerHTML = '<div style="color:var(--text-muted);font-size:12px;text-align:center;padding:20px">Chưa harvest</div>';
            const countEl = $('dmTargetCount');
            if (countEl) countEl.textContent = '0';
            dmProgress(0);
        });
    }

    // ── Nút Xóa log ──
    const btnClearLog = $('btnDMClearLog');
    if (btnClearLog) {
        btnClearLog.addEventListener('click', function () {
            const logEl = $('dmLog');
            if (logEl) logEl.innerHTML = '';
        });
    }

    // ── Auto-load groups khi navigate đến trang DM ──
    document.addEventListener('click', function (e) {
        const nav = e.target.closest('[data-page]');
        if (nav && nav.dataset.page === 'dm') {
            setTimeout(loadGroupsToDropdown, 300);
        }
    });

    console.log('[DM Module v2] Initialized — Session Lifecycle + Read-Before-Send');
})();
