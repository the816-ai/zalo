'use strict';

// ── Electron bridge ──────────────────────────────────────────────
const el = window.electron || {
    minimize: () => { }, maximize: () => { }, close: () => { }, hideToTray: () => { },
    store: { get: async () => null, set: async () => { }, getAll: async () => ({}) },
    onNavigate: () => { },
};

// ── State ────────────────────────────────────────────────────────
const S = {
    loggedIn: false,
    account: null,
    cookie: null,
    groups: [],
    contacts: [
        { id: 1, name: 'Nguyễn Văn An', phone: '0901234567', group: 'Khách hàng', active: true },
        { id: 2, name: 'Trần Thị Bình', phone: '0912345678', group: 'Đối tác', active: true },
        { id: 3, name: 'Lê Văn Cường', phone: '0923456789', group: 'Khách hàng', active: false },
        { id: 4, name: 'Phạm Minh Đức', phone: '0934567890', group: 'VIP', active: true },
        { id: 5, name: 'Hoàng Thị Em', phone: '0945678901', group: 'Khách hàng', active: true },
        { id: 6, name: 'Vũ Quang Huy', phone: '0956789012', group: 'Đối tác', active: true },
    ],
    templates: [
        { id: 1, name: 'Chào mừng', content: 'Xin chào {name}! Cảm ơn bạn đã quan tâm đến chúng tôi 😊', category: 'Marketing' },
        { id: 2, name: 'Khuyến mãi', content: '🎁 {name} ơi! Hôm nay {date} có ưu đãi 30% dành riêng cho bạn!', category: 'Marketing' },
        { id: 3, name: 'Chăm sóc', content: 'Xin chào {name}! Chúng tôi muốn hỏi thăm về trải nghiệm của bạn 🙏', category: 'Support' },
    ],
    send: { running: false, paused: false, ok: 0, err: 0, wait: 0 },
    friend: { running: false, paused: false, sent: 0, ok: 0, pend: 0, fail: 0 },
    selectedGroups: new Set(),
    groupFilter: 'all',
};

let sendTimer = null, frTimer = null;

// ── Seed groups (matching reference image style) ─────────────────
function seedGroups() {
    // Bắt đầu rỗng — loadState() sẽ load nhóm thật từ Zalo API
    S.groups = [];
}

// ══════════════════════════════════════════════════════════════════
// INIT
// ══════════════════════════════════════════════════════════════════


document.addEventListener('DOMContentLoaded', async () => {
    seedGroups();

    // Title bar controls
    document.getElementById('btn-min').onclick = () => el.minimize();
    document.getElementById('btn-max').onclick = () => el.maximize();
    document.getElementById('btn-close').onclick = () => el.hideToTray();

    // Navigation
    initNav();

    // Pages
    initGroups();
    initBulkSend();
    initAutoFriend();
    initContacts();
    initSettings();
    initCopyGroup();

    // Load stored data
    await loadState();

    // Tray navigate event
    el.onNavigate(page => navigate(page));

    // Navigate mặc định → page groups
    navigate('groups');

    log('info', '🚀 Zalo Tool Pro đã khởi động. Đăng nhập để bắt đầu!', 'send');
    // Auto-save sau khi đã load state xong
    setInterval(saveState, 30000);
});

// ══════════════════════════════════════════════════════════════════
// NAVIGATION
// ══════════════════════════════════════════════════════════════════
function initNav() {
    document.querySelectorAll('.nav-item[data-page]').forEach(a => {
        a.addEventListener('click', e => { e.preventDefault(); navigate(a.dataset.page); });
    });
}

window.navigate = function (page) {
    document.querySelectorAll('.nav-item[data-page]').forEach(a => {
        a.classList.toggle('active', a.dataset.page === page);
    });
    document.querySelectorAll('.page').forEach(p => {
        p.classList.toggle('active', p.id === 'page-' + page);
    });
    // ── Auto-sync Pipeline khi user navigate sang Pipeline ──
    if (page === 'pipeline') {
        setTimeout(() => { if (window.syncPipelineFromSettings) window.syncPipelineFromSettings(); }, 150);
    }
};

// ══════════════════════════════════════════════════════════════════
// GROUPS PAGE
// ══════════════════════════════════════════════════════════════════
function initGroups() {
    renderGroups();

    document.getElementById('groupSearch').addEventListener('input', e => renderGroups(e.target.value));

    document.querySelectorAll('.filter-chip').forEach(c => {
        c.addEventListener('click', () => {
            document.querySelectorAll('.filter-chip').forEach(x => x.classList.remove('active'));
            c.classList.add('active');
            S.groupFilter = c.dataset.filter;
            renderGroups(document.getElementById('groupSearch').value);
        });
    });

    // Nút gửi tin vào tất cả nhóm đã chọn
    document.getElementById('btnSendAllGroups')?.addEventListener('click', () => {
        window.sendMsgToAllSelectedGroups();
    });

    document.getElementById('btnRefreshGroups').addEventListener('click', () => {
        if (!S.loggedIn) { toast('Vui lòng đăng nhập Zalo trước!', 'error'); navigate('settings'); return; }
        const btn = document.getElementById('btnRefreshGroups');
        btn.style.transform = 'rotate(360deg)';
        btn.style.transition = 'transform 0.6s';
        setTimeout(() => { btn.style.transform = ''; btn.style.transition = ''; }, 600);
        loadRealGroups();
    });

    document.getElementById('btnLoginGroup').addEventListener('click', () => navigate('settings'));

    // Group select modal
    document.getElementById('groupModalSearch').addEventListener('input', e => renderGroupSelectList(e.target.value));
    document.getElementById('btnConfirmGroups').addEventListener('click', confirmGroupsSelected);
}

function renderGroups(query = '') {
    const grid = document.getElementById('groupsGrid');
    let groups = S.groups;

    if (query) {
        groups = groups.filter(g => g.name.toLowerCase().includes(query.toLowerCase()) || g.id.includes(query));
    }
    if (S.groupFilter === 'large') {
        groups = [...groups].sort((a, b) => b.members - a.members);
    } else if (S.groupFilter === 'recent') {
        groups = [...groups].sort((a, b) => {
            const p = d => { const [day, month, year] = d.split('/'); return new Date(year, month - 1, day); };
            return p(b.created) - p(a.created);
        });
    }

    document.getElementById('groupSubtitle').textContent = `${groups.length} nhóm`;

    grid.innerHTML = groups.map(g => `
    <div class="group-card" data-id="${g.id}">
      <div onclick="toggleGroupSelect('${g.id}', this.closest('.group-card'))" style="cursor:pointer">
        <div class="gc-name">${g.name}</div>
        <div class="gc-id">ID: ${g.id}</div>
        <div class="gc-meta">
          <div class="gc-row">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
            ${g.members} thành viên
          </div>
          <div class="gc-row">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y1="10"/></svg>
            Tạo lúc: ${g.created}
          </div>
        </div>
        ${g.unread > 0 ? `<div class="gc-unread">🔔 ${g.unread} tin mới</div>` : ''}
      </div>
      <div style="display:flex;gap:6px;margin-top:8px">
        <button data-gid="${g.id}" onclick="sendToGroupMembers(this.dataset.gid)"
          style="flex:1;background:linear-gradient(135deg,#667eea,#764ba2);color:#fff;border:none;border-radius:8px;padding:8px 0;font-size:12px;font-weight:600;cursor:pointer">
          📤 DM thành viên (${g.members})
        </button>
        <button onclick="sendMsgToGroupChat('${g.id}')" title="Gửi tin vào khung chat nhóm"
          style="background:linear-gradient(135deg,#10b981,#059669);color:#fff;border:none;border-radius:8px;padding:8px 14px;font-size:14px;font-weight:700;cursor:pointer">
          💬
        </button>
      </div>
    </div>
  `).join('') || '<div style="grid-column:1/-1;text-align:center;padding:60px;color:var(--text-muted)">Không tìm thấy nhóm nào</div>';
}

window.toggleGroupSelect = function (id, el) {
    if (S.selectedGroups.has(id)) {
        S.selectedGroups.delete(id);
        el.classList.remove('selected');
    } else {
        S.selectedGroups.add(id);
        el.classList.add('selected');
    }
};

/* == GỬi tin đến tất cả thành viên nhóm == */
let _groupSendActive = false;
let _groupSendStop = false;

// ── Spin helper cấp module (dùng cho sendToGroupMembers) ──
const _zwCharsGlobal = ['\u200b', '\u200c', '\u200d', '\ufeff'];
function spinMsg(baseMsg, recipientName) {
    let result = baseMsg;
    result = result.replace(/\{([^}]+)\}/g, function(_, opts) {
        var arr = opts.split('|');
        return arr[Math.floor(Math.random() * arr.length)];
    });
    result = result.replace(/<Name>/gi, recipientName || 'bạn');
    const pos = Math.floor(Math.random() * Math.max(1, result.length - 1)) + 1;
    const zw = _zwCharsGlobal[Math.floor(Math.random() * _zwCharsGlobal.length)];
    result = result.slice(0, pos) + zw + result.slice(pos);
    return result;
}

window.sendToGroupMembers = async function (groupId) {
    if (!S.loggedIn) { toast('Vui lòng đăng nhập trước!', 'error'); navigate('settings'); return; }

    // Tra cứu tên nhóm từ S.groups
    const group = S.groups.find(g => g.id === groupId);
    const groupName = group ? group.name : groupId;

    const msg = prompt('Gửi tin đến "' + groupName + '"\nNhập nội dung:');
    if (!msg || !msg.trim()) return;

    const cookie = S.cookie;
    log('info', `📤 Đang lấy thành viên nhóm "${groupName}"...`, 'send');
    navigate('bulk-send');

    const res = await el.zalo.getGroupMembers(cookie, groupId);
    if (!res.success || !res.members?.length) {
        log('error', `❌ Không lấy được thành viên: ${res.error}`, 'send');
        toast('Không lấy được thành viên nhóm', 'error');
        return;
    }

    const members = res.members;
    log('info', `👥 Tìm thấy ${members.length} thành viên trong nhóm “${groupName}”`, 'send');
    toast(`✅ ${members.length} thành viên → bắt đầu gửi...`, 'info');

    // Cập nhật UI stats
    S.send.running = true;
    S.send.ok = 0; S.send.err = 0; S.send.wait = members.length;
    updateSendStats();

    const delay = (ms) => new Promise(r => setTimeout(r, ms));
    const minDelay = 2500, maxDelay = 5000;  // 2.5-5 giây mỗi tin
    _groupSendStop = false;

    for (let i = 0; i < members.length; i++) {
        if (_groupSendStop) { log('info', '⏹ Đã dừng', 'send'); break; }
        const m = members[i];
        log('info', `[Đang gửi ${i + 1}/${members.length}] → ${m.name} (${m.uid})`, 'send');
        try {
            const r = await el.zalo.sendMessageByUid(cookie, m.uid, spinMsg(msg, m.name));
            if (r.success) {
                S.send.ok++;
                log('success', `✅ Gửi OK → ${m.name}`, 'send');
            } else {
                S.send.err++;
                log('error', `❌ Thất bại → ${m.name}: ${r.error}`, 'send');
            }
        } catch (e) {
            S.send.err++;
            log('error', `❌ Lỗi: ${e.message}`, 'send');
        }
        S.send.wait--;
        updateSendStats();
        if (i < members.length - 1) await delay(minDelay + Math.random() * (maxDelay - minDelay));
    }

    S.send.running = false;
    updateSendStats();
    log('success', `🎉 Xong! Đã gửi: ${S.send.ok}, Thất bại: ${S.send.err}`, 'send');
    toast(`Gửi xong: ${S.send.ok} OK, ${S.send.err} lỗi`, S.send.err === 0 ? 'success' : 'warning');
};

function renderGroupSelectList(query = '') {
    const list = document.getElementById('groupSelectList');
    const groups = query
        ? S.groups.filter(g => g.name.toLowerCase().includes(query.toLowerCase()))
        : S.groups;

    list.innerHTML = groups.map(g => `
    <div class="group-select-item">
      <input type="checkbox" value="${g.id}" id="gsc_${g.id}"
        ${S.selectedGroups.has(g.id) ? 'checked' : ''} 
        onchange="toggleGroupSelectModal('${g.id}', this.checked)" />
      <label for="gsc_${g.id}" style="flex:1;cursor:pointer">
        <div style="font-weight:600;font-size:12.5px">${g.name}</div>
        <div style="font-size:11px;color:var(--text-sub)">${g.members} thành viên</div>
      </label>
    </div>
  `).join('');
    updateSelectedGroupCount();
}

window.toggleGroupSelectModal = function (id, checked) {
    if (checked) S.selectedGroups.add(id);
    else S.selectedGroups.delete(id);
    updateSelectedGroupCount();
};

function updateSelectedGroupCount() {
    document.getElementById('selectedGroupCount').textContent = `${S.selectedGroups.size} nhóm đã chọn`;
}

async function confirmGroupsSelected() {
    if (S.selectedGroups.size === 0) { toast('Chọn ít nhất 1 nhóm!', 'warning'); return; }

    closeModal('groupSelectModal');
    navigate('bulk-send');

    // Fetch real members from selected groups via API
    const cookie = S.cookie;
    const allUids = [];
    let totalFetched = 0;

    toast(`⏳ Đang lấy thành viên từ ${S.selectedGroups.size} nhóm...`, 'info');

    for (const groupId of S.selectedGroups) {
        const g = S.groups.find(x => x.id === groupId);
        const groupName = g ? g.name : groupId;
        try {
            const res = await el.zalo.getGroupMembers(cookie, groupId);
            if (res.success && res.members?.length) {
                for (const m of res.members) {
                    if (m.uid && !allUids.includes(m.uid)) {
                        allUids.push(m.uid);
                    }
                }
                totalFetched += res.members.length;
                log('info', `✅ Nhóm "${groupName}": ${res.members.length} thành viên`, 'send');
            } else {
                log('warning', `⚠️ Nhóm "${groupName}": ${res.error || 'không có thành viên'}`, 'send');
            }
        } catch (e) {
            log('error', `❌ Nhóm "${groupName}": ${e.message}`, 'send');
        }
    }

    if (allUids.length > 0) {
        // Inject UIDs as uid:xxx format so sendBulkSmart can parse them
        document.getElementById('phoneInput').value = allUids.map(uid => `uid:${uid}`).join('\n');
        updatePhoneCount();
        toast(`✅ Đã lấy ${allUids.length} thành viên từ ${S.selectedGroups.size} nhóm!`, 'success');
    } else {
        toast('⚠️ Không lấy được thành viên nào — hãy đăng nhập QR trước', 'warning');
    }
}

// ══════════════════════════════════════════════════════════════════
// BULK SEND
// ══════════════════════════════════════════════════════════════════
function initBulkSend() {
    const phoneTA = document.getElementById('phoneInput');
    const msgTA = document.getElementById('msgInput');

    phoneTA.addEventListener('input', updatePhoneCount);
    msgTA.addEventListener('input', () => {
        document.getElementById('msgCharCount').textContent = `${msgTA.value.length}/500`;
    });

    document.getElementById('sendDelay').addEventListener('input', function () {
        document.getElementById('sendDelayVal').textContent = this.value + 's';
    });

    document.getElementById('btnImport').addEventListener('click', () => {
        document.getElementById('importFileInput').click();
    });
    document.getElementById('importFileInput').addEventListener('change', e => {
        readFile(e, 'phoneInput', updatePhoneCount);
    });

    document.getElementById('btnAddGroup').addEventListener('click', () => {
        renderGroupSelectList();
        openModal('groupSelectModal');
    });

    document.getElementById('btnClearInput').addEventListener('click', () => {
        phoneTA.value = '';
        updatePhoneCount();
    });

    document.getElementById('btnPickTemplate').addEventListener('click', () => {
        if (S.templates.length === 0) { toast('Chưa có mẫu nào!', 'info'); return; }
        msgTA.value = S.templates[0].content;
        document.getElementById('msgCharCount').textContent = `${msgTA.value.length}/500`;
        toast('Đã tải mẫu: ' + S.templates[0].name, 'success');
    });

    // ── Chuyển tab Phone / Nhóm ─────────────────
    let S_sendMode = 'phone'; // 'phone' or 'group'
    let S_selectedGroupId = null;

    document.querySelectorAll('.mode-tab').forEach(t => {
        t.addEventListener('click', () => {
            document.querySelectorAll('.mode-tab').forEach(x => x.classList.remove('active'));
            t.classList.add('active');
            S_sendMode = t.dataset.mode;
            document.getElementById('panelPhone').style.display = S_sendMode === 'phone' ? '' : 'none';
            document.getElementById('panelGroup').style.display = S_sendMode === 'group' ? '' : 'none';
            if (S_sendMode === 'group') renderGroupPickList();
        });
    });

    // Nút tải lại danh sách nhóm trong panel
    document.getElementById('btnRefreshGroupPick').addEventListener('click', renderGroupPickList);

    function renderGroupPickList() {
        const list = document.getElementById('groupPickList');
        if (!S.groups || S.groups.length === 0) {
            list.innerHTML = '<div style="text-align:center;padding:20px;color:var(--text-muted)">Chưa có nhóm — hãy đăng nhập QR và chờ tải nhóm</div>';
            document.getElementById('groupPickCount').textContent = 'Chưa chọn nhóm';
            return;
        }
        list.innerHTML = S.groups.map(g => `
            <div class="group-pick-item" data-gid="${g.id}"
                style="display:flex;align-items:center;gap:10px;padding:8px 10px;border-radius:6px;cursor:pointer;
                       border:2px solid transparent;margin-bottom:4px;"
                onclick="selectGroupPick(this, '${g.id}')">  
                <div style="flex:1">
                    <div style="font-weight:600;font-size:14px">${g.name}</div>
                    <div style="font-size:12px;color:var(--text-muted)">👥 ${g.members} thành viên</div>
                </div>
                <div style="font-size:12px;color:var(--text-muted)">${g.id}</div>
            </div>
        `).join('');
        document.getElementById('groupPickCount').textContent = 'Chưa chọn nhóm';
        S_selectedGroupId = null;
    }
    // Expose for onclick
    window.selectGroupPick = function (el, gid) {
        document.querySelectorAll('.group-pick-item').forEach(x => {
            x.style.borderColor = 'transparent';
            x.style.background = '';
        });
        el.style.borderColor = '#667eea';
        el.style.background = 'rgba(102,126,234,0.08)';
        S_selectedGroupId = gid;
        const g = S.groups.find(x => x.id === gid);
        document.getElementById('groupPickCount').textContent =
            g ? `Đã chọn: ${g.name} (${g.members} người)` : gid;
    };

    // Lưu reference để startBulkSend dùng
    window.__getSendMode = () => S_sendMode;
    window.__getSelectedGroupId = () => S_selectedGroupId;

    document.getElementById('btnClearLog').addEventListener('click', () => {
        document.getElementById('logBody').innerHTML = '';
    });

    document.getElementById('btnSend').addEventListener('click', startBulkSend);
    document.getElementById('btnPauseSend').addEventListener('click', pauseBulkSend);
    document.getElementById('btnStopSend').addEventListener('click', stopBulkSend);

    // ── Group Invite Toggle ──
    const enableGroupInviteCb = document.getElementById('enableGroupInvite');
    const inviteGroupSelector = document.getElementById('inviteGroupSelector');
    if (enableGroupInviteCb) {
        enableGroupInviteCb.addEventListener('change', () => {
            inviteGroupSelector.style.display = enableGroupInviteCb.checked ? '' : 'none';
            if (enableGroupInviteCb.checked) populateInviteGroupSelect();
        });
    }

    // ── Listen for smart send progress events ──
    if (el.onBulkSmartProgress) {
        el.onBulkSmartProgress((data) => {
            if (data.phase === 'resolve') {
                log('info', `🔍 ${data.status}`, 'send');
                if (data.failed) log('warning', `⚠️ ${data.status}`, 'send');
                updateSendProgress(data.pct, 100);
            } else if (data.phase === 'sending') {
                const icon = data.ok ? '✅' : '❌';
                const displayName = data.name || data.uid || 'unknown';
                const viaTag = data.via ? ` [${data.via}]` : '';
                log(data.ok ? 'success' : 'error', `${icon} ${displayName}${viaTag}${data.error ? ': ' + data.error : ''}`, 'send');
                if (data.results) {
                    S.send.ok = data.results.sent || 0;
                    S.send.err = data.results.failed || 0;
                    S.send.wait = (data.total || 0) - ((data.index || 0) + 1);
                    updateSendStats();
                }
                updateSendProgress((data.index || 0) + 1, data.total || 0);
            } else if (data.phase === 'cooldown') {
                log('info', `☕ ${data.status}`, 'send');
            } else if (data.phase === 'done') {
                log('success', `🎉 ${data.status}`, 'send');
                if (data.results) {
                    const r = data.results;
                    log('info', `📊 Msg: ${r.msgOk} | Invite: ${r.inviteOk} | Retry: ${r.retriedDMs || 0} | Fail: ${r.failed}`, 'send');
                    log('info', `👥 Bạn bè: ${r.friendCount || '?'} | Người lạ: ${r.strangerCount || '?'} | Block rate: ${r.strangerBlockRate || 0}%`, 'send');
                    toast(`Xong! ${r.sent}/${r.total} gửi OK (${r.successRate}%)`, r.failed === 0 ? 'success' : 'warning');
                }
                stopBulkSend();
            }
        });
    }
}

