// ══════════════════════════════════════════════════════════════════
// MODULE: SPAM NHÓM (Mass Group Messaging)
// Lấy danh sách nhóm của TẤT CẢ các nick và spam tin nhắn
// ══════════════════════════════════════════════════════════════════
(function initSpamGroupModule() {
    'use strict';
    const el = window.electron || {};
    const ez = el.zalo || {};
    const $ = id => document.getElementById(id);

    // ── Log UI ──
    function spamLog(msg, type = 'info') {
        const logEl = $('spamGroupLog');
        if (!logEl) return;
        const div = document.createElement('div');
        div.style.cssText = 'padding:3px 0;border-bottom:1px solid rgba(255,255,255,0.04)';
        const colors = { info: '#8b8fa3', ok: '#10b981', warn: '#f59e0b', err: '#ef4444', head: '#667eea' };
        div.style.color = colors[type] || colors.info;
        div.textContent = `[${new Date().toLocaleTimeString()}] ${msg}`;
        logEl.appendChild(div);
        if (logEl.childElementCount > 300) logEl.removeChild(logEl.firstChild);
        logEl.scrollTop = logEl.scrollHeight;
    }

    // ── Progress UI ──
    function spamProgress(pct, statusText) {
        const bar = $('spamGroupProgressBar');
        const pctText = $('spamGroupPct');
        const status = $('spamGroupStatus');
        if (bar) bar.style.width = Math.min(100, pct) + '%';
        if (pctText) pctText.textContent = Math.round(pct) + '%';
        if (status && statusText) status.textContent = statusText;
    }

    // ── Lấy danh sách tài khoản ──
    async function getActiveAccounts() {
        let accounts = [];
        try {
            const pool = await ez.poolGetAll();
            if (pool && pool.length) {
                accounts = pool.filter(a => a.status !== 'dead'); // Bỏ tài khoản chết
            }
        } catch (e) { }
        return accounts;
    }

    // ── Nút: Lấy Danh Sách Nhóm Khả Dụng ──
    const btnFetch = $('btnSpamGroupFetch');
    let _allGroupsCached = []; // [{ cookie, groupId, groupName, name }]

    if (btnFetch) {
        btnFetch.addEventListener('click', async function () {
            btnFetch.disabled = true;
            btnFetch.innerHTML = '⏳ Đang quét danh sách nhóm...';
            spamLog('Đang tải danh sách tài khoản...', 'head');
            _allGroupsCached = [];

            const accounts = await getActiveAccounts();
            if (!accounts.length) {
                spamLog('❌ Lỗi: Không có tài khoản khả dụng nào trong Pool. Cần quét mã QR đăng nhập trước!', 'err');
                if (typeof toast === 'function') toast('Chưa có tài khoản nào được đăng nhập!', 'error');
                btnFetch.disabled = false;
                btnFetch.innerHTML = '📥 Lấy Danh Sách Nhóm Khả Dụng';
                return;
            }

            spamLog(`Tìm thấy ${accounts.length} tài khoản chia sẻ. Bắt đầu tải nhóm...`, 'info');
            spamProgress(0, 'Đang tải nhóm...');

            for (let i = 0; i < accounts.length; i++) {
                const acc = accounts[i];
                const accName = acc.name || `Nick ${i+1}`;
                try {
                    spamLog(`Đang lấy nhóm của [${accName}]...`, 'warn');
                    const res = await ez.getGroups(acc.cookie);
                    if (res && res.success && res.groups) {
                        res.groups.forEach(g => {
                            _allGroupsCached.push({
                                cookie: acc.cookie,
                                accountName: accName,
                                groupId: g.id || g.groupId,
                                groupName: g.name || g.groupName || g.id,
                                totalMember: g.totalMember || 0
                            });
                        });
                        spamLog(`👉 [${accName}] có ${res.groups.length} nhóm!`, 'ok');
                    } else {
                        spamLog(`⚠️ [${accName}] Lỗi tải nhóm: ${res?.error || 'Không rõ'}`, 'err');
                    }
                } catch(e) {
                    spamLog(`⚠️ [${accName}] Lỗi API: ${e.message}`, 'err');
                }
                spamProgress((i+1)/accounts.length * 100, 'Đang quét nhóm...');
            }

            if (_allGroupsCached.length > 0) {
                spamLog(`✅ Thành công! Thu thập được tổng cộng ${_allGroupsCached.length} mục tiêu. Đã sẵn sàng Spam!`, 'head');
                if (typeof toast === 'function') toast(`Tải thành công ${_allGroupsCached.length} nhóm!`, 'success');
                btnFetch.innerHTML = `✅ Đã tải: ${_allGroupsCached.length} Nhóm | Thay đổi? Quét lại`;
            } else {
                spamLog('❌ Không tìm thấy nhóm nào tham gia. Bạn cần Join nhóm trước!', 'err');
                btnFetch.innerHTML = '📥 Lấy Danh Sách Nhóm Khả Dụng';
            }
            btnFetch.disabled = false;
        });
    }

    // Lắng nghe sự thay đổi tab sang "Spam Vào Nhóm"
    // Tab thay đổi được handle bởi renderer.js nhưng ta cần override btnStartSend
    window._isSpamGroupMode = false;
    document.addEventListener('click', (e) => {
        const btn = e.target.closest('.mode-tab');
        if (btn) {
            const mode = btn.dataset.mode;
            window._isSpamGroupMode = (mode === 'spam-group');
            
            $('panelPhone').style.display = (mode === 'phone') ? '' : 'none';
            $('panelGroup').style.display = (mode === 'group') ? '' : 'none';
            $('panelSpamGroup').style.display = (mode === 'spam-group') ? '' : 'none';
        }
    });

    // ── HACK: Chặn nút "Bắt đầu gửi" (btnStartSend) trong renderer.js nếu mode là spam-group ──
    const btnStartSendOrigin = $('btnStartSend');
    let isRunning = false;
    let stopRequested = false;

    if (btnStartSendOrigin) {
        // Intercept native listener
        btnStartSendOrigin.addEventListener('click', async (e) => {
            if (!window._isSpamGroupMode) return; // Cho mode cũ chạy bình thường

            e.preventDefault();
            e.stopPropagation();

            if (isRunning) return;

            // ── ĐỒNG BỘ: Hứng dữ liệu từ Memory Bus do Tab Danh Sách Nhóm Đẩy Tới ──
            if (window._swarmGroupPayload) {
                _allGroupsCached = window._swarmGroupPayload.map(g => ({
                    targetGroupId: g.id,
                    targetGroupName: g.name,
                    cookie: g._belongToCookie,
                    accountName: g._belongToName
                }));
                window._swarmGroupPayload = null; // Tiêu thụ xong thì xóa
                const btnFetch = $('btnSpamGroupFetch');
                if (btnFetch) btnFetch.innerHTML = `✅ Dùng Dữ Liệu Đồng Bộ (${_allGroupsCached.length} nhóm)`;
            }

            if (_allGroupsCached.length === 0) {
                if (typeof toast === 'function') toast('Chưa lấy danh sách nhóm! Bấm Lấy Danh Sách Nhóm Khả Dụng trước!', 'warning');
                return;
            }

            const msgEl = $('msgInput');
            const msg = msgEl ? msgEl.value.trim() : '';
            if (!msg) {
                if (typeof toast === 'function') toast('Nhập nội dung tin nhắn cần SPAM!', 'warning');
                return;
            }

            const delayInput = $('sendDelay') ? parseInt($('sendDelay').value) : 3;
            // Mode Spam cực đoan, delay cần dài hơn tí để chống block (Tự code API delay sau, đây là set ban đầu)
            
            Object.defineProperty(window, '_stopSpamGroupMode', {
                get: function() { return stopRequested; },
                set: function(v) { stopRequested = v; }
            });

            isRunning = true;
            stopRequested = false;
            btnStartSendOrigin.innerHTML = '🛑 ĐANG SPAM (Bấm Dừng Cần Thiết)';
            btnStartSendOrigin.style.background = '#ef4444';
            
            // Xử lý gửi 
            spamLog(`🔥 BẮT ĐẦU CHIẾN DỊCH SPAM ĐỘI NHÓM (${_allGroupsCached.length} NHÓM) 🔥`, 'head');

            let successCount = 0;
            let failCount = 0;

            const blockCounts = JSON.parse(localStorage.getItem('spamGroupBlockCounts') || '{}');

            for (let i = 0; i < _allGroupsCached.length; i++) {
                if (stopRequested) {
                    spamLog('⚠️ Yêu cầu DỪNG TỪ NGƯỜI DÙNG!', 'warn');
                    break;
                }

                const target = _allGroupsCached[i];
                spamProgress((i) / _allGroupsCached.length * 100, `Spamming ${i+1}/${_allGroupsCached.length}`);

                // Spintax message
                const content = spinMessage(msg);
                
                spamLog(`[${target.accountName}] Đang gửi vào nhóm: ${target.groupName}...`, 'warn');
                
                try {
                    const result = await ez.massSendGroupMsgs({
                        cookie: target.cookie,
                        groupId: target.groupId,
                        content: content
                    });
                    
                    if (result && result.success) {
                        spamLog(`[${target.accountName}] ✅ Gửi NHÓM THÀNH CÔNG: ${target.groupName}`, 'ok');
                        successCount++;
                        
                        // Clear strike count on success
                        const strikeKey = target.cookie + '_' + target.groupId;
                        if (blockCounts[strikeKey]) {
                            delete blockCounts[strikeKey];
                            localStorage.setItem('spamGroupBlockCounts', JSON.stringify(blockCounts));
                        }
                        
                    } else {
                        // Check if block 111
                        const errReason = result?.error || 'Lỗi không xác định';
                        spamLog(`[${target.accountName}] ❌ Thất bại: ${target.groupName}. Lý do: ${errReason}`, 'err');
                        failCount++;
                        if (String(errReason).includes('111')) {
                            const strikeKey = target.cookie + '_' + target.groupId;
                            blockCounts[strikeKey] = (blockCounts[strikeKey] || 0) + 1;
                            localStorage.setItem('spamGroupBlockCounts', JSON.stringify(blockCounts));
                            
                            if (blockCounts[strikeKey] >= 3) {
                                spamLog(`[${target.accountName}] ⛔ Nhóm bị khóa 111 quá 3 lần liên tiếp! TỰ ĐỘNG KICK KHỎI NHÓM để lọc rác...`, 'err');
                                try {
                                    if (ez.leaveGroup) {
                                        await ez.leaveGroup(target.cookie, target.groupId);
                                        spamLog(`[${target.accountName}] ✅ Đã tự rời khỏi nhóm rác: ${target.groupName}`, 'ok');
                                    } else {
                                        spamLog(`[${target.accountName}] ⚠️ API leaveGroup chưa sẵn sàng trong preload!`, 'warn');
                                    }
                                } catch(lvErr) {
                                    spamLog(`[${target.accountName}] ⚠️ Rời nhóm thất bại: ${lvErr.message}`, 'warn');
                                }
                            } else {
                                spamLog(`[${target.accountName}] ⛔ Bị Cấm Chat vào nhóm. Mã lỗi 111. Cảnh cáo lần ${blockCounts[strikeKey]}/3!`, 'warn');
                            }
                        }
                    }
                } catch(err) {
                    failCount++;
                    spamLog(`[${target.accountName}] ❌ Exception lỗi hệ thống: ${err.message}`, 'err');
                }

                // Chờ delay giữa 2 nhóm
                const delayMs = (delayInput + Math.random() * 5) * 1000;
                spamLog(`⏳ Chờ ${Math.round(delayMs/1000)}s chống Spam...`, 'info');
                await new Promise(r => setTimeout(r, Math.max(1000, delayMs)));
            }

            spamProgress(100, `Hoàn tất xả ${successCount} nhóm!`);
            spamLog(`🏁 TỔNG KẾT: Thành công ${successCount} nhóm | Lỗi ${failCount} nhóm.`, 'head');
            if (typeof toast === 'function') toast(`Chiến dịch hoàn tất! Cập nhật: ${successCount} thành công.`, 'success');

            // Khôi phục nút
            isRunning = false;
            btnStartSendOrigin.innerHTML = '🚀 Bắt đầu gửi Spam';
            btnStartSendOrigin.style.background = '';
        }, true);
    }

    // Nút dừng của renderer.js
    const btnStopSendOrigin = $('btnStopSend');
    if (btnStopSendOrigin) {
        btnStopSendOrigin.addEventListener('click', () => {
            if (window._isSpamGroupMode) {
                stopRequested = true;
                if (btnStartSendOrigin) {
                    btnStartSendOrigin.innerHTML = '⏳ Vui lòng đợi dừng...';
                }
            }
        });
    }

    // ── Spintax parser ──
    const _zwChars = ['\u200b', '\u200c', '\u200d', '\ufeff'];
    function spinMessage(baseMsg) {
        let result = baseMsg.replace(/\{([^}]+)\}/g, function (_, opts) {
            var arr = opts.split('|');
            return arr[Math.floor(Math.random() * arr.length)];
        });
        const zwPos = Math.floor(Math.random() * Math.max(1, result.length - 1)) + 1;
        const zw = _zwChars[Math.floor(Math.random() * _zwChars.length)];
        result = result.slice(0, zwPos) + zw + result.slice(zwPos);
        return result;
    }

    console.log('[Spam Group Module] Initialized - Sẵn sàng Bầy đàn Spam!');
})();
