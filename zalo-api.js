'use strict';
/**
 * ══════════════════════════════════════════════════════
 *  Zalo API Backend – dùng zca-js (đã reverse-engineer
 *  toàn bộ thuật toán mã hóa AES của Zalo)
 *  Chạy hoàn toàn ngầm, không cần browser.
 * ══════════════════════════════════════════════════════
 */

const https = require('https');

// ══════════════════════════════════════════════════════
// COOKIE / CREDENTIALS HELPERS
// ══════════════════════════════════════════════════════
function parseCookie(rawCookie) {
    const obj = {};
    rawCookie.split(';').forEach(part => {
        const [k, ...v] = part.trim().split('=');
        if (k) obj[k.trim()] = v.join('=').trim();
    });
    return obj;
}

function extractZaloCookies(rawCookie) {
    const c = parseCookie(rawCookie);
    return { zpw_sek: c.zpw_sek || '', zpsid: c.zpsid || '', raw: rawCookie };
}

/**
 * Chuyển cookie string thành mảng object mà zca-js chấp nhận.
 * zca-js cần: { name, value, domain, path, ... }
 */
function cookieStringToObjArr(rawCookie) {
    const obj = parseCookie(rawCookie);
    return Object.entries(obj)
        .filter(([k, v]) => k && v)
        .map(([name, value]) => ({
            name,
            value,
            domain: 'chat.zalo.me',
            path: '/',
            httpOnly: false,
            secure: true,
            session: false,
            hostOnly: false,
            storeId: '0',
            expirationDate: Math.floor(Date.now() / 1000) + 86400 * 30,
            sameSite: 'no_restriction',
        }));
}

// ══════════════════════════════════════════════════════
// ZCA-JS API SINGLETON
// ══════════════════════════════════════════════════════
let _api = null;
let _cookieHash = '';
let _imei = '';
let _userAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36';

/**
 * Lay IMEI từ data.json (được lưu bởi Electron main)
 * hoặc dùng giá trị mặc định từ lần extract trước
 */
function getImei() {
    try {
        const fs = require('fs');
        const path = require('path');
        // Đường dẫn Electron userData
        const dataPath = path.join(
            process.env.APPDATA || '',
            'Zalo Bulk Tool Pro',
            'data.json'
        );
        if (fs.existsSync(dataPath)) {
            const d = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
            if (d.imei) return d.imei;
        }
    } catch { }
    // Fallback: IMEI đã lấy được từ Zalo Web
    return '3c4e5f3a-d77c-4ce7-ba78-ab8ec27a9904-7c73ef5b8d3235ae0606f2e84e457ff5';
}

/**
 * Khởi tạo hoặc tái sử dụng zca-js API instance
 */
async function getApi(cookie) {
    // Nếu đã login qua QR → dùng luôn (bỏ qua cookie)
    if (_api && _cookieHash === 'QR_LOGIN') return _api;

    const cookieHash = cookie ? cookie.slice(0, 80) : '';
    if (_api && _cookieHash === cookieHash && cookieHash) return _api;

    if (!cookie || cookie === 'QR_SESSION') {
        throw new Error('Chưa đăng nhập. Vui lòng quét QR hoặc nhập Cookie trong Cài đặt.');
    }

    // Lazy-require zca-js (ESM → require compat)
    let Zalo;
    try {
        const mod = await import('zca-js');
        Zalo = mod.Zalo;
    } catch (e) {
        throw new Error('Thiếu zca-js: ' + e.message);
    }

    const imei = getImei();
    const credentials = {
        imei,
        cookie: cookieStringToObjArr(cookie),
        userAgent: _userAgent,
        language: 'vi',
    };

    const zalo = new Zalo({ logging: false });
    _api = await zalo.login(credentials);
    _cookieHash = cookieHash;

    _imei = imei;

    return _api;
}

// ══════════════════════════════════════════════════════
// HTTPS – chỉ dùng cho verifyLogin (endpoint không cần encrypt)
// ══════════════════════════════════════════════════════
function httpsGet(options) {
    return new Promise((resolve, reject) => {
        const req = https.request(options, res => {
            let data = '';
            res.on('data', c => data += c);
            res.on('end', () => {
                try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
                catch { resolve({ status: res.statusCode, body: null }); }
            });
        });
        req.on('error', reject);
        req.setTimeout(12000, () => req.destroy(new Error('Timeout')));
        req.end();
    });
}

// ══════════════════════════════════════════════════════
// QR LOGIN – user quét QR bằng Zalo mobile
// (Không cần cookie/IMEI thủ công)
// ══════════════════════════════════════════════════════
async function loginQR(qrImagePath, onQRReady) {
    let ZaloMod, LoginQRCallbackEventType;
    try {
        ZaloMod = await import('zca-js');
        LoginQRCallbackEventType = ZaloMod.LoginQRCallbackEventType;
        console.log('[QR] zca-js loaded. EventTypes:', JSON.stringify(LoginQRCallbackEventType));
    } catch (e) {
        throw new Error('Thiếu zca-js: ' + e.message);
    }

    const { Zalo } = ZaloMod;
    const zalo = new Zalo({ logging: true });

    console.log('[QR] Bắt đầu loginQR, qrPath:', qrImagePath);

    // loginQR blocks until user scans → resolves with api
    const api = await zalo.loginQR(
        {
            qrPath: qrImagePath,
            userAgent: _userAgent,
            language: 'vi',
        },
        (event) => {
            console.log('[QR] Event received:', JSON.stringify(event?.type), 'keys:', Object.keys(event || {}));
            console.log('[QR] Event data:', JSON.stringify(event?.data)?.slice(0, 200));
            const t = event?.type;
            const isQRReady = (
                t === (LoginQRCallbackEventType?.QR_CODE_GENERATED) ||
                t === 0 || t === 'QR_CODE_GENERATED' ||
                (event?.data?.qrUrl || event?.data?.qrPath)
            );
            if (isQRReady) {
                console.log('[QR] QR Code generated! Notifying renderer...');
                if (onQRReady) onQRReady(qrImagePath, event);
            }
        }
    );


    // Store api for subsequent calls
    _api = api;
    _cookieHash = 'QR_LOGIN';
    return { success: true };
}

// ══════════════════════════════════════════════════════
// 1. XÁC THỰC ĐĂNG NHẬP
// ══════════════════════════════════════════════════════
async function verifyLogin(cookie) {
    try {
        const ck = extractZaloCookies(cookie);
        if (!ck.zpw_sek && !ck.zpsid) {
            return { success: false, error: 'Cookie không hợp lệ. Cần có zpw_sek hoặc zpsid.' };
        }

        // Thử lấy thông tin qua zca-js login
        try {
            const api = await getApi(cookie);
            // Nếu login thành công thì lấy account info
            const info = api.getOwnId ? api.getOwnId() : null;
            return {
                success: true,
                user: {
                    name: 'Người dùng Zalo',
                    phone: '***',
                    uid: info || '',
                    avatar: '',
                },
            };
        } catch (loginErr) {
            // Fallback: verify qua HTTP
            const res = await httpsGet({
                hostname: 'jr.chat.zalo.me',
                path: '/jr/userinfo',
                method: 'GET',
                headers: {
                    'Cookie': cookie,
                    'User-Agent': _userAgent,
                    'Origin': 'https://chat.zalo.me',
                    'Referer': 'https://chat.zalo.me/',
                    'Host': 'jr.chat.zalo.me',
                },
            });

            if (res.status === 200 && res.body) {
                const d = res.body.data || res.body;
                return {
                    success: true,
                    user: {
                        name: d.displayName || d.name || 'Người dùng Zalo',
                        phone: d.phoneNumber || '***',
                        uid: d.userId || d.uid || '',
                        avatar: d.avatar || '',
                    },
                };
            }

            if (ck.zpsid) {
                return { success: true, user: { name: 'Người dùng Zalo', phone: '***', uid: '', avatar: '' } };
            }

            return { success: false, error: `Xác thực thất bại: ${loginErr.message}` };
        }
    } catch (err) {
        return { success: false, error: err.message };
    }
}

// ══════════════════════════════════════════════════════
// 2. TÌM USER THEO SĐT
// ══════════════════════════════════════════════════════
async function findUserByPhone(cookie, phone) {
    try {
        const api = await getApi(cookie);
        const user = await api.findUser(phone);
        if (user && user.uid) {
            return { success: true, uid: user.uid, name: user.display_name || user.zalo_name || phone };
        }
        return { success: false, uid: null, error: 'Không tìm thấy tài khoản với SĐT này' };
    } catch (err) {
        return { success: false, uid: null, error: err.message };
    }
}