function stopBulkSend() {
    S.send = { running: false, paused: false, ok: 0, err: 0, wait: 0 };
    setSendBtns(false);
    // Gửi cancel signal tới backend
    try { el.zalo?.cancelBulkSend?.(); } catch (_) {}
}

async function refreshAccountList() {
    const container = document.getElementById('accountPoolList');
    if (!container) return;
    try {
        const accounts = await el.zalo.poolGetAll();
        if (!accounts || accounts.length === 0) {
            container.innerHTML = '<div style="color:var(--text-muted);font-size:12px;text-align:center;padding:12px;">Chưa có tài khoản. Đăng nhập QR để thêm.</div>';
            return;
        }
        const groupOpts = (S.groups || []).map(g => `<option value="${g.id}">${g.name} (${g.members} TV)</option>`).join('');
        container.innerHTML = accounts.map((a, i) => `
            <div style="padding:10px;background:rgba(99,102,241,0.08);border-radius:8px;margin-bottom:6px;">
                <div style="display:flex;align-items:center;gap:10px;">
                    <span style="font-size:18px;">${i === 0 ? '👑' : '👤'}</span>
                    <div style="flex:1;min-width:0;">
                        <div style="font-size:13px;font-weight:600;color:var(--text-h);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${a.name}</div>
                        <div style="font-size:11px;color:var(--text-muted);">UID: ${a.uid} | Quota: ${a.quotaDay}/200</div>
                    </div>
                    <button onclick="toggleAccountGroups('${a.uid}')" style="background:rgba(99,102,241,0.15);color:#6366f1;border:none;border-radius:6px;padding:4px 8px;font-size:10px;cursor:pointer;">⚙ Nhóm</button>
                    <button onclick="removePoolAccount('${a.uid}')" style="background:rgba(239,68,68,0.1);color:#ef4444;border:none;border-radius:6px;padding:4px 10px;font-size:11px;cursor:pointer;">✕</button>
                </div>
                <div id="accountGroups_${a.uid}" style="display:none;margin-top:8px;padding-top:8px;border-top:1px solid rgba(99,102,241,0.15);">
                    <div style="display:flex;gap:6px;align-items:center;margin-bottom:4px;">
                        <label style="font-size:11px;color:var(--text-muted);min-width:70px;">Nhóm nguồn:</label>
                        <select id="srcGroup_${a.uid}" onchange="saveAccountGroupMapping('${a.uid}')" style="flex:1;font-size:11px;padding:4px 6px;border-radius:4px;border:1px solid rgba(99,102,241,0.3);background:var(--bg-card);">
                            <option value="">-- Không chọn --</option>
                            ${groupOpts}
                        </select>
                    </div>
                    <div style="display:flex;gap:6px;align-items:center;">
                        <label style="font-size:11px;color:var(--text-muted);min-width:70px;">Nhóm đích:</label>
                        <select id="dstGroup_${a.uid}" onchange="saveAccountGroupMapping('${a.uid}')" style="flex:1;font-size:11px;padding:4px 6px;border-radius:4px;border:1px solid rgba(99,102,241,0.3);background:var(--bg-card);">
                            <option value="">-- Dùng chung --</option>
                            ${groupOpts}
                        </select>
                    </div>
                </div>
            </div>
        `).join('');

        // Restore saved selections
        for (const a of accounts) {
            if (a.sourceGroupId) {
                const sel = document.getElementById(`srcGroup_${a.uid}`);
                if (sel) sel.value = a.sourceGroupId;
            }
            if (a.destGroupIds && a.destGroupIds[0]) {
                const sel = document.getElementById(`dstGroup_${a.uid}`);
                if (sel) sel.value = a.destGroupIds[0];
            }
        }
    } catch (_) {}
}

// Global function cho onclick
window.removePoolAccount = async function(uid) {
    await el.zalo.poolRemove(uid);
    refreshAccountList();
    toast('Đã xóa tài khoản khỏi pool', 'info');
};

window.toggleAccountGroups = function(uid) {
    const panel = document.getElementById(`accountGroups_${uid}`);
    if (panel) panel.style.display = panel.style.display === 'none' ? 'block' : 'none';
};

window.saveAccountGroupMapping = async function(uid) {
    const srcSel = document.getElementById(`srcGroup_${uid}`);
    const dstSel = document.getElementById(`dstGroup_${uid}`);
    const sourceGroupId = srcSel?.value || '';
    const destGroupId = dstSel?.value || '';
    const destGroupIds = destGroupId ? [destGroupId] : [];
    await el.zalo.poolSetGroupMapping(uid, sourceGroupId, destGroupIds);
    toast(`Đã lưu nhóm cho TK`, 'success');
};

function populateInviteGroupSelect() {
    const opts = '<option value="">-- Chọn nhóm --</option>' +
        S.groups.map(g => `<option value="${g.id}">${g.name} (${g.members} TV)</option>`).join('');
    const sel1 = document.getElementById('inviteGroupSelect');
    const sel2 = document.getElementById('inviteGroupSelect2');
    if (sel1) sel1.innerHTML = opts.replace('Chọn nhóm', 'Nhóm 1 (chính)');
    if (sel2) sel2.innerHTML = opts.replace('Chọn nhóm', 'Nhóm 2 (xoay)');
}

function updatePhoneCount() {
    const phones = getPhones('phoneInput');
    document.getElementById('phoneInputCount').textContent = `${phones.length} số`;
}

function getPhones(id) {
    return document.getElementById(id).value
        .split('\n').map(p => p.trim()).filter(p => p.length >= 9 && /\d/.test(p));
}

async function startBulkSend() {
    if (!S.loggedIn) { toast('Vui lòng đăng nhập Zalo trước!', 'error'); navigate('settings'); return; }
    let msg = document.getElementById('msgInput').value.trim();
    // FIX #3: Nếu msgInput trống → lấy từ Kho tin nhắn (settingsMsgs) và xoay vòng
    if (!msg) {
        try {
            const storedMsgs = (await el.store.get('settingsMsgs')) || [];
            if (storedMsgs.length > 0) {
                const idx = Math.floor(Math.random() * storedMsgs.length);
                msg = storedMsgs[idx];
                document.getElementById('msgInput').value = msg;
                toast(`📋 Đã lấy tin nhắn #${idx+1} từ kho`, 'info');
            }
        } catch(_) {}
    }
    if (!msg) { toast('Nhập nội dung tin nhắn hoặc thêm vào Kho Tin Nhắn trong Cài Đặt!', 'warning'); return; }

    const mode = window.__getSendMode ? window.__getSendMode() : 'phone';
    const smartEnabled = document.getElementById('enableSmartSend')?.checked;

    // ═══ SMART SEND 6-LAYER ═══
    if (smartEnabled) {
        const cookie = S.cookie;
        const inviteEnabled = document.getElementById('enableGroupInvite')?.checked;
        const inviteGroupId = inviteEnabled ? (document.getElementById('inviteGroupSelect')?.value || '') : '';
        const inviteGroupId2 = inviteEnabled ? (document.getElementById('inviteGroupSelect2')?.value || '') : '';

        const params = {
            inputType: mode === 'group' ? 'groupId' : 'phones',
            message: msg,
            delay: parseInt(document.getElementById('sendDelay')?.value) || 3,
            randomDelay: document.getElementById('randomDelay')?.checked !== false,
            enableVariation: document.getElementById('msgVariation')?.checked !== false,
            enableCooldown: document.getElementById('enableCooldown')?.checked !== false,
            maxPerHour: Math.max(1, parseInt(document.getElementById('maxPerHour')?.value) || 30),
            maxPerDay: Math.max(1, parseInt(document.getElementById('maxPerDay')?.value) || 200),
        };

        // Multi-group: gửi array các group IDs + per-group messages
        const groupIds = [inviteGroupId, inviteGroupId2].filter(Boolean);
        if (groupIds.length) {
            params.inviteGroupIds = groupIds;
            const msg1 = document.getElementById('msgGroup1')?.value?.trim();
            const msg2 = document.getElementById('msgGroup2')?.value?.trim();
            if (msg1 || msg2) {
                params.groupMessages = [msg1 || msg, msg2 || msg]; // fallback to main msg
            }
        }

        if (mode === 'group') {
            const groupId = window.__getSelectedGroupId ? window.__getSelectedGroupId() : null;
            if (!groupId) { toast('Hãy chọn một nhóm!', 'warning'); return; }
            params.groupId = groupId;
        } else {
            const phones = getPhones('phoneInput');
            if (!phones.length) { toast('Nhập danh sách số điện thoại!', 'warning'); return; }
            params.phones = phones;
        }

        // Start UI
        S.send = { running: true, paused: false, ok: 0, err: 0, wait: 0 };
        setSendBtns(true);
        document.getElementById('sendProgressCard').style.display = 'block';
        updateSendProgress(0, 100);
        updateSendStats();

        const targetCount = params.phones?.length || '?';
        log('info', `🚀 Smart Send 6-Layer: ${targetCount} targets | ${inviteGroupId ? 'Group invite ON' : 'No group invite'}`, 'send');
        toast(`🚀 Smart Send bắt đầu — ${targetCount} targets`, 'info');

        // Call backend
        el.zalo.sendBulkSmart(cookie, params).then(result => {
            if (!result.success && result.error) {
                log('error', `❌ Smart Send lỗi: ${result.error}`, 'send');
                toast('Smart Send lỗi: ' + result.error, 'error');
                stopBulkSend();
            }
            // Progress events are handled by onBulkSmartProgress listener
        }).catch(err => {
            log('error', `❌ IPC Error: ${err.message}`, 'send');
            stopBulkSend();
        });

        return;
    }

    // ═══ LEGACY SEND (khi Smart Send tắt) ═══

    if (mode === 'group') {
        const groupId = window.__getSelectedGroupId ? window.__getSelectedGroupId() : null;
        if (!groupId) { toast('Hãy chọn một nhóm!', 'warning'); return; }

        const group = S.groups.find(g => g.id === groupId);
        const groupName = group ? group.name : groupId;
        const cookie = S.cookie;

        setSendBtns(true);
        log('info', `📁 Đang lấy ${group?.members || '?'} thành viên nhóm "${groupName}"...`, 'send');

        // Gọi getGroupMembers IPC (đã fix: memberIds + getGroupMembersInfo)
        el.zalo.getGroupMembers(cookie, groupId).then(res => {
            if (!res.success || !res.members?.length) {
                // Fallback về currentMems đã lưu (nếu có)
                const fallback = group?.currentMems || [];
                if (fallback.length > 0) {
                    log('info', `⚠️ Dùng danh sách offline: ${fallback.length} thành viên`, 'send');
                    doSendToMembers(fallback, groupName, cookie, msg);
                } else {
                    log('error', `❌ Không lấy được thành viên: ${res.error || 'unknown'}`, 'send');
                    toast('Không lấy được thành viên nhóm — xem log để biết lỗi', 'error');
                    setSendBtns(false);
                }
                return;
            }
            // Hiển thị warning nếu không lấy đủ thành viên
            if (res.warning) {
                log('warning', res.warning, 'send');
                toast(res.warning, 'warning');
            }
            log('info', `👥 Lấy được ${res.members.length}/${res.actualTotal || res.members.length} thành viên trong "${groupName}"`, 'send');
            doSendToMembers(res.members, groupName, cookie, msg);

        }).catch(e => {
            log('error', `❌ Lỗi IPC: ${e.message}`, 'send');
            setSendBtns(false);
        });
        return;
    }

    // Mode phone — with full anti-ban protection
    const phones = getPhones('phoneInput');
    if (!phones.length) { toast('Nhập danh sách số điện thoại!', 'warning'); return; }

    const CHECKPOINT_KEY = 'bulk_send_cp_phone';
    const QUOTA_KEY = 'zalo_send_quota';
    const BAN_KEYWORDS = ['spam', 'ban', 'blocked', 'flood', 'tài khoản bị', 'khoá', 'bị khóa', 'không hợp lệ', 'quá số lần'];

    // ── Quota system (shared with group mode) ──
    const getQuota = () => {
        try {
            const q = JSON.parse(localStorage.getItem(QUOTA_KEY) || '{}');
            const today = new Date().toDateString();
            const hour = new Date().getHours();
            if (q.date !== today) return { date: today, hour, hourCount: 0, dayCount: 0 };
            if (q.hour !== hour) return { ...q, hour, hourCount: 0 };
            return q;
        } catch (e) { return { date: new Date().toDateString(), hour: new Date().getHours(), hourCount: 0, dayCount: 0 }; }
    };
    const saveQuota = (q) => { try { localStorage.setItem(QUOTA_KEY, JSON.stringify(q)); } catch (e) { } };
    const MAX_PER_HOUR = Math.max(1, parseInt(document.getElementById('maxPerHour')?.value) || 30);
    const MAX_PER_DAY = Math.max(1, parseInt(document.getElementById('maxPerDay')?.value) || 200);
    const COOLDOWN_EVERY = 10;
    const COOLDOWN_TIME = 30000;

    // ── Message variation ──
    const INVISIBLE_CHARS = ['\u200b', '\u200c', '\u200d', '\ufeff'];
    const variantMsg = (baseMsg, recipientName) => {
        let result = baseMsg;
        // Spin syntax {A|B|C} → chọn ngẫu nhiên
        result = result.replace(/\{([^}]+)\}/g, function(_, opts) {
            var arr = opts.split('|');
            return arr[Math.floor(Math.random() * arr.length)];
        });
        // Thay <Name> bằng tên thật (nếu có) hoặc 'bạn'
        result = result.replace(/<Name>/gi, recipientName || 'bạn');
        // Invisible chars để mỗi tin unique
        const numChars = Math.floor(Math.random() * 2) + 1;
        for (let i = 0; i < numChars; i++) {
            const pos = Math.floor(Math.random() * result.length);
            const ch = INVISIBLE_CHARS[Math.floor(Math.random() * INVISIBLE_CHARS.length)];
            result = result.slice(0, pos) + ch + result.slice(pos);
        }
        return result;
    };

    // ── Gaussian delay ──
    const gaussianDelay = (baseMs) => {
        const u1 = Math.random(), u2 = Math.random();
        const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
        const deviation = baseMs * 0.3;
        return Math.max(baseMs * 0.5, baseMs + z * deviation);
    };

    // ── Checkpoint resume ──
    const msgText = document.getElementById('msgInput').value.trim();
    let startIdx = 0;
    try {
        const cp = JSON.parse(localStorage.getItem(CHECKPOINT_KEY) || 'null');
        if (cp && cp.msg === msgText && cp.total === phones.length) {
            startIdx = cp.nextIdx;
            if (startIdx > 0) log('info', `♻️ Resume từ ${startIdx}/${phones.length}`, 'send');
        }
    } catch (e) { }

    S.send = { running: true, paused: false, ok: 0, err: 0, wait: phones.length - startIdx, retryQueue: [] };
    setSendBtns(true);
    document.getElementById('sendProgressCard').style.display = 'block';
    updateSendProgress(startIdx, phones.length);
    updateSendStats();

    const baseDelay = parseInt(document.getElementById('sendDelay').value) * 1000;
    const rand = document.getElementById('randomDelay').checked;
    const stopErr = document.getElementById('stopOnFail').checked;
    const useVariation = document.getElementById('msgVariation')?.checked !== false;
    const useCooldown = document.getElementById('enableCooldown')?.checked !== false;
    let idx = startIdx;
    let consecutiveErr = 0;
    let sessionSent = 0;

    const saveCheckpoint = () => {
        try { localStorage.setItem(CHECKPOINT_KEY, JSON.stringify({ msg: msgText, total: phones.length, nextIdx: idx, ok: S.send.ok, err: S.send.err })); } catch (e) { }
    };
    const clearCheckpoint = () => { try { localStorage.removeItem(CHECKPOINT_KEY); } catch (e) { } };

    toast(`🛡️ Anti-ban ON | Max ${MAX_PER_HOUR}/giờ, ${MAX_PER_DAY}/ngày | ${phones.length} SĐT`, 'info');
    let cooldownFired = false; // Fix #5: prevent cooldown infinite loop

    const next = () => {
        if (!S.send.running || S.send.paused) { saveCheckpoint(); return; }

        // ── Quota check ──
        const quota = getQuota();
        if (quota.hourCount >= MAX_PER_HOUR) {
            const waitMin = Math.max(1, 60 - new Date().getMinutes()); // Fix #7: min 1 minute
            log('warning', `🛡️ Đạt giới hạn ${MAX_PER_HOUR}/giờ → nghỉ ${waitMin} phút`, 'send');
            saveCheckpoint();
            S.send.paused = true;
            sendTimer = setTimeout(() => { S.send.paused = false; log('info', '▶ Tiếp tục sau cool-down giờ...', 'send'); next(); }, waitMin * 60 * 1000);
            return;
        }
        if (quota.dayCount >= MAX_PER_DAY) {
            log('warning', `🛡️ Đạt giới hạn ${MAX_PER_DAY}/ngày → dừng hôm nay`, 'send');
            toast(`Dừng! Đã gửi ${MAX_PER_DAY} tin hôm nay. Tiếp tục ngày mai.`, 'warning');
            saveCheckpoint(); stopBulkSend(); return;
        }

        // ── Cooldown every N messages (Fix #5: use flag to prevent re-trigger) ──
        if (useCooldown && sessionSent > 0 && sessionSent % COOLDOWN_EVERY === 0 && !cooldownFired) {
            cooldownFired = true;
            log('info', `☕ Cool-down ${COOLDOWN_TIME / 1000}s sau ${sessionSent} tin...`, 'send');
            sendTimer = setTimeout(next, COOLDOWN_TIME);
            return;
        }
        cooldownFired = false;

        // Retry queue
        if (S.send.retryQueue.length > 0 && idx >= phones.length) {
            const retryPhone = S.send.retryQueue.shift();
            log('warning', `🔄 Retry → ${retryPhone}`, 'send');
            simulateSend(retryPhone, useVariation ? variantMsg(msgText) : msgText).then(r => {
                const ok = r && r.success !== undefined ? r.success : r;
                if (ok) {
                    S.send.ok++; log('success', `✅ Retry OK → ${retryPhone}`, 'send');
                    // Fix #8: count retry toward quota
                    sessionSent++;
                    const q = getQuota(); q.hourCount = (q.hourCount || 0) + 1; q.dayCount = (q.dayCount || 0) + 1; saveQuota(q); updateQuotaUI();
                } else { log('error', `❌ Retry fail → ${retryPhone}`, 'send'); }
                updateSendStats();
                sendTimer = setTimeout(next, baseDelay * 2);
            });
            return;
        }

        if (idx >= phones.length && S.send.retryQueue.length === 0) {
            log('success', `🎉 Hoàn thành! ${S.send.ok}/${phones.length} OK | ${S.send.err} lỗi`, 'send');
            toast(`Xong! ${S.send.ok}/${phones.length} OK`, S.send.err === 0 ? 'success' : 'warning');
            clearCheckpoint(); stopBulkSend(); return;
        }

        const phone = phones[idx];
        const remaining = phones.length - startIdx;
        const pct = remaining > 0 ? Math.round(((idx - startIdx) / remaining) * 100) : 100; // Fix #4: division by zero
        log('info', `[📤 ${idx + 1}/${phones.length} - ${pct}%] → ${phone}`, 'send');

        const msgToSend = useVariation ? variantMsg(msgText) : msgText;

        simulateSend(phone, msgToSend).then(res => {
            const ok = res && res.success !== undefined ? res.success : res;
            const errMsg = (res && res.error) ? String(res.error) : '';
            if (ok) {
                S.send.ok++;
                consecutiveErr = 0;
                sessionSent++;
                // Update quota
                const q = getQuota();
                q.hourCount = (q.hourCount || 0) + 1;
                q.dayCount = (q.dayCount || 0) + 1;
                saveQuota(q);
                updateQuotaUI();
                log('success', `✅ → ${phone} [${q.hourCount}/h, ${q.dayCount}/d]`, 'send');
            } else {
                S.send.err++;
                consecutiveErr++;
                log('error', `❌ → ${phone}: ${errMsg}`, 'send');

                // ── Ban detection ──
                const isBanSignal = BAN_KEYWORDS.some(k => errMsg.toLowerCase().includes(k.toLowerCase()));
                if (isBanSignal) {
                    log('warning', `🚨 PHÁT HIỆN TÍN HIỆU BAN! → Tự động dừng 30 phút`, 'send');
                    toast('🚨 Có dấu hiệu bị ban! Đã tự dừng 30 phút.', 'error');
                    saveCheckpoint();
                    S.send.paused = true;
                    sendTimer = setTimeout(() => { S.send.paused = false; consecutiveErr = 0; log('info', '▶ Tiếp tục sau ban-pause 30 phút...', 'send'); next(); }, 30 * 60 * 1000);
                    return;
                }

                const isRetryable = !errMsg.includes('tham số') && !errMsg.includes('Bản thân');
                if (isRetryable && S.send.retryQueue.length < 50) S.send.retryQueue.push(phone);
                if (stopErr) { saveCheckpoint(); stopBulkSend(); return; }
            }

            S.send.wait = phones.length - idx - 1;
            updateSendStats();
            updateSendProgress(++idx, phones.length);
            saveCheckpoint();

            // Gaussian delay + adaptive
            let delay = rand ? gaussianDelay(baseDelay) : baseDelay;
            if (consecutiveErr >= 3) { delay *= 2; log('warning', `⚠️ ${consecutiveErr} lỗi → delay x2: ${Math.round(delay / 1000)}s`, 'send'); }
            if (consecutiveErr >= 7) { delay = 120000; consecutiveErr = 0; log('warning', '🛑 7+ lỗi → nghỉ 2 phút', 'send'); }
            sendTimer = setTimeout(next, delay);
        });
    };

    // Fix #1: Store reference so pauseBulkSend can resume without re-calling startBulkSend
    S.send._nextFn = next;
    next();
}

