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
    S.groups = [
        { id: '6452832425892012654', name: 'Học sáng', members: 4, created: '26/8/2025', unread: 0 },
        { id: '2822888250360872399', name: 'Nguồn account claude cursor', members: 3, created: '4/2/2026', unread: 0 },
        { id: '9162885645848436938', name: 'Nguyễn Duy Hiếu, Na, Bùi Ngọc Thanh Tuyền', members: 4, created: '8/1/2022', unread: 0 },
        { id: '1641660326226688043', name: 'VẠN PHÚ KHÁNH – VA&TBGD', members: 8, created: '10/12/2025', unread: 0 },
        { id: '2979096449077364916', name: 'Group Test', members: 3, created: '31/7/2025', unread: 0 },
        { id: '6511288884669272492', name: 'Kim Su, Nguyễn Duy Hiếu, Phong', members: 2, created: '2/3/2022', unread: 0 },
        { id: '9011712118946028531', name: 'VKU Học máy (8)', members: 60, created: '2/1/2025', unread: 0 },
        { id: '4994848336572424367', name: 'Gọi Rồng Online Z (1 SAO) – Open 21H 22/1/2026', members: 147, created: '9/12/2025', unread: 2 },
        { id: '1234567890123456789', name: 'Marketing Team Q1 2026', members: 12, created: '1/1/2026', unread: 5 },
        { id: '9876543210987654321', name: 'Nhóm bán hàng online', members: 34, created: '15/6/2025', unread: 0 },
    ];
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

    document.getElementById('btnRefreshGroups').addEventListener('click', () => {
        if (!S.loggedIn) { toast('Vui lòng đăng nhập Zalo trước!', 'error'); navigate('settings'); return; }
        const btn = document.getElementById('btnRefreshGroups');
        btn.style.transform = 'rotate(360deg)';
        btn.style.transition = 'transform 0.6s';
        setTimeout(() => { btn.style.transform = ''; btn.style.transition = ''; }, 600);
        toast('Đã làm mới danh sách nhóm!', 'success');
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
      <button data-gid="${g.id}" onclick="sendToGroupMembers(this.dataset.gid)"
        style="margin-top:8px;width:100%;background:linear-gradient(135deg,#667eea,#764ba2);color:#fff;border:none;border-radius:8px;padding:8px 0;font-size:13px;font-weight:600;cursor:pointer">
        📤 Gửi tin thành viên (${g.members})
      </button>
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

window.sendToGroupMembers = async function (groupId) {
    if (!S.loggedIn) { toast('Vui lòng đăng nhập trước!', 'error'); navigate('settings'); return; }

    // Tra cứu tên nhóm từ S.groups
    const group = S.groups.find(g => g.id === groupId);
    const groupName = group ? group.name : groupId;

    const msg = prompt('Gửi tin đến "' + groupName + '"\nNhập nội dung:');
    if (!msg || !msg.trim()) return;

    const cookie = S.cookie || 'QR_SESSION';
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
            const r = await el.zalo.sendMessageByUid(cookie, m.uid, msg);
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

function confirmGroupsSelected() {
    if (S.selectedGroups.size === 0) { toast('Chọn ít nhất 1 nhóm!', 'warning'); return; }
    // Inject member phones into phone input
    const dummyPhones = [];
    for (const id of S.selectedGroups) {
        const g = S.groups.find(x => x.id === id);
        if (g) {
            for (let i = 0; i < Math.min(g.members, 5); i++) {
                dummyPhones.push('09' + String(Math.floor(10000000 + Math.random() * 90000000)));
            }
        }
    }
    document.getElementById('phoneInput').value = dummyPhones.join('\n');
    updatePhoneCount();
    closeModal('groupSelectModal');
    navigate('bulk-send');
    toast(`Đã thêm thành viên từ ${S.selectedGroups.size} nhóm vào danh sách gửi tin!`, 'success');
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
}

function updatePhoneCount() {
    const phones = getPhones('phoneInput');
    document.getElementById('phoneInputCount').textContent = `${phones.length} số`;
}

function getPhones(id) {
    return document.getElementById(id).value
        .split('\n').map(p => p.trim()).filter(p => p.length >= 9 && /\d/.test(p));
}

function startBulkSend() {
    if (!S.loggedIn) { toast('Vui lòng đăng nhập Zalo trước!', 'error'); navigate('settings'); return; }
    const msg = document.getElementById('msgInput').value.trim();
    if (!msg) { toast('Nhập nội dung tin nhắn!', 'warning'); return; }

    const mode = window.__getSendMode ? window.__getSendMode() : 'phone';

    if (mode === 'group') {
        const groupId = window.__getSelectedGroupId ? window.__getSelectedGroupId() : null;
        if (!groupId) { toast('Hãy chọn một nhóm!', 'warning'); return; }

        const group = S.groups.find(g => g.id === groupId);
        const groupName = group ? group.name : groupId;
        const cookie = S.cookie || 'QR_SESSION';

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

    // Mode phone
    const phones = getPhones('phoneInput');
    if (!phones.length) { toast('Nhập danh sách số điện thoại!', 'warning'); return; }

    S.send = { running: true, paused: false, ok: 0, err: 0, wait: phones.length };
    setSendBtns(true);
    document.getElementById('sendProgressCard').style.display = 'block';
    updateSendProgress(0, phones.length);
    log('info', `📤 Bắt đầu gửi ${phones.length} tin nhắn...`, 'send');

    const delay = parseInt(document.getElementById('sendDelay').value) * 1000;
    const rand = document.getElementById('randomDelay').checked;
    const stopErr = document.getElementById('stopOnFail').checked;
    let idx = 0;

    const next = () => {
        if (!S.send.running || S.send.paused) return;
        if (idx >= phones.length) {
            log('success', `✅ Hoàn thành! ${S.send.ok} thành công, ${S.send.err} thất bại.`, 'send');
            toast(`Hoàn thành! ${S.send.ok}/${phones.length} tin`, 'success');
            stopBulkSend(); return;
        }
        const phone = phones[idx];
        log('info', `📨 Gửi → ${phone}`, 'send');

        simulateSend(phone, document.getElementById('msgInput').value.trim()).then(res => {
            const ok = res && res.success !== undefined ? res.success : res;
            const errMsg = (res && res.error) ? ` (${res.error})` : '';
            if (ok) { S.send.ok++; log('success', `✅ ${phone}`, 'send'); }
            else {
                S.send.err++; log('error', `❌ ${phone}${errMsg}`, 'send');
                if (stopErr) { stopBulkSend(); return; }
            }
            S.send.wait = phones.length - idx - 1;
            updateSendStats();
            updateSendProgress(++idx, phones.length);
            sendTimer = setTimeout(next, rand ? delay * (.7 + Math.random() * .6) : delay);
        });
    };
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
    const variantMsg = (baseMsg) => {
        // Random thêm 1-2 invisible chars vào vị trí ngẫu nhiên
        let result = baseMsg;
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

    const nextMember = () => {
        if (!S.send.running || S.send.paused) { saveCheckpoint(); return; }

        // ── Kiểm tra Quota ──
        const quota = getQuota();
        if (quota.hourCount >= MAX_PER_HOUR) {
            const waitMin = 60 - new Date().getMinutes();
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

        // ── Cool-down sau mỗi COOLDOWN_EVERY tin (nếu bật) ──
        if (useCooldown && sessionSent > 0 && sessionSent % COOLDOWN_EVERY === 0) {
            log('info', `☕ Cool-down ${COOLDOWN_TIME / 1000}s sau ${sessionSent} tin...`, 'send');
            sendTimer = setTimeout(nextMember, COOLDOWN_TIME);
            return;
        }

        // Retry queue
        if (S.send.retryQueue.length > 0 && idx >= members.length) {
            const retryUid = S.send.retryQueue.shift();
            const rm = members.find(m => m.uid === retryUid) || { uid: retryUid, name: retryUid.slice(-6) };
            log('warning', `🔄 Retry → ${rm.name}`, 'send');
            el.zalo.sendMessageByUid(cookie, retryUid, variantMsg(msg)).then(r => {
                if (r.success) { S.send.ok++; log('success', `✅ Retry OK → ${rm.name}`, 'send'); }
                else { log('error', `❌ Retry fail → ${rm.name}`, 'send'); }
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
        const pct = Math.round(((idx - startIdx) / (members.length - startIdx)) * 100);
        log('info', `[📤 ${idx + 1}/${members.length} - ${pct}%] → ${m.name}`, 'send');

        // Variation message để tránh spam filter (nếu bật)
        const msgToSend = useVariation ? variantMsg(msg) : msg;

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
                updateQuotaUI(); // Cập nhật progress bars real-time

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
                    }, 30 * 60 * 1000); // 30 phút
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
        startBulkSend();
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

    S.friend = { running: true, paused: false, sent: 0, ok: 0, pend: toSend.length, fail: 0 };
    setFrBtns(true);
    document.getElementById('frProgressCard').style.display = 'block';
    updateFrProgress(0, toSend.length);
    log('info', `🤝 Bắt đầu gửi ${toSend.length} lời mời kết bạn...`, 'fr');

    const delay = parseInt(document.getElementById('frDelay').value) * 1000;
    const rand = document.getElementById('frRandom').checked;
    let idx = 0;

    const next = () => {
        if (!S.friend.running || S.friend.paused) return;
        if (idx >= toSend.length) {
            log('success', `✅ Hoàn thành! Đã gửi ${S.friend.sent} lời mời.`, 'fr');
            toast(`Xong! ${S.friend.sent} lời mời kết bạn`, 'success');
            stopFriend(); return;
        }
        const phone = toSend[idx];
        log('info', `📨 Kết bạn → ${phone}`, 'fr');

        simulateFriend(phone).then(r => {
            if (r === 'ok') { S.friend.sent++; S.friend.ok++; log('success', `✅ Gửi lời mời → ${phone}`, 'fr'); }
            else if (r === 'already') { log('warning', `⚠️ ${phone} đã là bạn bè`, 'fr'); }
            else { S.friend.fail++; log('error', `❌ Không tìm thấy ${phone}`, 'fr'); }
            S.friend.pend = toSend.length - idx - 1;
            updateFrStats();
            updateFrProgress(++idx, toSend.length);
            frTimer = setTimeout(next, rand ? delay * (.8 + Math.random() * .4) : delay);
        });
    };
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
        startFriend();
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
    el.onLoginSuccess?.((data) => {
        closeModal('qrModal');
        S.loggedIn = true;
        S.cookie = 'QR_SESSION';
        S.account = { name: 'Người dùng Zalo (QR)', phone: '***', uid: '', avatar: '' };
        updateAccountUI();
        el.store.set('loggedIn', true);
        el.store.set('cookie', 'QR_SESSION');
        el.store.set('account', S.account);
        toast('🎉 Đăng nhập QR thành công! Có thể gửi tin ngay.', 'success');
        log('success', '✅ Đăng nhập QR thành công!', 'send');
        // Tự động tải danh sách nhóm
        loadRealGroups();
        navigate('groups');
    });

    // Lỗi QR
    el.onLoginError?.((msg) => {
        closeModal('qrModal');
        toast('Lỗi đăng nhập QR: ' + msg, 'error');
        log('error', '❌ Lỗi QR: ' + msg, 'send');
    });

    document.getElementById('btnSaveSettings').addEventListener('click', () => {
        saveState();
        toast('Cài đặt đã được lưu!', 'success');
    });

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
    const cookie = S.cookie || 'QR_SESSION';
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
        document.getElementById('statusText').textContent = 'Đã kết nối';
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
    // Hoạt động với cả QR session và cookie session
    if (el.zalo && (S.cookie || S.loggedIn)) {
        try {
            const cookie = S.cookie || 'QR_SESSION';
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
        const r = await el.zalo.sendFriendRequest(S.cookie, phone, document.getElementById('frMsgInput').value.trim());
        if (r.success) return 'ok';
        if (r.already) return 'already';
        if (r.pending) return 'already';
        return 'fail';
    }
    // fallback
    const v = Math.random();
    return v > 0.15 ? 'ok' : v > 0.08 ? 'already' : 'fail';
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
        // Chỉ restore session nếu có cookie thật (không phải QR_SESSION)
        // QR_SESSION không persist được qua restart (API object đã mất)
        if (all.loggedIn && cookie && cookie !== 'QR_SESSION' && cookie.length > 20) {
            S.loggedIn = true;
            S.cookie = cookie;
            S.account = all.account || { name: 'Người dùng Zalo', phone: '***' };
            updateAccountUI();
            if (document.getElementById('cookieInput')) {
                document.getElementById('cookieInput').value = cookie;
            }
        } else {
            // Chưa đăng nhập hoặc session QR đã hết → reset
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
            const cookie = S.cookie || 'QR_SESSION';
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
    const cookie = S.cookie || 'QR_SESSION';

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
        const cookie = S.cookie || 'QR_SESSION';
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
        const cookie = S.cookie || 'QR_SESSION';

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
            const cookie = S.cookie || 'QR_SESSION';

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