// ══════════════════════════════════════════════════════
// 3. GỬI TIN NHẮN
// ══════════════════════════════════════════════════════
async function sendMessage(cookie, phone, message) {
    try {
        const api = await getApi(cookie);

        // Bước 1: Tìm uid
        const found = await findUserByPhone(cookie, phone);
        if (!found.success || !found.uid) {
            return { success: false, error: found.error || 'Không tìm thấy người dùng' };
        }

        // Bước 2: Import ThreadType
        const { ThreadType } = await import('zca-js');

        // Bước 3: Gửi tin
        await api.sendMessage({ msg: message }, found.uid, ThreadType.User);
        return { success: true, to: phone, name: found.name };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

// ══════════════════════════════════════════════════════
// 4. GỬI LỜI MỜI KẾT BẠN
// ══════════════════════════════════════════════════════
async function sendFriendRequest(cookie, phone, message = '') {
    try {
        const api = await getApi(cookie);

        const found = await findUserByPhone(cookie, phone);
        if (!found.success || !found.uid) {
            return { success: false, error: found.error || 'Không tìm thấy người dùng' };
        }

        const msg = message || 'Xin chào! Mình muốn kết bạn với bạn 😊';
        await api.sendFriendRequest(msg, found.uid);
        return { success: true, to: phone, name: found.name };
    } catch (err) {
        const msg = err.message || '';
        if (msg.includes('already') || msg.includes('216')) {
            return { success: false, error: 'already_friend', already: true };
        }
        if (msg.includes('217') || msg.includes('pending')) {
            return { success: false, error: 'request_sent', pending: true };
        }
        return { success: false, error: msg };
    }
}

// ══════════════════════════════════════════════════════
// 5. LẤY DANH SÁCH NHÓM
// ══════════════════════════════════════════════════════
async function getGroups(cookie) {
    try {
        const api = await getApi(cookie);

        // Bước 1: Lấy tất cả group IDs
        const allGroupsRes = await api.getAllGroups();
        const gridVerMap = allGroupsRes?.gridVerMap || {};
        const groupIds = Object.keys(gridVerMap);

        if (groupIds.length === 0) {
            return { success: true, groups: [] };
        }

        console.log(`[getGroups] Tìm thấy ${groupIds.length} nhóm, đang lấy chi tiết...`);

        // Bước 2: Lấy info chi tiết (batch 50 mỗi lần)
        const batchSize = 50;
        const allGroupInfos = {};
        for (let i = 0; i < groupIds.length; i += batchSize) {
            const batch = groupIds.slice(i, i + batchSize);
            const infoRes = await api.getGroupInfo(batch);
            Object.assign(allGroupInfos, infoRes?.gridInfoMap || {});
        }

        // Bước 3: Format kết quả — lưu luôn currentMems để tránh gọi lại API
        const groups = Object.entries(allGroupInfos).map(([gid, g]) => ({
            id: gid,
            name: g.name || 'Nhóm không tên',
            members: g.totalMember || g.memberIds?.length || 0,
            created: g.createdTime
                ? new Date(g.createdTime * 1000).toLocaleDateString('vi-VN')
                : '',
            unread: 0,
            avatar: g.avt || '',
            // Lưu luôn danh sách thành viên — tránh gọi getGroupInfo lần 2 bị "unchanged"
            currentMems: (g.currentMems || []).map(m => ({
                uid: m.id,
                name: m.dName || m.zaloName || 'Ẩn danh',
                avatar: m.avatar_25 || m.avatar || '',
            })),
        })).filter(g => g.name);


        console.log(`[getGroups] Lấy được ${groups.length} nhóm.`);
        return { success: true, groups };

    } catch (err) {
        console.error('[getGroups] Error:', err.message);
        return { success: false, groups: [], error: err.message };
    }
}
// ══════════════════════════════════════════════════════
// 6. LẤY THÀNH VIÊN NHÓM - Thuật toán tinh vi 5 lớp
// ══════════════════════════════════════════════════════
async function getGroupMembers(cookie, groupId) {
    const log = (...a) => console.log('[getGroupMembers]', ...a);
    try {
        const api = await getApi(cookie);

        // ── Bước 1: getGroupInfo(groupId) với version=0 (luôn trả fresh data) ──
        log('calling getGroupInfo for', groupId);
        const infoRes = await api.getGroupInfo(groupId);

        const allKeys = Object.keys(infoRes?.gridInfoMap || {});
        log('gridInfoMap keys:', allKeys);
        log('unchangedsGroup:', JSON.stringify(infoRes?.unchangedsGroup));

        // Lấy group object — thử cả key string lẫn số nguyên
        let g = infoRes?.gridInfoMap?.[groupId]
            || infoRes?.gridInfoMap?.[String(groupId)]
            || infoRes?.gridInfoMap?.[Number(groupId)];

        // Nếu vẫn không thấy, thử match key gần nhất
        if (!g && allKeys.length > 0) {
            const matching = allKeys.find(k => String(k) === String(groupId));
            g = matching ? infoRes.gridInfoMap[matching] : null;
        }

        log('g found:', !!g, '| keys in g:', g ? Object.keys(g).join(',') : 'N/A');
        if (g) {
            log('RAW g (500 chars):', JSON.stringify(g).slice(0, 500));
            log('memberIds:', JSON.stringify(g.memberIds));
            log('currentMems count:', g.currentMems?.length, '| totalMember:', g.totalMember);
        }

        let members = [];
        let groupName = groupId;

        if (g) {
            groupName = g.name || groupId;

            log('memVerList:', JSON.stringify(g.memVerList));
            log('memberIds:', JSON.stringify(g.memberIds));
            log('currentMems count:', g.currentMems?.length, '| totalMember:', g.totalMember);

            // ── Chiến lược A0: memVerList = uid_version strings (CHÍNH XÁC NHẤT) ──
            const memVerList = g.memVerList || [];
            if (memVerList.length > 0) {
                log('Strategy A0: memVerList count:', memVerList.length);
                // Parse uid từ "uid_version" — ví dụ "1234567890_1" → "1234567890"
                const uids = memVerList.map(mv => mv.includes('_') ? mv.split('_').slice(0, -1).join('_') : mv);
                log('Extracted UIDs:', uids.length, 'first:', uids[0]);

                // Lấy profile qua getGroupMembersInfo (tự thêm _0 nếu cần)
                const allProfiles = {};
                for (let i = 0; i < uids.length; i += 50) {
                    const batch = uids.slice(i, i + 50);
                    try {
                        const pr = await api.getGroupMembersInfo(batch);
                        log('Profile response profiles count:', Object.keys(pr?.profiles || {}).length);
                        Object.assign(allProfiles, pr?.profiles || {});
                    } catch (e) { log('profile err:', e.message); }
                }
                members = uids.map(uid => ({
                    uid,
                    name: allProfiles[uid]?.displayName || allProfiles[uid]?.zaloName || `TV_${uid.slice(-6)}`,
                    avatar: allProfiles[uid]?.avatar || '',
                }));
                log('Strategy A0 result:', members.length, 'members');
            }

            // ── Chiến lược A: currentMems ──
            if (members.length === 0 && g.currentMems?.length > 0) {
                log('Strategy A: currentMems:', g.currentMems.length);
                members = g.currentMems.map(m => ({
                    uid: m.id,
                    name: m.dName || m.zaloName || `TV_${m.id.slice(-6)}`,
                    avatar: m.avatar_25 || m.avatar || '',
                }));
            }

            // ── Chiến lược B: memberIds + getGroupMembersInfo ──
            if (members.length === 0 && g.memberIds?.length > 0) {
                log('Strategy B: using memberIds:', g.memberIds.length);
                const allProfiles = {};
                for (let i = 0; i < g.memberIds.length; i += 50) {
                    const batch = g.memberIds.slice(i, i + 50);
                    try {
                        const pr = await api.getGroupMembersInfo(batch);
                        Object.assign(allProfiles, pr?.profiles || {});
                    } catch (e) { log('profile batch err:', e.message); }
                }
                members = g.memberIds.map(uid => ({
                    uid,
                    name: allProfiles[uid]?.displayName || allProfiles[uid]?.zaloName || `TV_${uid.slice(-6)}`,
                    avatar: allProfiles[uid]?.avatar || '',
                }));
            }

            // ── Chiến lược C: adminIds fallback ──
            if (members.length === 0 && g.adminIds?.length > 0) {
                log('Strategy C: using adminIds:', g.adminIds.length);
                members = g.adminIds.map(uid => ({ uid, name: `Quản trị_${uid.slice(-6)}`, avatar: '' }));
            }
        }

        // ── Bước 2 (Fallback D): getAllGroups → getGroupInfo retry ──
        if (members.length === 0) {
            log('Strategy D: fallback getAllGroups...');
            await api.getAllGroups();
            const r2 = await api.getGroupInfo([groupId]);
            const g2 = r2?.gridInfoMap?.[groupId];
            if (g2?.currentMems?.length > 0) {
                groupName = g2.name || groupName;
                members = g2.currentMems.map(m => ({
                    uid: m.id,
                    name: m.dName || m.zaloName || `TV_${m.id.slice(-6)}`,
                    avatar: m.avatar_25 || '',
                }));
            } else if (g2?.memVerList?.length > 0) {
                // v2 retry trả memVerList
                const uids2 = g2.memVerList.map(mv => mv.includes('_') ? mv.split('_').slice(0, -1).join('_') : mv);
                members = uids2.map(uid => ({ uid, name: `TV_${uid.slice(-6)}`, avatar: '' }));
                log('Strategy D got memVerList:', members.length);
            }
        }

        // ── Chiến lược F: RAW v1 endpoint /api/group/getmg (không -v2) ──
        // v1 thường trả currentMems đầy đủ hơn v2
        if (members.length === 0) {
            log('Strategy F: custom v1 endpoint /api/group/getmg...');
            try {
                const v1Result = await new Promise((resolve) => {
                    try {
                        api.custom('_getmgV1', ({ utils }) => {
                            const url = utils.makeURL(`${api.zpwServiceMap.group[0]}/api/group/getmg`);
                            // Thử params khác: all=1, type=0 để force full list
                            const p = utils.encodeAES(JSON.stringify({
                                gridVerMap: JSON.stringify({ [groupId]: 0 }),
                                all: 1,
                                type: 0,
                            }));
                            return utils.request(url, {
                                method: 'POST',
                                body: new URLSearchParams({ params: p }),
                            }).then(r => utils.resolve(r)).catch(() => null);
                        });
                        resolve(api._getmgV1({}));
                    } catch (e) { resolve(null); }
                });

                log('v1 raw response keys:', v1Result ? Object.keys(v1Result) : 'null');
                const gv1 = v1Result?.gridInfoMap?.[groupId]
                    || v1Result?.gridInfoMap?.[String(groupId)];
                if (gv1) {
                    log('v1 currentMems:', gv1.currentMems?.length, 'memVerList:', gv1.memVerList?.length);
                    if (gv1.currentMems?.length > 0) {
                        groupName = gv1.name || groupName;
                        members = gv1.currentMems.map(m => ({
                            uid: m.id,
                            name: m.dName || m.zaloName || `TV_${m.id.slice(-6)}`,
                            avatar: m.avatar_25 || '',
                        }));
                        log('Strategy F (v1 currentMems):', members.length);
                    } else if (gv1.memVerList?.length > 0) {
                        const uids = gv1.memVerList.map(mv => mv.includes('_') ? mv.split('_').slice(0, -1).join('_') : mv);
                        members = uids.map(uid => ({ uid, name: `TV_${uid.slice(-6)}`, avatar: '' }));
                        log('Strategy F (v1 memVerList):', members.length);
                    }
                }
            } catch (e) { log('Strategy F error:', e.message); }
        }

        // ── Chiến lược G: force version=-1 trên v2 ──
        if (members.length === 0) {
            log('Strategy G: force gridVerMap version=-1...');
            try {
                const gResult = await new Promise((resolve) => {
                    try {
                        api.custom('_getmgForce', ({ utils }) => {
                            const url = utils.makeURL(`${api.zpwServiceMap.group[0]}/api/group/getmg-v2`);
                            const p = utils.encodeAES(JSON.stringify({
                                gridVerMap: JSON.stringify({ [groupId]: -1 }), // -1 = force full
                            }));
                            return utils.request(url, {
                                method: 'POST',
                                body: new URLSearchParams({ params: p }),
                            }).then(r => utils.resolve(r)).catch(() => null);
                        });
                        resolve(api._getmgForce({}));
                    } catch (e) { resolve(null); }
                });
                const gg = gResult?.gridInfoMap?.[groupId] || gResult?.gridInfoMap?.[String(groupId)];
                if (gg?.currentMems?.length > 0) {
                    members = gg.currentMems.map(m => ({
                        uid: m.id, name: m.dName || `TV_${m.id.slice(-6)}`, avatar: '',
                    }));
                    log('Strategy G:', members.length);
                } else if (gg?.memVerList?.length > 0) {
                    const uids = gg.memVerList.map(mv => mv.includes('_') ? mv.split('_').slice(0, -1).join('_') : mv);
                    members = uids.map(uid => ({ uid, name: `TV_${uid.slice(-6)}`, avatar: '' }));
                    log('Strategy G memVerList:', members.length);
                }
            } catch (e) { log('Strategy G error:', e.message); }
        }

        // ── Chiến lược H: WebSocket Listener — trigger server push member list ──
        // Zalo app lấy member list qua WS push sau khi subscribe group. Ta trigger điều đó.
        if (members.length === 0) {
            log('Strategy H: WebSocket listener trigger...');
            try {
                const wsUids = await new Promise(resolve => {
                    const collectedUids = new Set();
                    const listener = api.listener;
                    const onGroupEvent = (evt) => {
                        // updateMembers là array objects {id, version} hoặc array string
                        const mems = evt?.data?.updateMembers || evt?.data?.members || [];
                        for (const m of mems) {
                            const uid = typeof m === 'string' ? m : (m.id || m.uid);
                            if (uid && uid !== '0') collectedUids.add(String(uid));
                        }
                        log('WS group_event, collected so far:', collectedUids.size);
                    };
                    listener.on('group_event', onGroupEvent);

                    // Start listener nếu chưa chạy
                    try { listener.start({ retryOnClose: false }); } catch (e) { }

                    // Gửi WS payload để trigger server push group info
                    // cmd 519, subCmd 1 là Zalo group info subscription
                    // cmd 602, subCmd 1 là group member list request
                    const wsPayloads = [
                        { version: 3, cmd: 519, subCmd: 1, data: { groupId: groupId.toString() } },
                        { version: 3, cmd: 602, subCmd: 1, data: { groupId: groupId.toString() } },
                        { version: 3, cmd: 611, subCmd: 0, data: { grid: groupId.toString() } },
                    ];
                    for (const payload of wsPayloads) {
                        try { listener.sendWs(payload); } catch (e) { }
                    }

                    // Chờ 5s để nhận push từ server
                    setTimeout(() => {
                        listener.removeListener('group_event', onGroupEvent);
                        resolve([...collectedUids]);
                    }, 5000);
                });

                if (wsUids.length > 0) {
                    log('Strategy H got UIDs from WS:', wsUids.length);
                    const allProfiles = {};
                    for (let i = 0; i < wsUids.length; i += 50) {
                        try {
                            const pr = await api.getGroupMembersInfo(wsUids.slice(i, i + 50));
                            Object.assign(allProfiles, pr?.profiles || {});
                        } catch (e) { }
                    }
                    members = wsUids.map(uid => ({
                        uid,
                        name: allProfiles[uid]?.displayName || allProfiles[uid]?.zaloName || `TV_${uid.slice(-6)}`,
                        avatar: allProfiles[uid]?.avatar || '',
                    }));
                }
            } catch (e) { log('Strategy H error:', e.message); }
        }

        // ── Chiến lược I: Endpoint Discovery qua zpwServiceMap ──
        // Dump service map để tìm undiscovered member list endpoints
        if (members.length === 0) {
            log('Strategy I: endpoint discovery...');
            const svcMap = api.zpwServiceMap || {};
            log('zpwServiceMap keys:', Object.keys(svcMap).join(','));
            const baseUrl = svcMap.group?.[0] || svcMap.chat?.[0] || '';
            // Thử các endpoint pattern tiềm năng cho member list
            const endpointCandidates = [
                '/api/group/getallmember',
                '/api/group/getmembers',
                '/api/group/memberlist',
                '/api/social/group/getmember',
            ];
            for (const ep of endpointCandidates) {
                if (members.length > 0) break;
                try {
                    const result = await new Promise(resolve => {
                        try {
                            api.custom('_epDiscover', ({ utils }) => {
                                const url = utils.makeURL(`${baseUrl}${ep}`);
                                const p = utils.encodeAES(JSON.stringify({
                                    groupId: groupId.toString(),
                                    grid: groupId.toString(),
                                    count: 1000, offset: 0,
                                }));
                                return utils.request(utils.makeURL(url, { params: p }), { method: 'GET' })
                                    .then(r => utils.resolve(r))
                                    .catch(() => null);
                            });
                            resolve(api._epDiscover({}));
                        } catch (e) { resolve(null); }
                    });
                    if (result && !result.error_code) {
                        log(`Endpoint ${ep} responded:`, JSON.stringify(result).slice(0, 200));
                        // Parse any UIDs từ response
                        const str = JSON.stringify(result || {});
                        const uidMatches = str.match(/\d{15,20}/g) || [];
                        const unique = [...new Set(uidMatches)].filter(u => u !== groupId.toString());
                        if (unique.length > 0) {
                            log(`Strategy I (${ep}) found UIDs:`, unique.length);
                            members = unique.map(uid => ({ uid, name: `TV_${uid.slice(-6)}`, avatar: '' }));
                        }
                    }
                } catch (e) { log(`Strategy I ep ${ep} err:`, e.message); }
            }
        }

        // ── Chiến lược E (BYPASS): Paginate chat history → extract UIDs ──

        // Phù hợp với nhóm 1000+ người khi member list bị block
        if (members.length === 0) {
            log('Strategy E: chat history paginate for large groups...');
            try {
                const totalExpected = g?.totalMember || 0;
                const uidSet = new Set();
                const MAX_ROUNDS = totalExpected > 500 ? 40 : 20; // 40 vòng cho nhóm lớn
                const PER_ROUND = 50;
                let lastMsgId = '0';
                let round = 0;
                let hasMore = true;

                // Vòng 1: lấy 1000 tin nhắn một lúc (Zalo cho phép count lớn)
                try {
                    const big = await api.getGroupChatHistory(groupId, 1000);
                    const msgs = big?.groupMsgs || [];
                    for (const msg of msgs) {
                        const uid = msg.uidFrom || msg.senderId;
                        if (uid && uid !== '0' && uid !== '') uidSet.add(String(uid));
                    }
                    lastMsgId = msgs.length > 0
                        ? (msgs[msgs.length - 1].msgId || msgs[msgs.length - 1].globalMsgId || '0')
                        : '0';
                    hasMore = (big?.more === 1);
                    log(`Round 0: ${msgs.length} msgs → ${uidSet.size} UIDs (hasMore=${hasMore})`);
                } catch (e) {
                    log('Initial big fetch err:', e.message);
                    // Fallback về 200 nếu 1000 fail
                    const hist = await api.getGroupChatHistory(groupId, 200);
                    const msgs = hist?.groupMsgs || [];
                    for (const msg of msgs) {
                        const uid = msg.uidFrom || msg.senderId;
                        if (uid && uid !== '0' && uid !== '') uidSet.add(String(uid));
                    }
                    hasMore = false;
                    log(`Fallback: ${msgs.length} msgs → ${uidSet.size} UIDs`);
                }

                // Paginate nếu nhóm còn thêm và chưa đủ thành viên
                while (hasMore && uidSet.size < totalExpected && round < MAX_ROUNDS) {
                    round++;
                    try {
                        // Dùng custom API để paginate bằng lastMsgId
                        const hist = await (() => {
                            return new Promise((resolve, reject) => {
                                try {
                                    api.custom('_histPaged', ({ utils, props }) => {
                                        const url = utils.makeURL(
                                            `${api.zpwServiceMap.group[0]}/api/group/history`
                                        );
                                        const params = utils.encodeAES(JSON.stringify({
                                            grid: groupId,
                                            count: PER_ROUND,
                                            timestamp: lastMsgId,
                                        }));
                                        return utils.request(utils.makeURL(url, { params }), { method: 'GET' })
                                            .then(r => utils.resolve(r));
                                    });
                                    resolve(api._histPaged({}));
                                } catch (e) { reject(e); }
                            });
                        })().catch(() => api.getGroupChatHistory(groupId, PER_ROUND));

                        const msgs = hist?.groupMsgs || [];
                        if (msgs.length === 0) break;

                        for (const msg of msgs) {
                            const uid = msg.uidFrom || msg.senderId;
                            if (uid && uid !== '0' && uid !== '') uidSet.add(String(uid));
                        }
                        lastMsgId = msgs[msgs.length - 1]?.msgId || '0';
                        hasMore = hist?.more === 1;
                        log(`Round ${round}: +${msgs.length} msgs → total UIDs: ${uidSet.size}`);
                        await new Promise(r => setTimeout(r, 300)); // Delay nhỏ giữa các round
                    } catch (e) {
                        log(`Round ${round} err:`, e.message);
                        break;
                    }
                }

                log(`Final scan: ${uidSet.size} unique UIDs (target: ${totalExpected})`);

                if (uidSet.size > 0) {
                    const uids = [...uidSet];
                    // Fetch profiles in batch 50
                    const allProfiles = {};
                    for (let i = 0; i < uids.length; i += 50) {
                        const batch = uids.slice(i, i + 50);
                        try {
                            const pr = await api.getGroupMembersInfo(batch);
                            Object.assign(allProfiles, pr?.profiles || {});
                        } catch (e) { log('profile batch err:', e.message); }
                        if (i > 0) await new Promise(r => setTimeout(r, 200)); // Ngắn delay
                    }
                    members = uids.map(uid => ({
                        uid,
                        name: allProfiles[uid]?.displayName || allProfiles[uid]?.zaloName || `TV_${uid.slice(-6)}`,
                        avatar: allProfiles[uid]?.avatar || '',
                    }));
                    log('Strategy E members:', members.length);
                }
            } catch (e) { log('Strategy E error:', e.message); }
        }


        // Không còn strategy nào → trả lỗi rõ ràng
        if (members.length === 0) {
            log('ALL strategies failed');
            return {
                success: false,
                error: `Không lấy được thành viên nhóm. Có thể nhóm bị ẩn danh sách (lockViewMember) hoặc chưa có lịch sử chat. g=${!!g}, memVerList=${g?.memVerList?.length || 0}, memberIds=${g?.memberIds?.length || 0}, currentMems=${g?.currentMems?.length || 0}`,
            };
        }


        // Lọc bỏ UID của chính tài khoản đang login
        const ownUid = String(api.getOwnId() || '');
        if (ownUid) {
            const before = members.length;
            members = members.filter(m => String(m.uid) !== ownUid);
            if (members.length !== before) {
                log(`Filtered out own UID ${ownUid}, members: ${before} → ${members.length}`);
            }
        }

        const actualTotal = g?.totalMember || members.length;
        const coverage = members.length / Math.max(actualTotal, 1);
        const warning = coverage < 0.8 && actualTotal > members.length
            ? `⚠️ Chỉ tìm được ${members.length}/${actualTotal} thành viên. Lurkers (người chưa từng chat) không thể lấy được qua lịch sử tin nhắn.`
            : null;

        log(`SUCCESS: ${members.length} found / ${actualTotal} total (coverage ${Math.round(coverage * 100)}%)`);
        return { success: true, groupName, totalMember: members.length, actualTotal, members, warning };


    } catch (err) {
        console.error('[getGroupMembers] Error:', err.stack || err.message);
        return { success: false, error: err.message };
    }
}


// ══════════════════════════════════════════════════════
// 7. SMART SEND — anti-block + exponential backoff
//    Cho nhóm 1000+ người, tránh rate limit Zalo
// ══════════════════════════════════════════════════════
const sleep = ms => new Promise(r => setTimeout(r, ms));
const RATE_LIMIT_KEYWORDS = ['nhiều quá', 'rate', 'limit', 'flood', 'spam', 'quá nhiều', 'too many', 'vượt quá'];
const isRateLimit = msg => RATE_LIMIT_KEYWORDS.some(k => String(msg).toLowerCase().includes(k));
const isBlockedByUser = msg => ['tham số', 'invalid', 'blocked', 'privacy'].some(k => String(msg).toLowerCase().includes(k));

async function sendMessageByUid(cookie, uid, message, _retryCount = 0) {
    const log = (...a) => console.log('[smartSend]', ...a);
    const MAX_RETRIES = 3;
    try {
        const api = await getApi(cookie);
        const { ThreadType } = await import('zca-js');

        // ── Lần 1: Gửi trực tiếp với exponential backoff retry ──
        let directError = '';
        for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
            try {
                await api.sendMessage({ msg: message }, uid, ThreadType.User);
                log(`Direct OK (attempt ${attempt + 1}) →`, uid);
                return { success: true, uid, via: 'direct' };
            } catch (e) {
                directError = e.message || '';
                if (isRateLimit(directError)) {
                    // Rate limit → backoff: 2s, 4s, 8s, 16s
                    const backoff = Math.pow(2, attempt + 1) * 1000;
                    log(`Rate limited! Backoff ${backoff}ms (attempt ${attempt + 1}/${MAX_RETRIES})`);
                    if (attempt < MAX_RETRIES) {
                        await sleep(backoff);
                        continue;
                    }
                }
                // Không phải rate limit hoặc hết retry → break
                log(`Direct fail (attempt ${attempt + 1}) →`, uid, '|', directError);
                break;
            }
        }

        // Nếu đã bị rate limit sau tất cả retry
        if (isRateLimit(directError)) {
            log('Rate limit exhausted, waiting 30s before friend request...');
            await sleep(30000); // Chờ 30s trước khi thử cách khác
        }

        // ── Lần 2: Kiểm tra mối quan hệ ──
        let status = null;
        try {
            status = await api.getFriendRequestStatus(uid);
        } catch (e) {
            log('getFriendRequestStatus err:', e.message);
        }

        if (status?.is_friend === 1) {
            // Đã bạn bè nhưng fail → retry sau khi bạn bè
            log('Already friend but direct failed → retry once after 2s');
            await sleep(2000);
            try {
                await api.sendMessage({ msg: message }, uid, ThreadType.User);
                return { success: true, uid, via: 'direct_retry' };
            } catch (e) {
                return { success: false, uid, error: `Bạn bè nhưng không gửi được: ${e.message}` };
            }
        }

        if (status?.is_requesting) {
            log('Friend request already sent to', uid, '→ mark success (message was in FR)');
            return { success: true, uid, via: 'friend_request_pending' };
        }

        // ── Lần 3: Gửi lời mời kết bạn KÈM tin nhắn (bypass chặn người lạ) ──
        log('Sending friend request WITH message to', uid);
        try {
            await api.sendFriendRequest(message, uid);
            log('FR + message OK →', uid);
            return { success: true, uid, via: 'friend_request' };
        } catch (e2) {
            if (isRateLimit(e2.message)) {
                log('FR also rate limited, waiting 60s...');
                await sleep(60000);
                // Retry FR một lần nữa
                try {
                    await api.sendFriendRequest(message, uid);
                    return { success: true, uid, via: 'friend_request_retry' };
                } catch (e3) { }
            }
            log('sendFriendRequest failed:', e2.message);
            return { success: false, uid, error: `Direct: ${directError} | FR: ${e2.message}` };
        }

    } catch (err) {
        console.error('[smartSend] Error:', err.message);
        return { success: false, uid, error: err.message };
    }
}



// ══════════════════════════════════════════════════════
// 8. SAO CHÉP THÀNH VIÊN NHÓM — Phase 4 bypass tinh vi
//    Lấy members từ nhóm nguồn → thêm vào nhóm đích
// ══════════════════════════════════════════════════════

// ── Helper: lấy Set UID bạn bè hiện tại ──
async function getFriendSet(api) {
    try {
        const all = [];
        let page = 0;
        while (true) {
            const batch = await api.getAllFriends(200, page, 0);
            if (!batch?.length) break;
            batch.forEach(u => all.push(String(u.userId || u.uid || u.id)));
            if (batch.length < 200) break;
            page++;
            await sleep(300);
        }
        return new Set(all);
    } catch (e) {
        console.log('[getFriendSet] fallback empty set:', e.message);
        return new Set();
    }
}

// ── Hàm phê duyệt pending members — dùng API đúng: reviewPendingMemberRequest ──
async function approvePendingMembers(cookie, targetGroupId) {
    const log = (...a) => console.log('[approvePending]', ...a);
    try {
        const api = await getApi(cookie);
        const pending = await api.getPendingGroupMembers(targetGroupId);
        const users = pending?.users || [];
        log(`Pending members: ${users.length}`);
        if (users.length === 0) return { success: true, approved: 0, total: 0 };

        const pendingUids = users.map(u => String(u.uid));
        let approved = 0;
        let failed = 0;

        // Dùng reviewPendingMemberRequest — API chuyên biệt, HỖ TRỢ batch
        // Gửi batch 100 mỗi lần
        for (let i = 0; i < pendingUids.length; i += 100) {
            const batch = pendingUids.slice(i, i + 100);
            try {
                const res = await api.reviewPendingMemberRequest(
                    { members: batch, isApprove: true },
                    targetGroupId
                );
                // res = { [uid]: statusCode }
                // 0 = SUCCESS, 166 = no perm, 170 = not in pending, 178 = already in group
                for (const [uid, code] of Object.entries(res || {})) {
                    if (code === 0 || code === 178) { // 178 = đã trong nhóm rồi → cũng tính là ok
                        approved++;
                    } else {
                        failed++;
                        log(`approve uid=${uid} code=${code} (${code === 166 ? 'no_perm' : code === 170 ? 'not_in_pending' : 'unknown'})`);
                    }
                }
                log(`Batch approve: +${approved}/${batch.length}`);
            } catch (e) {
                log('reviewPendingMemberRequest batch err:', e.message);
                // Fallback từng người
                for (const uid of batch) {
                    try {
                        const r = await api.reviewPendingMemberRequest(
                            { members: uid, isApprove: true },
                            targetGroupId
                        );
                        const code = r?.[uid];
                        if (code === 0 || code === 178) approved++;
                        else failed++;
                    } catch (e2) { failed++; }
                    await sleep(400);
                }
            }
            if (i + 100 < pendingUids.length) await sleep(1500);
        }
        return { success: true, approved, failed, total: users.length };
    } catch (err) {
        console.error('[approvePending] Error:', err.message);
        return { success: false, error: err.message };
    }
}

// ══════════════════════════════════════════════════════════════════
// TRICK 1: "Temp Group Bridge" — Dành cho Admin nhóm đích + Người lạ
//
// Thuật toán: Zalo cho phép CREATOR thêm BẤT KỲ ai vào nhóm MỚI.
// Khai thác: tạo nhóm tạm với người lạ → họ có quan hệ nhóm với bạn
//            → addUserToGroup từ nhóm tạm sang nhóm đích thành công hơn
//            → disperseGroup nhóm tạm để dọn dẹp.
// ══════════════════════════════════════════════════════════════════
async function addStrangersViaTempGroup(api, strangerUids, targetGroupId, { delayMs = 2000, onProgress, log } = {}) {
    log = log || ((...a) => console.log('[tempGroupTrick]', ...a));
    const results = { added: 0, failed: 0, errors: [] };
    const BATCH = 100; // Zalo createGroup chấp nhận nhiều người
    let batch1Done = 0;

    // Chia người lạ thành chunks 100 — mỗi chunk tạo 1 nhóm tạm
    for (let i = 0; i < strangerUids.length; i += BATCH) {
        const chunk = strangerUids.slice(i, i + BATCH);
        let tempGroupId = null;
        log(`Batch ${Math.ceil(i / BATCH) + 1}: Tạo nhóm tạm với ${chunk.length} người lạ...`);

        try {
            // Bước 1: createGroup với người lạ (creator bypass — không cần là bạn bè)
            const cr = await api.createGroup({
                name: `_temp_${Date.now()}`,  // tên tạm, sẽ xóa sau
                members: chunk,
            });
            tempGroupId = cr?.groupId;
            if (!tempGroupId) throw new Error('createGroup không trả về groupId');

            const tempOk = new Set(cr?.sucessMembers || []);
            const tempFail = new Set(cr?.errorMembers || []);
            log(`  createGroup: +${tempOk.size} ok, ${tempFail.size} fail → gid=${tempGroupId}`);
            await sleep(1500); // chờ nhóm tạm ổn định

            // Bước 2: addUserToGroup từ nhóm tạm → nhóm đích
            // Giờ họ đã có "quan hệ nhóm" với bạn — success rate tăng
            if (tempOk.size > 0) {
                const uidsToMove = [...tempOk];
                try {
                    const ar = await api.addUserToGroup(uidsToMove, targetGroupId);
                    const errSet = new Set(ar?.errorMembers || []);
                    const ok = uidsToMove.length - errSet.size;
                    results.added += ok;
                    log(`  move to target: +${ok}/${uidsToMove.length} err=${errSet.size}`);

                    // Retry từng người failed
                    for (const uid of errSet) {
                        await sleep(600);
                        try {
                            const r2 = await api.addUserToGroup([uid], targetGroupId);
                            if (!r2?.errorMembers?.includes(uid)) { results.added++; }
                            else {
                                // Fallback: invite
                                const inv = await api.inviteUserToGroups(uid, [targetGroupId]);
                                if (inv?.grid_message_map?.[targetGroupId]?.error_code === 0) results.added++;
                                else { results.failed++; results.errors.push(uid); }
                            }
                        } catch (e2) { results.failed++; results.errors.push(uid); }
                    }
                } catch (e) {
                    log('  move batch err:', e.message);
                    results.failed += tempOk.size;
                }
            }

            // Lỗi ngay từ createGroup → dùng inviteUserToGroups
            for (const uid of tempFail) {
                try {
                    const inv = await api.inviteUserToGroups(uid, [targetGroupId]);
                    if (inv?.grid_message_map?.[targetGroupId]?.error_code === 0) results.added++;
                    else { results.failed++; results.errors.push(uid); }
                } catch (e) { results.failed++; results.errors.push(uid); }
                await sleep(400);
            }

        } catch (e) {
            log(`createGroup chunk err:`, e.message);
            // Fallback: invite tất cả trong chunk
            for (const uid of chunk) {
                try {
                    const inv = await api.inviteUserToGroups(uid, [targetGroupId]);
                    if (inv?.grid_message_map?.[targetGroupId]?.error_code === 0) results.added++;
                    else results.failed++;
                } catch (e2) { results.failed++; }
                await sleep(400);
            }
        } finally {
            // Bước 3: Xóa nhóm tạm (dọn dẹp quan trọng!)
            if (tempGroupId) {
                try {
                    await sleep(1000);
                    await api.disperseGroup(tempGroupId);
                    log(`  disperseGroup ${tempGroupId} ✓ (dọn sạch)`);
                } catch (e) { log(`  disperseGroup fail (không quan trọng):`, e.message); }
            }
        }

        batch1Done += chunk.length;
        if (onProgress) onProgress(batch1Done, strangerUids.length);
        if (i + BATCH < strangerUids.length) await sleep(delayMs);
    }
    return results;
}

// ══════════════════════════════════════════════════════════════════
// TRICK 2: "Invite Link Engine" — Khi không phải admin nhóm đích
//
// Thuật toán: Nếu bạn có quyền tạo invite link (member thường cũng có):
// 1. enableGroupLink(targetGroupId) → lấy link join
// 2. sendMessage(uid, link) → người lạ nhận được link
// 3. Họ click link → joinGroupLink → join nhóm KHÔNG CẦN approval
//    (link join bypass joinAppr nếu link không require approval riêng)
//
// Hạn chế: họ phải tự bấm — không 100% tự động
// Nhưng đây là CÁCH DUY NHẤT hợp lệ khi không phải admin
// ══════════════════════════════════════════════════════════════════
async function getOrEnableGroupLink(api, groupId) {
    try {
        const linkInfo = await api.enableGroupLink(groupId);
        return linkInfo?.link || null;
    } catch (e) {
        // Thử getGroupLinkDetail nếu link đã tồn tại
        try {
            const det = await api.getGroupLinkDetail(groupId);
            return det?.link || null;
        } catch (e2) { return null; }
    }
}

// ══════════════════════════════════════════════════════════════════
// GIẢI PHÁP DUY NHẤT KHI KHÔNG CÓ ADMIN: Invite Link Bypass
//
// Insight: joinGroupLink (join qua link) BYPASS joinAppr hoàn toàn!
// Ngay cả khi nhóm bật "yêu cầu phê duyệt", join bằng link vẫn vào
// thẳng nhóm mà KHÔNG cần admin duyệt.
//
// Chiến lược 3-kênh song song:
//   Kênh 1: sendLink (DM) → link + tin nhắn mời
//   Kênh 2: inviteUserToGroups → push notification mời vào nhóm
//   Kênh 3: sendMessage (DM) → tin nhắn thường nhắc join
//
// Lưu ý: Yêu cầu member PHẢI TỰ BẤM — không 100% tự động
//        nhưng là cách DUY NHẤT và PHÁP LÝ khi không có admin
// ══════════════════════════════════════════════════════════════════
async function forceJoinViaLink(cookie, targetGroupId, memberUids, options = {}) {
    const log = (...a) => console.log('[forceJoinViaLink]', ...a);
    const {
        customMsg = null,    // Tin nhắn tùy chỉnh (null = dùng mặc định)
        delayMs = 1500,     // Delay giữa mỗi người (anti-spam)
        onProgress = null,
    } = options;

    try {
        const api = await getApi(cookie);

        // Bước 1: Lấy hoặc tạo invite link của nhóm
        log(`Step 1: enableGroupLink cho nhóm ${targetGroupId}`);
        let groupLink = null;
        try {
            // Thử getGroupLinkDetail trước — nếu link đã tồn tại
            const det = await api.getGroupLinkDetail(targetGroupId);
            if (det?.enabled === 1 && det?.link) {
                groupLink = det.link;
                log(`  Link đã tồn tại: ${groupLink}`);
            }
        } catch (e) { /* chưa có link */ }

        if (!groupLink) {
            // Tạo mới invite link
            const linkRes = await api.enableGroupLink(targetGroupId);
            groupLink = linkRes?.link;
            log(`  Link mới: ${groupLink}`);
        }

        if (!groupLink) {
            return { success: false, error: 'Không lấy được invite link (không đủ quyền?)' };
        }

        // Bước 2: Lấy tên nhóm để tạo tin nhắn mời hấp dẫn
        let groupName = 'nhóm của chúng tôi';
        try {
            const gi = await api.getGroupInfo(targetGroupId);
            groupName = gi?.gridInfoMap?.[targetGroupId]?.name || groupName;
        } catch (e) { }

        const inviteMsg = customMsg ||
            `🎉 Bạn được mời tham gia nhóm "${groupName}"!\n` +
            `👆 Click link sau để join ngay (không cần phê duyệt):\n${groupLink}`;

        log(`Step 2: Gửi link đến ${memberUids.length} thành viên...`);

        // Bước 3: Gửi theo 3 kênh song song cho mỗi UID
        const results = { sent: 0, failed: 0, link: groupLink, errors: [] };

        for (let i = 0; i < memberUids.length; i++) {
            const uid = memberUids[i];
            let sent = false;

            // Kênh 1: inviteUserToGroups — gửi push notification invite
            try {
                const inv = await api.inviteUserToGroups(uid, [targetGroupId]);
                const code = inv?.grid_message_map?.[targetGroupId]?.error_code;
                if (code === 0) {
                    sent = true;
                    log(`  [${i + 1}/${memberUids.length}] invite OK: ${uid}`);
                }
            } catch (e) { log(`  invite err ${uid}:`, e.message); }

            // Kênh 2: sendLink — gửi DM với link join (ThreadType.User = 0)
            try {
                await api.sendLink(
                    { msg: inviteMsg, link: groupLink },
                    uid,
                    0  // ThreadType.User = DM
                );
                sent = true;
                log(`  [${i + 1}/${memberUids.length}] sendLink OK: ${uid}`);
            } catch (e) {
                // Fallback: sendMessage thường
                try {
                    await api.sendMessage(
                        { msg: inviteMsg },
                        uid,
                        0  // ThreadType.User = DM
                    );
                    sent = true;
                } catch (e2) { log(`  sendMsg err ${uid}:`, e2.message); }
            }

            if (sent) results.sent++;
            else { results.failed++; results.errors.push(uid); }

            if (onProgress) onProgress(i + 1, memberUids.length);

            // Anti-spam delay giữa mỗi người
            if (i < memberUids.length - 1) await sleep(delayMs);
        }

        log(`DONE: sent=${results.sent} fail=${results.failed} | link=${groupLink}`);
        return { success: true, ...results };

    } catch (err) {
        console.error('[forceJoinViaLink] Fatal:', err.message);
        return { success: false, error: err.message };
    }
}

async function copyGroupMembers(cookie, sourceGroupId, targetGroupId, options = {}) {
    const log = (...a) => console.log('[copyGroupMembers]', ...a);
    const {
        onProgress,
        batchSize = 100,       // ← Batch 100 người/lần (chính sách Zalo cho phép)
        delayMs = 3000,      // Delay giữa batch chính (anti-ban)
        retryDelay = 5000,      // Delay trước khi retry từng người lỗi
        createNewGroup = false,
        newGroupName = '',
    } = options;

    // ── Helper: retry một UID đơn lẻ với 4 cấp ──
    // ══════════════════════════════════════════════════════════════════
    // 5-LAYER FORCE ADD — Hoàn toàn tự động (target KHÔNG cần click gì!)
    //
    //  L1: addUserToGroup trực tiếp (admin force → silent add, 0 click)
    //  L2: Retry sau backoff (rate limit recovery, 0 click)
    //  L3: createGroup TEMP BRIDGE (creator privilege bypass privacy!)
    //      → tạo nhóm tạm với stranger → họ bị force vào nhóm tạm
    //      → addUserToGroup từ nhóm tạm sang nhóm đích (0 click)
    //      → disperseGroup nhóm tạm (dọn sạch)
    //  L4: Retry addUserToGroup sau Temp Bridge (0 click)
    //  L5: addUserToGroup delay dài final attempt (0 click)
    //
    // QUAN TRỌNG: Zalo có thể block L3 nếu user bật privacy "block group add"
    //             Không có API nào vượt qua được server-side privacy enforcement
    // ══════════════════════════════════════════════════════════════════
    const tryAddOne = async (api, uid, gid) => {
        // ── Layer 1: Direct admin force add (0 click từ target) ──
        try {
            const r = await api.addUserToGroup([uid], gid);
            if (!r?.errorMembers?.includes(uid)) return { uid, ok: true, via: 'L1_admin_add' };
        } catch (e) {
            if (isRateLimit(e.message)) {
                log(`  L1 rate-limit → backoff 15s`);
                await sleep(15000);
            }
        }

        // ── Layer 2: Retry sau backoff ngắn (0 click) ──
        await sleep(retryDelay);
        try {
            const r2 = await api.addUserToGroup([uid], gid);
            if (!r2?.errorMembers?.includes(uid)) return { uid, ok: true, via: 'L2_add_retry' };
        } catch (e) {
            if (isRateLimit(e.message)) await sleep(20000);
        }

        // ── Layer 3: TEMP GROUP BRIDGE — Khai thác creator privilege ──
        // Zalo creator có thể force-add BẤT KỲ ai vào nhóm MỚI (bypass privacy!)
        // Sau khi stranger vào nhóm tạm → có "quan hệ nhóm" → addUserToGroup sang đích
        let tempCreated = null;
        try {
            log(`  L3 TempBridge: createGroup for uid=${uid}`);
            const cr = await api.createGroup({
                name: `_t_${Date.now()}`,   // tên tạm, xóa ngay sau
                members: [uid],
            });
            tempCreated = cr?.groupId;
            const tempOk = !cr?.errorMembers?.includes(uid);

            if (tempCreated && tempOk) {
                log(`    tempGroup=${tempCreated} → stranger vào ✓`);
                await sleep(1200); // chờ nhóm tạm ổn định

                // Force add sang nhóm đích (giờ đã có group relationship)
                const r3 = await api.addUserToGroup([uid], gid);
                if (!r3?.errorMembers?.includes(uid)) {
                    log(`    L3 bridge success uid=${uid}`);
                    return { uid, ok: true, via: 'L3_temp_bridge' };
                }
                // Bridge vào nhóm tạm ok nhưng move sang đích thất bại
                // → thử lại sau delay
                await sleep(2000);
                const r3b = await api.addUserToGroup([uid], gid);
                if (!r3b?.errorMembers?.includes(uid)) {
                    return { uid, ok: true, via: 'L3_bridge_retry' };
                }
            } else {
                log(`    L3 createGroup rejected uid=${uid} (privacy blocked)`);
            }
        } catch (e) {
            log(`  L3 TempBridge err ${uid}:`, e.message);
            if (isRateLimit(e.message)) await sleep(25000);
        } finally {
            // LUÔN xóa nhóm tạm dù có lỗi hay không
            if (tempCreated) {
                try {
                    await sleep(500);
                    await api.disperseGroup(tempCreated);
                    log(`    disperseGroup ${tempCreated} ✓`);
                } catch (e2) { /* không quan trọng */ }
            }
        }

        // ── Layer 4: Retry sau Temp Bridge với delay dài hơn (0 click) ──
        await sleep(retryDelay * 2);
        try {
            const r4 = await api.addUserToGroup([uid], gid);
            if (!r4?.errorMembers?.includes(uid)) return { uid, ok: true, via: 'L4_post_bridge_retry' };
        } catch (e) { }

        // ── Layer 5: Final force attempt sau long delay (0 click) ──
        await sleep(retryDelay * 3);
        try {
            const r5 = await api.addUserToGroup([uid], gid);
            if (!r5?.errorMembers?.includes(uid)) return { uid, ok: true, via: 'L5_final' };
        } catch (e) { }

        // Thực sự chặn hoàn toàn (privacy server-side enforcement)
        return { uid, ok: false, via: 'privacy_blocked_server' };
    };


    try {
        const api = await getApi(cookie);
        const ownUid = String(api.getOwnId() || '');

        // ── Lấy toàn bộ UID từ nhóm nguồn ──
        log('Fetching source group members:', sourceGroupId);
        const srcResult = await getGroupMembers(cookie, sourceGroupId);
        if (!srcResult.success || !srcResult.members?.length) {
            return { success: false, error: 'Không lấy được thành viên nhóm nguồn: ' + (srcResult.error || 'unknown') };
        }

        const allUids = srcResult.members
            .map(m => String(m.uid))
            .filter(uid => uid && uid !== ownUid && uid !== '0');
        log(`Source: ${allUids.length} UIDs`);

        // ── Lấy members hiện tại của nhóm đích để bỏ qua duplicate ──
        let existingUids = new Set();
        if (!createNewGroup && targetGroupId) {
            try {
                const tgtRes = await api.getGroupInfo(targetGroupId);
                const tg = tgtRes?.gridInfoMap?.[targetGroupId];
                const exist = tg?.memberIds || tg?.currentMems?.map(m => m.id) || [];
                exist.forEach(uid => existingUids.add(String(uid)));
                log(`Target existing: ${existingUids.size}`);
            } catch (e) { log('getGroupInfo target failed, will add all:', e.message); }
        }

        const toAdd = allUids.filter(uid => !existingUids.has(uid));
        log(`To add: ${toAdd.length} (skip ${allUids.length - toAdd.length} existing)`);
        if (toAdd.length === 0)
            return { success: true, added: 0, failed: 0, total: 0, msg: 'Tất cả đã có trong nhóm đích!' };

        const results = { added: 0, failed: 0, errors: [], details: [] };
        let createdGroupId = null;
        let activeGid = targetGroupId;

        // ── PRE-ANALYSIS: Phân loại bạn bè vs người lạ (friends first!) ──
        // Bạn bè → addUserToGroup thành công gần 100%
        // Người lạ → cần inviteUserToGroups hoặc link
        let friendUids = new Set();
        try {
            friendUids = await getFriendSet(api);
            const friendCount = toAdd.filter(u => friendUids.has(u)).length;
            log(`Pre-analysis: ${friendCount} friends / ${toAdd.length - friendCount} non-friends`);
            // Ưu tiên bạn bè lên đầu trong toAdd
            if (friendCount > 0 && friendCount < toAdd.length) {
                toAdd.sort((a, b) => {
                    const aF = friendUids.has(a) ? 0 : 1;
                    const bF = friendUids.has(b) ? 0 : 1;
                    return aF - bF;
                });
                log('Sorted: friends first → higher success rate');
            }
        } catch (e) { log('getFriendSet skip:', e.message); }

        // ── PHASE 0 (bypass pending): Tạm tắt yêu cầu phê duyệt ──
        // Chỉ áp dụng khi thêm vào nhóm có sẵn và user là admin nhóm đó
        let joinApprWasOn = false;
        if (!createNewGroup && activeGid) {
            try {
                const gi = await api.getGroupInfo(activeGid);
                const setting = gi?.gridInfoMap?.[activeGid]?.setting;
                // joinAppr = 1 có nghĩa đang BẬT yêu cầu duyệt
                if (setting?.joinAppr === 1) {
                    joinApprWasOn = true;
                    await api.updateGroupSettings({ joinAppr: false }, activeGid);
                    log('Phase 0: Đã TẮT joinAppr (bypass pending approval)');
                    await sleep(1000); // Đợi setting apply
                }
            } catch (e) {
                log('Phase 0: Không tắt được joinAppr (không phải admin?):', e.message);
                // Tiếp tục bình thường — sẽ handle pending sau
            }
        }

        // ══════════════ CHẾ ĐỘ TẠO NHÓM MỚI ══════════════
        if (createNewGroup) {
            const gname = newGroupName || `Sao chép ${srcResult.groupName || ''} ${new Date().toLocaleDateString('vi-VN')}`;
            log('createGroup mode:', gname, `| ${toAdd.length} members`);

            // Batch đầu tiên: tạo nhóm (Zalo createGroup chứa được nhiều người)
            const firstBatch = toAdd.slice(0, batchSize);
            try {
                const cr = await api.createGroup({ name: gname, members: firstBatch });
                createdGroupId = cr?.groupId;
                activeGid = createdGroupId;
                const succUids = new Set(cr?.sucessMembers || []);
                const failUids = new Set(cr?.errorMembers || []);
                results.added += succUids.size;
                log(`createGroup OK gid=${createdGroupId} +${succUids.size}/${firstBatch.length} fail=${failUids.size}`);

                // Retry các UID lỗi ngay từ createGroup
                for (const uid of failUids) {
                    await sleep(1000);
                    const r = await tryAddOne(api, uid, activeGid);
                    if (r.ok) results.added++; else { results.failed++; results.errors.push(uid); }
                    log(`  retry ${uid}: ${r.via}`);
                }
            } catch (e) {
                log('createGroup failed:', e.message);
                return { success: false, error: 'createGroup: ' + e.message };
            }

            if (onProgress) onProgress(Math.min(batchSize, toAdd.length), toAdd.length);

            // Các batch tiếp theo thêm vào nhóm mới tạo
            for (let i = batchSize; i < toAdd.length; i += batchSize) {
                const batch = toAdd.slice(i, i + batchSize);
                log(`addBatch ${Math.ceil(i / batchSize) + 1}: ${batch.length} UIDs → gid=${activeGid}`);
                await sleep(delayMs);

                let batchOk = 0;
                try {
                    const ar = await api.addUserToGroup(batch, activeGid);
                    const errSet = new Set(ar?.errorMembers || []);
                    batchOk = batch.length - errSet.size;
                    results.added += batchOk;
                    log(`  batch OK +${batchOk}/${batch.length}`);

                    // Retry từng UID lỗi qua 4-tier cascade
                    for (const uid of errSet) {
                        await sleep(800);
                        const r = await tryAddOne(api, uid, activeGid);
                        if (r.ok) { results.added++; batchOk++; }
                        else { results.failed++; results.errors.push(uid); }
                        log(`  retry ${uid}: ${r.via}`);
                    }
                } catch (e) {
                    // Rate limit toàn batch → backoff 30s rồi retry
                    if (isRateLimit(e.message)) {
                        log('Rate limit on batch! Backoff 30s...');
                        await sleep(30000);
                        i -= batchSize; continue; // redo this batch
                    }
                    log('batch error:', e.message);
                    results.failed += batch.length;
                }
                if (onProgress) onProgress(Math.min(i + batchSize, toAdd.length), toAdd.length);
            }

            log(`DONE createNew: +${results.added} fail=${results.failed}/${toAdd.length}`);
            return {
                success: true, total: toAdd.length, ...results,
                createdGroupId, groupName: gname, sourceGroupName: srcResult.groupName,
            };
        }

        // ══════════════ CHẾ ĐỘ THÊM VÀO NHÓM CÓ SẴN ══════════════
        log(`addToExisting mode | gid=${activeGid} | ${toAdd.length} UIDs | batch=${batchSize}`);

        for (let i = 0; i < toAdd.length; i += batchSize) {
            const batch = toAdd.slice(i, i + batchSize);
            const batchNo = Math.ceil(i / batchSize) + 1;
            log(`── Batch ${batchNo}: ${batch.length} UIDs`);

            let batchOk = 0;
            let rateLimited = false;
            try {
                const ar = await api.addUserToGroup(batch, activeGid);
                const errSet = new Set(ar?.errorMembers || []);
                batchOk = batch.length - errSet.size;
                results.added += batchOk;
                log(`  Batch ${batchNo} direct: +${batchOk}/${batch.length} err=${errSet.size}`);

                // Per-user 4-tier retry cho từng UID lỗi
                for (const uid of errSet) {
                    await sleep(800);
                    const r = await tryAddOne(api, uid, activeGid);
                    if (r.ok) { results.added++; batchOk++; }
                    else { results.failed++; results.errors.push(uid); }
                    log(`  retry ${uid}: ${r.via}`);
                }
            } catch (e) {
                if (isRateLimit(e.message)) {
                    log(`Batch ${batchNo} rate-limited → backoff 30s, redo`);
                    await sleep(30000);
                    i -= batchSize; // retry same batch
                    continue;
                }
                log(`Batch ${batchNo} exception:`, e.message);
                // Fallback: try per-user on entire batch
                for (const uid of batch) {
                    await sleep(500);
                    const r = await tryAddOne(api, uid, activeGid);
                    if (r.ok) results.added++; else { results.failed++; results.errors.push(uid); }
                }
            }

            if (onProgress) onProgress(Math.min(i + batchSize, toAdd.length), toAdd.length);

            // Delay giữa batch (ngoại trừ batch cuối)
            if (i + batchSize < toAdd.length) await sleep(delayMs);
        }

        log(`FINAL batch loop: +${results.added} fail=${results.failed}/${toAdd.length}`);

        // ── TRICK 1A: Temp Group Bridge cho người lạ vẫn fail sau retry ──
        // Collect failed UIDs là người lạ (không có trong friendUids)
        const failedStrangers = results.errors.filter(uid => !friendUids.has(uid));
        if (failedStrangers.length > 0 && activeGid) {
            log(`TRICK 1A: ${failedStrangers.length} failed strangers → Temp Group Bridge`);
            try {
                const tgRes = await addStrangersViaTempGroup(
                    api, failedStrangers, activeGid,
                    { delayMs, onProgress, log }
                );
                // Xóa khỏi errors những uid đã được bridge xử lý
                results.added += tgRes.added;
                results.failed += tgRes.failed - failedStrangers.length; // adjust: những failed trước nay ok
                results.errors = results.errors.filter(u => tgRes.errors.includes(u));
                log(`TRICK 1A result: +${tgRes.added} still fail=${tgRes.failed}`);
            } catch (e) { log('TRICK 1A err:', e.message); }
        }

        // ── TRICK 2: Invite Link fallback (cho non-admin và người lạ vẫn chưa thêm được) ──
        const totalFailed = results.failed;
        if (totalFailed > 0 || !joinApprWasOn) {
            // Thử lấy group invite link để log ra (admin có thể share cho người lạ tự join)
            try {
                const link = await getOrEnableGroupLink(api, activeGid);
                if (link) {
                    log(`TRICK 2: Group invite link = ${link}`);
                    log(`  → Share link này cho ${totalFailed} người lạ để họ tự join bypass approval`);
                    results.inviteLink = link; // trả về để UI hiển thị
                }
            } catch (e) { log('TRICK 2 getGroupLink err:', e.message); }
        }

        log(`FINAL: +${results.added} fail=${results.failed}/${toAdd.length}`);

        // ── PHASE 3: Auto-approve members còn bị pending dùng đúng API: reviewPendingMemberRequest ──
        if (!createNewGroup && activeGid) {
            try {
                const pend = await api.getPendingGroupMembers(activeGid);
                const pendUsers = pend?.users || [];
                if (pendUsers.length > 0) {
                    log(`Phase 3: ${pendUsers.length} pending → reviewPendingMemberRequest`);
                    const pendUids = pendUsers.map(u => String(u.uid));
                    for (let i = 0; i < pendUids.length; i += 100) {
                        const batch = pendUids.slice(i, i + 100);
                        try {
                            const res = await api.reviewPendingMemberRequest(
                                { members: batch, isApprove: true },
                                activeGid
                            );
                            let ok = 0;
                            for (const [uid, code] of Object.entries(res || {})) {
                                if (code === 0 || code === 178) { results.added++; ok++; }
                                else log(`  pending uid=${uid} code=${code}`);
                            }
                            log(`Phase 3 approved +${ok}/${batch.length}`);
                        } catch (e) {
                            log('Phase 3 err:', e.message);
                            // Fallback từng người
                            for (const uid of batch) {
                                try {
                                    const r = await api.reviewPendingMemberRequest(
                                        { members: uid, isApprove: true }, activeGid
                                    );
                                    if (r?.[uid] === 0 || r?.[uid] === 178) results.added++;
                                } catch (e2) { }
                                await sleep(300);
                            }
                        }
                        if (i + 100 < pendUids.length) await sleep(1200);
                    }
                } else {
                    log('Phase 3: Không có pending members ✔');
                }
            } catch (e) { log('Phase 3 getPendingGroupMembers err:', e.message); }
        }

        // ── PHASE 4: Khôi phục joinAppr settings ──
        if (joinApprWasOn && activeGid) {
            try {
                await sleep(1000);
                await api.updateGroupSettings({ joinAppr: true }, activeGid);
                log('Phase 4: Đã bật lại joinAppr (restore settings)');
            } catch (e) { log('Phase 4 restore err (không ảnh hưởng kết quả):', e.message); }
        }

        return {
            success: true,
            total: toAdd.length,
            ...results,
            sourceGroupName: srcResult.groupName,
        };


    } catch (err) {
        console.error('[copyGroupMembers] Fatal:', err.stack || err.message);
        return { success: false, error: err.message };
    }
}





// ══════════════════════════════════════════════════════════════════
//  HYDRA — Thuật toán 7 lớp tối thượng
//  Mục tiêu: 100% thành viên từ nhóm nguồn sang nhóm đích
//
//  CỐT LÕI INSIGHT về ZCA-JS / Zalo server:
//  ┌─────────────────────────────────────────────────────────────┐
//  │  "block group add" chỉ block addUserToGroup vào NHÓM CŨ.   │
//  │  NHƯNG: createGroup(members=[stranger_uid]) là CREATOR      │
//  │  PRIVILEGE → Zalo server cho phép thêm BẤT KỲ UID nào      │
//  │  vào nhóm MỚI vừa tạo (không bị chặn privacy).             │
//  │                                                             │
//  │  SAU KHI stranger vào temp group → họ có "group bond"       │
//  │  với account của bạn → addUserToGroup sang group đích       │
//  │  có success rate CAO HƠN NHIỀU.                             │
//  │                                                             │
//  │  Nếu vẫn fail → inviteUserToGroups gửi PUSH NOTIFICATION    │
//  │  vào app Zalo của họ → 1-tap để join.                       │
//  │                                                             │
//  │  Cuối cùng: sendFriendRequest(linkMsg) → link DM qua kênh  │
//  │  lời mời kết bạn — bypass hoàn toàn "block DM strangers".  │
//  └─────────────────────────────────────────────────────────────┘
//
//  LAYER 1 : Tắt joinAppr + batch addUserToGroup (ai không privacy)
//  LAYER 2 : createGroup TEMP BRIDGE → move to target (0 click)
//  LAYER 3 : CASCADE BRIDGE — tạo temp group từ context shared temp (0 click)
//  LAYER 4 : inviteUserToGroups push notification (1-tap trong app)
//  LAYER 5 : sendFriendRequest + link mời (bypass block DM + bypass block group)
//  LAYER 6 : Multi-wave retry daemon (kiểm tra ai đã join thực tế → retry còn lại)
//  LAYER 7 : Auto re-approve pending mỗi wave + restore settings
// ══════════════════════════════════════════════════════════════════

async function copyGroupMembersHydra(cookie, sourceGroupId, targetGroupId, options = {}) {
    const log = (...a) => {
        const msg = `[HYDRA] ${a.join(' ')}`;
        console.log(msg);
        if (options.onLog) options.onLog(msg);
    };

    const {
        onProgress = null,
        batchSize = 80,
        delayMs = 2000,
        maxWaves = 3,          // số vòng retry tối đa (wave 1, 2, 3)
        waveDelay = 30000,     // delay giữa các wave (30s)
        createNewGroup = false,
        newGroupName = '',
    } = options;

    // ── Gaussian jitter: delay ngẫu nhiên giống hành vi người thật ──
    const jitter = (base) => base + Math.floor((Math.random() - 0.5) * base * 0.4);

    // ── Create variant messages: chèn zero-width chars để mỗi tin khác nhau ──
    const zwChars = ['\u200b', '\u200c', '\u200d', '\u2060'];
    function variantMsg(base) {
        const zw = zwChars[Math.floor(Math.random() * zwChars.length)];
        const pos = Math.floor(base.length / 2);
        return base.slice(0, pos) + zw + base.slice(pos);
    }

    // ── Kiểm tra ai ĐÃ trong nhóm đích (real-time check) ──
    async function getMemberSetOf(api, gid) {
        try {
            const info = await api.getGroupInfo(gid);
            const g = info?.gridInfoMap?.[gid] || info?.gridInfoMap?.[String(gid)];
            const mems = g?.memberIds || g?.currentMems?.map(m => m.id) || [];
            const pend = await api.getPendingGroupMembers(gid).catch(() => ({ users: [] }));
            const pendUids = (pend?.users || []).map(u => String(u.uid));
            return { members: new Set(mems.map(String)), pending: new Set(pendUids) };
        } catch (e) {
            log('getMemberSetOf err:', e.message);
            return { members: new Set(), pending: new Set() };
        }
    }

    // ── Auto-approve hàng loạt tất cả pending ──
    async function autoApprovePending(api, gid) {
        try {
            // Bước 1: lấy danh sách pending
            let rawResp = null;
            try {
                rawResp = await api.getPendingGroupMembers(gid);
            } catch (e1) {
                log(`AutoApprove: getPendingGroupMembers err: ${e1.message}`);
                return 0;
            }

            // DEBUG: in toàn bộ response để biết cấu trúc thực
            log(`AutoApprove DEBUG raw: ${JSON.stringify(rawResp)?.slice(0, 300)}`);

            // Probe tất cả các field có thể chứa users
            let rawUsers =
                rawResp?.users ||
                rawResp?.pendings ||
                rawResp?.data?.users ||
                rawResp?.data?.pendings ||
                rawResp?.memberRequests ||
                rawResp?.data?.memberRequests ||
                (Array.isArray(rawResp) ? rawResp : null) ||
                [];

            log(`AutoApprove: rawUsers count=${rawUsers.length}`);

            if (rawUsers.length === 0) {
                log(`AutoApprove: không có pending members (rawResp keys=${Object.keys(rawResp || {}).join(',')})`);
                return 0;
            }

            // Trích xuất UID
            const uids = rawUsers
                .map(u => (typeof u === 'string' || typeof u === 'number')
                    ? String(u) : String(u?.uid || u?.id || u?.userId || u?.memberId || ''))
                .filter(u => u && u !== '0' && /^\d+$/.test(u));

            log(`AutoApprove: ${uids.length} UIDs cần duyệt: [${uids.slice(0, 5).join(',')}${uids.length > 5 ? '...' : ''}]`);

            if (uids.length === 0) {
                log(`AutoApprove: không parse được UID từ rawUsers[0]=${JSON.stringify(rawUsers[0])}`);
                return 0;
            }

            // Bước 2: duyệt từng batch
            let approved = 0;
            for (let i = 0; i < uids.length; i += 20) {
                const batch = uids.slice(i, i + 20);
                try {
                    const res = await api.reviewPendingMemberRequest(
                        { members: batch, isApprove: true }, gid
                    );

                    log(`AutoApprove batch[${i}]: res=${JSON.stringify(res)?.slice(0, 200)}`);

                    // Parse response: có thể là array of codes hoặc object uid→code
                    if (Array.isArray(res)) {
                        for (const code of res) {
                            if (code === 0 || code === 178 || code === null) approved++;
                        }
                    } else if (res && typeof res === 'object') {
                        for (const [, code] of Object.entries(res)) {
                            if (code === 0 || code === 178 || code === null) approved++;
                        }
                    } else {
                        // Nếu API không throw → coi như thành công
                        approved += batch.length;
                    }
                } catch (batchErr) {
                    log(`AutoApprove batch err: ${batchErr.message} → retry 1 by 1`);
                    for (const uid of batch) {
                        try {
                            await api.reviewPendingMemberRequest(
                                { members: [uid], isApprove: true }, gid
                            );
                            approved++;
                        } catch (e2) {
                            log(`AutoApprove uid=${uid} err: ${e2.message}`);
                        }
                        await sleep(300);
                    }
                }
                if (i + 20 < uids.length) await sleep(500);
            }

            if (approved > 0) log(`AutoApprove: ✅ +${approved} đã được duyệt`);
            else log(`AutoApprove: 0 duyệt thành công (check log trên)`);
            return approved;
        } catch (e) {
            log(`AutoApprove fatal: ${e.message}`);
            return 0;
        }
    }


    // ══════════════════════════════════════════════════════════════════
    //  RAW BYPASS HELPERS — thao t\u00e1c tr\u1ef1c ti\u1ebfp v\u1edbi Zalo API params
    //  Zalo c\u00f3 3 l\u1edbi bypass t\u1ea1i server layer:
    //  1. membersTypes: -1 = stranger, 0 = phone contact, 1 = friend
    //     → n\u1ebfu server ch\u1ec9 check membersTypes thay v\u00ec DB relationship → 0 s\u1ebd qua
    //  2. /v1 endpoint: version c\u0169, validation y\u1ebfu h\u01a1n /v2
    //  3. zsource k\u00e1c nhau: 601 = mobile, 714 = web — c\u00f3 th\u1ec3 bypass tr\u00ean web path
    // ══════════════════════════════════════════════════════════════════

    async function rawCreateGroupNoFriend(api, uids, groupName) {
        // Raw bypass: simple không hoạt động vì cần AES key từ zca-js internal context
        // Zalo encrypt bằng session key — không thể tạo manually từ bên ngoài
        // Hàm này để placeholder, return null để skip gracefully
        log(`  [RAW-createGroup] skipped (cannot bypass AES encryption externally)`);
        return null;
    }

    async function rawAddToGroup(api, uids, groupId) {
        // Tương tự rawCreateGroupNoFriend — không thể bypass auth externally
        log(`  [RAW-addToGroup] skipped (route through standard api instead)`);
        return null;
    }

    // ──────────────────────────────────────────────────────────────
    // HYDRA CORE v2: Permanent Bridge Group
    // bridgeGid = nhóm cầu nối cố định (tạo với friend anchor), dùng lại cho mọi stranger
    //
    // L1: Direct addUserToGroup
    // L2: Bridge Add — addUserToGroup([uid], bridgeGid) và người vào bridge (creator privilege)
    //     → ngay sau: addUserToGroup([uid], targetGid) trong "bond window"
    // L3: Batch bridge — sau L2, batch move tất cả ai vào bridge → target cùng lúc
    // L4: Push notification invite (1-tap)
    // L5: sendFriendRequest + link
    // ──────────────────────────────────────────────────────────────
    async function hydraAddOne(api, uid, gid, groupLink, groupName, bridgeGid) {

        // ── LAYER 1: Direct addUserToGroup ──
        try {
            const r = await api.addUserToGroup([uid], gid);
            if (!r?.errorMembers?.includes(uid)) {
                log(`  [L1-OK] ${uid} → direct add`);
                return { uid, ok: true, via: 'L1_direct' };
            }
        } catch (e) {
            if (isRateLimit(e.message)) { log(`  [L1] rate-limit → backoff 15s`); await sleep(15000); }
        }

        // ── LAYER 1b: Không dùng rawAddToGroup (broken — không bypass được) ──
        // inviteUserToGroups là vector tốt hơn sau joinAppr=ON

        // ── LAYER 2: PERMANENT BRIDGE GROUP (thay thế TempBridge cũ) ──
        // bridgeGid được tạo 1 lần ở MAIN FLOW với friend anchor
        // Zalo cho phép creator add BẤT KỲ ai vào nhóm mình đã tạo
        if (bridgeGid) {
            try {
                log(`  [L2] BridgeGroup add: uid=${uid} → bridgeGid=${bridgeGid}`);
                const rb = await api.addUserToGroup([uid], bridgeGid);
                const inBridge = !rb?.errorMembers?.includes(uid);

                if (inBridge) {
                    log(`  [L2] ✓ uid=${uid} vào bridge → move to target within 600ms`);
                    await sleep(600);
                    const rt = await api.addUserToGroup([uid], gid);
                    if (!rt?.errorMembers?.includes(uid)) {
                        log(`  [L2-OK] ${uid} via BridgeGroup`);
                        // Kick khỏi bridge để giữ sạch (tuỳ chọn — có thể bỏ qua)
                        api.removeUserFromGroup([uid], bridgeGid).catch(() => { });
                        return { uid, ok: true, via: 'L2_bridge_group' };
                    }

                    // Vẫn fail → thử cascade invite từ bridge context
                    log(`  [L3] CASCADE: invite từ bridge bond context`);
                    await sleep(jitter(800));
                    const r3 = await api.addUserToGroup([uid], gid);
                    if (!r3?.errorMembers?.includes(uid)) {
                        api.removeUserFromGroup([uid], bridgeGid).catch(() => { });
                        log(`  [L3-OK] ${uid} via bridge-cascade-retry`);
                        return { uid, ok: true, via: 'L3_bridge_cascade' };
                    }
                    // Invite (1-tap) từ bridge context — higher trust — trước khi kick khỏi bridge
                    const inv3 = await api.inviteUserToGroups(uid, [gid]);
                    const mm3 = inv3?.grid_message_map;
                    const code3 = mm3?.[gid]?.error_code ?? mm3?.[String(gid)]?.error_code;
                    api.removeUserFromGroup([uid], bridgeGid).catch(() => { });
                    if (code3 === 0) {
                        log(`  [L3] invite from bridge bond sent (code=0)`);
                        return { uid, ok: false, via: 'L3_bridge_invite_pending', invited: true };
                    }
                } else {
                    log(`  [L2] uid=${uid} bị chặn khỏi bridge (strict privacy) → thử raw createGroup`);
                    // ── L2b: RAW createGroup không cần kết bạn (memberType spoof) ──
                    // Thử tạo nhóm tạm với chính stranger này bằng cách thay membersTypes=0
                    const rawGr = await rawCreateGroupNoFriend(api, [uid], `_r_${Date.now().toString(36)}`);
                    if (rawGr?.groupId && !rawGr.errorMembers?.includes(String(uid))) {
                        log(`  [L2b] ✓ uid=${uid} vào rawGroup=${rawGr.groupId} → move to target`);
                        await sleep(600);
                        const rt2 = await api.addUserToGroup([uid], gid);
                        try { await sleep(400); await api.disperseGroup(rawGr.groupId); } catch { }
                        if (!rt2?.errorMembers?.includes(uid)) {
                            log(`  [L2b-OK] ${uid} via rawCreateGroup bypass`);
                            return { uid, ok: true, via: 'L2b_raw_create_bypass' };
                        }
                    }
                }
            } catch (e2) {
                log(`  [L2] BridgeGroup err:`, e2.message);
                if (isRateLimit(e2.message)) await sleep(15000);
            }
        }

        // ── LAYER 4: inviteUserToGroups PUSH NOTIFICATION (1-tap trong Zalo app) ──
        log(`  [L4] inviteUserToGroups push notification → ${uid}`);
        try {
            const inv = await api.inviteUserToGroups(uid, [gid]);
            const msgMap = inv?.grid_message_map;
            const code = msgMap?.[gid]?.error_code ?? msgMap?.[String(gid)]?.error_code;
            if (code === 0) {
                log(`  [L4] invite notification sent → họ sẽ thấy thông báo trong Zalo app`);
                return { uid, ok: false, via: `L4_invited_pending`, invited: true };
            }
        } catch (e4) {
            log(`  [L4] err:`, e4.message);
        }

        // ── LAYER 5: sendFriendRequest + Link mời (bypass TẤT CẢ: block DM + block group add) ──
        // sendFriendRequest là kênh DUY NHẤT có thể reach người lạ dù họ block DM
        // Kèm link nhóm trong message → họ đọc lời mời kết bạn → thấy link → join
        if (groupLink) {
            const msgs = [
                `Xin chào! Tôi muốn kết bạn và mời bạn vào nhóm ${groupName}.\n👆 Click để join: ${groupLink}`,
                `Chào bạn! Tôi mời bạn vào nhóm ${groupName} — click link sau để tham gia ngay:\n${groupLink}`,
                `Hi! Hãy cùng tham gia nhóm ${groupName} nhé!\n🔗 ${groupLink}`,
            ];
            const msg = variantMsg(msgs[Math.floor(Math.random() * msgs.length)]);
            log(`  [L5] sendFriendRequest + link → ${uid}`);
            try {
                await api.sendFriendRequest(msg, uid);
                log(`  [L5] FR sent ✓ (kênh lời mời kết bạn + link nhóm)`);
                return { uid, ok: false, via: 'L5_friend_request_with_link', invited: true };
            } catch (e5) {
                log(`  [L5] FR err:`, e5.message);
                // Fallback: thử sendMessage (nếu không phải stranger hoàn toàn)
                try {
                    // BUG FIX: sendMessage signature là (body, threadId, threadType)
                    // ThreadType.User = 0, không dùng magic number
                    const { ThreadType } = require('zca-js');
                    await api.sendMessage({ msg: variantMsg(msg) }, uid, ThreadType?.User ?? 0);
                    log(`  [L5b] sendMessage fallback ✓`);
                    return { uid, ok: false, via: 'L5b_dm_with_link', invited: true };
                } catch (_) { }
            }
        }

        return { uid, ok: false, via: 'all_layers_failed', invited: false };
    }

    // ──────────────────────────────────────────────────────────────
    //  MAIN HYDRA FLOW
    // ──────────────────────────────────────────────────────────────
    try {
        const api = await getApi(cookie);
        const ownUid = String(api.getOwnId() || '');

        // Step 0: Lấy thành viên nhóm nguồn
        log(`=== HYDRA START: src=${sourceGroupId} → tgt=${targetGroupId || 'new'} ===`);
        const srcResult = await getGroupMembers(cookie, sourceGroupId);
        if (!srcResult.success || !srcResult.members?.length)
            return { success: false, error: 'Không lấy được thành viên nhóm nguồn: ' + (srcResult.error || '') };

        let allUids = srcResult.members
            .map(m => String(m.uid))
            .filter(u => u && u !== ownUid && u !== '0');
        log(`Source: ${allUids.length} UIDs từ "${srcResult.groupName}"`);

        // Step 1: Lấy invite link của nhóm đích (nếu tồn tại)
        let groupLink = null;
        let groupName = targetGroupId || 'nhóm';
        let activeGid = null;

        // Step 2: Xử lý mode tạo nhóm mới vs thêm vào nhóm có sẵn
        if (createNewGroup) {
            const gname = newGroupName || `Sao chép ${srcResult.groupName} ${new Date().toLocaleDateString('vi-VN')}`;
            log(`[CREATE MODE] Tạo nhóm mới: "${gname}" với ${allUids.length} thành viên`);
            const firstBatch = allUids.slice(0, Math.min(batchSize, allUids.length));
            const cr = await api.createGroup({ name: gname, members: firstBatch });
            activeGid = cr?.groupId;
            if (!activeGid) return { success: false, error: 'createGroup thất bại' };
            groupName = gname;
            log(`  Nhóm mới tạo: gid=${activeGid} +${cr?.sucessMembers?.length || 0}`);
            // Xử lý phần còn lại
            const remainUids = allUids.slice(firstBatch.length);
            allUids = [...(cr?.errorMembers || []), ...remainUids];
        } else {
            activeGid = targetGroupId;
        }

        // Step 3: Lấy group link + tên nhóm cho L5
        // BUG FIX: enableGroupLink / getGroupLinkDetail trả về nhiều field khác nhau
        // phải probe: .link | .groupLink | .joinLink | .url | data.link
        let groupInfoData = null;
        try {
            groupInfoData = await api.getGroupInfo(activeGid);
            groupName = groupInfoData?.gridInfoMap?.[activeGid]?.name
                || groupInfoData?.gridInfoMap?.[String(activeGid)]?.name
                || groupName;

            // Thử enable link trước (tạo mới nếu chưa có), sau đó getDetail
            const tryLink = async (res) => {
                if (!res) return null;
                // probe tất cả field có thể
                const d = res?.data || res;
                return d?.link || d?.groupLink || d?.joinLink || d?.url
                    || d?.linkKey || d?.join_link
                    || res?.link || res?.groupLink || res?.joinLink
                    || null;
            };
            const r1 = await api.enableGroupLink(activeGid).catch(() => null);
            groupLink = await tryLink(r1);
            if (!groupLink) {
                const r2 = await api.getGroupLinkDetail(activeGid).catch(() => null);
                groupLink = await tryLink(r2);
            }
            log(`Group link: ${groupLink || 'N/A'} | name: "${groupName}"`);
        } catch (e) { log('getGroupInfo/link err:', e.message); }

        // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
        //  HYDRA ULTIMATE — THUẬT TOÁN TINH VI NHẤT
        //
        //  XÁC NHẬN TỪ DEBUG (users:null):
        //  ❌ addUserToGroup(stranger) → Zalo SILENT REJECT, users:null, không pending
        //  ✅ addUserToGroup(friend)   → Direct join (với joinAppr=OFF)
        //  ✅ inviteUserToGroups(any)  → Push notification → họ tap → pending (joinAppr=ON)
        //  ✅ reviewPendingMemberRequest → Duyệt pending → họ vào nhóm
        //
        //  LAYERED STRATEGY:
        //  L1: Bạn bè → addUserToGroup(batch 20) với joinAppr=OFF → direct join
        //  L2: Stranger → inviteUserToGroups mỗi người → push notification Zalo
        //      → Họ tap "Đồng ý" trong Zalo → pending queue
        //      → Background daemon autoApprovePending mỗi 15s → vào nhóm
        //  L3: Stranger bị chặn invite → sendFriendRequest + group link
        //  L4: Wave retry (3 lần, 30s giữa mỗi wave) → re-invite + approve pending
        //  L5: Final sweep → approve tất cả pending còn lại
        // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

        // ── Friend set + phân loại ──
        let friendUids = new Set();
        try { friendUids = await getFriendSet(api); log(`Friends: ${friendUids.size}`); } catch { }

        // ── Loại bỏ người đã trong nhóm ──
        let { members: existSet } = await getMemberSetOf(api, activeGid);
        let toProcess = allUids.filter(u => !existSet.has(u));
        log(`Cần thêm: ${toProcess.length} | Đã có: ${existSet.size}`);
        if (toProcess.length === 0) {
            return { success: true, total: allUids.length, added: existSet.size, invited: 0, failed: 0, successRate: 100, msg: 'Tất cả đã trong nhóm!' };
        }

        const BATCH = 20;

        const stats = { ok: 0, invited: 0, failed: 0 };
        // invitedSet: strangers đã nhận invite (chưa chắc đã click)
        const invitedSet = new Set();
        // failSet: không thể invite (bị chặn mọi cách)
        const failSet = new Set();

        // Adaptive backoff
        let consecutiveFails = 0;
        let currentDelay = delayMs;
        const updateBackoff = (ok) => {
            if (ok) { consecutiveFails = 0; currentDelay = Math.max(delayMs, currentDelay * 0.85); }
            else { consecutiveFails++; if (consecutiveFails >= 3) currentDelay = Math.min(delayMs * 4, currentDelay * 1.5); }
        };

        // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
        //  CHIẾN LƯỢC: joinAppr=ON + addUserToGroup(tất cả)
        //
        //  Zalo behavior với joinAppr=ON:
        //  ✅ Bạn bè          → admin pending (không cần họ làm gì)
        //  ✅ Stranger default → admin pending (không cần họ làm gì!)
        //     (nếu họ có "Cho phép thêm vào nhóm" = ON — default)
        //  ❌ Stranger full    → errorMembers → fallback inviteUserToGroups
        //
        //  → Với người privacy mặc định + chưa kết bạn:
        //    addUserToGroup → HỌ VÀO PENDING mà không cần tap gì!
        // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

        // BẬT joinAppr để mọi người vào pending (admin duyệt thủ công)
        try { await api.updateGroupSettings({ joinAppr: true }, activeGid); await sleep(600); } catch { }

        // ── L1: BATCH ADD TẤT CẢ với joinAppr=ON ──
        // Thử addUserToGroup cho CẢ bạn bè lẫn stranger
        // → Ai "cho phép thêm vào nhóm" (default) → vào admin pending ngay ✅
        // → Ai bị chặn (full privacy) → errorMembers → chuyển sang inviteUserToGroups
        log(`\n=== L1: Batch add ${toProcess.length} người → pending queue (joinAppr=ON) ===`);

        const blockedByPrivacy = []; // errorMembers từ L1

        for (let i = 0; i < toProcess.length; i += BATCH) {
            const batch = toProcess.slice(i, i + BATCH);
            try {
                const r = await api.addUserToGroup(batch, activeGid);
                const errSet = new Set(r?.errorMembers?.map(String) || []);
                const ok = batch.filter(u => !errSet.has(String(u)));
                const fail = batch.filter(u => errSet.has(String(u)));

                stats.ok += ok.length;
                if (ok.length) log(`  ⏳ +${ok.length} → pending (chờ bạn duyệt)`);
                if (fail.length) {
                    log(`  ⚠️ ${fail.length} bị chặn privacy → chuyển sang L2 invite`);
                    for (const uid of fail) blockedByPrivacy.push(uid);
                }
                updateBackoff(ok.length > 0);
            } catch (e) {
                if (isRateLimit(e.message)) await sleep(jitter(15000));
                for (const uid of batch) blockedByPrivacy.push(uid);
                updateBackoff(false);
            }
            if (i + BATCH < toProcess.length) await sleep(jitter(currentDelay));
        }
        log(`  L1 done: pending+=${stats.ok} | blocked=${blockedByPrivacy.length}`);

        // ── L2: Invite người bị chặn (joinAppr=ON → tap → pending → admin duyệt thủ công) ──
        if (blockedByPrivacy.length > 0) {
            log(`\n=== L2: Invite ${blockedByPrivacy.length} người bị chặn → pending queue ===`);
            // joinAppr=ON đã bật ở trên → khi họ tap → vào pending (không auto-approve)

            for (let i = 0; i < blockedByPrivacy.length; i++) {
                const uid = blockedByPrivacy[i];
                if (onProgress) onProgress(stats.ok + i, toProcess.length);

                try {
                    const inv = await api.inviteUserToGroups(uid, [activeGid]);
                    const mm = inv?.grid_message_map;
                    const code = mm?.[activeGid]?.error_code ?? mm?.[String(activeGid)]?.error_code;

                    if (code === 0 || code === undefined || code === null) {
                        invitedSet.add(uid);
                        stats.invited++;
                        updateBackoff(true);
                        log(`  📨 ${uid}: invite OK (chờ họ tap Zalo notification)`);
                    } else {
                        log(`  [L2-blocked] ${uid} invite code=${code} → thử các bypass khác`);

                        // ── L3a: Group Bond DM — sendMessage trực tiếp ──
                        // Zalo cho phép nhắn tin người cùng nhóm dù không kết bạn
                        // → Gửi link nhóm B vào DM của họ
                        let l3Done = false;
                        if (groupLink) {
                            try {
                                const { ThreadType } = require('zca-js');
                                const dmMsg = variantMsg(`Xin chào! Mời bạn vào nhóm: ${groupLink}`);
                                await api.sendMessage({ msg: dmMsg }, uid, ThreadType?.User ?? 0);
                                invitedSet.add(uid);
                                stats.invited++;
                                l3Done = true;
                                log(`  📱 ${uid}: [L3a] Group Bond DM sent ✓`);
                            } catch (e3a) {
                                log(`  [L3a] DM err: ${e3a.message}`);
                            }
                        }

                        // ── L3b: sendFriendRequest + link ──
                        if (!l3Done && groupLink) {
                            try {
                                await api.sendFriendRequest(variantMsg(`Mời bạn vào nhóm: ${groupLink}`), uid);
                                invitedSet.add(uid);
                                stats.invited++;
                                l3Done = true;
                                log(`  📩 ${uid}: [L3b] FR+link sent ✓`);
                            } catch (e3b) {
                                log(`  [L3b] FR err: ${e3b.message}`);
                            }
                        }

                        // ── L3c: Post vào Nhóm A (source group) @mention + link ──
                        // Họ sẽ thấy mention trong Group A — không thể bỏ qua
                        if (!l3Done && groupLink && sourceGroupId) {
                            try {
                                const { ThreadType } = require('zca-js');
                                const mentionMsg = `@${uid} Mời bạn tham gia nhóm: ${groupLink}`;
                                await api.sendMessage(
                                    {
                                        msg: mentionMsg,
                                        mentions: [{ uid, length: String(uid).length + 1, offset: 0, type: 1 }],
                                    },
                                    sourceGroupId,
                                    ThreadType?.Group ?? 1
                                );
                                invitedSet.add(uid);
                                stats.invited++;
                                l3Done = true;
                                log(`  📢 ${uid}: [L3c] @mention in Group A sent ✓`);
                            } catch (e3c) {
                                log(`  [L3c] Group post err: ${e3c.message}`);
                            }
                        }

                        if (!l3Done) {
                            failSet.add(uid);
                            stats.failed++;
                            log(`  ❌ ${uid}: ALL bypass failed (full privacy)`);
                        }
                        updateBackoff(l3Done);
                    }
                } catch (e) {
                    log(`  [invite] ${uid} err: ${e.message}`);
                    if (isRateLimit(e.message)) await sleep(jitter(15000));
                    failSet.add(uid);
                    stats.failed++;
                    updateBackoff(false);
                }

                if (i < strangers.length - 1) await sleep(jitter(currentDelay));
            }

            log(`\n=== Wave 1 done: ⏳ pending=${stats.ok} | 📨 invited=${stats.invited} | ❌ fail=${stats.failed} ===`);
            log(`  👉 Vào nhóm B → "Thành viên chờ duyệt" để duyệt thủ công`);
        }


        // ── L4: MULTI-WAVE RETRY — re-invite ai chưa click (không tự duyệt) ──
        for (let wave = 2; wave <= maxWaves; wave++) {
            log(`\n=== WAVE ${wave}: Chờ ${waveDelay / 1000}s → re-invite ai chưa click ===`);
            await sleep(jitter(waveDelay));

            // Re-invite những ai chưa tap (vẫn trong invitedSet, chưa accept)
            let reInviteOk = 0;
            for (const uid of [...invitedSet]) {
                try {
                    const inv = await api.inviteUserToGroups(uid, [activeGid]);
                    const mm = inv?.grid_message_map;
                    const code = mm?.[activeGid]?.error_code ?? mm?.[String(activeGid)]?.error_code;
                    if (code === 0 || code === undefined || code === null) reInviteOk++;
                } catch { }
                await sleep(jitter(600));
            }
            log(`Wave ${wave}: re-invited ${reInviteOk}/${invitedSet.size}`);
        }

        // ── L5: FINAL REPORT (không auto-approve — admin duyệt thủ công) ──
        log(`\n=== HYDRA COMPLETE ===`);
        log(`⏳ ${stats.ok} bạn bè → pending queue`);
        log(`📨 ${stats.invited} stranger → đã nhận invite (chờ họ tap)`);
        log(`❌ ${stats.failed} bị chặn hoàn toàn (full privacy)`);
        log(`👉 Mở nhóm B → Thành viên → "Chờ phê duyệt" → duyệt tất cả`);

        return {
            success: true,
            total: allUids.length,
            added: stats.ok,
            invited: stats.invited,
            failed: stats.failed,
            successRate: Math.round((stats.ok / Math.max(allUids.length, 1)) * 100),
            inviteLink: groupLink,
            sourceGroupName: srcResult.groupName,
            groupName,
            createdGroupId: createNewGroup ? activeGid : undefined,
            errors: [...failSet],
            msg: `${stats.ok} người → pending (chờ duyệt). ${stats.invited} nhận invite. ${stats.failed} bị chặn.`,
        };


    } catch (err) {
        console.error('[HYDRA] Fatal:', err.stack || err.message);
        return { success: false, error: err.message };
    }
}




module.exports = {
    verifyLogin,
    loginQR,
    findUserByPhone,
    sendMessage,
    sendMessageByUid,
    sendFriendRequest,
    getGroups,
    getGroupMembers,
    copyGroupMembers,
    copyGroupMembersHydra,
    approvePendingMembers,
    forceJoinViaLink,
    parseCookie,
    extractZaloCookies,
};