function doSendToMembers(members, groupName, cookie, msg) {
    const CHECKPOINT_KEY = `bulk_send_cp_${groupName}`;
    const QUOTA_KEY = 'zalo_send_quota';
    const BAN_KEYWORDS = ['spam', 'ban', 'blocked', 'flood', 'tài khoản bị', 'khoá', 'bị khóa', 'không hợp lệ', 'quá số lần'];

    // ── Hệ thống Quota chống ban ──
    const getQuota = () => {
        try {
            const q = JSON.parse(localStorage.getItem(QUOTA_KEY) || '{}');
            const today = new Date().toDateString();
            const hour = new Date().getHours();
            if (q.date !== today) return { date: today, hour, hourCount: 0, dayCount: 0 };
            if (q.hour !== hour) return { ...q, hour, hourCount: 0 };
            return q;
        } catch (e) { return { date: new Date().toDateString(), hour: new Date().getHours(), hourCount: 0, dayCount: 0 }; }
    };
    const saveQuota = (q) => { try { localStorage.setItem(QUOTA_KEY, JSON.stringify(q)); } catch (e) { } };
    const MAX_PER_HOUR = Math.max(1, parseInt(document.getElementById('maxPerHour')?.value) || 30);
    const MAX_PER_DAY = Math.max(1, parseInt(document.getElementById('maxPerDay')?.value) || 200);
    const COOLDOWN_EVERY = 10; // Nghỉ sau mỗi 10 tin
    const COOLDOWN_TIME = 30000; // Nghỉ 30s

    // ── Message variation để tránh spam detection ──
    const INVISIBLE_CHARS = ['\u200b', '\u200c', '\u200d', '\ufeff']; // Zero-width chars
    const variantMsg = (baseMsg, recipientName) => {
        let result = baseMsg;
        // Spin syntax {A|B|C} → chọn ngẫu nhiên
        result = result.replace(/\{([^}]+)\}/g, function(_, opts) {
            var arr = opts.split('|');
            return arr[Math.floor(Math.random() * arr.length)];
        });
        // Thay <Name> bằng tên thật của người nhận
        result = result.replace(/<Name>/gi, recipientName || 'bạn');
        // Random thêm 1-2 invisible chars vào vị trí ngẫu nhiên
        const numChars = Math.floor(Math.random() * 2) + 1;
        for (let i = 0; i < numChars; i++) {
            const pos = Math.floor(Math.random() * result.length);
            const ch = INVISIBLE_CHARS[Math.floor(Math.random() * INVISIBLE_CHARS.length)];
            result = result.slice(0, pos) + ch + result.slice(pos);
        }
        return result;
    };

    // ── Gaussian delay — giống hành vi người dùng thật hơn ──
    const gaussianDelay = (baseMs) => {
        // Box-Muller transform
        const u1 = Math.random(), u2 = Math.random();
        const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
        const deviation = baseMs * 0.3; // ±30% độ lệch
        return Math.max(baseMs * 0.5, baseMs + z * deviation);
    };

    // ── Checkpoint resume ──
    let startIdx = 0;
    try {
        const cp = JSON.parse(localStorage.getItem(CHECKPOINT_KEY) || 'null');
        if (cp && cp.msg === msg && cp.total === members.length) {
            startIdx = cp.nextIdx;
            if (startIdx > 0) log('info', `♻️ Resume từ ${startIdx}/${members.length}`, 'send');
        }
    } catch (e) { }

    S.send = { running: true, paused: false, ok: 0, err: 0, wait: members.length - startIdx, retryQueue: [] };
    setSendBtns(true);
    document.getElementById('sendProgressCard').style.display = 'block';
    updateSendProgress(startIdx, members.length);
    updateSendStats();

    const baseDelay = parseInt(document.getElementById('sendDelay').value) * 1000;
    const rand = document.getElementById('randomDelay').checked;
    const stopErr = document.getElementById('stopOnFail').checked;
    const useVariation = document.getElementById('msgVariation')?.checked !== false;
    const useCooldown = document.getElementById('enableCooldown')?.checked !== false;
    let idx = startIdx;
    let consecutiveErr = 0;
    let sessionSent = 0;

    const saveCheckpoint = () => {
        try { localStorage.setItem(CHECKPOINT_KEY, JSON.stringify({ msg, total: members.length, nextIdx: idx, ok: S.send.ok, err: S.send.err })); } catch (e) { }
    };
    const clearCheckpoint = () => { try { localStorage.removeItem(CHECKPOINT_KEY); } catch (e) { } };

    toast(`🛡️ Anti-ban ON | Max ${MAX_PER_HOUR}/giờ, ${MAX_PER_DAY}/ngày | ${members.length} thành viên`, 'info');
    let cooldownFired = false; // Fix #5: prevent cooldown infinite loop

    const nextMember = () => {
        if (!S.send.running || S.send.paused) { saveCheckpoint(); return; }

        // ── Kiểm tra Quota ──
        const quota = getQuota();
        if (quota.hourCount >= MAX_PER_HOUR) {
            const waitMin = Math.max(1, 60 - new Date().getMinutes()); // Fix #7
            log('warning', `🛡️ Đạt giới hạn ${MAX_PER_HOUR}/giờ → nghỉ ${waitMin} phút để tránh ban`, 'send');
            saveCheckpoint();
            S.send.paused = true;
            sendTimer = setTimeout(() => {
                S.send.paused = false;
                log('info', '▶ Tiếp tục sau cool-down giờ...', 'send');
                nextMember();
            }, waitMin * 60 * 1000);
            return;
        }
        if (quota.dayCount >= MAX_PER_DAY) {
            log('warning', `🛡️ Đạt giới hạn ${MAX_PER_DAY}/ngày → dừng hôm nay để bảo vệ tài khoản`, 'send');
            toast(`Dừng! Đã gửi ${MAX_PER_DAY} tin hôm nay. Tiếp tục ngày mai.`, 'warning');
            saveCheckpoint(); stopBulkSend(); return;
        }

        // ── Cool-down sau mỗi COOLDOWN_EVERY tin (Fix #5: flag) ──
        if (useCooldown && sessionSent > 0 && sessionSent % COOLDOWN_EVERY === 0 && !cooldownFired) {
            cooldownFired = true;
            log('info', `☕ Cool-down ${COOLDOWN_TIME / 1000}s sau ${sessionSent} tin...`, 'send');
            sendTimer = setTimeout(nextMember, COOLDOWN_TIME);
            return;
        }
        cooldownFired = false;

        // Retry queue
        if (S.send.retryQueue.length > 0 && idx >= members.length) {
            const retryUid = S.send.retryQueue.shift();
            const rm = members.find(m => m.uid === retryUid) || { uid: retryUid, name: retryUid.slice(-6) };
            log('warning', `🔄 Retry → ${rm.name}`, 'send');
            el.zalo.sendMessageByUid(cookie, retryUid, variantMsg(msg, rm.name)).then(r => {
                if (r.success) {
                    S.send.ok++; log('success', `✅ Retry OK → ${rm.name}`, 'send');
                    // Fix #8: count retry toward quota
                    sessionSent++;
                    const q = getQuota(); q.hourCount = (q.hourCount || 0) + 1; q.dayCount = (q.dayCount || 0) + 1; saveQuota(q); updateQuotaUI();
                } else { log('error', `❌ Retry fail → ${rm.name}`, 'send'); }
                updateSendStats();
                sendTimer = setTimeout(nextMember, baseDelay * 2);
            });
            return;
        }

        if (idx >= members.length && S.send.retryQueue.length === 0) {
            log('success', `🎉 Hoàn thành! ${S.send.ok}/${members.length} OK | ${S.send.err} lỗi`, 'send');
            toast(`Xong! ${S.send.ok}/${members.length} OK`, S.send.err === 0 ? 'success' : 'warning');
            clearCheckpoint(); stopBulkSend(); return;
        }

        const m = members[idx];
        const remaining = members.length - startIdx;
        const pct = remaining > 0 ? Math.round(((idx - startIdx) / remaining) * 100) : 100; // Fix #4
        log('info', `[📤 ${idx + 1}/${members.length} - ${pct}%] → ${m.name}`, 'send');

        // Variation message để tránh spam filter (nếu bật)
        const msgToSend = useVariation ? variantMsg(msg, m.name) : msg;

        el.zalo.sendMessageByUid(cookie, m.uid, msgToSend).then(r => {
            if (r.success) {
                S.send.ok++;
                consecutiveErr = 0;
                sessionSent++;
                // Cập nhật quota
                const q = getQuota();
                q.hourCount = (q.hourCount || 0) + 1;
                q.dayCount = (q.dayCount || 0) + 1;
                saveQuota(q);
                updateQuotaUI();

                const via = r.via === 'friend_request' ? ' 🤝' : r.via === 'friend_request_pending' ? ' ✉️' : r.via === 'direct_retry' ? ' 🔁' : '';
                log('success', `✅ → ${m.name}${via} [${q.hourCount}/h, ${q.dayCount}/d]`, 'send');
            } else {
                S.send.err++;
                consecutiveErr++;
                const errMsg = String(r.error || '');
                log('error', `❌ → ${m.name}: ${errMsg}`, 'send');

                // ── Detect ban signal ──
                const isBanSignal = BAN_KEYWORDS.some(k => errMsg.toLowerCase().includes(k.toLowerCase()));
                if (isBanSignal) {
                    log('warning', `🚨 PHÁT HIỆN TÍN HIỆU BAN! → Tự động dừng 30 phút bảo vệ tài khoản`, 'send');
                    toast('🚨 Có dấu hiệu bị ban! Đã tự dừng 30 phút. Tài khoản được bảo vệ.', 'error');
                    saveCheckpoint();
                    S.send.paused = true;
                    sendTimer = setTimeout(() => {
                        S.send.paused = false;
                        consecutiveErr = 0;
                        log('info', '▶ Tiếp tục sau ban-pause 30 phút...', 'send');
                        nextMember();
                    }, 30 * 60 * 1000);
                    return;
                }

                const isRetryable = !errMsg.includes('tham số') && !errMsg.includes('Bản thân');
                if (isRetryable && S.send.retryQueue.length < 50) S.send.retryQueue.push(m.uid);
                if (stopErr) { saveCheckpoint(); stopBulkSend(); return; }
            }

            S.send.wait = members.length - idx - 1;
            updateSendStats();
            updateSendProgress(++idx, members.length);
            saveCheckpoint();

            // Gaussian delay + adaptive
            let delay = rand ? gaussianDelay(baseDelay) : baseDelay;
            if (consecutiveErr >= 3) { delay *= 2; log('warning', `⚠️ ${consecutiveErr} lỗi → delay x2: ${Math.round(delay / 1000)}s`, 'send'); }
            if (consecutiveErr >= 7) {
                delay = 120000; consecutiveErr = 0;
                log('warning', '🛑 7+ lỗi → nghỉ 2 phút', 'send');
            }
            sendTimer = setTimeout(nextMember, delay);
        });
    };
    // Fix #1: Store reference for pause/resume
    S.send._nextFn = nextMember;
    nextMember();
}






function pauseBulkSend() {
    S.send.paused = !S.send.paused;
    const btn = document.getElementById('btnPauseSend');
    if (S.send.paused) {
        btn.textContent = '▶ Tiếp tục';
        clearTimeout(sendTimer);
        log('warning', '⏸ Tạm dừng gửi tin.', 'send');
    } else {
        btn.textContent = '⏸ Tạm dừng';
        log('info', '▶ Tiếp tục gửi tin...', 'send');
        // Fix #1: Resume existing loop instead of creating a new one
        if (S.send._nextFn) S.send._nextFn();
    }
}

function stopBulkSend() {
    S.send.running = false;
    S.send.paused = false;
    clearTimeout(sendTimer);
    setSendBtns(false);
    document.getElementById('sendProgressCard').style.display = 'none';
    document.getElementById('btnPauseSend').textContent = '⏸ Tạm dừng';
}

// ── Update Anti-Ban Quota UI real-time ──
function updateQuotaUI() {
    try {
        const maxH = Math.max(1, parseInt(document.getElementById('maxPerHour')?.value) || 30);
        const maxD = Math.max(1, parseInt(document.getElementById('maxPerDay')?.value) || 200);
        const q = JSON.parse(localStorage.getItem('zalo_send_quota') || '{}');
        const today = new Date().toDateString();
        const hour = new Date().getHours();
        const hCount = (q.date === today && q.hour === hour) ? (q.hourCount || 0) : 0;
        const dCount = (q.date === today) ? (q.dayCount || 0) : 0;

        const hPct = Math.min(100, (hCount / maxH) * 100);
        const dPct = Math.min(100, (dCount / maxD) * 100);

        const el_hBar = document.getElementById('quotaHourBar');
        const el_dBar = document.getElementById('quotaDayBar');
        const el_hTxt = document.getElementById('quotaHourText');
        const el_dTxt = document.getElementById('quotaDayText');
        const el_status = document.getElementById('antiBanStatus');

        if (el_hBar) el_hBar.style.width = hPct + '%';
        if (el_dBar) el_dBar.style.width = dPct + '%';
        if (el_hTxt) el_hTxt.textContent = `${hCount} / ${maxH}`;
        if (el_dTxt) el_dTxt.textContent = `${dCount} / ${maxD}`;

        // Color bars warning
        if (el_hBar) el_hBar.style.background = hPct > 80
            ? 'linear-gradient(90deg,#ff6b6b,#ee5a24)'
            : hPct > 60 ? 'linear-gradient(90deg,#feca57,#ff9f43)'
                : 'linear-gradient(90deg,#48c78e,#06d6a0)';

        // Status badge
        if (el_status) {
            const maxPct = Math.max(hPct, dPct);
            if (maxPct >= 100) {
                el_status.textContent = '🔴 Đạt giới hạn';
                el_status.style.color = '#ff6b6b';
                el_status.style.background = 'rgba(255,107,107,0.15)';
            } else if (maxPct >= 70) {
                el_status.textContent = '🟡 Cảnh báo';
                el_status.style.color = '#feca57';
                el_status.style.background = 'rgba(254,202,87,0.15)';
            } else {
                el_status.textContent = '🟢 An toàn';
                el_status.style.color = '#48c78e';
                el_status.style.background = 'rgba(72,199,142,0.15)';
            }
        }
    } catch (e) { }
}

// Auto-refresh quota UI every 10s
setInterval(updateQuotaUI, 10000);
setTimeout(updateQuotaUI, 500); // Initial load


function setSendBtns(r) {
    document.getElementById('btnSend').disabled = r;
    document.getElementById('btnPauseSend').disabled = !r;
    document.getElementById('btnStopSend').disabled = !r;
}

function updateSendProgress(cur, tot) {
    const pct = tot ? Math.round(cur / tot * 100) : 0;
    document.getElementById('sendProgressFill').style.width = pct + '%';
    document.getElementById('sendProgressPct').textContent = pct + '%';
    document.getElementById('sendProgressCur').textContent = cur;
    document.getElementById('sendProgressTot').textContent = tot;
}

function updateSendStats() {
    document.getElementById('logOk').textContent = S.send.ok;
    document.getElementById('logErr').textContent = S.send.err;
    document.getElementById('logWait').textContent = S.send.wait;
}

// ══════════════════════════════════════════════════════════════════
// AUTO FRIEND
// ══════════════════════════════════════════════════════════════════
function initAutoFriend() {
    document.getElementById('frDelay').addEventListener('input', function () {
        document.getElementById('frDelayVal').textContent = this.value + 's';
    });

    document.getElementById('frPhoneInput').addEventListener('input', () => {
        const phones = getPhones('frPhoneInput');
        document.getElementById('frPhoneCount').textContent = `${phones.length} người`;
    });

    document.getElementById('btnImportFr').addEventListener('click', () => {
        document.getElementById('frFileInput').click();
    });
    document.getElementById('frFileInput').addEventListener('change', e => {
        readFile(e, 'frPhoneInput', () => {
            document.getElementById('frPhoneCount').textContent = `${getPhones('frPhoneInput').length} người`;
        });
    });

    document.getElementById('btnClearFr').addEventListener('click', () => {
        document.getElementById('frPhoneInput').value = '';
        document.getElementById('frPhoneCount').textContent = '0 người';
    });

    document.getElementById('btnClearFrLog').addEventListener('click', () => {
        document.getElementById('frLogBody').innerHTML = '';
    });

    document.getElementById('btnStartFr').addEventListener('click', startFriend);
    document.getElementById('btnPauseFr').addEventListener('click', pauseFriend);
    document.getElementById('btnStopFr').addEventListener('click', stopFriend);
}

