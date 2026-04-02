// ══════════════════════════════════════════════════════════════════
// MODULE: TRẠI NUÔI ACC (Auto Warm-up)
// v1: Auto cross-messaging between pool accounts
// ══════════════════════════════════════════════════════════════════
(function initNurtureModule() {
    'use strict';
    const el = window.electron || {};
    const ez = el.zalo || {};
    const $ = id => document.getElementById(id);

    let _running = false;
    let _stopRequested = false;

    // ══════════════════════════════════════════════════════════════
    // CONVERSATION TEMPLATES — Chào theo tên nick, nội dung tự nhiên
    // ══════════════════════════════════════════════════════════════
    const _convTemplates = [
        { open: 'Chào {name}, hôm nay thế nào?', reply: 'Cũng ổn, cảm ơn bạn!' },
        { open: 'Ê {name}, đang làm gì đấy?', reply: 'Đang rảnh, có gì không?' },
        { open: 'Hi {name}! Lâu quá không nói chuyện', reply: 'Ừa, dạo này bận quá!' },
        { open: '{name} ơi, tối nay rảnh không?', reply: 'Tuỳ nha, có việc gì?' },
        { open: 'Hello {name}, cho mình hỏi chút được không?', reply: 'Được chứ, hỏi đi!' },
        { open: 'Chào buổi sáng {name}!', reply: 'Chào buổi sáng bạn!' },
        { open: 'Chào buổi tối {name}, ngủ chưa?', reply: 'Chưa ngủ, đang lướt mạng nè' },
        { open: '{name}, mình mới thấy cái này hay lắm', reply: 'Cái gì thế? Kể nghe coi' },
        { open: 'Dạ {name}, mình muốn chia sẻ với bạn', reply: 'Gì vậy? Nói đi nha' },
        { open: '{name} ơi, weekend này có đi đâu không?', reply: 'Chắc ở nhà thôi á' },
        { open: 'Bạn {name} ơi, khoẻ không?', reply: 'Khoẻ nha, cảm ơn!' },
        { open: 'Hey {name}! Có tin gì mới không?', reply: 'Không có gì mới lắm hehe' },
    ];

    function getConversation(recipientName) {
        const tpl = _convTemplates[Math.floor(Math.random() * _convTemplates.length)];
        const name = recipientName || 'bạn';
        const emoji = [' ✨', ' 😊', ' 👍', ' ☕', ' 🌟', ''][Math.floor(Math.random() * 6)];
        const zw = ['\u200b', '\u200c', '\u200d', '\ufeff'][Math.floor(Math.random() * 4)];
        return {
            open: tpl.open.replace(/\{name\}/gi, name) + emoji + zw,
            reply: tpl.reply + zw,
        };
    }

    // ══════════════════════════════════════════════════════════════
    // SCHEDULE: Chỉ chạy trong giờ hoạt động (7h-23h)
    // ══════════════════════════════════════════════════════════════
    function isActiveHour() {
        const h = new Date().getHours();
        return h >= 7 && h < 23;
    }

    // ══════════════════════════════════════════════════════════════
    // POISSON DELAY: Thay thế delay cố định 15-45s
    // ══════════════════════════════════════════════════════════════
    function getNurtureDelay() {
        const r = Math.random();
        if (r < 0.15) return (5 + Math.random() * 10) * 1000;    // 15%: nhanh 5-15s
        if (r < 0.65) return (20 + Math.random() * 40) * 1000;   // 50%: bình thường 20-60s
        if (r < 0.90) return (60 + Math.random() * 120) * 1000;  // 25%: chậm 1-3 phút
        return (180 + Math.random() * 300) * 1000;               // 10%: rất chậm 3-8 phút
    }

    function nLog(msg, type = 'info') {
        const logEl = $('ntLog');
        if (!logEl) return;
        const div = document.createElement('div');
        div.style.cssText = 'padding:3px 0;border-bottom:1px solid rgba(255,255,255,0.05)';
        const colors = { info: '#8b949e', ok: '#10b981', warn: '#f59e0b', err: '#ef4444', head: '#8b5cf6' };
        div.style.color = colors[type] || colors.info;
        div.textContent = '[' + new Date().toLocaleTimeString() + '] ' + msg;
        logEl.appendChild(div);
        logEl.scrollTop = logEl.scrollHeight;
    }

    async function getPoolAccounts() {
        try {
            return await ez.poolGetAll() || [];
        } catch (e) {
            return [];
        }
    }

    async function getRealCookie(uid) {
        try {
            return await ez.poolGetCookie(uid);
        } catch (e) {
            return null;
        }
    }

    const btnStart = $('btnNurtureStart');
    if (btnStart) {
        btnStart.addEventListener('click', async function () {
            if (_running) return;

            const accounts = await getPoolAccounts();
            const countEl = $('ntAccCount');
            if (countEl) countEl.textContent = accounts.length;

            if (accounts.length < 2) {
                if (typeof toast === 'function') toast('Cần có ít nhất 2 acc phụ trong Pool để chéo nhau!', 'warning');
                nLog('Không đủ tài khoản trong Pool (' + accounts.length + '/2). Hãy thêm acc qua trình quản lý rẽ nhánh.', 'err');
                return;
            }

            _running = true;
            _stopRequested = false;
            btnStart.disabled = true;
            const btnStop = $('btnNurtureStop');
            if (btnStop) btnStop.style.display = '';

            nLog('========== BẮT ĐẦU WARM-UP (Trại Nuôi) ==========', 'head');
            nLog('Đã phát hiện ' + accounts.length + ' accounts. Bắt đầu phiên chéo...', 'info');

            let sent = 0, failed = 0;

            while (!_stopRequested) {
                // ── SCHEDULE CHECK: Chỉ hoạt động 7h-23h ──
                if (!isActiveHour()) {
                    nLog('💤 Ngoài giờ hoạt động (7h-23h). Chờ đến sáng...', 'warn');
                    while (!isActiveHour() && !_stopRequested) {
                        await new Promise(r => setTimeout(r, 60000)); // Check mỗi 1 phút
                    }
                    if (_stopRequested) break;
                    nLog('☀️ Đã vào giờ hoạt động. Tiếp tục nuôi...', 'head');
                }

                // 1. Pick 2 random distinct accounts
                let idxA = Math.floor(Math.random() * accounts.length);
                let idxB = Math.floor(Math.random() * accounts.length);
                while (idxB === idxA) {
                    idxB = Math.floor(Math.random() * accounts.length);
                }

                const accA = accounts[idxA];
                const accB = accounts[idxB];

                // 2. Get real cookie for sender
                const cookieA = await getRealCookie(accA.uid);
                if (!cookieA) {
                    nLog('Không lấy được cookie của: ' + (accA.name || accA.uid), 'warn');
                    failed++;
                } else {
                    // 3. GỬI TIN NHẮN CHÀO THEO TÊN (hai chiều)
                    const conv = getConversation(accB.name || accB.uid);
                    nLog(`[GỬI] ${accA.name} ──▶ ${accB.name}: "${conv.open}"`, 'info');

                    try {
                        const r = await ez.sendMessageByUid(cookieA, accB.uid, conv.open);
                        if (r && r.success) {
                            sent++;
                            nLog(`✅ OK`, 'ok');

                            // ── HỘI THOẠI HAI CHIỀU: accB reply lại accA ──
                            if (Math.random() < 0.7) { // 70% chance reply
                                const replyDelay = 3000 + Math.random() * 8000; // 3-11s đọc rồi reply
                                await new Promise(r => setTimeout(r, replyDelay));

                                const cookieB = await getRealCookie(accB.uid);
                                if (cookieB) {
                                    nLog(`[TRẢ LỜI] ${accB.name} ──▶ ${accA.name}: "${conv.reply}"`, 'info');
                                    try {
                                        const r2 = await ez.sendMessageByUid(cookieB, accA.uid, conv.reply);
                                        if (r2 && r2.success) {
                                            sent++;
                                            nLog(`✅ Reply OK`, 'ok');
                                        }
                                    } catch (_) { /* reply fail is OK */ }
                                }
                            }
                        } else {
                            failed++;
                            nLog(`❌ Lỗi: ${r ? r.error : 'Network'}`, 'err');
                        }
                    } catch (e) {
                        failed++;
                        nLog(`❌ Ngoại lệ: ${e.message}`, 'err');
                    }
                }

                // Update Stats
                const sentEl = $('ntSentCount');
                const failEl = $('ntFailCount');
                if (sentEl) sentEl.textContent = sent;
                if (failEl) failEl.textContent = failed;

                // 4. POISSON DELAY (thay vì cố định 15-45s)
                if (!_stopRequested) {
                    const delayMs = getNurtureDelay();
                    const delayS = Math.round(delayMs / 1000);
                    nLog(`⏸ Chờ ${delayS}s cho cặp tiếp theo...`, 'info');
                    for (let s = delayS; s > 0 && !_stopRequested; s--) {
                        await new Promise(r => setTimeout(r, 1000));
                    }
                }
            }

            nLog('❌ Phiên Warm-up đã dừng.', 'warn');
            _running = false;
            btnStart.disabled = false;
            if (btnStop) btnStop.style.display = 'none';
        });
    }

    const btnStop = $('btnNurtureStop');
    if (btnStop) {
        btnStop.addEventListener('click', function () {
            _stopRequested = true;
            nLog('Yêu cầu dừng...', 'warn');
        });
    }

    const btnClear = $('btnNurtureClearLog');
    if (btnClear) {
        btnClear.addEventListener('click', function () {
            const logEl = $('ntLog');
            if (logEl) logEl.innerHTML = '<div style="color:#8b949e">Đã dọn log.</div>';
        });
    }

    // Load pool counts periodically when on this page
    setInterval(async () => {
        const activePage = document.querySelector('.page.active');
        if (activePage && activePage.id === 'page-nurture' && !_running) {
            const accs = await getPoolAccounts();
            const countEl = $('ntAccCount');
            if (countEl) countEl.textContent = accs ? accs.length : 0;
        }
    }, 5000);

    console.log('[Nurture Module] Initialized');
})();