function startFriend() {
    if (!S.loggedIn) { toast('Đăng nhập Zalo trước!', 'error'); navigate('settings'); return; }
    const phones = getPhones('frPhoneInput');
    if (!phones.length) { toast('Nhập danh sách số điện thoại!', 'warning'); return; }

    const limit = parseInt(document.getElementById('frLimit').value) || 50;
    const toSend = phones.slice(0, limit);

    const CHECKPOINT_KEY = 'bulk_friend_cp';
    const QUOTA_KEY = 'zalo_friend_quota';
    const BAN_KEYWORDS = ['spam', 'ban', 'blocked', 'flood', 'tài khoản bị', 'khoá', 'bị khóa', 'không hợp lệ', 'quá số lần'];

    // ── Friend Quota system ──
    const getQuota = () => {
        try {
            const q = JSON.parse(localStorage.getItem(QUOTA_KEY) || '{}');
            const today = new Date().toDateString();
            const hour = new Date().getHours();
            if (q.date !== today) return { date: today, hour, hourCount: 0, dayCount: 0 };
            if (q.hour !== hour) return { ...q, hour, hourCount: 0 };
            return q;
        } catch (e) { return { date: new Date().toDateString(), hour: new Date().getHours(), hourCount: 0, dayCount: 0 }; }
    };
    const saveQuota = (q) => { try { localStorage.setItem(QUOTA_KEY, JSON.stringify(q)); } catch (e) { } };
    const MAX_PER_HOUR = Math.max(1, parseInt(document.getElementById('frMaxPerHour')?.value) || 15);
    const MAX_PER_DAY = Math.max(1, parseInt(document.getElementById('frMaxPerDay')?.value) || 50);
    const COOLDOWN_EVERY = 8;
    const COOLDOWN_TIME = 20000;

    // ── Gaussian delay ──
    const gaussianDelay = (baseMs) => {
        const u1 = Math.random(), u2 = Math.random();
        const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
        const deviation = baseMs * 0.3;
        return Math.max(baseMs * 0.5, baseMs + z * deviation);
    };

    // ── Checkpoint resume ──
    let startIdx = 0;
    try {
        const cp = JSON.parse(localStorage.getItem(CHECKPOINT_KEY) || 'null');
        if (cp && cp.total === toSend.length) {
            startIdx = cp.nextIdx;
            if (startIdx > 0) log('info', `♻️ Resume từ ${startIdx}/${toSend.length}`, 'fr');
        }
    } catch (e) { }

    S.friend = { running: true, paused: false, sent: 0, ok: 0, pend: toSend.length - startIdx, fail: 0, retryQueue: [] };
    setFrBtns(true);
    document.getElementById('frProgressCard').style.display = 'block';
    updateFrProgress(startIdx, toSend.length);
    updateFrStats();

    const baseDelay = parseInt(document.getElementById('frDelay').value) * 1000;
    const rand = document.getElementById('frRandom').checked;
    const useCooldown = document.getElementById('frEnableCooldown')?.checked !== false;
    let idx = startIdx;
    let consecutiveErr = 0;
    let sessionSent = 0;

    const saveCheckpoint = () => {
        try { localStorage.setItem(CHECKPOINT_KEY, JSON.stringify({ total: toSend.length, nextIdx: idx, sent: S.friend.sent, fail: S.friend.fail })); } catch (e) { }
    };
    const clearCheckpoint = () => { try { localStorage.removeItem(CHECKPOINT_KEY); } catch (e) { } };

    // ── Update Friend Quota UI ──
    const updateFrQuotaUI = () => {
        try {
            const maxH = MAX_PER_HOUR;
            const maxD = MAX_PER_DAY;
            const q = getQuota();
            const hCount = q.hourCount || 0;
            const dCount = q.dayCount || 0;
            const hPct = Math.min(100, (hCount / maxH) * 100);
            const dPct = Math.min(100, (dCount / maxD) * 100);

            const el_hBar = document.getElementById('frQuotaHourBar');
            const el_dBar = document.getElementById('frQuotaDayBar');
            const el_hTxt = document.getElementById('frQuotaHourText');
            const el_dTxt = document.getElementById('frQuotaDayText');
            const el_status = document.getElementById('frAntiBanStatus');

            if (el_hBar) el_hBar.style.width = hPct + '%';
            if (el_dBar) el_dBar.style.width = dPct + '%';
            if (el_hTxt) el_hTxt.textContent = `${hCount} / ${maxH}`;
            if (el_dTxt) el_dTxt.textContent = `${dCount} / ${maxD}`;

            if (el_hBar) el_hBar.style.background = hPct > 80
                ? 'linear-gradient(90deg,#ff6b6b,#ee5a24)'
                : hPct > 60 ? 'linear-gradient(90deg,#feca57,#ff9f43)'
                    : 'linear-gradient(90deg,#48c78e,#06d6a0)';

            if (el_status) {
                const maxPct = Math.max(hPct, dPct);
                if (maxPct >= 100) { el_status.textContent = '🔴 Đạt giới hạn'; el_status.style.color = '#ff6b6b'; el_status.style.background = 'rgba(255,107,107,0.15)'; }
                else if (maxPct >= 70) { el_status.textContent = '🟡 Cảnh báo'; el_status.style.color = '#feca57'; el_status.style.background = 'rgba(254,202,87,0.15)'; }
                else { el_status.textContent = '🟢 An toàn'; el_status.style.color = '#48c78e'; el_status.style.background = 'rgba(72,199,142,0.15)'; }
            }
        } catch (e) { }
    };

    toast(`🛡️ Anti-ban ON | Max ${MAX_PER_HOUR}/giờ, ${MAX_PER_DAY}/ngày | ${toSend.length} lời mời`, 'info');
    updateFrQuotaUI();
    let cooldownFired = false; // Fix #5

    const next = () => {
        if (!S.friend.running || S.friend.paused) { saveCheckpoint(); return; }

        // ── Quota check ──
        const quota = getQuota();
        if (quota.hourCount >= MAX_PER_HOUR) {
            const waitMin = Math.max(1, 60 - new Date().getMinutes()); // Fix #7
            log('warning', `🛡️ Đạt giới hạn ${MAX_PER_HOUR} kết bạn/giờ → nghỉ ${waitMin} phút`, 'fr');
            saveCheckpoint();
            S.friend.paused = true;
            frTimer = setTimeout(() => { S.friend.paused = false; log('info', '▶ Tiếp tục sau cool-down giờ...', 'fr'); next(); }, waitMin * 60 * 1000);
            return;
        }
        if (quota.dayCount >= MAX_PER_DAY) {
            log('warning', `🛡️ Đạt giới hạn ${MAX_PER_DAY} kết bạn/ngày → dừng hôm nay`, 'fr');
            toast(`Dừng! Đã gửi ${MAX_PER_DAY} lời mời hôm nay. Tiếp tục ngày mai.`, 'warning');
            saveCheckpoint(); stopFriend(); return;
        }

        // ── Cooldown every N requests (Fix #5: flag) ──
        if (useCooldown && sessionSent > 0 && sessionSent % COOLDOWN_EVERY === 0 && !cooldownFired) {
            cooldownFired = true;
            log('info', `☕ Cool-down ${COOLDOWN_TIME / 1000}s sau ${sessionSent} lời mời...`, 'fr');
            frTimer = setTimeout(next, COOLDOWN_TIME);
            return;
        }
        cooldownFired = false;

        // Retry queue
        if (S.friend.retryQueue.length > 0 && idx >= toSend.length) {
            const retryPhone = S.friend.retryQueue.shift();
            log('warning', `🔄 Retry → ${retryPhone}`, 'fr');
            simulateFriend(retryPhone).then(r => {
                const result = typeof r === 'object' ? r : { status: r };
                if (result.status === 'ok' || result === 'ok') {
                    S.friend.sent++; S.friend.ok++; log('success', `✅ Retry OK → ${retryPhone}`, 'fr');
                    // Fix #8: count retry toward quota
                    sessionSent++;
                    const q = getQuota(); q.hourCount = (q.hourCount || 0) + 1; q.dayCount = (q.dayCount || 0) + 1; saveQuota(q); updateFrQuotaUI();
                } else { log('error', `❌ Retry fail → ${retryPhone}`, 'fr'); }
                updateFrStats();
                frTimer = setTimeout(next, baseDelay * 2);
            });
            return;
        }

        if (idx >= toSend.length && S.friend.retryQueue.length === 0) {
            log('success', `🎉 Hoàn thành! ${S.friend.sent}/${toSend.length} lời mời OK | ${S.friend.fail} lỗi`, 'fr');
            toast(`Xong! ${S.friend.sent} lời mời kết bạn`, 'success');
            clearCheckpoint(); stopFriend(); return;
        }

        const phone = toSend[idx];
        const remaining = toSend.length - startIdx;
        const pct = remaining > 0 ? Math.round(((idx - startIdx) / remaining) * 100) : 100; // Fix #4
        log('info', `[🤝 ${idx + 1}/${toSend.length} - ${pct}%] → ${phone}`, 'fr');

        simulateFriend(phone).then(r => {
            // Fix #10: r can be 'ok', 'already', or { status: 'fail', error: '...' }
            const status = typeof r === 'object' ? r.status : r;
            const errMsg = typeof r === 'object' ? (r.error || 'fail') : (r || 'fail');

            if (status === 'ok') {
                S.friend.sent++;
                S.friend.ok++;
                consecutiveErr = 0;
                sessionSent++;
                const q = getQuota();
                q.hourCount = (q.hourCount || 0) + 1;
                q.dayCount = (q.dayCount || 0) + 1;
                saveQuota(q);
                updateFrQuotaUI();
                log('success', `✅ Gửi lời mời → ${phone} [${q.hourCount}/h, ${q.dayCount}/d]`, 'fr');
            } else if (status === 'already') {
                log('warning', `⚠️ ${phone} đã là bạn bè`, 'fr');
            } else {
                S.friend.fail++;
                consecutiveErr++;
                log('error', `❌ Không tìm thấy ${phone}: ${errMsg}`, 'fr');

                // ── Ban detection (Fix #10: now errMsg contains actual error) ──
                const isBanSignal = BAN_KEYWORDS.some(k => errMsg.toLowerCase().includes(k.toLowerCase()));
                if (isBanSignal) {
                    log('warning', `🚨 PHÁT HIỆN TÍN HIỆU BAN! → Tự động dừng 30 phút`, 'fr');
                    toast('🚨 Có dấu hiệu bị ban! Đã tự dừng 30 phút.', 'error');
                    saveCheckpoint();
                    S.friend.paused = true;
                    frTimer = setTimeout(() => { S.friend.paused = false; consecutiveErr = 0; log('info', '▶ Tiếp tục sau ban-pause 30 phút...', 'fr'); next(); }, 30 * 60 * 1000);
                    return;
                }

                if (S.friend.retryQueue.length < 30) S.friend.retryQueue.push(phone);
            }

            S.friend.pend = toSend.length - idx - 1;
            updateFrStats();
            updateFrProgress(++idx, toSend.length);
            saveCheckpoint();

            // Gaussian delay + adaptive
            let delay = rand ? gaussianDelay(baseDelay) : baseDelay;
            if (consecutiveErr >= 3) { delay *= 2; log('warning', `⚠️ ${consecutiveErr} lỗi → delay x2: ${Math.round(delay / 1000)}s`, 'fr'); }
            if (consecutiveErr >= 5) { delay = 120000; consecutiveErr = 0; log('warning', '🛑 5+ lỗi → nghỉ 2 phút', 'fr'); }
            frTimer = setTimeout(next, delay);
        });
    };
    // Fix #2: Store reference for pauseFriend
    S.friend._nextFn = next;
    next();
}

function pauseFriend() {
    S.friend.paused = !S.friend.paused;
    const btn = document.getElementById('btnPauseFr');
    if (S.friend.paused) {
        btn.textContent = '▶ Tiếp tục';
        clearTimeout(frTimer);
    } else {
        btn.textContent = '⏸ Tạm dừng';
        // Fix #2: Resume existing loop instead of creating a new one
        if (S.friend._nextFn) S.friend._nextFn();
    }
}

function stopFriend() {
    S.friend.running = false;
    clearTimeout(frTimer);
    setFrBtns(false);
    document.getElementById('frProgressCard').style.display = 'none';
    document.getElementById('btnPauseFr').textContent = '⏸ Tạm dừng';
}

function setFrBtns(r) {
    document.getElementById('btnStartFr').disabled = r;
    document.getElementById('btnPauseFr').disabled = !r;
    document.getElementById('btnStopFr').disabled = !r;
}

function updateFrProgress(cur, tot) {
    const pct = tot ? Math.round(cur / tot * 100) : 0;
    document.getElementById('frProgressFill').style.width = pct + '%';
    document.getElementById('frProgressPct').textContent = pct + '%';
    document.getElementById('frProgressCur').textContent = cur;
    document.getElementById('frProgressTot').textContent = tot;
}

function updateFrStats() {
    document.getElementById('frSent').textContent = S.friend.sent;
    document.getElementById('frOk').textContent = S.friend.ok;
    document.getElementById('frPend').textContent = S.friend.pend;
    document.getElementById('frFail').textContent = S.friend.fail;
}

// ══════════════════════════════════════════════════════════════════
// CONTACTS
// ══════════════════════════════════════════════════════════════════
function initContacts() {
    renderContacts();

    document.getElementById('btnAddContact').addEventListener('click', () => openModal('addContactModal'));
    document.getElementById('contactModalClose') && (document.querySelector('#addContactModal .modal-x').onclick = () => closeModal('addContactModal'));
    document.getElementById('btnSaveCt').addEventListener('click', saveContact);
    document.getElementById('btnExportCt').addEventListener('click', () => {
        const csv = 'Tên,SĐT,Nhóm,Trạng thái\n' + S.contacts.map(c => `${c.name},${c.phone},${c.group},${c.active ? 'Hoạt động' : 'Không'}`).join('\n');
        dl('contacts.csv', csv, 'text/csv');
        toast('Xuất CSV thành công!', 'success');
    });
}

function renderContacts() {
    document.getElementById('contactBody').innerHTML = S.contacts.map(c => `
    <tr>
      <td style="color:var(--text-h);font-weight:600">${c.name}</td>
      <td>${c.phone}</td>
      <td><span class="tag">${c.group}</span></td>
      <td><span class="status-badge-tbl ${c.active ? 'active' : 'inactive'}">${c.active ? '● Hoạt động' : '● Không'}</span></td>
      <td style="display:flex;gap:6px">
        <button class="tbl-action" title="Gửi tin" onclick="quickSend('${c.phone}')">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
        </button>
        <button class="tbl-action" title="Kết bạn" onclick="quickFriend('${c.phone}')">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><line x1="19" y1="8" x2="19" y2="14"/><line x1="22" y1="11" x2="16" y2="11"/></svg>
        </button>
        <button class="tbl-action" title="Xóa" onclick="delContact(${c.id})">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/></svg>
        </button>
      </td>
    </tr>
  `).join('');
}

function saveContact() {
    const name = document.getElementById('ctName').value.trim();
    const phone = document.getElementById('ctPhone').value.trim();
    const group = document.getElementById('ctGroup').value.trim() || 'Khác';
    if (!name || !phone) { toast('Điền tên và SĐT!', 'warning'); return; }
    S.contacts.push({ id: Date.now(), name, phone, group, active: true });
    renderContacts();
    closeModal('addContactModal');
    saveState();
    toast(`Đã thêm ${name}`, 'success');
    document.getElementById('ctName').value = '';
    document.getElementById('ctPhone').value = '';
    document.getElementById('ctGroup').value = '';
}

window.delContact = function (id) {
    S.contacts = S.contacts.filter(c => c.id !== id);
    renderContacts();
    saveState();
    toast('Đã xóa liên hệ', 'info');
};

window.quickSend = function (phone) {
    document.getElementById('phoneInput').value = phone;
    updatePhoneCount();
    navigate('bulk-send');
    toast(`Đã thêm ${phone} vào gửi tin`, 'success');
};

window.quickFriend = function (phone) {
    document.getElementById('frPhoneInput').value = phone;
    document.getElementById('frPhoneCount').textContent = '1 người';
    navigate('auto-friend');
    toast(`Đã thêm ${phone} vào kết bạn`, 'success');
};

// ══════════════════════════════════════════════════════════════════
// SETTINGS
// ══════════════════════════════════════════════════════════════════
function initSettings() {
    document.getElementById('howToCookie')?.addEventListener('click', e => {
        e.preventDefault();
        openModal('cookieGuide');
    });

    document.getElementById('btnLoginSubmit').addEventListener('click', doLogin);

    // ── QR LOGIN ──────────────────────────────────────────────
    document.getElementById('btnLoginQR')?.addEventListener('click', async () => {
        if (!el.zalo?.loginQR) { toast('QR login không khả dụng', 'error'); return; }
        openModal('qrModal');
        document.getElementById('qrStatus').textContent = '⏳ Đang tạo mã QR...';
        document.getElementById('qrImage').style.display = 'none';
        log('info', '🔲 Bắt đầu đăng nhập QR...', 'send');
        try {
            await el.zalo.loginQR();
        } catch (e) {
            toast('Lỗi QR: ' + e.message, 'error');
            closeModal('qrModal');
        }
    });

    // Nhận QR image từ main process
    el.onQRReady?.((dataUrl) => {
        document.getElementById('qrStatus').textContent = '📱 Quét bằng Zalo trên điện thoại!';
        const img = document.getElementById('qrImage');
        img.src = dataUrl;
        img.style.display = 'block';
    });

    // Đăng nhập QR thành công
    el.onLoginSuccess?.(async (data) => {
        closeModal('qrModal');
        S.loggedIn = true;
        // Cookie thật từ main process, hoặc null nếu QR session chưa có cookie
        S.cookie = (data?.cookie && data.cookie !== 'null' && data.cookie.length > 10)
            ? data.cookie : null;
        const uid = data?.uid || Date.now().toString();
        const name = data?.name || 'Tài khoản Zalo (QR)';
        S.account = { name, phone: '***', uid, avatar: '' };
        updateAccountUI();
        // Lưu state đầy đủ
        el.store.set('loggedIn', true);
        el.store.set('cookie', S.cookie);
        el.store.set('account', S.account);
        el.store.set('connectedAccount', { uid, name, ts: Date.now() });
        toast('🎉 Đăng nhập QR thành công!', 'success');
        log('success', `✅ Đăng nhập QR OK | ${name} (${uid})`, 'send');

        // Hiện banner TK kết nối
        window.dispatchEvent(new CustomEvent('zalo:loginSuccess_internal', { detail: { uid, name } }));

        // Auto-save vào pool
        try {
            await el.zalo.poolAdd(S.cookie, name, uid);
            refreshAccountList();
            log('info', `📋 Pool: TK ${name} đã thêm`, 'send');
        } catch (_) {}

        // Tự động tải danh sách nhóm
        loadRealGroups();
        navigate('groups');

        // Sync Pipeline
        if (window.syncPipelineFromSettings) setTimeout(window.syncPipelineFromSettings, 500);
    });

    // Lỗi QR
    el.onLoginError?.((msg) => {
        closeModal('qrModal');
        toast('Lỗi đăng nhập QR: ' + msg, 'error');
        log('error', '❌ Lỗi QR: ' + msg, 'send');
    });

    // btnSaveSettings handled by initSettingsV2 — removed duplicate here

    document.getElementById('btnLogout').addEventListener('click', () => {
        S.loggedIn = false;
        S.account = null;
        S.cookie = null;
        updateAccountUI();
        saveState();
        toast('Đã đăng xuất!', 'info');
    });

    document.getElementById('btnLoginGroup').addEventListener('click', () => navigate('settings'));

    // Close modals when clicking the overlay background
    document.querySelectorAll('.modal-overlay').forEach(overlay => {
        overlay.addEventListener('click', e => {
            if (e.target === overlay) overlay.style.display = 'none';
        });
    });

    // Auto-start with Windows toggle
    document.getElementById('setAutoStart').addEventListener('change', function () {
        toast(this.checked ? '✅ Bật khởi động cùng Windows' : '🔕 Tắt khởi động cùng Windows', 'info');
    });
}


async function doLogin() {
    const cookie = document.getElementById('cookieInput').value.trim();
    if (!cookie) { toast('Dán cookie Zalo vào ô bên trên!', 'warning'); return; }
    if (cookie.length < 20) { toast('Cookie không hợp lệ!', 'error'); return; }

    const btn = document.getElementById('btnLoginSubmit');
    btn.disabled = true;
    btn.innerHTML = '⟳ Đang xác thực...';

    log('info', '🔐 Đang xác thực cookie Zalo...', 'send');

    try {
        const result = await el.zalo.verify(cookie);
        if (result.success) {
            S.loggedIn = true;
            S.cookie = cookie;
            S.account = result.user;
            updateAccountUI();
            await el.store.set('cookie', cookie);
            await el.store.set('loggedIn', true);
            await el.store.set('account', result.user);
            btn.disabled = false;
            btn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/><polyline points="10 17 15 12 10 7"/><line x1="15" y1="12" x2="3" y2="12"/></svg> Xác thực & Kết nối`;
            toast(`🎉 Xin chào ${result.user.name}! Đã kết nối Zalo.`, 'success');
            log('success', `✅ Đăng nhập thành công: ${result.user.name} (${result.user.phone})`, 'send');
            navigate('groups');
            // Load real groups
            loadRealGroups();
            // Bug7 fix: sync Pipeline với account mới đăng nhập
            if (window.syncPipelineFromSettings) setTimeout(window.syncPipelineFromSettings, 500);
        } else {
            btn.disabled = false;
            btn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/><polyline points="10 17 15 12 10 7"/><line x1="15" y1="12" x2="3" y2="12"/></svg> Xác thực & Kết nối`;
            toast(`❌ ${result.error || 'Đăng nhập thất bại'}`, 'error');
            log('error', `❌ Lỗi đăng nhập: ${result.error}`, 'send');
        }
    } catch (e) {
        btn.disabled = false;
        btn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/><polyline points="10 17 15 12 10 7"/><line x1="15" y1="12" x2="3" y2="12"/></svg> Xác thực & Kết nối`;
        toast('Lỗi kết nối: ' + e.message, 'error');
    }
}

async function loadRealGroups() {
    if (!S.loggedIn) return;
    const cookie = S.cookie;
    log('info', '📋 Đang tải danh sách nhóm Zalo...', 'send');
    try {
        const result = await el.zalo.getGroups(cookie);
        if (result.success && result.groups.length > 0) {
            S.groups = result.groups;
            renderGroups();
            log('success', `📋 Đã tải ${result.groups.length} nhóm!`, 'send');
            toast(`✅ Tải được ${result.groups.length} nhóm Zalo`, 'success');
        } else {
            log('error', `❌ Không tải được nhóm: ${result.error || 'Không có nhóm'}`, 'send');
        }
    } catch (e) {
        log('error', '❌ Lỗi tải nhóm: ' + e.message, 'send');
    }
}

function updateAccountUI() {
    if (S.loggedIn && S.account) {
        document.getElementById('statusDot').className = 'status-dot online';
        // Bug11 fix: hiển thị tên user thật thay vì chỉ "Đã kết nối"
        const uname = S.account.name || S.account.displayName || 'Đã kết nối';
        document.getElementById('statusText').textContent = uname;
        const btn = document.getElementById('btnLoginGroup');
        if (btn) btn.style.display = 'none';
    } else {
        document.getElementById('statusDot').className = 'status-dot offline';
        document.getElementById('statusText').textContent = 'Chưa kết nối';
        const btn = document.getElementById('btnLoginGroup');
        if (btn) btn.style.display = '';
    }
}

// ══════════════════════════════════════════════════════════════════
// UTILITIES
// ══════════════════════════════════════════════════════════════════
function log(type, msg, target) {
    const el = document.getElementById(target === 'fr' ? 'frLogBody' : 'logBody');
    const now = new Date().toTimeString().split(' ')[0];
    const div = document.createElement('div');
    div.className = `log-entry ${type}`;
    div.innerHTML = `<span class="log-time">${now}</span><span class="log-msg">${msg}</span>`;
    el.appendChild(div);
    el.scrollTop = el.scrollHeight;
    while (el.children.length > 300) el.removeChild(el.firstChild);
}

function toast(msg, type = 'info') {
    const w = document.getElementById('toastWrap');
    const t = document.createElement('div');
    t.className = `toast ${type}`;
    const icons = { success: '✅', error: '❌', warning: '⚠️', info: 'ℹ️' };
    t.innerHTML = `<span>${icons[type] || ''}</span><span>${msg}</span>`;
    w.appendChild(t);
    setTimeout(() => { t.style.animation = 'toast-out .3s ease forwards'; setTimeout(() => t.remove(), 300); }, 3200);
}

window.openModal = function (id) {
    document.getElementById(id).style.display = 'flex';
};
window.closeModal = function (id) {
    document.getElementById(id).style.display = 'none';
};

window.insertVar = function (v) {
    const ta = document.getElementById('msgInput');
    const s = ta.selectionStart;
    ta.value = ta.value.slice(0, s) + v + ta.value.slice(s);
    ta.selectionStart = ta.selectionEnd = s + v.length;
    ta.focus();
    document.getElementById('msgCharCount').textContent = `${ta.value.length}/500`;
};

// ── Real API callers (fallback to simulate if not in Electron) ────
async function simulateSend(phone, message) {
    if (el.zalo && (S.cookie || S.loggedIn)) {
        try {
            // Bug8 fix: không dùng 'QR_SESSION' string làm cookie — fallback sang null để zca-js dùng session cache
            const cookie = (S.cookie && S.cookie !== 'QR_SESSION') ? S.cookie : null;
            if (!cookie) return { success: false, error: 'Phiên đăng nhập QR chưa có cookie thật. Vui lòng đăng nhập lại bằng cookie.' };
            const r = await el.zalo.sendMessage(cookie, phone, message);
            return r;
        } catch (e) {
            return { success: false, error: e.message };
        }
    }
    return { success: Math.random() > 0.12 };
}

async function simulateFriend(phone) {
    if (el.zalo && S.cookie) {
        try {
            const r = await el.zalo.sendFriendRequest(S.cookie, phone, document.getElementById('frMsgInput').value.trim());
            if (r.success) return 'ok';
            if (r.already) return 'already';
            if (r.pending) return 'already';
            // Fix #10: Return error message for ban detection instead of plain 'fail'
            return { status: 'fail', error: r.error || 'Unknown error' };
        } catch (e) {
            return { status: 'fail', error: e.message };
        }
    }
    // fallback
    const v = Math.random();
    return v > 0.15 ? 'ok' : v > 0.08 ? 'already' : { status: 'fail', error: 'simulated failure' };
}

function readFile(e, taId, cb) {
    const f = e.target.files[0]; if (!f) return;
    const fr = new FileReader();
    fr.onload = ev => { document.getElementById(taId).value = ev.target.result; cb && cb(); toast(`Import: ${f.name}`, 'success'); };
    fr.readAsText(f); e.target.value = '';
}

function dl(name, content, type) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([content], { type }));
    a.download = name; a.click();
}

// ── Persistent storage ───────────────────────────────────────────
async function loadState() {
    try {
        const all = await el.store.getAll();
        const cookie = all.cookie;
        // FIX #6: Accept cookie dù là QR session hay cookie thật, miễn length > 10
        if (all.loggedIn && cookie && cookie.length > 10) {
            S.loggedIn = true;
            S.cookie = cookie;
            S.account = all.account || { name: 'Người dùng Zalo', phone: '***' };
            updateAccountUI();
            if (document.getElementById('cookieInput')) {
                document.getElementById('cookieInput').value = cookie;
            }
            // Restore connected account banner
            const acct = all.connectedAccount;
            if (acct && acct.uid) {
                setTimeout(() => {
                    window.dispatchEvent(new CustomEvent('zalo:loginSuccess_internal', {
                        detail: { uid: acct.uid, name: acct.name || S.account.name }
                    }));
                }, 900);
            }
        } else {
            S.loggedIn = false;
            S.cookie = null;
            updateAccountUI();
        }
        if (all.contacts?.length) { S.contacts = all.contacts; renderContacts(); }
    } catch { }
}


async function saveState() {
    try {
        await el.store.set('loggedIn', S.loggedIn);
        await el.store.set('account', S.account);
        await el.store.set('contacts', S.contacts);
    } catch { }
}

setInterval(saveState, 30000);

// ══════════════════════════════════════════════════════════════════
// SAO CHÉP THÀNH VIÊN NHÓM
// ══════════════════════════════════════════════════════════════════

function cpyLog(msg, type = 'info') {
    const div = document.getElementById('cpyLog');
    if (!div) return;
    const colors = { info: '#cdd9e5', success: '#48c78e', error: '#ff6b6b', warning: '#feca57' };
    const icons = { info: '>', success: '✓', error: '✗', warning: '⚠' };
    const line = document.createElement('div');
    line.style.color = colors[type] || '#cdd9e5';
    line.style.padding = '1px 0';
    line.textContent = `[${new Date().toLocaleTimeString('vi-VN')}] ${icons[type]} ${msg}`;
    // Remove placeholder
    const ph = div.querySelector('span');
    if (ph) ph.remove();
    div.appendChild(line);
    div.scrollTop = div.scrollHeight;
}

async function fillCopyGroupDropdowns(forceRefresh = false) {
    const src = document.getElementById('cpySrcGroup');
    const tgt = document.getElementById('cpyTgtGroup');
    if (!src || !tgt) return;

    // Nếu chưa đăng nhập thì bỏ qua
    if (!S.loggedIn) {
        src.innerHTML = '<option value="">-- Đăng nhập trước --</option>';
        tgt.innerHTML = '<option value="">-- Đăng nhập trước --</option>';
        return;
    }

    // Hiển thị loading
    src.innerHTML = '<option value="">⏳ Đang tải danh sách nhóm...</option>';
    tgt.innerHTML = '<option value="">⏳ Đang tải danh sách nhóm...</option>';

    try {
        // Luôn fetch mới từ Zalo nếu forceRefresh hoặc chưa có groups
        let groups = S.groups || [];
        if (forceRefresh || groups.length === 0) {
            const cookie = S.cookie;
            cpyLog('🔄 Đang tải danh sách nhóm từ Zalo...');
            const result = await el.zalo.getGroups(cookie);
            if (result.success && result.groups?.length) {
                groups = result.groups;
                S.groups = groups; // cập nhật cache local
                cpyLog(`✅ Tải xong: ${groups.length} nhóm`);
            } else {
                cpyLog(`⚠️ Không tải được nhóm: ${result.error || 'unknown'}`, 'warning');
            }
        }

        if (groups.length === 0) {
            src.innerHTML = '<option value="">-- Không có nhóm nào --</option>';
            tgt.innerHTML = '<option value="">-- Không có nhóm nào --</option>';
            return;
        }

        // Sắp xếp theo tên
        const sorted = [...groups].sort((a, b) => (a.name || '').localeCompare(b.name || '', 'vi'));
        const opts = sorted.map(g =>
            `<option value="${g.id}">${g.name || g.id} (${g.members ?? '?'} người)</option>`
        ).join('');

        src.innerHTML = '<option value="">-- Chọn nhóm NGUỒN (bạn đã tham gia) --</option>' + opts;
        tgt.innerHTML = '<option value="">-- Chọn nhóm ĐÍCH (nhóm của bạn) --</option>' + opts;

        // Info khi chọn nhóm nguồn
        src.addEventListener('change', () => {
            const g = groups.find(x => x.id === src.value);
            document.getElementById('cpySrcInfo').textContent =
                g ? `👥 ${g.members ?? '?'} thành viên | ID: ${g.id}` : '';
        });

    } catch (e) {
        cpyLog(`❌ Lỗi tải nhóm: ${e.message}`, 'error');
        src.innerHTML = '<option value="">-- Lỗi tải nhóm --</option>';
        tgt.innerHTML = '<option value="">-- Lỗi tải nhóm --</option>';
    }
}

window.onCpyModeChange = function () {
    const isNew = document.getElementById('modeNew').checked;
    document.getElementById('panelTgtGroup').style.display = isNew ? 'none' : '';
    document.getElementById('panelNewGroup').style.display = isNew ? '' : 'none';
};

async function startCopyGroup() {
    if (!S.loggedIn) { toast('Vui lòng đăng nhập trước!', 'error'); return; }
    const srcId = document.getElementById('cpySrcGroup').value;
    if (!srcId) { toast('Hãy chọn nhóm nguồn!', 'warning'); return; }
    const isNew = document.getElementById('modeNew').checked;
    const tgtId = isNew ? null : document.getElementById('cpyTgtGroup').value;
    if (!isNew && !tgtId) { toast('Hãy chọn nhóm đích!', 'warning'); return; }
    const newName = document.getElementById('cpyNewName').value.trim();
    const batchSize = parseInt(document.getElementById('cpyBatch').value) || 5;
    const delayMs = (parseInt(document.getElementById('cpyDelay').value) || 2) * 1000;
    const cookie = S.cookie;

    // Reset UI
    document.getElementById('cpyProgressCard').style.display = 'block';
    document.getElementById('cpyProgressBar').style.width = '0%';
    document.getElementById('cpyProgressText').textContent = '0 / ?';
    document.getElementById('cpyCountOk').textContent = '0';
    document.getElementById('cpyCountErr').textContent = '0';
    document.getElementById('cpyCountTotal').textContent = '0';
    document.getElementById('cpyLog').innerHTML = '';
    document.getElementById('btnCopyGroup').disabled = true;
    document.getElementById('btnCopyGroupStop').style.display = '';

    const srcGroup = (S.groups || []).find(g => g.id === srcId);
    cpyLog(`Bắt đầu sao chép từ "${srcGroup?.name || srcId}" → ${isNew ? `nhóm mới "${newName || 'Nhóm sao chép'}"` : `nhóm đích ${tgtId}`}`);
    cpyLog(`Batch ${batchSize} người/lần | Delay ${delayMs / 1000}s`);

    try {
        const result = await el.zalo.copyGroupMembers(cookie, srcId, tgtId, {
            createNewGroup: isNew,
            newGroupName: newName,
            batchSize,
            delayMs,
        });

        if (result.success) {
            document.getElementById('cpyCountOk').textContent = result.added || 0;
            document.getElementById('cpyCountErr').textContent = result.failed || 0;
            document.getElementById('cpyCountTotal').textContent = result.total || (result.added + result.failed) || 0;
            document.getElementById('cpyProgressBar').style.width = '100%';

            if (result.createdGroupId) {
                cpyLog(`✅ Đã tạo nhóm mới "${result.groupName}" (ID: ${result.createdGroupId})`, 'success');
            }
            cpyLog(`🎉 Hoàn thành! ${result.added}/${result.total || '?'} thành viên đã sao chép.`, 'success');
            if (result.msg) cpyLog(result.msg, 'info');
            if (result.errors?.length) {
                result.errors.slice(0, 5).forEach(e => cpyLog(`Lỗi: ${e}`, 'error'));
            }
            toast(`Sao chép xong! +${result.added} thành viên`, 'success');
        } else {
            cpyLog(`❌ Lỗi: ${result.error}`, 'error');
            toast(`Lỗi: ${result.error}`, 'error');
        }
    } catch (e) {
        cpyLog(`❌ Exception: ${e.message}`, 'error');
    }

    document.getElementById('btnCopyGroup').disabled = false;
    document.getElementById('btnCopyGroupStop').style.display = 'none';
}

function initCopyGroup() {
    // Auto-load danh sách nhóm từ Zalo ngay khi vào tab
    fillCopyGroupDropdowns(false);

    // Nút Tải lại nhóm
    const btnRefresh = document.getElementById('btnRefreshCopyGroups');
    if (btnRefresh) {
        btnRefresh.addEventListener('click', async () => {
            btnRefresh.disabled = true;
            btnRefresh.textContent = '⏳ Đang tải...';
            await fillCopyGroupDropdowns(true); // forceRefresh = true
            btnRefresh.disabled = false;
            btnRefresh.textContent = '🔄 Tải lại';
        });
    }

    document.getElementById('btnCopyGroup').addEventListener('click', startCopyGroup);
    document.getElementById('btnCopyGroupStop').addEventListener('click', () => {
        toast('Đang xử lý... không thể dừng giữa chừng. Vui lòng chờ batch hiện tại hoàn tất.', 'warning');
    });

    // Nghe progress real-time từ main process
    el.onCopyProgress((data) => {
        const { done, total } = data || {};
        if (!total) return;
        const pct = Math.round((done / total) * 100);
        document.getElementById('cpyProgressBar').style.width = pct + '%';
        document.getElementById('cpyProgressText').textContent = `${done} / ${total}`;
        document.getElementById('cpyCountTotal').textContent = total;
    });

    // ── HYDRA log streaming realtime ──
    el.onHydraLog((msg) => {
        // Color-code dựa theo prefix
        let type = 'info';
        if (msg.includes('[L1-OK]') || msg.includes('[L2-OK]') || msg.includes('[L3-OK]') || msg.includes('✅') || msg.includes('100%')) type = 'success';
        else if (msg.includes('❌') || msg.includes('FAIL') || msg.includes('err')) type = 'error';
        else if (msg.includes('📨') || msg.includes('INVITED') || msg.includes('[L4]') || msg.includes('[L5]')) type = 'warning';
        cpyLog(msg, type);
    });

    // Phê duyệt pending members độc lập
    document.getElementById('btnApprovePending').addEventListener('click', async () => {
        if (!S.loggedIn) { toast('Vui lòng đăng nhập!', 'error'); return; }
        const isNew = document.getElementById('modeNew').checked;
        const tgtId = isNew ? null : document.getElementById('cpyTgtGroup').value;
        if (!tgtId) { toast('Hãy chọn nhóm đích trước!', 'warning'); return; }
        const btn = document.getElementById('btnApprovePending');
        btn.disabled = true;
        btn.textContent = '⏳ Đang phê duyệt...';
        cpyLog(`🔔 Đang lấy danh sách pending members của nhóm ${tgtId}...`);
        const cookie = S.cookie;
        try {
            const r = await el.zalo.approvePending(cookie, tgtId);
            if (r.success) {
                cpyLog(`✅ Đã phê duyệt ${r.approved}/${r.total || '?'} pending members!`, 'success');
                toast(`Đã phê duyệt ${r.approved} thành viên chờ!`, 'success');
            } else {
                cpyLog(`❌ Lỗi: ${r.error}`, 'error');
                toast(`Lỗi: ${r.error}`, 'error');
            }
        } catch (e) {
            cpyLog(`❌ Exception: ${e.message}`, 'error');
        }
        btn.disabled = false;
        btn.textContent = '✅ Phê Duyệt Pending Members';
    });

    // ── Gửi link mời (non-admin bypass pending) ──
    document.getElementById('btnForceJoinViaLink').addEventListener('click', async () => {
        if (!S.loggedIn) { toast('Vui lòng đăng nhập!', 'error'); return; }
        const srcId = document.getElementById('cpySrcGroup').value;
        const isNew = document.getElementById('modeNew').checked;
        const tgtId = isNew ? null : document.getElementById('cpyTgtGroup').value;
        if (!srcId) { toast('Hãy chọn nhóm nguồn!', 'warning'); return; }
        if (!tgtId) { toast('Hãy chọn nhóm đích!', 'warning'); return; }

        const btn = document.getElementById('btnForceJoinViaLink');
        btn.disabled = true;
        btn.textContent = '⏳ Đang gửi link mời...';
        const cookie = S.cookie;

        cpyLog('🔗 Bước 1: Lấy thành viên nhóm nguồn...');
        try {
            const membersRes = await el.zalo.getGroupMembers(cookie, srcId);
            if (!membersRes.success || !membersRes.members?.length) {
                cpyLog('❌ Không lấy được thành viên nhóm nguồn!', 'error');
                toast('Không lấy được thành viên!', 'error');
                btn.disabled = false; btn.textContent = '🔗 Gửi Link Mời (Non-Admin Bypass)';
                return;
            }
            const uids = membersRes.members.map(m => String(m.uid)).filter(u => u && u !== '0');
            cpyLog(`🔗 Bước 2: Gửi link mời đến ${uids.length} thành viên qua DM...`);
            document.getElementById('cpyProgressCard').style.display = 'block';
            const r = await el.zalo.forceJoinViaLink(cookie, tgtId, uids, { delayMs: 1500 });
            if (r.success) {
                cpyLog(`✅ Đã gửi: ${r.sent}/${uids.length} thành viên`);
                if (r.link) cpyLog(`🔗 Invite Link: ${r.link}`, 'success');
                toast(`Đã gửi link mời cho ${r.sent} người!`, 'success');
            } else {
                cpyLog(`❌ Lỗi: ${r.error}`, 'error');
                toast(`Lỗi: ${r.error}`, 'error');
            }
        } catch (e) { cpyLog(`❌ Exception: ${e.message}`, 'error'); }
        btn.disabled = false;
        btn.textContent = '🔗 Gửi Link Mời (Non-Admin Bypass)';
    });

    // ── HYDRA 7-LAYER ULTRA BYPASS ──────────────────────────────
    const btnHydra = document.getElementById('btnHydra');
    if (btnHydra) {
        btnHydra.addEventListener('click', async () => {
            if (!S.loggedIn) { toast('Vui lòng đăng nhập trước!', 'error'); return; }
            const srcId = document.getElementById('cpySrcGroup').value;
            const isNew = document.getElementById('modeNew').checked;
            const tgtId = isNew ? null : document.getElementById('cpyTgtGroup').value;
            if (!srcId) { toast('Hãy chọn nhóm nguồn!', 'warning'); return; }
            if (!isNew && !tgtId) { toast('Hãy chọn nhóm đích!', 'warning'); return; }

            const batchSize = parseInt(document.getElementById('cpyBatch').value) || 80;
            const delayMs = (parseInt(document.getElementById('cpyDelay').value) || 2) * 1000;
            const newName = document.getElementById('cpyNewName')?.value?.trim() || '';
            const cookie = S.cookie;

            // Reset UI
            document.getElementById('cpyProgressCard').style.display = 'block';
            document.getElementById('cpyProgressBar').style.width = '0%';
            document.getElementById('cpyProgressText').textContent = '0 / ?';
            document.getElementById('cpyCountOk').textContent = '0';
            document.getElementById('cpyCountErr').textContent = '0';
            document.getElementById('cpyCountTotal').textContent = '0';
            document.getElementById('cpyLog').innerHTML = '';

            btnHydra.disabled = true;
            btnHydra.textContent = '⚡ HYDRA đang chạy...';

            cpyLog('🐍 HYDRA INIT: 7-layer bypass algorithm khởi động...', 'info');
            cpyLog('L1=Direct | L2=TempBridge | L3=Cascade | L4=PushInvite | L5=FRLink | L6=Wave | L7=AutoApprove', 'info');

            try {
                const result = await el.zalo.copyHydra(cookie, srcId, tgtId, {
                    createNewGroup: isNew,
                    newGroupName: newName,
                    batchSize,
                    delayMs,
                    maxWaves: 3,
                    waveDelay: 30000,
                });

                if (result.success) {
                    document.getElementById('cpyCountOk').textContent = result.added || 0;
                    document.getElementById('cpyCountErr').textContent = result.failed || 0;
                    document.getElementById('cpyCountTotal').textContent = result.total || 0;
                    document.getElementById('cpyProgressBar').style.width = (result.successRate || 0) + '%';

                    cpyLog(`🎉 HOÀN THÀNH! ${result.successRate}% (${result.added}/${result.total}) đã vào nhóm`, 'success');
                    if (result.invited > 0) cpyLog(`📨 ${result.invited} người đã nhận invite/link — chờ họ bấm OK`, 'warning');
                    if (result.inviteLink) cpyLog(`🔗 Invite link: ${result.inviteLink}`, 'info');
                    if (result.createdGroupId) cpyLog(`✨ Nhóm mới tạo ID: ${result.createdGroupId}`, 'success');
                    toast(`HYDRA: ${result.successRate}% thành công! +${result.added} thành viên`, 'success');
                } else {
                    cpyLog(`❌ HYDRA lỗi: ${result.error}`, 'error');
                    toast(`HYDRA lỗi: ${result.error}`, 'error');
                }
            } catch (e) {
                cpyLog(`❌ HYDRA Exception: ${e.message}`, 'error');
            }

            btnHydra.disabled = false;
            btnHydra.textContent = '🐍 HYDRA — 7-Layer Ultra Bypass';
        });
    }
}



// ══════════════════════════════════════════════════════════════
// AUTO PIPELINE UI — PERSISTENT DB + MESSAGE ROTATION LIBRARY
// ══════════════════════════════════════════════════════════════
(function initPipelineUI() {
    const ipc = window.electron?.ipcRenderer;

    // ── Helpers: store ──
    async function dbGet(key, def = '') {
        try { return (await ipc?.invoke('store:get', key)) ?? def; } catch(_) { return def; }
    }
    async function dbSet(key, val) {
        try { await ipc?.invoke('store:set', key, val); } catch(_) {}
    }

    function lines(str) { return (str||'').split('\n').map(l=>l.trim()).filter(Boolean); }
    function badge(id, arr, unit='') {
        const el = document.getElementById(id);
        if (el) el.textContent = `${arr.length} ${unit}`;
    }

    // ── Load all persisted values on DOMContentLoaded / navigate ──
    async function loadDB() {
        const [cookies, groups, customers, dest, msgs, tgToken, tgChatId, maxPG] = await Promise.all([
            dbGet('pipe_cookies',''), dbGet('pipe_groups',''),
            dbGet('pipe_customers',''), dbGet('pipe_dest',''),
            dbGet('pipe_msgs','[]'), dbGet('pipe_tg_token',''),
            dbGet('pipe_tg_chatid',''), dbGet('pipe_max_per_group','200')
        ]);
        setVal('pipeCookies', cookies);    badge('pipeAcctCount',   lines(cookies), 'TK');
        setVal('pipeGroupLinks', groups);  badge('pipeLinkCount',   lines(groups),  'links');
        setVal('pipeCustomers', customers);badge('pipeCustomerCount',lines(customers),'người');
        setVal('pipeDestGroups', dest);
        setVal('pipeTgToken', tgToken);
        setVal('pipeTgChatId', tgChatId);
        const mpg = document.getElementById('pipeMaxPerGroup');
        if (mpg) mpg.value = maxPG;

        // Load message library
        try {
            const arr = JSON.parse(msgs);
            arr.forEach(m => addMsgCard(m, false));
            badge('pipeMsgCount', arr, 'tin');
        } catch(_){}
    }

    function setVal(id, val) {
        const el = document.getElementById(id);
        if (el) el.value = val;
    }

    // ── Message Rotation Library ──
    let msgLibrary = [];

    function saveMsgs() {
        dbSet('pipe_msgs', JSON.stringify(msgLibrary));
        badge('pipeMsgCount', msgLibrary, 'tin');
    }

    function addMsgCard(text, persist = true) {
        if (!text || !text.trim()) return;
        if (msgLibrary.indexOf(text.trim()) === -1) msgLibrary.push(text.trim());
        renderMsgList();
        if (persist) saveMsgs();
    }

    function renderMsgList() {
        const list = document.getElementById('pipeMsgList');
        if (!list) return;
        list.innerHTML = '';
        msgLibrary.forEach((msg, idx) => {
            const card = document.createElement('div');
            card.style.cssText = 'display:flex;gap:6px;align-items:flex-start;padding:8px;border-radius:8px;border:1px solid rgba(255,255,255,0.08);background:rgba(255,255,255,0.03)';
            card.innerHTML = `
                <div style="flex:1;font-size:12px;color:var(--text-h);white-space:pre-wrap;word-break:break-word">${escHtml(msg)}</div>
                <button style="padding:3px 8px;border-radius:6px;border:none;background:rgba(239,68,68,0.15);color:#ef4444;cursor:pointer;font-size:11px;white-space:nowrap" data-idx="${idx}">✕</button>
            `;
            card.querySelector('button').addEventListener('click', (e) => {
                const i = parseInt(e.target.dataset.idx);
                msgLibrary.splice(i, 1);
                renderMsgList();
                saveMsgs();
            });
            list.appendChild(card);
        });
        badge('pipeMsgCount', msgLibrary, 'tin');
    }

    function escHtml(s) {
        return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    }

    // ── Stage Highlight ──
    const stageMap = { joining:'pstage1', filtering:'pstage2', harvesting:'pstage3', scoring:'pstage4', sending:'pstage5' };
    function highlightStage(stageName) {
        ['pstage1','pstage2','pstage3','pstage4','pstage5'].forEach(id => {
            const el = document.getElementById(id);
            if (!el) return;
            el.style.background = ''; el.style.borderColor = 'rgba(255,255,255,0.08)'; el.style.color = '';
        });
        const el = document.getElementById(stageMap[stageName]);
        if (el) {
            el.style.background = 'linear-gradient(135deg,rgba(102,126,234,0.3),rgba(245,158,11,0.2))';
            el.style.borderColor = '#667eea'; el.style.color = '#fff'; el.style.fontWeight = '700';
        }
    }
    function markStageDone(stageName) {
        const el = document.getElementById(stageMap[stageName]);
        if (el) { el.style.background = 'rgba(16,185,129,0.15)'; el.style.borderColor = '#10b981'; }
    }

    // ── Log ──
    function addPipeLog(msg, type = '') {
        const body = document.getElementById('pipeLogBody');
        if (!body) return;
        const d = document.createElement('div');
        d.className = `log-entry ${type}`;
        d.textContent = `[${new Date().toLocaleTimeString()}] ${msg}`;
        body.prepend(d);
        if (body.children.length > 300) body.lastChild?.remove();
    }

    // ── Progress handler ──
    let pipeOkN = 0, pipeFailN = 0;
    window.electron?.onPipelineProgress?.((p) => {
        const status = document.getElementById('pipeStatusText');
        const pct    = document.getElementById('pipePct');
        const fill   = document.getElementById('pipeProgressFill');
        if (status) status.textContent = p.status || '';
        if (pct)    pct.textContent = `${p.pct||0}%`;
        if (fill)   fill.style.width = `${p.pct||0}%`;
        if (p.stage) highlightStage(p.stage);
        if (p.pipeline?.harvestedCount) {
            const el = document.getElementById('pipeHarvested');
            if (el) el.textContent = p.pipeline.harvestedCount;
        }
        addPipeLog(p.status || '', p.stage === 'error' ? 'err' : '');
        if (p.stage === 'done' || p.stage === 'error') {
            resetBtns();
            if (p.pipeline?.sendResult) {
                pipeOkN   += p.pipeline.sendResult.sent   || 0;
                pipeFailN += p.pipeline.sendResult.failed || 0;
                const elOk   = document.getElementById('pipeOk');
                const elFail = document.getElementById('pipeFail');
                if (elOk)   elOk.textContent   = pipeOkN;
                if (elFail) elFail.textContent  = pipeFailN;
            }
            if (p.stage === 'done') Object.keys(stageMap).forEach(s => markStageDone(s));
        }
    });

    function resetBtns() {
        const s = document.getElementById('btnStartPipeline');
        const x = document.getElementById('btnStopPipeline');
        if (s) { s.disabled = false; s.textContent = '⚡ Chạy Pipeline'; }
        if (x)   x.disabled = true;
    }

    // ── Wire buttons after DOM ready ──
    function wireButtons() {

        // Save accounts
        document.getElementById('btnPipeSaveAcct')?.addEventListener('click', () => {
            const v = document.getElementById('pipeCookies')?.value || '';
            dbSet('pipe_cookies', v);
            badge('pipeAcctCount', lines(v), 'TK');
            addPipeLog('✅ Đã lưu tài khoản');
        });
        document.getElementById('btnPipeClearAcct')?.addEventListener('click', () => {
            if (!confirm('Xóa toàn bộ cookies đã lưu?')) return;
            setVal('pipeCookies',''); dbSet('pipe_cookies','');
            badge('pipeAcctCount', [], 'TK');
        });

        // Save groups
        document.getElementById('btnPipeSaveGroups')?.addEventListener('click', () => {
            const v = document.getElementById('pipeGroupLinks')?.value || '';
            dbSet('pipe_groups', v);
            badge('pipeLinkCount', lines(v), 'links');
            addPipeLog(`✅ Đã lưu ${lines(v).length} groups`);
        });
        document.getElementById('btnPipeAppendGroups')?.addEventListener('click', async () => {
            const cur  = await dbGet('pipe_groups','');
            const newV = document.getElementById('pipeGroupLinks')?.value || '';
            const combined = [...new Set([...lines(cur), ...lines(newV)])].join('\n');
            setVal('pipeGroupLinks', combined);
            dbSet('pipe_groups', combined);
            badge('pipeLinkCount', lines(combined), 'links');
            addPipeLog(`✅ Đã thêm vào DB: ${lines(combined).length} groups`);
        });
        document.getElementById('btnPipeClearGroups')?.addEventListener('click', () => {
            if (!confirm('Xóa toàn bộ danh sách nhóm?')) return;
            setVal('pipeGroupLinks',''); dbSet('pipe_groups','');
            badge('pipeLinkCount', [], 'links');
        });

        // Update count live as user types
        document.getElementById('pipeGroupLinks')?.addEventListener('input', (e) => {
            badge('pipeLinkCount', lines(e.target.value), 'links');
        });

        // Save customers
        document.getElementById('btnPipeSaveCustomers')?.addEventListener('click', () => {
            const v = document.getElementById('pipeCustomers')?.value || '';
            dbSet('pipe_customers', v);
            badge('pipeCustomerCount', lines(v), 'người');
            addPipeLog(`✅ Đã lưu ${lines(v).length} khách hàng`);
        });
        document.getElementById('btnPipeAppendCustomers')?.addEventListener('click', async () => {
            const cur  = await dbGet('pipe_customers','');
            const newV = document.getElementById('pipeCustomers')?.value || '';
            const combined = [...new Set([...lines(cur), ...lines(newV)])].join('\n');
            setVal('pipeCustomers', combined);
            dbSet('pipe_customers', combined);
            badge('pipeCustomerCount', lines(combined), 'người');
            addPipeLog(`✅ ${lines(combined).length} khách hàng trong DB`);
        });
        document.getElementById('btnPipeClearCustomers')?.addEventListener('click', () => {
            if (!confirm('Xóa danh sách khách hàng?')) return;
            setVal('pipeCustomers',''); dbSet('pipe_customers','');
            badge('pipeCustomerCount', [], 'người');
        });

        document.getElementById('pipeCustomers')?.addEventListener('input', (e) => {
            badge('pipeCustomerCount', lines(e.target.value), 'người');
        });
        document.getElementById('pipeCookies')?.addEventListener('input', (e) => {
            badge('pipeAcctCount', lines(e.target.value), 'TK');
        });

        // Save dest groups
        document.getElementById('btnPipeSaveDest')?.addEventListener('click', () => {
            const v = document.getElementById('pipeDestGroups')?.value || '';
            dbSet('pipe_dest', v); addPipeLog('✅ Đã lưu nhóm đích');
        });

        // Settings — auto-save on blur
        ['pipeTgToken','pipeTgChatId'].forEach(id => {
            document.getElementById(id)?.addEventListener('blur', (e) => {
                dbSet(id === 'pipeTgToken' ? 'pipe_tg_token' : 'pipe_tg_chatid', e.target.value);
            });
        });
        document.getElementById('pipeMaxPerGroup')?.addEventListener('change', (e) => {
            dbSet('pipe_max_per_group', e.target.value);
        });

        // Add message to library
        document.getElementById('btnAddPipeMsg')?.addEventListener('click', () => {
            const ta = document.getElementById('pipeNewMsg');
            if (!ta || !ta.value.trim()) return;
            addMsgCard(ta.value.trim());
            ta.value = '';
        });
        document.getElementById('pipeNewMsg')?.addEventListener('keydown', (e) => {
            if (e.ctrlKey && e.key === 'Enter') document.getElementById('btnAddPipeMsg')?.click();
        });

        // Reset all DB
        document.getElementById('btnPipeReset')?.addEventListener('click', () => {
            if (!confirm('Xóa TOÀN BỘ dữ liệu Pipeline (accounts, groups, messages)?')) return;
            ['pipe_cookies','pipe_groups','pipe_customers','pipe_dest','pipe_msgs','pipe_tg_token','pipe_tg_chatid'].forEach(k => dbSet(k,''));
            ['pipeCookies','pipeGroupLinks','pipeCustomers','pipeDestGroups','pipeTgToken','pipeTgChatId'].forEach(id => setVal(id,''));
            msgLibrary = []; renderMsgList();
            ['pipeAcctCount','pipeLinkCount','pipeCustomerCount','pipeMsgCount'].forEach(id => {
                const el = document.getElementById(id); if(el) el.textContent = '0';
            });
            addPipeLog('🗑 Đã xóa toàn bộ DB Pipeline', 'err');
        });

        // Clear log
        document.getElementById('btnClearPipeLog')?.addEventListener('click', () => {
            const b = document.getElementById('pipeLogBody'); if(b) b.innerHTML='';
        });

        // ── START PIPELINE ──
        document.getElementById('btnStartPipeline')?.addEventListener('click', async () => {
            let cookiesRaw = document.getElementById('pipeCookies')?.value || '';
            if (!cookiesRaw.trim()) {
                const primaryCookie = await ipc?.invoke('store:get', 'cookie');
                const pool = (await ipc?.invoke('store:get', 'settingsPool')) || [];
                const allCookies = [primaryCookie, ...pool.map(t => t.cookie)].filter(Boolean);
                cookiesRaw = allCookies.join('\n');
            }
            const cookies  = lines(cookiesRaw);
            const groupLinks = lines(document.getElementById('pipeGroupLinks')?.value || '');
            const customers  = lines(document.getElementById('pipeCustomers')?.value || '');
            const destGroups = lines(document.getElementById('pipeDestGroups')?.value || '');
            const maxPerGroup = parseInt(document.getElementById('pipeMaxPerGroup')?.value || '200');
            const phoneScan   = document.getElementById('pipePhoneScan')?.checked || false;

            const tgSettings = (await ipc?.invoke('store:get', 'telegramSettings')) || {};
            const tgToken  = tgSettings.token  || '';
            const tgChatId = tgSettings.chatId || '';

            let msgs = msgLibrary.slice();
            if (msgs.length === 0) {
                const storedMsgs = (await ipc?.invoke('store:get', 'settingsMsgs')) || [];
                msgs = storedMsgs;
                if (msgs.length > 0) addPipeLog(`📋 Lấy ${msgs.length} tin nhắn từ Kho (Cài Đặt)`);
            }

            if (!S.loggedIn && !cookies.length) { alert('Cần ít nhất 1 cookie! Hãy đăng nhập tại Cài Đặt trước.'); return; }
            if (!groupLinks.length && !customers.length) { alert('Cần ít nhất 1 link nhóm hoặc 1 khách hàng!'); return; }
            if (!msgs.length) { alert('Cần ít nhất 1 tin nhắn trong kho! Thêm tại Cài Đặt → Kho Tin Nhắn.'); return; }

            pipeOkN = 0; pipeFailN = 0;
            ['pipeOk','pipeFail','pipeHarvested'].forEach(id => { const el=document.getElementById(id); if(el) el.textContent='0'; });
            document.getElementById('pipeProgressFill').style.width = '0%';
            document.getElementById('pipeStatusText').textContent = 'Đang khởi động...';
            document.getElementById('pipePct').textContent = '0%';
            document.getElementById('pipeLogBody').innerHTML = '';

            const btnStart = document.getElementById('btnStartPipeline');
            const btnStop  = document.getElementById('btnStopPipeline');
            if (btnStart) { btnStart.disabled = true; btnStart.textContent = '⏳ Đang chạy...'; }
            if (btnStop)    btnStop.disabled = false;

            highlightStage('joining');
            addPipeLog(`🚀 Pipeline: ${groupLinks.length} groups | ${cookies.length} TK | ${msgs.length} msgs | ${customers.length} KH | TG: ${tgToken ? '✓' : '✗'}`);

            try {
                await ipc?.invoke('zalo:runFullPipeline', {
                    cookies, groupLinks, extraTargets: customers,
                    destGroupIds: destGroups, messages: msgs,
                    telegramToken: tgToken, telegramChatId: tgChatId,
                    opts: { maxPerGroup, phoneScan }
                });
            } catch(e) {
                addPipeLog(`❌ Lỗi: ${e.message}`, 'err');
                resetBtns();
            }
        });

        // ── STOP ──
        document.getElementById('btnStopPipeline')?.addEventListener('click', async () => {
            await ipc?.invoke('zalo:cancelPipeline');
            addPipeLog('⛔ Đã yêu cầu dừng...', 'err');
            document.getElementById('btnStopPipeline').disabled = true;
        });
    }

    // ── Init: load DB then wire ──
    loadDB().then(() => wireButtons());

})();

// ═══ QR Login cho TK Phụ (Account Pool) ═══
(function initPoolQR() {
    const ipc = window.electronAPI;
    const $ = id => document.getElementById(id);
    let _poolQrActive = false;

    function showPoolQrModal() {
        const modal = $('poolQrModal');
        if (modal) { modal.style.display = 'flex'; }
        if ($('poolQrImg')) $('poolQrImg').innerHTML = '<span>⏳ Đang tạo QR...</span>';
        if ($('poolQrStatus')) $('poolQrStatus').textContent = 'Đang kết nối...';
        _poolQrActive = true;
    }
    function hidePoolQrModal() {
        const modal = $('poolQrModal');
        if (modal) modal.style.display = 'none';
        _poolQrActive = false;
    }

    $('btnPoolLoginQR')?.addEventListener('click', async () => {
        showPoolQrModal();
        try { await ipc?.invoke('zalo:poolLoginQR'); }
        catch(e) { if ($('poolQrStatus')) $('poolQrStatus').textContent = '❌ Lỗi: ' + e.message; }
    });
    $('btnPoolQrClose')?.addEventListener('click', () => hidePoolQrModal());

    // Nhận QR image
    ipc?.on?.('zalo:poolQrReady', (_ev, dataUrl) => {
        if (!_poolQrActive) return;
        if ($('poolQrImg')) $('poolQrImg').innerHTML = '<img src="' + dataUrl + '" style="width:190px;height:190px;border-radius:8px;object-fit:contain" />';
        if ($('poolQrStatus')) $('poolQrStatus').textContent = 'Quét QR bằng điện thoại TK phụ...';
    });

    // Nhận kết quả đăng nhập thành công
    ipc?.on?.('zalo:poolLoginSuccess', async (_ev, data) => {
        if (!_poolQrActive || !data?.success) return;
        const status = $('poolQrStatus');
        if (status) { status.textContent = '✅ Đăng nhập thành công!'; status.style.color = '#10b981'; }
        try {
            const cookie = data.cookie;
            if (!cookie) throw new Error('Không lấy được cookie TK phụ');
            const uid = data.uid || ('pool_' + Date.now());
            const name = data.name || ('TK ' + (Date.now() % 1000));
            const settingsPool = (await ipc.invoke('store:get', 'settingsPool')) || [];
            if (!settingsPool.some(tk => tk.uid === uid)) {
                settingsPool.push({ cookie, name, uid, addedAt: Date.now() });
                await ipc.invoke('store:set', 'settingsPool', settingsPool);
                await ipc.invoke('zalo:accountPool:add', cookie, name, uid);
            }
            window.dispatchEvent(new CustomEvent('pool:refresh'));
            setTimeout(hidePoolQrModal, 1500);
        } catch(e) {
            if (status) { status.textContent = '❌ ' + e.message; status.style.color = '#ef4444'; }
        }
    });

    ipc?.on?.('zalo:poolLoginError', (_ev, err) => {
        if (!_poolQrActive) return;
        const status = $('poolQrStatus');
        if (status) { status.textContent = '❌ ' + err; status.style.color = '#ef4444'; }
    });

    window.addEventListener('pool:refresh', async () => {
        const pool = (await ipc?.invoke('store:get', 'settingsPool')) || [];
        if ($('settingsPoolCount')) $('settingsPoolCount').textContent = pool.length + ' TK';
    });
})();

// ════════════════════════════════════════════════════════════════
// SETTINGS v2.2 — Account Banner + Pool + Telegram + Kho tin nhắn
// ════════════════════════════════════════════════════════════════
(function initSettingsV2() {
    const ipc = window.electronAPI;
    const $ = id => document.getElementById(id);
    const store = {
        get: k => ipc?.invoke('store:get', k),
        set: (k, v) => ipc?.invoke('store:set', k, v),
    };

    // ── 1. Account Banner ──
    async function showConnectedBanner(info) {
        if (!info || !info.uid) return;
        const banner = $('connectedAccountBanner');
        const loginSec = $('loginSection');
        if (banner) {
            banner.style.display = 'block';
            $('connAcctName').textContent = info.name || info.displayName || 'Tài khoản Zalo';
            $('connAcctUid').textContent = info.uid || '—';
            $('connAcctTime').textContent = new Date().toLocaleTimeString('vi-VN');
            $('connAcctAvatar').textContent = (info.name || 'Z')[0].toUpperCase();
        }
        if (loginSec) loginSec.style.display = 'none';
    }

    function hideConnectedBanner() {
        const banner = $('connectedAccountBanner');
        const loginSec = $('loginSection');
        if (banner) banner.style.display = 'none';
        if (loginSec) loginSec.style.display = 'block';
    }

    // Restore banner on load
    (async () => {
        const info = await store.get('connectedAccount');
        if (info && info.uid) showConnectedBanner(info);
    })();

    // Disconnect
    $('btnDisconnectAcct')?.addEventListener('click', async () => {
        await store.set('cookie', '');
        await store.set('connectedAccount', null);
        hideConnectedBanner();
    });

    // Hook into login success events
    window.addEventListener('zalo:loginSuccess_internal', async e => {
        const info = e.detail;
        await store.set('connectedAccount', { uid: info.uid, name: info.name, ts: Date.now() });
        showConnectedBanner(info);
    });

    if (ipc?.on) {
        ipc.on('zalo:loginSuccess', async (_ev, data) => {
            if (data && data.success) {
                try {
                    const cookie = await store.get('cookie');
                    if (cookie) {
                        const r = await ipc.invoke('zalo:verify', cookie);
                        if (r && r.user?.uid) {
                            await store.set('connectedAccount', { uid: r.user.uid, name: r.user.name || r.displayName, ts: Date.now() });
                            showConnectedBanner({ uid: r.user.uid, name: r.user.name || r.displayName });
                        }
                    }
                } catch(_) {}
            }
        });
    }

    // ── 2. Account Pool ──
    let settingsPool = [];

    async function loadSettingsPool() {
        settingsPool = (await store.get('settingsPool')) || [];
        renderSettingsPool();
    }

    function renderSettingsPool() {
        const list = $('settingsPoolList');
        const badge = $('settingsPoolCount');
        if (!list) return;
        if (badge) badge.textContent = settingsPool.length + ' TK';
        if (settingsPool.length === 0) {
            list.innerHTML = '<div style="color:var(--text-muted);font-size:12px;text-align:center;padding:16px;border:1px dashed var(--card-border);border-radius:8px">Chưa có tài khoản phụ nào</div>';
            return;
        }
        list.innerHTML = settingsPool.map((tk, i) => {
            const initial = (tk.name || 'T')[0].toUpperCase();
            const cookiePreview = tk.cookie ? tk.cookie.slice(0, 20) + '...' : '—';
            return '<div style="display:flex;align-items:center;gap:8px;padding:8px 10px;border-radius:8px;border:1px solid var(--card-border);background:rgba(255,255,255,0.03)">'
                + '<div style="width:32px;height:32px;border-radius:50%;background:linear-gradient(135deg,#667eea,#764ba2);display:flex;align-items:center;justify-content:center;color:#fff;font-weight:700;font-size:13px">' + initial + '</div>'
                + '<div style="flex:1;min-width:0"><div style="font-weight:600;font-size:13px">' + (tk.name || 'TK ' + (i+1)) + '</div>'
                + '<div style="font-size:10px;color:var(--text-muted)">Cookie: ' + cookiePreview + '</div></div>'
                + '<span style="font-size:10px;padding:2px 7px;border-radius:8px;background:rgba(16,185,129,0.15);color:#10b981">Sẵn sàng</span>'
                + '<button onclick="window._removePoolTk(' + i + ')" style="background:rgba(239,68,68,0.1);color:#ef4444;border:none;border-radius:6px;padding:3px 8px;cursor:pointer;font-size:11px">✕</button>'
                + '</div>';
        }).join('');
    }

    window._removePoolTk = async (i) => {
        settingsPool.splice(i, 1);
        await store.set('settingsPool', settingsPool);
        try { await ipc?.invoke('zalo:accountPool:remove', settingsPool[i]?.uid); } catch(_) {}
        renderSettingsPool();
    };

    $('btnSettingsPoolAdd')?.addEventListener('click', async () => {
        const cookie = $('settingsPoolCookie')?.value?.trim();
        const name = $('settingsPoolName')?.value?.trim() || ('TK ' + (settingsPool.length + 2));
        if (!cookie) { alert('Vui lòng nhập cookie!'); return; }
        try {
            const r = await ipc?.invoke('zalo:verify', cookie);
            if (!r?.success) { alert('Cookie không hợp lệ hoặc hết hạn!'); return; }
            const uid = r?.user?.uid || ('tk_' + Date.now());
            const realName = r?.user?.name || name;
            settingsPool.push({ cookie, name: realName, uid, addedAt: Date.now() });
            await store.set('settingsPool', settingsPool);
            await ipc?.invoke('zalo:accountPool:add', cookie, realName, uid);
            $('settingsPoolCookie').value = '';
            $('settingsPoolName').value = '';
            renderSettingsPool();
        } catch(e) {
            alert('Lỗi xác thực cookie: ' + e.message);
        }
    });

    loadSettingsPool();

    // ── 3. Telegram Thông Báo ──
    async function loadTelegramSettings() {
        const tg = (await store.get('telegramSettings')) || {};
        if ($('settingsTgToken')) $('settingsTgToken').value = tg.token || '';
        if ($('settingsTgChatId')) $('settingsTgChatId').value = tg.chatId || '';
    }

    $('btnTestTelegram')?.addEventListener('click', async () => {
        const token = $('settingsTgToken')?.value?.trim();
        const chatId = $('settingsTgChatId')?.value?.trim();
        const result = $('tgTestResult');
        if (!token || !chatId) { if(result) result.textContent = '⚠️ Nhập token và chat ID!'; return; }
        if(result) result.textContent = '⏳ Đang gửi...';
        try {
            const res = await fetch('https://api.telegram.org/bot' + token + '/sendMessage', {
                method: 'POST',
                headers: {'Content-Type':'application/json'},
                body: JSON.stringify({ chat_id: chatId, text: '✅ Zalo Bulk Tool Pro — Kết nối Telegram thành công!' })
            });
            const data = await res.json();
            if (data.ok) {
                if(result) { result.textContent = '✅ Gửi thành công!'; result.style.color = '#10b981'; }
                await store.set('telegramSettings', { token, chatId });
            } else {
                if(result) { result.textContent = '❌ ' + (data.description || 'Lỗi'); result.style.color = '#ef4444'; }
            }
        } catch(e) {
            if(result) { result.textContent = '❌ ' + e.message; result.style.color = '#ef4444'; }
        }
    });

    loadTelegramSettings();

    // ── 4. Kho Tin Nhắn ──
    let settingsMsgs = [];

    async function loadSettingsMsgs() {
        settingsMsgs = (await store.get('settingsMsgs')) || [];
        renderSettingsMsgs();
    }

    function renderSettingsMsgs() {
        const list = $('settingsMsgList');
        const badge = $('settingsMsgCount');
        if (badge) badge.textContent = settingsMsgs.length + ' mẫu';
        if (!list) return;
        if (settingsMsgs.length === 0) {
            list.innerHTML = '<div style="color:var(--text-muted);font-size:12px;text-align:center;padding:12px;border:1px dashed var(--card-border);border-radius:8px">Chưa có tin nhắn mẫu nào</div>';
            return;
        }
        list.innerHTML = settingsMsgs.map((msg, i) => {
            const preview = msg.length > 120 ? msg.slice(0,120) + '…' : msg;
            return '<div style="display:flex;align-items:flex-start;gap:8px;padding:8px 10px;border-radius:8px;border:1px solid var(--card-border);background:rgba(255,255,255,0.03)">'
                + '<span style="background:rgba(102,126,234,0.15);color:#667eea;font-size:10px;font-weight:700;padding:2px 6px;border-radius:6px;flex-shrink:0;margin-top:1px">#' + (i+1) + '</span>'
                + '<div style="flex:1;font-size:12px;color:var(--text-h);white-space:pre-wrap;word-break:break-all">' + preview + '</div>'
                + '<button onclick="window._removeSettingsMsg(' + i + ')" style="background:rgba(239,68,68,0.1);color:#ef4444;border:none;border-radius:6px;padding:3px 8px;cursor:pointer;font-size:11px;flex-shrink:0">✕</button>'
                + '</div>';
        }).join('');
    }

    window._removeSettingsMsg = async (i) => {
        settingsMsgs.splice(i, 1);
        await store.set('settingsMsgs', settingsMsgs);
        renderSettingsMsgs();
    };

    $('btnAddSettingsMsg')?.addEventListener('click', async () => {
        const msg = $('settingsNewMsg')?.value?.trim();
        if (!msg) return;
        settingsMsgs.push(msg);
        await store.set('settingsMsgs', settingsMsgs);
        $('settingsNewMsg').value = '';
        renderSettingsMsgs();
    });

    // Ctrl+Enter để thêm nhanh
    $('settingsNewMsg')?.addEventListener('keydown', e => {
        if (e.key === 'Enter' && e.ctrlKey) $('btnAddSettingsMsg')?.click();
    });

    loadSettingsMsgs();

    // ── 5. Save Settings ──
    $('btnSaveSettings')?.addEventListener('click', async () => {
        const token = $('settingsTgToken')?.value?.trim();
        const chatId = $('settingsTgChatId')?.value?.trim();
        if (token && chatId) await store.set('telegramSettings', { token, chatId });
        if (settingsMsgs.length > 0) await store.set('pipeMessages', settingsMsgs);
        alert('✅ Đã lưu cài đặt!');
    });

    // ── 6. Pipeline — tự dùng cookie từ store ──
    const origPipeBtn = $('btnStartPipeline');
    if (origPipeBtn) {
        origPipeBtn.addEventListener('click', async () => {
            const pipeArea = $('pipeCookies');
            if (pipeArea && !pipeArea.value.trim()) {
                const storedCookie = await store.get('cookie');
                if (storedCookie) {
                    pipeArea.value = storedCookie;
                }
            }
        }, true); // capture phase
    }

})();



// ════════════════════════════════════════════════════════════════
// SCAN NHÓM MỞ CHAT — Kiểm tra 100 link nhóm
// ════════════════════════════════════════════════════════════════
(function initScanOpenChat() {
    const $ = id => document.getElementById(id);
    let _openLinks = [];
    let _scanning = false;

    function parseGroupId(link) {
        const match = link.match(/zalo\.me\/g\/(\w+)/i) || link.match(/([a-z0-9]{6,20})$/i);
        return match ? match[1] : null;
    }

    function parseGroupLinks(raw) {
        return raw.split('\n')
            .map(l => l.trim())
            .filter(l => l.length > 5);
    }

    function updateScanUI(scanOpen, scanClosed, pct) {
        const progress = $('scanProgressFill');
        if (progress) progress.style.width = pct + '%';
        const pctEl = $('scanPct');
        if (pctEl) pctEl.textContent = pct + '%';
        const openBadge = $('scanOpenCount');
        if (openBadge) openBadge.textContent = scanOpen + ' mở';
        const closedBadge = $('scanClosedCount');
        if (closedBadge) closedBadge.textContent = scanClosed + ' đóng';
    }

    $('btnScanGroups')?.addEventListener('click', async () => {
        if (_scanning) return;
        const raw = $('scanGroupLinks')?.value || '';
        const links = parseGroupLinks(raw);
        if (links.length === 0) { toast('Nhập ít nhất 1 link nhóm!', 'warning'); return; }

        // Get cookie — QR login có thể không có cookie string, dùng null để zca-js dùng session cache
        const cookie = S.cookie || (await el.store.get('cookie')) || null;
        if (!S.loggedIn && (!cookie || cookie.length < 5)) {
            toast('Cần đăng nhập trước! Vào Cài Đặt → đăng nhập QR.', 'error');
            return;
        }

        _scanning = true;
        _openLinks = [];
        const closedLinks = [];

        // UI
        $('scanProgressBar').style.display = 'block';
        $('scanResults').style.display = 'none';
        $('btnScanGroups').disabled = true;
        $('btnScanGroups').textContent = '⏳ Đang scan...';
        $('btnCopyScanOpen').disabled = true;
        $('btnCopyScanAll').disabled = true;
        updateScanUI(0, 0, 0);
        $('scanStatusText').textContent = 'Chuẩn bị scan ' + links.length + ' nhóm...';

        const groupIds = links.map(l => parseGroupId(l) || l);
        const validLinks = links.filter((_, i) => groupIds[i]);

        try {
            const BATCH = 20;
            let processed = 0;
            for (let b = 0; b < groupIds.length; b += BATCH) {
                const batch = groupIds.slice(b, b + BATCH);
                const batchLinks = validLinks.slice(b, b + BATCH);

                $('scanStatusText').textContent = 'Đang scan ' + (b+1) + '–' + Math.min(b+BATCH, groupIds.length) + ' / ' + groupIds.length + '...';

                try {
                    const result = await el.zalo.checkGroupChatStatus(cookie, batch);
                    // FIX: checkGroupChatStatus trả mảng trực tiếp (statusList), không phải {results:[...]}
                    const items = Array.isArray(result) ? result : (result?.results || result?.statusList || []);
                    items.forEach((r, idx) => {
                        const originalLink = batchLinks[idx] || batch[idx];
                        // FIX: field đúng là isOpenChat, không phải openChat/chatEnabled/status
                        if (r.isOpenChat === true) {
                            _openLinks.push({ link: originalLink, name: r.groupName || r.name || r.groupId || originalLink });
                        } else {
                            closedLinks.push({ link: originalLink, name: r.groupName || r.name || r.groupId || originalLink });
                        }
                    });
                } catch(batchErr) {
                    console.error("Scan batch error:", batchErr);
                    batchLinks.forEach(link => closedLinks.push({ link, name: link }));
                }
                processed += batch.length;
                const pct = Math.round((processed / groupIds.length) * 100);
                updateScanUI(_openLinks.length, closedLinks.length, pct);
                if (b + BATCH < groupIds.length) await new Promise(r => setTimeout(r, 1500 + Math.random() * 1000));
            }
        } catch(e) {
            $('scanStatusText').textContent = '❌ Lỗi: ' + e.message;
        }

        // Show results
        $('scanProgressFill').style.width = '100%';
        $('scanPct').textContent = '100%';

        const _noResult = _openLinks.length === 0 && closedLinks.length === 0;
        $('scanStatusText').textContent = _noResult
            ? '⚠️ Không scan được — cần đăng nhập QR trước hoặc link nhóm không hợp lệ'
            : `Hoàn thành! ${_openLinks.length} nhóm mở, ${closedLinks.length} nhóm đóng.`;
        $('scanResults').style.display = 'block';
        $('openChatTotal').textContent = _openLinks.length;
        $('closedChatTotal').textContent = closedLinks.length;

        // Render open list
        $('openChatList').innerHTML = _openLinks.length === 0
            ? '<span style="color:var(--text-muted)">Không có nhóm mở</span>'
            : _openLinks.map(g => `<div style="display:flex;justify-content:space-between;padding:2px 0;border-bottom:1px solid rgba(255,255,255,0.04)">
                <span>${g.name || g.link}</span>
                <a href="${g.link}" style="color:#667eea;font-size:10px" target="_blank">🔗</a>
              </div>`).join('');

        // Render closed list
        $('closedChatList').innerHTML = closedLinks.length === 0
            ? '<span style="color:var(--text-muted)">Không có nhóm đóng</span>'
            : closedLinks.map(g => `<div style="color:var(--text-muted);padding:2px 0;border-bottom:1px solid rgba(255,255,255,0.04)">${g.name || g.link}</div>`).join('');

        updateScanUI(_openLinks.length, closedLinks.length, 100);
        toast(`Scan xong: ${_openLinks.length} nhóm mở chat`, _openLinks.length > 0 ? 'success' : 'info');

        // Enable copy buttons
        if (_openLinks.length > 0) {
            $('btnCopyScanOpen').disabled = false;
            $('btnCopyScanAll').disabled = false;
        }
        $('btnScanGroups').disabled = false;
        $('btnScanGroups').textContent = '🔍 Scan lại';
        _scanning = false;
    });

    // Copy nhóm mở
    $('btnCopyScanOpen')?.addEventListener('click', () => {
        const text = _openLinks.map(g => g.link).join('\n');
        navigator.clipboard.writeText(text).then(() => toast('Đã copy ' + _openLinks.length + ' link nhóm mở!', 'success'));
    });

    // Dùng vào Pipeline — inject vào pipeGroupLinks
    $('btnCopyScanAll')?.addEventListener('click', () => {
        const pipeLinks = document.getElementById('pipeGroupLinks');
        if (pipeLinks) {
            const existing = pipeLinks.value.trim();
            const newLinks = _openLinks.map(g => g.link).join('\n');
            pipeLinks.value = existing ? existing + '\n' + newLinks : newLinks;
            // Update badge
            const lines = v => v.split('\n').map(l=>l.trim()).filter(l=>l.length>5);
            const badge = document.getElementById('pipeLinkCount');
            if (badge) badge.textContent = lines(pipeLinks.value).length + ' links';
            toast(`Đã thêm ${_openLinks.length} nhóm mở vào Pipeline!`, 'success');
            // Scroll to pipeline links
            pipeLinks.scrollIntoView({ behavior: 'smooth', block: 'center' });
        } else {
            navigator.clipboard.writeText(_openLinks.map(g => g.link).join('\n'));
            toast('Đã copy vào clipboard!', 'success');
        }
    });
})();


// ════════════════════════════════════════════════════════════════
// FULL AUTO: Open Chat Pipeline Orchestrator
// Flow: Scan links → Lọc mở chat → Join (tất cả TK) → Harvest members → Multi-account DM
// ════════════════════════════════════════════════════════════════
(function initFullAutoOpenChat() {
    const $ = id => document.getElementById(id);
    const ipc = window.electronAPI || window.electron?.ipcRenderer;
    let _stopRequested = false;
    let _running = false;

    function autoLog(msg, type = 'info') {
        const el = $('openChatAutoLog');
        if (!el) return;
        el.style.display = 'block';
        const colors = { info: '#a3b3cc', ok: '#10b981', err: '#ef4444', warn: '#f59e0b', head: '#a78bfa' };
        const div = document.createElement('div');
        div.style.color = colors[type] || colors.info;
        div.textContent = '[' + new Date().toLocaleTimeString('vi') + '] ' + msg;
        el.appendChild(div);
        el.scrollTop = el.scrollHeight;
    }

    function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

    $('btnStopOpenChat')?.addEventListener('click', () => {
        _stopRequested = true;
        autoLog('⛔ Yêu cầu dừng...', 'err');
    });

    $('btnFullAutoOpenChat')?.addEventListener('click', async () => {
        if (_running) return;

        const raw = $('scanGroupLinks')?.value || '';
        const links = raw.split('\n').map(l => l.trim()).filter(l => l.length > 5);
        if (links.length === 0) { alert('Nhập ít nhất 1 link nhóm để Scan!'); return; }

        // Get cookie + account pool
        const primaryCookie = S.cookie || (await ipc?.invoke('store:get', 'cookie'));
        if (!primaryCookie && !S.loggedIn) {
            alert('Cần đăng nhập tài khoản chính trước!');
            return;
        }
        const pool = (await ipc?.invoke('store:get', 'settingsPool')) || [];
        const allCookies = [primaryCookie, ...pool.map(t => t.cookie)].filter(Boolean);
        const allAccounts = [
            { name: S.account?.name || 'TK Chính', cookie: primaryCookie },
            ...pool.map(t => ({ name: t.name || t.uid || 'TK Phụ', cookie: t.cookie }))
        ];

        // Get message from repo or pipeline
        const msgs = (await ipc?.invoke('store:get', 'settingsMsgs')) || [];
        const baseMsg = msgs.length > 0 ? msgs[0] : ($('pipeGroupLinks') ? '' : '');
        if (!baseMsg) {
            const input = prompt('Nhập tin nhắn muốn gửi đến thành viên:');
            if (!input) return;
        }

        _running = true;
        _stopRequested = false;
        $('btnFullAutoOpenChat').disabled = true;
        $('btnFullAutoOpenChat').textContent = '⏳ Đang chạy...';
        $('btnStopOpenChat').style.display = '';
        $('openChatAutoLog').innerHTML = '';
        $('openChatAutoLog').style.display = 'block';

        autoLog('═══ BẮT ĐẦU FULL AUTO OPEN CHAT ═══', 'head');
        autoLog(`📊 ${links.length} links | ${allAccounts.length} tài khoản | ${msgs.length} tin nhắn`, 'info');

        try {
            // ─── BƯỚC 1: SCAN NHÓM MỞ CHAT ───
            autoLog('🔍 [BƯỚC 1] Scan nhóm mở chat...', 'head');
            let openGroupLinks = [];
            try {
                const parseId = link => {
                    const m = link.match(/zalo\.me\/g\/(\w+)/i) || link.match(/([a-z0-9]{6,20})$/i);
                    return m ? m[1] : link;
                };
                const groupIds = links.map(parseId);
                const scanResult = await ipc?.invoke('zalo:checkGroupChatStatus', primaryCookie, groupIds);
                // FIX: checkGroupChatStatus returns array with field 'isOpenChat'
                const statusList = Array.isArray(scanResult) ? scanResult : (scanResult?.results || []);
                statusList.forEach((r, i) => {
                    if (r.isOpenChat === true || r.openChat === true || r.chatEnabled === true) {
                        // Map back to original link
                        openGroupLinks.push(links[i] || r.groupId);
                    }
                });
                if (openGroupLinks.length === 0) openGroupLinks = links; // fallback nếu không có nhóm mở
                autoLog(`✅ Tìm thấy ${openGroupLinks.length}/${links.length} nhóm mở chat`, 'ok');
            } catch(e) {
                openGroupLinks = links;
                autoLog('⚠️ Scan lỗi, dùng tất cả link: ' + e.message, 'warn');
            }
            if (_stopRequested) throw new Error('STOP');
            if (openGroupLinks.length === 0) {
                autoLog('❌ Không có nhóm mở chat nào!', 'err');
                throw new Error('NO_OPEN_GROUPS');
            }

            // ─── BƯỚC 2: TẤT CẢ TK JOIN VÀO NHÓM MỞ ───
            autoLog(`📥 [BƯỚC 2] ${allAccounts.length} TK join ${openGroupLinks.length} nhóm...`, 'head');
            const joinedGroupIds = new Set();
            for (let ai = 0; ai < allAccounts.length; ai++) {
                if (_stopRequested) throw new Error('STOP');
                const acct = allAccounts[ai];
                autoLog(`  TK [${ai+1}/${allAccounts.length}] ${acct.name} đang join...`);
                try {
                    const joinResult = await ipc?.invoke('zalo:autoJoinGroups', [acct.cookie], openGroupLinks);
                    const ok = joinResult?.joined?.length || 0;
                    const already = joinResult?.alreadyIn?.length || 0;
                    const fail = joinResult?.failed?.length || 0;
                    autoLog(`    ✅ Join OK: ${ok} | Đã có: ${already} | Lỗi: ${fail}`, ok + already > 0 ? 'ok' : 'warn');
                    // Collect group IDs from join results (FIX: check multiple field names)
                    [...(joinResult?.joined || []), ...(joinResult?.alreadyIn || [])].forEach(g => {
                        const gid = g.groupId || g.id || g.group_id;
                        if (gid) joinedGroupIds.add(String(gid));
                    });
                } catch(e) {
                    autoLog(`    ❌ ${acct.name}: ${e.message}`, 'err');
                }
                await sleep(2000 + Math.random() * 2000);
            }
            autoLog(`📥 Tổng: đã vào ${joinedGroupIds.size} nhóm`, 'ok');
            if (_stopRequested) throw new Error('STOP');

            // ─── BƯỚC 3: HARVEST MEMBERS ───
            autoLog('📡 [BƯỚC 3] Lấy danh sách thành viên...', 'head');
            const allMembers = new Map(); // uid → { uid, name, phone }
            const targetGroupIds = joinedGroupIds.size > 0
                ? [...joinedGroupIds]
                : openGroupLinks.map(l => { const m = l.match(/zalo\.me\/g\/(\w+)/i); return m ? m[1] : l; });

            for (const groupId of targetGroupIds) {
                if (_stopRequested) throw new Error('STOP');
                try {
                    const members = await ipc?.invoke('zalo:getGroupMembers', primaryCookie, groupId);
                    // FIX: getGroupMembers may return { success, members } or raw array
                    const memberArr = Array.isArray(members) ? members : (members?.members || []);
                    if (memberArr.length > 0) {
                        memberArr.forEach(m => {
                            const uid = String(m.uid || m.userId || m.id || '');
                            if (uid && uid.length > 2) allMembers.set(uid, {
                                uid,
                                name: m.name || m.displayName || m.zaloName || '',
                                phone: m.phone || ''
                            });
                        });
                        autoLog(`  Nhóm ${groupId}: +${members.length} thành viên (tổng: ${allMembers.size})`, 'ok');
                    }
                } catch(e) {
                    autoLog(`  ⚠️ Nhóm ${groupId}: ${e.message}`, 'warn');
                }
                await sleep(1500);
            }
            const memberList = [...allMembers.values()];
            autoLog(`📡 Harvest xong: ${memberList.length} thành viên unique`, 'ok');
            if (memberList.length === 0) {
                autoLog('⚠️ Không harvest được thành viên nào. Có thể cần join nhóm trước.', 'warn');
                throw new Error('NO_MEMBERS');
            }
            if (_stopRequested) throw new Error('STOP');

            // ─── BƯỚC 4: CHIA TK GỬI LUÂN PHIÊN ───
            autoLog(`🚀 [BƯỚC 4] ${allAccounts.length} TK gửi ${memberList.length} thành viên...`, 'head');
            const chunkSize = Math.ceil(memberList.length / allAccounts.length);
            autoLog(`  Mỗi TK đảm nhận ~${chunkSize} người`, 'info');

            const activeMsg = msgs.length > 0 ? msgs[Math.floor(Math.random() * msgs.length)] : baseMsg;

            for (let ai = 0; ai < allAccounts.length; ai++) {
                if (_stopRequested) throw new Error('STOP');
                const acct = allAccounts[ai];
                const myChunk = memberList.slice(ai * chunkSize, (ai + 1) * chunkSize);
                if (myChunk.length === 0) continue;

                autoLog(`  🔵 ${acct.name}: gửi ${myChunk.length} người...`, 'info');

                // Convert members to phones/UIDs for sendBulkSmart
                const phones = myChunk.map(m => m.phone || m.uid).filter(Boolean);
                const uids = myChunk.map(m => m.uid).filter(Boolean);

                try {
                    // FIX: sendBulkSmart with uid inputType (now supported) + names for persona
                    const names = myChunk.map(m => m.name || '');
                    await ipc?.invoke('zalo:sendBulkSmart', acct.cookie, {
                        inputType: 'uid',
                        uids: uids,
                        names: names,
                        message: activeMsg,
                        delayMs: 4000,
                        maxPerHour: 60,
                        randomDelay: true,
                        stopOnFail: false,
                        enableSmartSend: true,
                    });
                    autoLog(`    ✅ ${acct.name}: hoàn thành ${myChunk.length} người`, 'ok');
                } catch(e) {
                    autoLog(`    ❌ ${acct.name}: ${e.message}`, 'err');
                }
                // Brief pause between accounts
                if (ai < allAccounts.length - 1) await sleep(3000);
            }
            autoLog('═══ HOÀN THÀNH FULL AUTO ═══', 'head');
            autoLog(`✅ Đã gửi đến ${memberList.length} thành viên từ ${openGroupLinks.length} nhóm mở chat`, 'ok');
            toast(`Full Auto hoàn thành! ${memberList.length} thành viên đã được tiếp cận.`, 'success');

        } catch(e) {
            if (e.message !== 'STOP' && e.message !== 'NO_OPEN_GROUPS' && e.message !== 'NO_MEMBERS') {
                autoLog('❌ Lỗi: ' + e.message, 'err');
            }
        } finally {
            _running = false;
            _stopRequested = false;
            const btn = $('btnFullAutoOpenChat');
            if (btn) { btn.disabled = false; btn.textContent = '⚡ Full Auto: Scan→Join→DM'; }
            $('btnStopOpenChat').style.display = 'none';
        }
    });
})();

// ════════════════════════════════════════════════════════════════
// POST-LOGIN SYNC — Trigger syncPipeline sau khi đăng nhập QR
// ════════════════════════════════════════════════════════════════
(function initPostLoginSync() {
    // 1. Delayed re-sync sau 2.5s (electronAPI ready, store populated)
    setTimeout(() => {
        if (window.syncPipelineFromSettings) window.syncPipelineFromSettings();
    }, 2500);

    // 2. Listen loginSuccess event từ main process sau QR scan
    try {
        if (window.electron && window.electron.onLoginSuccess) {
            window.electron.onLoginSuccess(function(data) {
                setTimeout(() => {
                    if (window.syncPipelineFromSettings) window.syncPipelineFromSettings();
                }, 600);
            });
        }
    } catch(e) {}

    // 3. Poll cookie store mỗi 8s — nếu thay đổi thì sync
    var _lastCookie = null;
    setInterval(async function() {
        try {
            var ipc = window.electronAPI || (window.electron && window.electron.ipcRenderer);
            if (!ipc) return;
            var cookie = await ipc.invoke('store:get', 'cookie');
            if (cookie && cookie !== _lastCookie) {
                _lastCookie = cookie;
                if (window.syncPipelineFromSettings) window.syncPipelineFromSettings();
            }
        } catch(_) {}
    }, 8000);
})();

// ════════════════════════════════════════════════════════════════
// PIPELINE SYNC v2 — Override với S.cookie fallback hoàn chỉnh
// ════════════════════════════════════════════════════════════════
(function initPipelineSyncV2() {
    const ipc = window.electronAPI || (window.electron && window.electron.ipcRenderer);
    const get = async (k) => {
        try { return ipc ? await ipc.invoke('store:get', k) : null; } catch(_) { return null; }
    };

    async function syncFromSettings() {
        // FIX: Check cả cookie LẪN loggedIn state (QR login có thể không có cookie thật)
        const storedCookie = await get('cookie');
        const storedLoggedIn = await get('loggedIn');
        const primaryCookie = storedCookie || (typeof S !== 'undefined' ? S.cookie : null);
        const storedAcct = await get('connectedAccount');
        const primaryAcct = storedAcct || (typeof S !== 'undefined' ? S.account : null);
        const isLoggedIn = !!(primaryCookie || storedLoggedIn || (typeof S !== 'undefined' && S.loggedIn));
        const pool = (await get('settingsPool')) || [];
        const msgs = (await get('settingsMsgs')) || [];
        const tg = (await get('telegramSettings')) || {};

        const $ = id => document.getElementById(id);

        // ── 1. Tài khoản ──
        const allAccounts = [];
        if (isLoggedIn) {
            const acct = primaryAcct || { name: 'Tài khoản chính (QR)', uid: '' };
            allAccounts.push({ ...acct, cookie: primaryCookie || 'QR_ACTIVE', isPrimary: true });
        }
        pool.forEach(tk => allAccounts.push({ ...tk, isPrimary: false }));

        const badge = $('pipeAcctCount');
        if (badge) badge.textContent = allAccounts.length + ' TK';

        const display = $('pipeAcctDisplay');
        if (display) {
            if (allAccounts.length === 0) {
                display.innerHTML = '<div style="font-size:12px;color:var(--text-muted);text-align:center;padding:8px">Chưa đăng nhập — vào <b>Cài Đặt</b> để đăng nhập QR</div>';
            } else {
                display.innerHTML = allAccounts.map((tk, i) => `
                    <div style="display:flex;align-items:center;gap:8px;padding:6px 8px;border-radius:8px;background:rgba(255,255,255,0.03);border:1px solid ${tk.isPrimary?'rgba(102,126,234,0.3)':'var(--card-border)'}">
                        <div style="width:28px;height:28px;border-radius:50%;background:${tk.isPrimary?'linear-gradient(135deg,#10b981,#059669)':'linear-gradient(135deg,#667eea,#764ba2)'};display:flex;align-items:center;justify-content:center;color:#fff;font-weight:700;font-size:11px">${(tk.name||'Z')[0].toUpperCase()}</div>
                        <div style="flex:1">
                            <span style="font-size:12px;font-weight:600">${tk.name||'TK '+(i+1)}</span>
                            ${tk.isPrimary?'<span style="font-size:9px;background:rgba(16,185,129,0.15);color:#10b981;padding:1px 5px;border-radius:4px;margin-left:4px">Chính</span>':''}
                        </div>
                        <span style="font-size:10px;color:#10b981">✓ Sẵn sàng</span>
                    </div>
                `).join('');
            }
        }

        // Auto-inject cookies vào hidden field
        if (allAccounts.length > 0) {
            const pipeArea = $('pipeCookies');
            if (pipeArea) pipeArea.value = allAccounts.map(t => t.cookie).filter(Boolean).join('\n');
        }

        // ── 2. Kho tin nhắn ──
        const msgList = $('pipeMsgList');
        const msgBadge = $('pipeMsgCount');
        if (msgBadge) msgBadge.textContent = msgs.length + ' tin';
        if (msgList) {
            if (msgs.length === 0) {
                msgList.innerHTML = '<div style="font-size:12px;color:var(--text-muted);text-align:center;padding:8px">Chưa có tin nhắn — thêm tại <b>Cài Đặt → Kho Tin Nhắn</b></div>';
            } else {
                msgList.innerHTML = msgs.map((msg,i) => `<div style="display:flex;gap:6px;padding:6px 8px;border-radius:8px;background:rgba(255,255,255,0.03);border:1px solid var(--card-border)"><span style="background:rgba(102,126,234,0.15);color:#667eea;font-size:9px;font-weight:700;padding:2px 5px;border-radius:4px;flex-shrink:0">#${i+1}</span><span style="font-size:12px;line-height:1.5;color:var(--text-h)">${msg}</span></div>`).join('');
            }
        }

        // ── 3. Telegram status ──
        const tgStatus = $('pipeTgStatus');
        if (tgStatus) {
            if (tg.token && tg.chatId) {
                tgStatus.innerHTML = '<span style="color:#10b981;font-weight:600">✅ Đã kết nối Telegram</span>';
            } else {
                tgStatus.innerHTML = '<span style="color:var(--text-muted)">Chưa cấu hình — vào <b>Cài Đặt → Telegram</b></span>';
            }
        }

        // ── 4. Auto-inject msgs ──
        const msgInput = $('pipeGroupMsg') || $('pipeMessage') || $('pipeMsg');
        if (msgInput && !msgInput.value.trim() && msgs.length > 0) {
            msgInput.value = msgs[0];
        }
    }

    // Override window.syncPipelineFromSettings
    window.syncPipelineFromSettings = syncFromSettings;

    // Chạy ngay
    setTimeout(syncFromSettings, 500);
    setTimeout(syncFromSettings, 2000); // Retry sau 2s

    // Chạy khi navigate sang pipeline
    document.addEventListener('click', function(e) {
        const nav = e.target.closest('[data-page]');
        if (nav && nav.dataset.page === 'pipeline') {
            setTimeout(syncFromSettings, 200);
        }
    });
})();

// ══════════════════════════════════════════════════════════════════
// GỬI TIN NHẮN VÀO NHÓM (group chat thread)
// ══════════════════════════════════════════════════════════════════
window.sendMsgToGroupChat = async function(groupId) {
    if (!S.loggedIn) { toast('Vui lòng đăng nhập trước!', 'error'); navigate('settings'); return; }
    const group = S.groups.find(g => g.id === groupId);
    const groupName = group ? group.name : groupId;

    const msg = prompt('Gửi tin vào chat nhóm "' + groupName + '"\n(Tin nhắn xuất hiện trong khung chat nhóm)\n\nNhập nội dung:');
    if (!msg || !msg.trim()) return;

    const cookie = S.cookie;
    log('info', '📣 Đang gửi tin vào chat nhóm "' + groupName + '"...', 'send');
    navigate('bulk-send');

    try {
        const r = await el.zalo.sendGroupMessage(cookie, groupId, msg.trim());
        if (r.success) {
            log('success', '✅ Đã gửi tin vào nhóm "' + groupName + '"', 'send');
            toast('✅ Đã gửi tin vào nhóm "' + groupName + '"', 'success');
        } else {
            log('error', '❌ Lỗi: ' + r.error, 'send');
            toast('❌ Gửi thất bại: ' + r.error, 'error');
        }
    } catch(e) {
        log('error', '❌ Lỗi: ' + e.message, 'send');
        toast('Lỗi: ' + e.message, 'error');
    }
};

// Gửi tin vào tất cả nhóm đã chọn
window.sendMsgToAllSelectedGroups = async function() {
    if (!S.loggedIn) { toast('Vui lòng đăng nhập trước!', 'error'); navigate('settings'); return; }
    const groupIds = [...S.selectedGroups];
    if (groupIds.length === 0) { toast('Chưa chọn nhóm nào! Click vào nhóm để chọn.', 'warning'); return; }

    const msg = prompt('Gửi tin vào ' + groupIds.length + ' nhóm đã chọn:\n\nNhập nội dung:');
    if (!msg || !msg.trim()) return;

    const cookie = S.cookie;
    navigate('bulk-send');
    log('info', '📣 Gửi tin vào ' + groupIds.length + ' nhóm...', 'send');

    let ok = 0, fail = 0;
    for (let i = 0; i < groupIds.length; i++) {
        const gid = groupIds[i];
        const group = S.groups.find(g => g.id === gid);
        const name = group ? group.name : gid;
        try {
            const r = await el.zalo.sendGroupMessage(cookie, gid, msg.trim());
            if (r.success) { ok++; log('success', '✅ [' + (i+1) + '/' + groupIds.length + '] ' + name, 'send'); }
            else { fail++; log('error', '❌ [' + (i+1) + '/' + groupIds.length + '] ' + name + ': ' + r.error, 'send'); }
        } catch(e) {
            fail++;
            log('error', '❌ [' + (i+1) + '/' + groupIds.length + '] ' + name + ': ' + e.message, 'send');
        }
        if (i < groupIds.length - 1) await new Promise(r => setTimeout(r, 2000 + Math.random() * 1000));
    }
    log('success', '🎉 Xong: ' + ok + ' OK, ' + fail + ' lỗi', 'send');
    toast('Gửi nhóm: ' + ok + ' OK / ' + fail + ' lỗi', fail === 0 ? 'success' : 'warning');
};


// ════════════════════════════════════════════════════════════════
// PIPELINE SYNC v2 — Override syncFromSettings with loggedIn check
// ════════════════════════════════════════════════════════════════
(function initPipelineSyncV2() {
    const ipc = window.electronAPI || (window.electron && window.electron.ipcRenderer);
    const get = async (k) => {
        try { return ipc ? await ipc.invoke('store:get', k) : null; } catch(_) { return null; }
    };
    const store = {
        get: k => get(k),
        set: (k, v) => { try { return ipc ? ipc.invoke('store:set', k, v) : null; } catch(_) { return null; } }
    };

    async function syncFromSettings() {
        // FIX: Check cả cookie LẪN loggedIn state (QR login có thể không có cookie thật)
        const storedCookie = await get('cookie');
        const storedLoggedIn = await get('loggedIn');
        const primaryCookie = storedCookie || (typeof S !== 'undefined' ? S.cookie : null);
        const storedAcct = await get('connectedAccount');
        const primaryAcct = storedAcct || (typeof S !== 'undefined' ? S.account : null);
        const isLoggedIn = !!(primaryCookie || storedLoggedIn || (typeof S !== 'undefined' && S.loggedIn));
        const pool = (await get('settingsPool')) || [];
        const msgs = (await get('settingsMsgs')) || [];
        const tg = (await get('telegramSettings')) || {};

        const $ = id => document.getElementById(id);

        // ── 1. Tài khoản ──
        const allAccounts = [];
        if (isLoggedIn) {
            const acct = primaryAcct || { name: 'Tài khoản chính (QR)', uid: '' };
            allAccounts.push({ ...acct, cookie: primaryCookie || 'QR_ACTIVE', isPrimary: true });
        }
        pool.forEach(tk => allAccounts.push({ ...tk, isPrimary: false }));

        const badge = $('pipeAcctCount');
        if (badge) badge.textContent = allAccounts.length + ' TK';

        const display = $('pipeAcctDisplay');
        if (display) {
            if (allAccounts.length === 0) {
                display.innerHTML = '<div style="font-size:12px;color:var(--text-muted);text-align:center;padding:8px">Chưa đăng nhập — vào <b>Cài Đặt</b> để đăng nhập QR</div>';
            } else {
                display.innerHTML = allAccounts.map(function(tk, i) {
                    var bgColor = tk.isPrimary ? 'linear-gradient(135deg,#10b981,#059669)' : 'linear-gradient(135deg,#667eea,#764ba2)';
                    var borderColor = tk.isPrimary ? 'rgba(102,126,234,0.3)' : 'var(--card-border)';
                    var initial = (tk.name || 'Z')[0].toUpperCase();
                    var label = tk.name || ('TK ' + (i + 1));
                    var primaryBadge = tk.isPrimary ? '<span style="font-size:9px;background:rgba(16,185,129,0.15);color:#10b981;padding:1px 5px;border-radius:4px;margin-left:4px">Chính</span>' : '';
                    return '<div style="display:flex;align-items:center;gap:8px;padding:6px 8px;border-radius:8px;background:rgba(255,255,255,0.03);border:1px solid ' + borderColor + '">'
                        + '<div style="width:28px;height:28px;border-radius:50%;background:' + bgColor + ';display:flex;align-items:center;justify-content:center;color:#fff;font-weight:700;font-size:11px">' + initial + '</div>'
                        + '<div style="flex:1"><span style="font-size:12px;font-weight:600">' + label + '</span>' + primaryBadge + '</div>'
                        + '<span style="font-size:10px;color:#10b981">✓ Sẵn sàng</span>'
                        + '</div>';
                }).join('');
            }
        }

        // Auto-inject cookies vào hidden field
        if (allAccounts.length > 0) {
            const pipeArea = $('pipeCookies');
            if (pipeArea) pipeArea.value = allAccounts.map(t => t.cookie).filter(Boolean).join('\n');
        }

        // ── 2. Kho tin nhắn ──
        const msgList = $('pipeMsgList');
        const msgBadge = $('pipeMsgCount');
        if (msgBadge) msgBadge.textContent = msgs.length + ' tin';
        if (msgList) {
            if (msgs.length === 0) {
                msgList.innerHTML = '<div style="font-size:12px;color:var(--text-muted);text-align:center;padding:8px">Chưa có tin nhắn — thêm tại <b>Cài Đặt → Kho Tin Nhắn</b></div>';
            } else {
                msgList.innerHTML = msgs.map(function(msg, i) {
                    var preview = msg.length > 80 ? msg.slice(0, 80) + '…' : msg;
                    return '<div style="display:flex;gap:6px;padding:6px 8px;border-radius:8px;background:rgba(255,255,255,0.03);border:1px solid var(--card-border)">'
                        + '<span style="background:rgba(102,126,234,0.15);color:#667eea;font-size:9px;font-weight:700;padding:2px 5px;border-radius:4px;flex-shrink:0">#' + (i+1) + '</span>'
                        + '<span style="font-size:12px;line-height:1.5;color:var(--text-h)">' + preview + '</span>'
                        + '</div>';
                }).join('');
            }
        }

        // ── 3. Telegram status ──
        const tgStatus = $('pipeTgStatus');
        if (tgStatus) {
            if (tg.token && tg.chatId) {
                tgStatus.innerHTML = '<span style="color:#10b981;font-weight:600">✅ Đã kết nối Telegram</span>';
            } else {
                tgStatus.innerHTML = '<span style="color:var(--text-muted)">Chưa cấu hình — vào <b>Cài Đặt → Telegram</b></span>';
            }
        }

        // ── 4. Auto-inject msgs ──
        const msgInput = $('pipeGroupMsg') || $('pipeMessage') || $('pipeMsg');
        if (msgInput && !msgInput.value.trim() && msgs.length > 0) {
            msgInput.value = msgs[0];
        }
    }

    // Override window.syncPipelineFromSettings
    window.syncPipelineFromSettings = syncFromSettings;

    // Chạy ngay
    setTimeout(syncFromSettings, 500);
    setTimeout(syncFromSettings, 2000); // Retry sau 2s

    // Chạy khi navigate sang pipeline
    document.addEventListener('click', function(e) {
        const nav = e.target.closest('[data-page]');
        if (nav && nav.dataset.page === 'pipeline') {
            setTimeout(syncFromSettings, 200);
        }
    });

    // Chạy khi login thành công
    window.addEventListener('zalo:loginSuccess_internal', function() {
        setTimeout(syncFromSettings, 500);
    });
})();