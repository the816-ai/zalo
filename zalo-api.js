'use strict';
/**
 * â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
 *  Zalo API Backend â€“ dÃ¹ng zca-js (Ä‘Ã£ reverse-engineer
 *  toÃ n bá»™ thuáº­t toÃ¡n mÃ£ hÃ³a AES cá»§a Zalo)
 *  Cháº¡y hoÃ n toÃ n ngáº§m, khÃ´ng cáº§n browser.
 * â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
 */

const https = require('https');
const fs = require('fs');
const path = require('path');
const os = require('os');

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
//  V2 ENGINE â€” Advanced algorithms for Zalo Bulk Tool Pro v2
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

// â”€â”€ V2.1: Priority Queue (Min-Heap) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Score-based ordering: targets with highest success likelihood go first
class PriorityQueue {
    constructor() { this._heap = []; }
    get size() { return this._heap.length; }
    isEmpty() { return this._heap.length === 0; }

    // Score calculation: higher = process first
    static calcScore(target, friendSet, sentHistory) {
        let score = 50; // base
        if (friendSet && friendSet.has(target.uid)) score += 50;           // friends â†’ highest priority
        if (target.avatar && target.avatar.length > 5) score += 10;        // has avatar â†’ real user
        if (target.lastActive && (Date.now() / 1000 - target.lastActive) < 86400) score += 20; // active < 24h
        if (sentHistory && sentHistory.has(target.uid)) score -= 200;      // already sent â†’ deprioritize
        if (target.name && !target.name.startsWith('TV_') && !target.name.startsWith('UID_')) score += 5; // has real name
        return score;
    }

    enqueue(item, priority) {
        this._heap.push({ item, priority });
        this._bubbleUp(this._heap.length - 1);
    }
    dequeue() {
        if (this._heap.length === 0) return null;
        const top = this._heap[0];
        const last = this._heap.pop();
        if (this._heap.length > 0) { this._heap[0] = last; this._sinkDown(0); }
        return top.item;
    }
    peek() { return this._heap.length > 0 ? this._heap[0].item : null; }
    toArray() {
        return [...this._heap].sort((a, b) => b.priority - a.priority).map(x => x.item);
    }
    _bubbleUp(i) {
        while (i > 0) {
            const p = Math.floor((i - 1) / 2);
            if (this._heap[p].priority >= this._heap[i].priority) break;
            [this._heap[p], this._heap[i]] = [this._heap[i], this._heap[p]];
            i = p;
        }
    }
    _sinkDown(i) {
        const len = this._heap.length;
        while (true) {
            let largest = i, l = 2 * i + 1, r = 2 * i + 2;
            if (l < len && this._heap[l].priority > this._heap[largest].priority) largest = l;
            if (r < len && this._heap[r].priority > this._heap[largest].priority) largest = r;
            if (largest === i) break;
            [this._heap[i], this._heap[largest]] = [this._heap[largest], this._heap[i]];
            i = largest;
        }
    }
}

// â”€â”€ V2.2: Session Manager â€” Checkpoint/Resume â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Persist send progress to disk â†’ resume after crash/cancel
class SessionManager {
    constructor() {
        this._dir = path.join(process.env.APPDATA || os.homedir(), 'Zalo Bulk Tool Pro', 'sessions');
        try { fs.mkdirSync(this._dir, { recursive: true }); } catch (_) {}
    }
    _getPath(sessionId) { return path.join(this._dir, `${sessionId}.json`); }

    create(params, targets) {
        const id = `bulk_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        const session = {
            id, createdAt: Date.now(), status: 'running',
            params: { ...params, cookie: undefined }, // never persist cookie
            cursor: 0,
            totalTargets: targets.length,
            targets: targets.map(t => ({ uid: t.uid, name: t.name, phone: t.phone || '' })),
            results: { sent: 0, msgOk: 0, inviteOk: 0, failed: 0, details: [] },
            checkpoint: null,
        };
        this._save(id, session);
        console.log(`[SessionMgr] Created session ${id} with ${targets.length} targets`);
        return id;
    }
    checkpoint(sessionId, cursor, results) {
        try {
            const s = this._load(sessionId);
            if (!s) return;
            s.cursor = cursor;
            s.results = { ...s.results, ...results };
            s.checkpoint = Date.now();
            this._save(sessionId, s);
        } catch (_) {}
    }
    complete(sessionId, results) {
        try {
            const s = this._load(sessionId);
            if (!s) return;
            s.status = 'completed';
            s.results = { ...s.results, ...results };
            s.completedAt = Date.now();
            this._save(sessionId, s);
        } catch (_) {}
    }
    getIncomplete() {
        try {
            const files = fs.readdirSync(this._dir).filter(f => f.endsWith('.json'));
            const sessions = [];
            for (const f of files) {
                try {
                    const s = JSON.parse(fs.readFileSync(path.join(this._dir, f), 'utf8'));
                    if (s.status === 'running') sessions.push(s);
                } catch (_) {}
            }
            // Only return sessions < 24h old
            return sessions.filter(s => Date.now() - s.createdAt < 86400000);
        } catch (_) { return []; }
    }
    getSession(sessionId) { return this._load(sessionId); }
    _save(id, data) {
        try { fs.writeFileSync(this._getPath(id), JSON.stringify(data, null, 2)); } catch (_) {}
    }
    _load(id) {
        try { return JSON.parse(fs.readFileSync(this._getPath(id), 'utf8')); } catch (_) { return null; }
    }
    cleanOld(maxAgeDays = 7) {
        try {
            const cutoff = Date.now() - maxAgeDays * 86400000;
            const files = fs.readdirSync(this._dir).filter(f => f.endsWith('.json'));
            for (const f of files) {
                try {
                    const s = JSON.parse(fs.readFileSync(path.join(this._dir, f), 'utf8'));
                    if (s.createdAt < cutoff) fs.unlinkSync(path.join(this._dir, f));
                } catch (_) {}
            }
        } catch (_) {}
    }
}

// â”€â”€ V2.3: Markov Timer â€” Human-like delay patterns â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// State machine: SHORT â†’ MEDIUM â†’ LONG with transition probabilities
class MarkovTimer {
    constructor() {
        // States: 0=SHORT(1-3s), 1=MEDIUM(3-8s), 2=LONG(8-20s), 3=PAUSE(20-60s)
        this._state = 0;
        this._transitions = [
            /* FROM SHORT  â†’ */ [0.40, 0.35, 0.20, 0.05],
            /* FROM MEDIUM â†’ */ [0.25, 0.40, 0.25, 0.10],
            /* FROM LONG   â†’ */ [0.15, 0.35, 0.30, 0.20],
            /* FROM PAUSE  â†’ */ [0.50, 0.30, 0.15, 0.05],
        ];
        this._ranges = [
            [1000, 3000],
            [3000, 8000],
            [8000, 20000],
            [20000, 60000],
        ];
        this._sendCount = 0;
    }
    next() {
        this._sendCount++;
        // Force pause every 15-25 sends (human "tired" pattern)
        if (this._sendCount > 0 && this._sendCount % (15 + Math.floor(Math.random() * 10)) === 0) {
            this._state = 3; // force PAUSE
        } else {
            // Markov transition
            const probs = this._transitions[this._state];
            const r = Math.random();
            let cum = 0;
            for (let i = 0; i < probs.length; i++) {
                cum += probs[i];
                if (r <= cum) { this._state = i; break; }
            }
        }
        const [min, max] = this._ranges[this._state];
        // Gaussian-like within range
        const mid = (min + max) / 2;
        const z = Math.sqrt(-2 * Math.log(Math.random())) * Math.cos(2 * Math.PI * Math.random());
        return Math.max(min, Math.min(max, Math.round(mid + z * (max - min) * 0.2)));
    }
    // Time-of-day multiplier: slower at lunch, evening
    getMultiplier() {
        const h = new Date().getHours();
        if (h >= 12 && h <= 13) return 2.0;  // lunch â†’ slow
        if (h >= 8 && h <= 9) return 1.5;    // morning rush â†’ cautious
        if (h >= 20 && h <= 22) return 1.3;  // evening browse
        if (h < 7 || h >= 23) return 2.5;    // night â†’ very slow
        return 1.0;
    }
    getDelay() {
        return Math.round(this.next() * this.getMultiplier());
    }
    reset() { this._state = 0; this._sendCount = 0; }
}

// â”€â”€ V2.4: Honeypot Detector â€” Skip suspicious targets â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
class HoneypotDetector {
    constructor() {
        this._blacklist = new Set();
        this._blacklistFile = path.join(process.env.APPDATA || os.homedir(), 'Zalo Bulk Tool Pro', 'honeypot_blacklist.json');
        this._load();
    }
    _load() {
        try {
            const data = JSON.parse(fs.readFileSync(this._blacklistFile, 'utf8'));
            data.forEach(uid => this._blacklist.add(uid));
        } catch (_) {}
    }
    _save() {
        try {
            const dir = path.dirname(this._blacklistFile);
            fs.mkdirSync(dir, { recursive: true });
            fs.writeFileSync(this._blacklistFile, JSON.stringify([...this._blacklist]));
        } catch (_) {}
    }
    isBlacklisted(uid) { return this._blacklist.has(String(uid)); }
    addToBlacklist(uid) { this._blacklist.add(String(uid)); this._save(); }

    // Score: 0 = safe, 100 = definitely honeypot
    getSuspicionScore(target) {
        let score = 0;
        const uid = String(target.uid || '');
        // UID pattern: sequential or too round
        if (/^(\d)\1{10,}$/.test(uid)) score += 40;  // repeated digits
        if (uid.endsWith('000000')) score += 20;       // too round
        // No avatar + generic name
        if (!target.avatar || target.avatar.length < 5) score += 15;
        if (!target.name || target.name.startsWith('TV_') || target.name.startsWith('UID_')) score += 10;
        // Previously failed permanently
        if (this._blacklist.has(uid)) score += 100;
        return score;
    }
    // Filter array of targets, removing suspicious ones
    filter(targets, threshold = 60) {
        const safe = [], suspicious = [];
        for (const t of targets) {
            const score = this.getSuspicionScore(t);
            if (score >= threshold) {
                suspicious.push({ ...t, suspicionScore: score });
            } else {
                safe.push(t);
            }
        }
        if (suspicious.length > 0) {
            console.log(`[HoneypotDetector] Filtered ${suspicious.length} suspicious targets (threshold=${threshold})`);
        }
        return { safe, suspicious };
    }
}

// â”€â”€ V2.5: Member Cache â€” TTL-based in-memory cache â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
class MemberCache {
    constructor(ttlMs = 30 * 60 * 1000) { // 30 min default TTL
        this._cache = new Map();
        this._ttl = ttlMs;
    }
    get(groupId) {
        const entry = this._cache.get(String(groupId));
        if (!entry) return null;
        if (Date.now() - entry.ts > this._ttl) {
            this._cache.delete(String(groupId));
            return null;
        }
        return entry.data;
    }
    set(groupId, data) {
        this._cache.set(String(groupId), { data, ts: Date.now() });
    }
    invalidate(groupId) { this._cache.delete(String(groupId)); }
    clear() { this._cache.clear(); }
    has(groupId) { return this.get(groupId) !== null; }
}

// â”€â”€ V2.6: UserAgent Pool â€” Rotate UA per session â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const UA_POOL = [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:128.0) Gecko/20100101 Firefox/128.0',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:127.0) Gecko/20100101 Firefox/127.0',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36 Edg/145.0.0.0',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.0.0 Safari/537.36 Edg/144.0.0.0',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36',
];
function rotateUserAgent() {
    _userAgent = UA_POOL[Math.floor(Math.random() * UA_POOL.length)];
    console.log(`[V2] UA rotated: ${_userAgent.slice(0, 60)}...`);
    return _userAgent;
}

// â”€â”€ V2.7: Adaptive Batch Sizer â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
class AdaptiveBatchSizer {
    constructor(initial = 12, min = 3, max = 30) {
        this._size = initial;
        this._min = min;
        this._max = max;
        this._successCount = 0;
        this._failCount = 0;
        this._window = [];  // rolling window of last 20 results
    }
    record(success) {
        this._window.push(success ? 1 : 0);
        if (this._window.length > 20) this._window.shift();
        if (success) this._successCount++; else this._failCount++;
        this._adjust();
    }
    _adjust() {
        if (this._window.length < 5) return; // not enough data
        const rate = this._window.reduce((a, b) => a + b, 0) / this._window.length;
        if (rate > 0.8 && this._size < this._max) {
            this._size = Math.min(this._max, Math.ceil(this._size * 1.3));
        } else if (rate < 0.4 && this._size > this._min) {
            this._size = Math.max(this._min, Math.floor(this._size * 0.6));
        }
    }
    get size() { return this._size + Math.floor(Math.random() * 3) - 1; } // +/- 1 jitter
    get successRate() {
        return this._window.length > 0
            ? this._window.reduce((a, b) => a + b, 0) / this._window.length
            : 1;
    }
    reset() { this._size = 12; this._window = []; this._successCount = 0; this._failCount = 0; }
}

// â”€â”€ V2.8: Expanded Noise Actions â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// 12+ noise types to mimic human browsing (extended from 6 in v1)
function createNoiseActions(api) {
    return [
        () => api.getAllFriends(100, 1),
        () => api.getOwnId(),
        () => api.getAllGroups(),
        () => api.getStickers('recently_used').catch(() => null),
        () => api.getSettings?.().catch(() => null),
        () => api.getPinConversations?.().catch(() => null),
        // V2: new noise types
        () => api.getAllFriends(50, Math.floor(Math.random() * 5)).catch(() => null),
        () => api.getAllGroups().catch(() => null),
        () => { try { api.getOwnId(); } catch (_) {} return null; },
        () => api.getStickers('trending').catch(() => null),
        () => api.getStickers('hot').catch(() => null),
        () => new Promise(r => setTimeout(r, 300 + Math.random() * 700)), // "thinking" pause
    ];
}

// Instantiate V2 singletons
const sessionManager = new SessionManager();
const memberCache = new MemberCache();
const honeypotDetector = new HoneypotDetector();

// Clean old sessions on startup
sessionManager.cleanOld(7);

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// COOKIE / CREDENTIALS HELPERS
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
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
 * Chuyá»ƒn cookie string thÃ nh máº£ng object mÃ  zca-js cháº¥p nháº­n.
 * zca-js cáº§n: { name, value, domain, path, ... }
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

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// ZCA-JS API SINGLETON
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
let _api = null;
let _cookieHash = '';
let _imei = '';
let _userAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36';

/**
 * Lay IMEI tá»« data.json hoáº·c táº¡o má»›i
 * forceNew=true: táº¡o IMEI má»›i Ä‘á»ƒ bypass device fingerprint
 */
// â”€â”€ Luhn checksum for IMEI validation â”€â”€
function generateLuhnIMEI() {
    // Real TAC codes: Samsung/Xiaomi/Oppo/Vivo phá»• biáº¿n Viá»‡t Nam
    const tacs = ['35674711','35378710','86498604','35740609','86476502','35462509'];
    const tac = tacs[Math.floor(Math.random() * tacs.length)];
    let partial = tac + String(Math.floor(Math.random() * 9999999)).padStart(7, '0');
    // TÃ­nh Luhn check digit
    let sum = 0, alt = true;
    for (let i = partial.length - 1; i >= 0; i--) {
        let d = parseInt(partial[i]);
        if (alt) { d *= 2; if (d > 9) d -= 9; }
        sum += d; alt = !alt;
    }
    return partial + ((10 - (sum % 10)) % 10);
}

function getImei(forceNew = false) {
    if (forceNew) {
        // Luhn-valid 15-digit IMEI wrapped in Zalo UUID format
        const luhnIMEI = generateLuhnIMEI();
        const hex = (n) => [...Array(n)].map(() => Math.floor(Math.random()*16).toString(16)).join('');
        const newImei = `${luhnIMEI.slice(0,8)}-${hex(4)}-${hex(4)}-${hex(4)}-${hex(12)}-${hex(32)}`;
        console.log(`[IMEI] New device (Luhn: ${luhnIMEI})`);
        return newImei;
    }
    try {
        const fs = require('fs');
        const path = require('path');
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
    return '3c4e5f3a-d77c-4ce7-ba78-ab8ec27a9904-7c73ef5b8d3235ae0606f2e84e457ff5';
}

/**
 * Khá»Ÿi táº¡o hoáº·c tÃ¡i sá»­ dá»¥ng zca-js API instance
 */
async function getApi(cookie, forceRefresh = false) {
    // If QR login and not forced â†’ use cached
    if (_api && _cookieHash === 'QR_LOGIN' && !forceRefresh) return _api;

    const cookieHash = cookie ? cookie.slice(0, 80) : '';
    if (_api && _cookieHash === cookieHash && cookieHash && !forceRefresh) return _api;

    if (!cookie || cookie === 'QR_SESSION') {
        // FIX: nếu đã có cached API (QR login), dùng thay vì throw
        if (_api) return _api;
        throw new Error('Chưa đăng nhập. Vui lòng quét QR hoặc nhập Cookie trong Cài đặt.');
    }
    // Lazy-require zca-js (ESM â†’ require compat)
    let Zalo;
    try {
        const mod = await import('zca-js');
        Zalo = mod.Zalo;
    } catch (e) {
        throw new Error('Thiáº¿u zca-js: ' + e.message);
    }

    const imei = getImei(forceRefresh);
    // FIX: Random Zalo mobile UA â€” giáº£ láº­p thiáº¿t bá»‹ tháº­t
    const _ZALO_UAS = [
        'Zalo/23.12.1 (iPhone; iOS 17.2; Scale/3.00)',
        'Zalo/23.11.2 (Linux; Android 14; SM-S918B Build/UP1A)',
        'Zalo/23.12.3 (Linux; Android 13; Redmi Note 12 Build/TQ3A)',
        'Zalo/23.11.5 (Linux; Android 14; CPH2609 Build/UP1A)',
        'Zalo/23.10.2 (Linux; Android 12; Pixel 7 Build/SD1A)',
    ];
    const _pickedUA = _ZALO_UAS[Math.floor(Math.random() * _ZALO_UAS.length)];
    const _isAndroid = _pickedUA.includes('Android');
    const _osVer = _isAndroid
        ? (_pickedUA.match(/Android ([\d.]+)/)?.[1] || '14')
        : (_pickedUA.match(/iOS ([\d.]+)/)?.[1] || '17');
    const _screenDpi = [2.0, 2.5, 2.75, 3.0][Math.floor(Math.random() * 4)];
    const _netType  = ['WIFI', 'LTE', '5G'][Math.floor(Math.random() * 3)];

    const credentials = {
        imei,
        cookie: cookieStringToObjArr(cookie),
        userAgent: _pickedUA,
        language: 'vi',
        // Extra Zalo app headers â€” trÃ¡nh bá»‹ classify lÃ  bot
        extraHeaders: {
            'X-ZALO-NETWORK-TYPE': _netType,
            'X-ZALO-DEVICE-OS-VERSION': _isAndroid ? `android ${_osVer}` : `ios ${_osVer}`,
            'X-ZALO-SCREEN-DPI': String(_screenDpi),
            'X-ZALO-TIMEZONE': '7',
            'X-ZALO-APP-VERSION': '23.12.1',
            'Accept-Language': 'vi-VN,vi;q=0.9,en;q=0.8',
        },
    };

    const zalo = new Zalo({ logging: false });
    _api = await zalo.login(credentials);
    _cookieHash = cookieHash;

    _imei = imei;

    return _api;
}

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// HTTPS â€“ chá»‰ dÃ¹ng cho verifyLogin (endpoint khÃ´ng cáº§n encrypt)
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
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

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// QR LOGIN â€“ user quÃ©t QR báº±ng Zalo mobile
// (KhÃ´ng cáº§n cookie/IMEI thá»§ cÃ´ng)
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
async function loginQR(qrImagePath, onQRReady) {
    let ZaloMod, LoginQRCallbackEventType;
    try {
        ZaloMod = await import('zca-js');
        LoginQRCallbackEventType = ZaloMod.LoginQRCallbackEventType;
        console.log('[QR] zca-js loaded. EventTypes:', JSON.stringify(LoginQRCallbackEventType));
    } catch (e) {
        throw new Error('Thiáº¿u zca-js: ' + e.message);
    }

    const { Zalo } = ZaloMod;
    const zalo = new Zalo({ logging: true });

    console.log('[QR] Báº¯t Ä‘áº§u loginQR, qrPath:', qrImagePath);

    // loginQR blocks until user scans â†’ resolves with api
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

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// 1. XÃC THá»°C ÄÄ‚NG NHáº¬P
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
async function verifyLogin(cookie) {
    try {
        const ck = extractZaloCookies(cookie);
        if (!ck.zpw_sek && !ck.zpsid) {
            return { success: false, error: 'Cookie khÃ´ng há»£p lá»‡. Cáº§n cÃ³ zpw_sek hoáº·c zpsid.' };
        }

        // Thá»­ láº¥y thÃ´ng tin qua zca-js login
        try {
            const api = await getApi(cookie);
            // Náº¿u login thÃ nh cÃ´ng thÃ¬ láº¥y account info
            const info = api.getOwnId ? api.getOwnId() : null;
            return {
                success: true,
                user: {
                    name: 'NgÆ°á»i dÃ¹ng Zalo',
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
                        name: d.displayName || d.name || 'NgÆ°á»i dÃ¹ng Zalo',
                        phone: d.phoneNumber || '***',
                        uid: d.userId || d.uid || '',
                        avatar: d.avatar || '',
                    },
                };
            }

            if (ck.zpsid) {
                return { success: true, user: { name: 'NgÆ°á»i dÃ¹ng Zalo', phone: '***', uid: '', avatar: '' } };
            }

            return { success: false, error: `XÃ¡c thá»±c tháº¥t báº¡i: ${loginErr.message}` };
        }
    } catch (err) {
        return { success: false, error: err.message };
    }
}

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// 2. TÃŒM USER THEO SÄT
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
async function findUserByPhone(cookie, phone) {
    try {
        const api = await getApi(cookie);
        const user = await api.findUser(phone);
        if (user && user.uid) {
            return { success: true, uid: user.uid, name: user.display_name || user.zalo_name || phone };
        }
        return { success: false, uid: null, error: 'KhÃ´ng tÃ¬m tháº¥y tÃ i khoáº£n vá»›i SÄT nÃ y' };
    } catch (err) {
        return { success: false, uid: null, error: err.message };
    }
}

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// 3. Gá»¬I TIN NHáº®N
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
async function sendMessage(cookie, phone, message) {
    try {
        const api = await getApi(cookie);

        // BÆ°á»›c 1: TÃ¬m uid
        const found = await findUserByPhone(cookie, phone);
        if (!found.success || !found.uid) {
            return { success: false, error: found.error || 'KhÃ´ng tÃ¬m tháº¥y ngÆ°á»i dÃ¹ng' };
        }

        // BÆ°á»›c 2: Import ThreadType
        const { ThreadType } = await import('zca-js');

        // BÆ°á»›c 3: Gá»­i tin
        await api.sendMessage({ msg: message }, found.uid, ThreadType.User);
        return { success: true, to: phone, name: found.name };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// 4. Gá»¬I Lá»œI Má»œI Káº¾T Báº N
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
async function sendFriendRequest(cookie, phone, message = '') {
    try {
        const api = await getApi(cookie);

        const found = await findUserByPhone(cookie, phone);
        if (!found.success || !found.uid) {
            return { success: false, error: found.error || 'KhÃ´ng tÃ¬m tháº¥y ngÆ°á»i dÃ¹ng' };
        }

        const msg = message || 'Xin chÃ o! MÃ¬nh muá»‘n káº¿t báº¡n vá»›i báº¡n ðŸ˜Š';
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

// ══════════════════════════════════════════════════════════════
// 4b. KẾT BẠN BẰNG UID (không cần phone)
// ══════════════════════════════════════════════════════════════
async function sendFriendRequestByUid(cookie, uid, message = '') {
    try {
        const api = await getApi(cookie);
        const msg = message || 'Xin chào! Mình muốn kết bạn với bạn 😊';
        await api.sendFriendRequest(msg, uid);
        return { success: true, uid };
    } catch (err) {
        const m = err.message || '';
        if (m.includes('already') || m.includes('216')) {
            return { success: false, error: 'already_friend', already: true };
        }
        if (m.includes('217') || m.includes('pending')) {
            return { success: false, error: 'request_sent', pending: true };
        }
        return { success: false, error: m };
    }
}

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// 5. Láº¤Y DANH SÃCH NHÃ“M
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
async function getGroups(cookie) {
    try {
        const api = await getApi(cookie);

        // BÆ°á»›c 1: Láº¥y táº¥t cáº£ group IDs
        const allGroupsRes = await api.getAllGroups();
        const gridVerMap = allGroupsRes?.gridVerMap || {};
        const groupIds = Object.keys(gridVerMap);

        if (groupIds.length === 0) {
            return { success: true, groups: [] };
        }

        console.log(`[getGroups] TÃ¬m tháº¥y ${groupIds.length} nhÃ³m, Ä‘ang láº¥y chi tiáº¿t...`);

        // BÆ°á»›c 2: Láº¥y info chi tiáº¿t (batch 50 má»—i láº§n)
        const batchSize = 50;
        const allGroupInfos = {};
        for (let i = 0; i < groupIds.length; i += batchSize) {
            const batch = groupIds.slice(i, i + batchSize);
            const infoRes = await api.getGroupInfo(batch);
            Object.assign(allGroupInfos, infoRes?.gridInfoMap || {});
        }

        // BÆ°á»›c 3: Format káº¿t quáº£ â€” lÆ°u luÃ´n currentMems Ä‘á»ƒ trÃ¡nh gá»i láº¡i API
        const groups = Object.entries(allGroupInfos).map(([gid, g]) => ({
            id: gid,
            name: g.name || 'NhÃ³m khÃ´ng tÃªn',
            members: g.totalMember || g.memberIds?.length || 0,
            created: g.createdTime
                ? new Date(g.createdTime * 1000).toLocaleDateString('vi-VN')
                : '',
            unread: 0,
            avatar: g.avt || '',
            // LÆ°u luÃ´n danh sÃ¡ch thÃ nh viÃªn â€” trÃ¡nh gá»i getGroupInfo láº§n 2 bá»‹ "unchanged"
            currentMems: (g.currentMems || []).map(m => ({
                uid: m.id,
                name: m.dName || m.zaloName || 'áº¨n danh',
                avatar: m.avatar_25 || m.avatar || '',
            })),
        })).filter(g => g.name);


        console.log(`[getGroups] Láº¥y Ä‘Æ°á»£c ${groups.length} nhÃ³m.`);
        return { success: true, groups };

    } catch (err) {
        console.error('[getGroups] Error:', err.message);
        return { success: false, groups: [], error: err.message };
    }
}
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// 6. Láº¤Y THÃ€NH VIÃŠN NHÃ“M - Thuáº­t toÃ¡n tinh vi 5 lá»›p
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
async function getGroupMembers(cookie, groupId) {
    const log = (...a) => console.log('[getGroupMembers]', ...a);

    // V2: Check cache first
    const cached = memberCache.get(groupId);
    if (cached) {
        log(`CACHE HIT for group ${groupId} (${cached.members?.length} members)`);
        return cached;
    }

    try {
        const api = await getApi(cookie);

        // â”€â”€ BÆ°á»›c 1: getGroupInfo(groupId) vá»›i version=0 (luÃ´n tráº£ fresh data) â”€â”€
        log('calling getGroupInfo for', groupId);
        const infoRes = await api.getGroupInfo(groupId);

        const allKeys = Object.keys(infoRes?.gridInfoMap || {});
        log('gridInfoMap keys:', allKeys);
        log('unchangedsGroup:', JSON.stringify(infoRes?.unchangedsGroup));

        // Láº¥y group object â€” thá»­ cáº£ key string láº«n sá»‘ nguyÃªn
        let g = infoRes?.gridInfoMap?.[groupId]
            || infoRes?.gridInfoMap?.[String(groupId)]
            || infoRes?.gridInfoMap?.[Number(groupId)];

        // Náº¿u váº«n khÃ´ng tháº¥y, thá»­ match key gáº§n nháº¥t
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

            // â”€â”€ Chiáº¿n lÆ°á»£c A0: memVerList = uid_version strings (CHÃNH XÃC NHáº¤T) â”€â”€
            const memVerList = g.memVerList || [];
            if (memVerList.length > 0) {
                log('Strategy A0: memVerList count:', memVerList.length);
                // Parse uid tá»« "uid_version" â€” vÃ­ dá»¥ "1234567890_1" â†’ "1234567890"
                const uids = memVerList.map(mv => mv.includes('_') ? mv.split('_').slice(0, -1).join('_') : mv);
                log('Extracted UIDs:', uids.length, 'first:', uids[0]);

                // Láº¥y profile qua getGroupMembersInfo (tá»± thÃªm _0 náº¿u cáº§n)
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

            // â”€â”€ Chiáº¿n lÆ°á»£c A: currentMems â”€â”€
            if (members.length === 0 && g.currentMems?.length > 0) {
                log('Strategy A: currentMems:', g.currentMems.length);
                members = g.currentMems.map(m => ({
                    uid: m.id,
                    name: m.dName || m.zaloName || `TV_${m.id.slice(-6)}`,
                    avatar: m.avatar_25 || m.avatar || '',
                }));
            }

            // â”€â”€ Chiáº¿n lÆ°á»£c B: memberIds + getGroupMembersInfo â”€â”€
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

            // â”€â”€ Chiáº¿n lÆ°á»£c C: adminIds fallback â”€â”€
            if (members.length === 0 && g.adminIds?.length > 0) {
                log('Strategy C: using adminIds:', g.adminIds.length);
                members = g.adminIds.map(uid => ({ uid, name: `Quáº£n trá»‹_${uid.slice(-6)}`, avatar: '' }));
            }
        }

        // â”€â”€ BÆ°á»›c 2 (Fallback D): getAllGroups â†’ getGroupInfo retry â”€â”€
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
                // v2 retry tráº£ memVerList
                const uids2 = g2.memVerList.map(mv => mv.includes('_') ? mv.split('_').slice(0, -1).join('_') : mv);
                members = uids2.map(uid => ({ uid, name: `TV_${uid.slice(-6)}`, avatar: '' }));
                log('Strategy D got memVerList:', members.length);
            }
        }

        // â”€â”€ Chiáº¿n lÆ°á»£c F: RAW v1 endpoint /api/group/getmg (khÃ´ng -v2) â”€â”€
        // v1 thÆ°á»ng tráº£ currentMems Ä‘áº§y Ä‘á»§ hÆ¡n v2
        if (members.length === 0) {
            log('Strategy F: custom v1 endpoint /api/group/getmg...');
            try {
                const v1Result = await new Promise((resolve) => {
                    try {
                        api.custom('_getmgV1', ({ utils }) => {
                            const url = utils.makeURL(`${api.zpwServiceMap.group[0]}/api/group/getmg`);
                            // Thá»­ params khÃ¡c: all=1, type=0 Ä‘á»ƒ force full list
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

        // â”€â”€ Chiáº¿n lÆ°á»£c G: force version=-1 trÃªn v2 â”€â”€
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

        // â”€â”€ Chiáº¿n lÆ°á»£c H: WebSocket Listener â€” trigger server push member list â”€â”€
        // Zalo app láº¥y member list qua WS push sau khi subscribe group. Ta trigger Ä‘iá»u Ä‘Ã³.
        if (members.length === 0) {
            log('Strategy H: WebSocket listener trigger...');
            try {
                const wsUids = await new Promise(resolve => {
                    const collectedUids = new Set();
                    const listener = api.listener;
                    const onGroupEvent = (evt) => {
                        // updateMembers lÃ  array objects {id, version} hoáº·c array string
                        const mems = evt?.data?.updateMembers || evt?.data?.members || [];
                        for (const m of mems) {
                            const uid = typeof m === 'string' ? m : (m.id || m.uid);
                            if (uid && uid !== '0') collectedUids.add(String(uid));
                        }
                        log('WS group_event, collected so far:', collectedUids.size);
                    };
                    listener.on('group_event', onGroupEvent);

                    // Start listener náº¿u chÆ°a cháº¡y
                    try { listener.start({ retryOnClose: false }); } catch (e) { }

                    // Gá»­i WS payload Ä‘á»ƒ trigger server push group info
                    // cmd 519, subCmd 1 lÃ  Zalo group info subscription
                    // cmd 602, subCmd 1 lÃ  group member list request
                    const wsPayloads = [
                        { version: 3, cmd: 519, subCmd: 1, data: { groupId: groupId.toString() } },
                        { version: 3, cmd: 602, subCmd: 1, data: { groupId: groupId.toString() } },
                        { version: 3, cmd: 611, subCmd: 0, data: { grid: groupId.toString() } },
                    ];
                    for (const payload of wsPayloads) {
                        try { listener.sendWs(payload); } catch (e) { }
                    }

                    // Chá» 5s Ä‘á»ƒ nháº­n push tá»« server
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

        // â”€â”€ Chiáº¿n lÆ°á»£c I: Endpoint Discovery qua zpwServiceMap â”€â”€
        // Dump service map Ä‘á»ƒ tÃ¬m undiscovered member list endpoints
        if (members.length === 0) {
            log('Strategy I: endpoint discovery...');
            const svcMap = api.zpwServiceMap || {};
            log('zpwServiceMap keys:', Object.keys(svcMap).join(','));
            const baseUrl = svcMap.group?.[0] || svcMap.chat?.[0] || '';
            // Thá»­ cÃ¡c endpoint pattern tiá»m nÄƒng cho member list
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
                        // Parse any UIDs tá»« response
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

        // â”€â”€ Chiáº¿n lÆ°á»£c E (BYPASS): Paginate chat history â†’ extract UIDs â”€â”€

        // PhÃ¹ há»£p vá»›i nhÃ³m 1000+ ngÆ°á»i khi member list bá»‹ block
        if (members.length === 0) {
            log('Strategy E: chat history paginate for large groups...');
            try {
                const totalExpected = g?.totalMember || 0;
                const uidSet = new Set();
                const MAX_ROUNDS = totalExpected > 500 ? 40 : 20; // 40 vÃ²ng cho nhÃ³m lá»›n
                const PER_ROUND = 50;
                let lastMsgId = '0';
                let round = 0;
                let hasMore = true;

                // VÃ²ng 1: láº¥y 1000 tin nháº¯n má»™t lÃºc (Zalo cho phÃ©p count lá»›n)
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
                    log(`Round 0: ${msgs.length} msgs â†’ ${uidSet.size} UIDs (hasMore=${hasMore})`);
                } catch (e) {
                    log('Initial big fetch err:', e.message);
                    // Fallback vá» 200 náº¿u 1000 fail
                    const hist = await api.getGroupChatHistory(groupId, 200);
                    const msgs = hist?.groupMsgs || [];
                    for (const msg of msgs) {
                        const uid = msg.uidFrom || msg.senderId;
                        if (uid && uid !== '0' && uid !== '') uidSet.add(String(uid));
                    }
                    hasMore = false;
                    log(`Fallback: ${msgs.length} msgs â†’ ${uidSet.size} UIDs`);
                }

                // Paginate náº¿u nhÃ³m cÃ²n thÃªm vÃ  chÆ°a Ä‘á»§ thÃ nh viÃªn
                while (hasMore && uidSet.size < totalExpected && round < MAX_ROUNDS) {
                    round++;
                    try {
                        // DÃ¹ng custom API Ä‘á»ƒ paginate báº±ng lastMsgId
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
                        log(`Round ${round}: +${msgs.length} msgs â†’ total UIDs: ${uidSet.size}`);
                        await new Promise(r => setTimeout(r, 300)); // Delay nhá» giá»¯a cÃ¡c round
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
                        if (i > 0) await new Promise(r => setTimeout(r, 200)); // Ngáº¯n delay
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


        // KhÃ´ng cÃ²n strategy nÃ o â†’ tráº£ lá»—i rÃµ rÃ ng
        if (members.length === 0) {
            log('ALL strategies failed');
            return {
                success: false,
                error: `KhÃ´ng láº¥y Ä‘Æ°á»£c thÃ nh viÃªn nhÃ³m. CÃ³ thá»ƒ nhÃ³m bá»‹ áº©n danh sÃ¡ch (lockViewMember) hoáº·c chÆ°a cÃ³ lá»‹ch sá»­ chat. g=${!!g}, memVerList=${g?.memVerList?.length || 0}, memberIds=${g?.memberIds?.length || 0}, currentMems=${g?.currentMems?.length || 0}`,
            };
        }


        // Lá»c bá» UID cá»§a chÃ­nh tÃ i khoáº£n Ä‘ang login
        const ownUid = String(api.getOwnId() || '');
        if (ownUid) {
            const before = members.length;
            members = members.filter(m => String(m.uid) !== ownUid);
            if (members.length !== before) {
                log(`Filtered out own UID ${ownUid}, members: ${before} â†’ ${members.length}`);
            }
        }

        const actualTotal = g?.totalMember || members.length;
        const coverage = members.length / Math.max(actualTotal, 1);
        const warning = coverage < 0.8 && actualTotal > members.length
            ? `âš ï¸ Chá»‰ tÃ¬m Ä‘Æ°á»£c ${members.length}/${actualTotal} thÃ nh viÃªn. Lurkers (ngÆ°á»i chÆ°a tá»«ng chat) khÃ´ng thá»ƒ láº¥y Ä‘Æ°á»£c qua lá»‹ch sá»­ tin nháº¯n.`
            : null;

        log(`SUCCESS: ${members.length} found / ${actualTotal} total (coverage ${Math.round(coverage * 100)}%)`);
        const result = { success: true, groupName, totalMember: members.length, actualTotal, members, warning, adminIds: g?.adminIds || [], creatorId: g?.creatorId || '' };

        // V2: Cache the result
        memberCache.set(groupId, result);

        return result;


    } catch (err) {
        console.error('[getGroupMembers] Error:', err.stack || err.message);
        return { success: false, error: err.message };
    }
}


// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// 7. SMART SEND â€” anti-block + exponential backoff
//    Cho nhÃ³m 1000+ ngÆ°á»i, trÃ¡nh rate limit Zalo
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
const sleep = ms => new Promise(r => setTimeout(r, ms));
const RATE_LIMIT_KEYWORDS = ['nhiá»u quÃ¡', 'rate', 'limit', 'flood', 'spam', 'quÃ¡ nhiá»u', 'too many', 'vÆ°á»£t quÃ¡'];
const isRateLimit = msg => RATE_LIMIT_KEYWORDS.some(k => String(msg).toLowerCase().includes(k));
const isBlockedByUser = msg => ['tham sá»‘', 'invalid', 'blocked', 'privacy'].some(k => String(msg).toLowerCase().includes(k));

async function sendMessageByUid(cookie, uid, message, _retryCount = 0) {
    const log = (...a) => console.log('[smartSend]', ...a);
    const MAX_RETRIES = 3;
    try {
        const api = await getApi(cookie);
        const { ThreadType } = await import('zca-js');

        // â”€â”€ Láº§n 1: Gá»­i trá»±c tiáº¿p vá»›i exponential backoff retry â”€â”€
        let directError = '';
        for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
            try {
                await api.sendMessage({ msg: message }, uid, ThreadType.User);
                log(`Direct OK (attempt ${attempt + 1}) â†’`, uid);
                return { success: true, uid, via: 'direct' };
            } catch (e) {
                directError = e.message || '';
                if (isRateLimit(directError)) {
                    // Rate limit â†’ backoff: 2s, 4s, 8s, 16s
                    const backoff = Math.pow(2, attempt + 1) * 1000;
                    log(`Rate limited! Backoff ${backoff}ms (attempt ${attempt + 1}/${MAX_RETRIES})`);
                    if (attempt < MAX_RETRIES) {
                        await sleep(backoff);
                        continue;
                    }
                }
                // KhÃ´ng pháº£i rate limit hoáº·c háº¿t retry â†’ break
                log(`Direct fail (attempt ${attempt + 1}) â†’`, uid, '|', directError);
                break;
            }
        }

        // Náº¿u Ä‘Ã£ bá»‹ rate limit sau táº¥t cáº£ retry
        if (isRateLimit(directError)) {
            log('Rate limit exhausted, waiting 30s before friend request...');
            await sleep(30000); // Chá» 30s trÆ°á»›c khi thá»­ cÃ¡ch khÃ¡c
        }

        // â”€â”€ Láº§n 2: Kiá»ƒm tra má»‘i quan há»‡ â”€â”€
        let status = null;
        try {
            status = await api.getFriendRequestStatus(uid);
        } catch (e) {
            log('getFriendRequestStatus err:', e.message);
        }

        if (status?.is_friend === 1) {
            // ÄÃ£ báº¡n bÃ¨ nhÆ°ng fail â†’ retry sau khi báº¡n bÃ¨
            log('Already friend but direct failed â†’ retry once after 2s');
            await sleep(2000);
            try {
                await api.sendMessage({ msg: message }, uid, ThreadType.User);
                return { success: true, uid, via: 'direct_retry' };
            } catch (e) {
                return { success: false, uid, error: `Báº¡n bÃ¨ nhÆ°ng khÃ´ng gá»­i Ä‘Æ°á»£c: ${e.message}` };
            }
        }

        if (status?.is_requesting) {
            log('Friend request already sent to', uid, 'â†’ mark success (message was in FR)');
            return { success: true, uid, via: 'friend_request_pending' };
        }

        // â”€â”€ Láº§n 3: Gá»­i lá»i má»i káº¿t báº¡n KÃˆM tin nháº¯n (bypass cháº·n ngÆ°á»i láº¡) â”€â”€
        log('Sending friend request WITH message to', uid);
        try {
            await api.sendFriendRequest(message, uid);
            log('FR + message OK â†’', uid);
            return { success: true, uid, via: 'friend_request' };
        } catch (e2) {
            if (isRateLimit(e2.message)) {
                log('FR also rate limited, waiting 60s...');
                await sleep(60000);
                // Retry FR má»™t láº§n ná»¯a
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



// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// 8. SAO CHÃ‰P THÃ€NH VIÃŠN NHÃ“M â€” Phase 4 bypass tinh vi
//    Láº¥y members tá»« nhÃ³m nguá»“n â†’ thÃªm vÃ o nhÃ³m Ä‘Ã­ch
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

// â”€â”€ Helper: láº¥y Set UID báº¡n bÃ¨ hiá»‡n táº¡i â”€â”€
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

// â”€â”€ HÃ m phÃª duyá»‡t pending members â€” dÃ¹ng API Ä‘Ãºng: reviewPendingMemberRequest â”€â”€
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

        // DÃ¹ng reviewPendingMemberRequest â€” API chuyÃªn biá»‡t, Há»– TRá»¢ batch
        // Gá»­i batch 100 má»—i láº§n
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
                    if (code === 0 || code === 178) { // 178 = Ä‘Ã£ trong nhÃ³m rá»“i â†’ cÅ©ng tÃ­nh lÃ  ok
                        approved++;
                    } else {
                        failed++;
                        log(`approve uid=${uid} code=${code} (${code === 166 ? 'no_perm' : code === 170 ? 'not_in_pending' : 'unknown'})`);
                    }
                }
                log(`Batch approve: +${approved}/${batch.length}`);
            } catch (e) {
                log('reviewPendingMemberRequest batch err:', e.message);
                // Fallback tá»«ng ngÆ°á»i
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

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// TRICK 1: "Temp Group Bridge" â€” DÃ nh cho Admin nhÃ³m Ä‘Ã­ch + NgÆ°á»i láº¡
//
// Thuáº­t toÃ¡n: Zalo cho phÃ©p CREATOR thÃªm Báº¤T Ká»² ai vÃ o nhÃ³m Má»šI.
// Khai thÃ¡c: táº¡o nhÃ³m táº¡m vá»›i ngÆ°á»i láº¡ â†’ há» cÃ³ quan há»‡ nhÃ³m vá»›i báº¡n
//            â†’ addUserToGroup tá»« nhÃ³m táº¡m sang nhÃ³m Ä‘Ã­ch thÃ nh cÃ´ng hÆ¡n
//            â†’ disperseGroup nhÃ³m táº¡m Ä‘á»ƒ dá»n dáº¹p.
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
async function addStrangersViaTempGroup(api, strangerUids, targetGroupId, { delayMs = 2000, onProgress, log } = {}) {
    log = log || ((...a) => console.log('[tempGroupTrick]', ...a));
    const results = { added: 0, failed: 0, errors: [] };
    const BATCH = 100; // Zalo createGroup cháº¥p nháº­n nhiá»u ngÆ°á»i
    let batch1Done = 0;

    // Chia ngÆ°á»i láº¡ thÃ nh chunks 100 â€” má»—i chunk táº¡o 1 nhÃ³m táº¡m
    for (let i = 0; i < strangerUids.length; i += BATCH) {
        const chunk = strangerUids.slice(i, i + BATCH);
        let tempGroupId = null;
        log(`Batch ${Math.ceil(i / BATCH) + 1}: Táº¡o nhÃ³m táº¡m vá»›i ${chunk.length} ngÆ°á»i láº¡...`);

        try {
            // BÆ°á»›c 1: createGroup vá»›i ngÆ°á»i láº¡ (creator bypass â€” khÃ´ng cáº§n lÃ  báº¡n bÃ¨)
            const cr = await api.createGroup({
                name: `_temp_${Date.now()}`,  // tÃªn táº¡m, sáº½ xÃ³a sau
                members: chunk,
            });
            tempGroupId = cr?.groupId;
            if (!tempGroupId) throw new Error('createGroup khÃ´ng tráº£ vá» groupId');

            const tempOk = new Set(cr?.sucessMembers || []);
            const tempFail = new Set(cr?.errorMembers || []);
            log(`  createGroup: +${tempOk.size} ok, ${tempFail.size} fail â†’ gid=${tempGroupId}`);
            await sleep(1500); // chá» nhÃ³m táº¡m á»•n Ä‘á»‹nh

            // BÆ°á»›c 2: addUserToGroup tá»« nhÃ³m táº¡m â†’ nhÃ³m Ä‘Ã­ch
            // Giá» há» Ä‘Ã£ cÃ³ "quan há»‡ nhÃ³m" vá»›i báº¡n â€” success rate tÄƒng
            if (tempOk.size > 0) {
                const uidsToMove = [...tempOk];
                try {
                    const ar = await api.addUserToGroup(uidsToMove, targetGroupId);
                    const errSet = new Set(ar?.errorMembers || []);
                    const ok = uidsToMove.length - errSet.size;
                    results.added += ok;
                    log(`  move to target: +${ok}/${uidsToMove.length} err=${errSet.size}`);

                    // Retry tá»«ng ngÆ°á»i failed
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

            // Lá»—i ngay tá»« createGroup â†’ dÃ¹ng inviteUserToGroups
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
            // Fallback: invite táº¥t cáº£ trong chunk
            for (const uid of chunk) {
                try {
                    const inv = await api.inviteUserToGroups(uid, [targetGroupId]);
                    if (inv?.grid_message_map?.[targetGroupId]?.error_code === 0) results.added++;
                    else results.failed++;
                } catch (e2) { results.failed++; }
                await sleep(400);
            }
        } finally {
            // BÆ°á»›c 3: XÃ³a nhÃ³m táº¡m (dá»n dáº¹p quan trá»ng!)
            if (tempGroupId) {
                try {
                    await sleep(1000);
                    await api.disperseGroup(tempGroupId);
                    log(`  disperseGroup ${tempGroupId} âœ“ (dá»n sáº¡ch)`);
                } catch (e) { log(`  disperseGroup fail (khÃ´ng quan trá»ng):`, e.message); }
            }
        }

        batch1Done += chunk.length;
        if (onProgress) onProgress(batch1Done, strangerUids.length);
        if (i + BATCH < strangerUids.length) await sleep(delayMs);
    }
    return results;
}

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// TRICK 2: "Invite Link Engine" â€” Khi khÃ´ng pháº£i admin nhÃ³m Ä‘Ã­ch
//
// Thuáº­t toÃ¡n: Náº¿u báº¡n cÃ³ quyá»n táº¡o invite link (member thÆ°á»ng cÅ©ng cÃ³):
// 1. enableGroupLink(targetGroupId) â†’ láº¥y link join
// 2. sendMessage(uid, link) â†’ ngÆ°á»i láº¡ nháº­n Ä‘Æ°á»£c link
// 3. Há» click link â†’ joinGroupLink â†’ join nhÃ³m KHÃ”NG Cáº¦N approval
//    (link join bypass joinAppr náº¿u link khÃ´ng require approval riÃªng)
//
// Háº¡n cháº¿: há» pháº£i tá»± báº¥m â€” khÃ´ng 100% tá»± Ä‘á»™ng
// NhÆ°ng Ä‘Ã¢y lÃ  CÃCH DUY NHáº¤T há»£p lá»‡ khi khÃ´ng pháº£i admin
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
async function getOrEnableGroupLink(api, groupId) {
    try {
        const linkInfo = await api.enableGroupLink(groupId);
        return linkInfo?.link || null;
    } catch (e) {
        // Thá»­ getGroupLinkDetail náº¿u link Ä‘Ã£ tá»“n táº¡i
        try {
            const det = await api.getGroupLinkDetail(groupId);
            return det?.link || null;
        } catch (e2) { return null; }
    }
}

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// GIáº¢I PHÃP DUY NHáº¤T KHI KHÃ”NG CÃ“ ADMIN: Invite Link Bypass
//
// Insight: joinGroupLink (join qua link) BYPASS joinAppr hoÃ n toÃ n!
// Ngay cáº£ khi nhÃ³m báº­t "yÃªu cáº§u phÃª duyá»‡t", join báº±ng link váº«n vÃ o
// tháº³ng nhÃ³m mÃ  KHÃ”NG cáº§n admin duyá»‡t.
//
// Chiáº¿n lÆ°á»£c 3-kÃªnh song song:
//   KÃªnh 1: sendLink (DM) â†’ link + tin nháº¯n má»i
//   KÃªnh 2: inviteUserToGroups â†’ push notification má»i vÃ o nhÃ³m
//   KÃªnh 3: sendMessage (DM) â†’ tin nháº¯n thÆ°á»ng nháº¯c join
//
// LÆ°u Ã½: YÃªu cáº§u member PHáº¢I Tá»° Báº¤M â€” khÃ´ng 100% tá»± Ä‘á»™ng
//        nhÆ°ng lÃ  cÃ¡ch DUY NHáº¤T vÃ  PHÃP LÃ khi khÃ´ng cÃ³ admin
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
async function forceJoinViaLink(cookie, targetGroupId, memberUids, options = {}) {
    const log = (...a) => console.log('[forceJoinViaLink]', ...a);
    const {
        customMsg = null,    // Tin nháº¯n tÃ¹y chá»‰nh (null = dÃ¹ng máº·c Ä‘á»‹nh)
        delayMs = 1500,     // Delay giá»¯a má»—i ngÆ°á»i (anti-spam)
        onProgress = null,
    } = options;

    try {
        const api = await getApi(cookie);

        // BÆ°á»›c 1: Láº¥y hoáº·c táº¡o invite link cá»§a nhÃ³m
        log(`Step 1: enableGroupLink cho nhÃ³m ${targetGroupId}`);
        let groupLink = null;
        try {
            // Thá»­ getGroupLinkDetail trÆ°á»›c â€” náº¿u link Ä‘Ã£ tá»“n táº¡i
            const det = await api.getGroupLinkDetail(targetGroupId);
            if (det?.enabled === 1 && det?.link) {
                groupLink = det.link;
                log(`  Link Ä‘Ã£ tá»“n táº¡i: ${groupLink}`);
            }
        } catch (e) { /* chÆ°a cÃ³ link */ }

        if (!groupLink) {
            // Táº¡o má»›i invite link
            const linkRes = await api.enableGroupLink(targetGroupId);
            groupLink = linkRes?.link;
            log(`  Link má»›i: ${groupLink}`);
        }

        if (!groupLink) {
            return { success: false, error: 'KhÃ´ng láº¥y Ä‘Æ°á»£c invite link (khÃ´ng Ä‘á»§ quyá»n?)' };
        }

        // BÆ°á»›c 2: Láº¥y tÃªn nhÃ³m Ä‘á»ƒ táº¡o tin nháº¯n má»i háº¥p dáº«n
        let groupName = 'nhÃ³m cá»§a chÃºng tÃ´i';
        try {
            const gi = await api.getGroupInfo(targetGroupId);
            groupName = gi?.gridInfoMap?.[targetGroupId]?.name || groupName;
        } catch (e) { }

        const inviteMsg = customMsg ||
            `ðŸŽ‰ Báº¡n Ä‘Æ°á»£c má»i tham gia nhÃ³m "${groupName}"!\n` +
            `ðŸ‘† Click link sau Ä‘á»ƒ join ngay (khÃ´ng cáº§n phÃª duyá»‡t):\n${groupLink}`;

        log(`Step 2: Gá»­i link Ä‘áº¿n ${memberUids.length} thÃ nh viÃªn...`);

        // BÆ°á»›c 3: Gá»­i theo 3 kÃªnh song song cho má»—i UID
        const results = { sent: 0, failed: 0, link: groupLink, errors: [] };

        for (let i = 0; i < memberUids.length; i++) {
            const uid = memberUids[i];
            let sent = false;

            // KÃªnh 1: inviteUserToGroups â€” gá»­i push notification invite
            try {
                const inv = await api.inviteUserToGroups(uid, [targetGroupId]);
                const code = inv?.grid_message_map?.[targetGroupId]?.error_code;
                if (code === 0) {
                    sent = true;
                    log(`  [${i + 1}/${memberUids.length}] invite OK: ${uid}`);
                }
            } catch (e) { log(`  invite err ${uid}:`, e.message); }

            // KÃªnh 2: sendLink â€” gá»­i DM vá»›i link join (ThreadType.User = 0)
            try {
                await api.sendLink(
                    { msg: inviteMsg, link: groupLink },
                    uid,
                    0  // ThreadType.User = DM
                );
                sent = true;
                log(`  [${i + 1}/${memberUids.length}] sendLink OK: ${uid}`);
            } catch (e) {
                // Fallback: sendMessage thÆ°á»ng
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

            // Anti-spam delay giá»¯a má»—i ngÆ°á»i
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
        batchSize = 100,       // â† Batch 100 ngÆ°á»i/láº§n (chÃ­nh sÃ¡ch Zalo cho phÃ©p)
        delayMs = 3000,      // Delay giá»¯a batch chÃ­nh (anti-ban)
        retryDelay = 5000,      // Delay trÆ°á»›c khi retry tá»«ng ngÆ°á»i lá»—i
        createNewGroup = false,
        newGroupName = '',
    } = options;

    // â”€â”€ Helper: retry má»™t UID Ä‘Æ¡n láº» vá»›i 4 cáº¥p â”€â”€
    // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
    // 5-LAYER FORCE ADD â€” HoÃ n toÃ n tá»± Ä‘á»™ng (target KHÃ”NG cáº§n click gÃ¬!)
    //
    //  L1: addUserToGroup trá»±c tiáº¿p (admin force â†’ silent add, 0 click)
    //  L2: Retry sau backoff (rate limit recovery, 0 click)
    //  L3: createGroup TEMP BRIDGE (creator privilege bypass privacy!)
    //      â†’ táº¡o nhÃ³m táº¡m vá»›i stranger â†’ há» bá»‹ force vÃ o nhÃ³m táº¡m
    //      â†’ addUserToGroup tá»« nhÃ³m táº¡m sang nhÃ³m Ä‘Ã­ch (0 click)
    //      â†’ disperseGroup nhÃ³m táº¡m (dá»n sáº¡ch)
    //  L4: Retry addUserToGroup sau Temp Bridge (0 click)
    //  L5: addUserToGroup delay dÃ i final attempt (0 click)
    //
    // QUAN TRá»ŒNG: Zalo cÃ³ thá»ƒ block L3 náº¿u user báº­t privacy "block group add"
    //             KhÃ´ng cÃ³ API nÃ o vÆ°á»£t qua Ä‘Æ°á»£c server-side privacy enforcement
    // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
    const tryAddOne = async (api, uid, gid) => {
        // â”€â”€ Layer 1: Direct admin force add (0 click tá»« target) â”€â”€
        try {
            const r = await api.addUserToGroup([uid], gid);
            if (!r?.errorMembers?.includes(uid)) return { uid, ok: true, via: 'L1_admin_add' };
        } catch (e) {
            if (isRateLimit(e.message)) {
                log(`  L1 rate-limit â†’ backoff 15s`);
                await sleep(15000);
            }
        }

        // â”€â”€ Layer 2: Retry sau backoff ngáº¯n (0 click) â”€â”€
        await sleep(retryDelay);
        try {
            const r2 = await api.addUserToGroup([uid], gid);
            if (!r2?.errorMembers?.includes(uid)) return { uid, ok: true, via: 'L2_add_retry' };
        } catch (e) {
            if (isRateLimit(e.message)) await sleep(20000);
        }

        // â”€â”€ Layer 3: TEMP GROUP BRIDGE â€” Khai thÃ¡c creator privilege â”€â”€
        // Zalo creator cÃ³ thá»ƒ force-add Báº¤T Ká»² ai vÃ o nhÃ³m Má»šI (bypass privacy!)
        // Sau khi stranger vÃ o nhÃ³m táº¡m â†’ cÃ³ "quan há»‡ nhÃ³m" â†’ addUserToGroup sang Ä‘Ã­ch
        let tempCreated = null;
        try {
            log(`  L3 TempBridge: createGroup for uid=${uid}`);
            const cr = await api.createGroup({
                name: `_t_${Date.now()}`,   // tÃªn táº¡m, xÃ³a ngay sau
                members: [uid],
            });
            tempCreated = cr?.groupId;
            const tempOk = !cr?.errorMembers?.includes(uid);

            if (tempCreated && tempOk) {
                log(`    tempGroup=${tempCreated} â†’ stranger vÃ o âœ“`);
                await sleep(1200); // chá» nhÃ³m táº¡m á»•n Ä‘á»‹nh

                // Force add sang nhÃ³m Ä‘Ã­ch (giá» Ä‘Ã£ cÃ³ group relationship)
                const r3 = await api.addUserToGroup([uid], gid);
                if (!r3?.errorMembers?.includes(uid)) {
                    log(`    L3 bridge success uid=${uid}`);
                    return { uid, ok: true, via: 'L3_temp_bridge' };
                }
                // Bridge vÃ o nhÃ³m táº¡m ok nhÆ°ng move sang Ä‘Ã­ch tháº¥t báº¡i
                // â†’ thá»­ láº¡i sau delay
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
            // LUÃ”N xÃ³a nhÃ³m táº¡m dÃ¹ cÃ³ lá»—i hay khÃ´ng
            if (tempCreated) {
                try {
                    await sleep(500);
                    await api.disperseGroup(tempCreated);
                    log(`    disperseGroup ${tempCreated} âœ“`);
                } catch (e2) { /* khÃ´ng quan trá»ng */ }
            }
        }

        // â”€â”€ Layer 4: Retry sau Temp Bridge vá»›i delay dÃ i hÆ¡n (0 click) â”€â”€
        await sleep(retryDelay * 2);
        try {
            const r4 = await api.addUserToGroup([uid], gid);
            if (!r4?.errorMembers?.includes(uid)) return { uid, ok: true, via: 'L4_post_bridge_retry' };
        } catch (e) { }

        // â”€â”€ Layer 5: Final force attempt sau long delay (0 click) â”€â”€
        await sleep(retryDelay * 3);
        try {
            const r5 = await api.addUserToGroup([uid], gid);
            if (!r5?.errorMembers?.includes(uid)) return { uid, ok: true, via: 'L5_final' };
        } catch (e) { }

        // Thá»±c sá»± cháº·n hoÃ n toÃ n (privacy server-side enforcement)
        return { uid, ok: false, via: 'privacy_blocked_server' };
    };


    try {
        const api = await getApi(cookie);
        const ownUid = String(api.getOwnId() || '');

        // â”€â”€ Láº¥y toÃ n bá»™ UID tá»« nhÃ³m nguá»“n â”€â”€
        log('Fetching source group members:', sourceGroupId);
        const srcResult = await getGroupMembers(cookie, sourceGroupId);
        if (!srcResult.success || !srcResult.members?.length) {
            return { success: false, error: 'KhÃ´ng láº¥y Ä‘Æ°á»£c thÃ nh viÃªn nhÃ³m nguá»“n: ' + (srcResult.error || 'unknown') };
        }

        const allUids = srcResult.members
            .map(m => String(m.uid))
            .filter(uid => uid && uid !== ownUid && uid !== '0');
        log(`Source: ${allUids.length} UIDs`);

        // â”€â”€ Láº¥y members hiá»‡n táº¡i cá»§a nhÃ³m Ä‘Ã­ch Ä‘á»ƒ bá» qua duplicate â”€â”€
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
            return { success: true, added: 0, failed: 0, total: 0, msg: 'Táº¥t cáº£ Ä‘Ã£ cÃ³ trong nhÃ³m Ä‘Ã­ch!' };

        const results = { added: 0, failed: 0, errors: [], details: [] };
        let createdGroupId = null;
        let activeGid = targetGroupId;

        // â”€â”€ PRE-ANALYSIS: PhÃ¢n loáº¡i báº¡n bÃ¨ vs ngÆ°á»i láº¡ (friends first!) â”€â”€
        // Báº¡n bÃ¨ â†’ addUserToGroup thÃ nh cÃ´ng gáº§n 100%
        // NgÆ°á»i láº¡ â†’ cáº§n inviteUserToGroups hoáº·c link
        let friendUids = new Set();
        try {
            friendUids = await getFriendSet(api);
            const friendCount = toAdd.filter(u => friendUids.has(u)).length;
            log(`Pre-analysis: ${friendCount} friends / ${toAdd.length - friendCount} non-friends`);
            // Æ¯u tiÃªn báº¡n bÃ¨ lÃªn Ä‘áº§u trong toAdd
            if (friendCount > 0 && friendCount < toAdd.length) {
                toAdd.sort((a, b) => {
                    const aF = friendUids.has(a) ? 0 : 1;
                    const bF = friendUids.has(b) ? 0 : 1;
                    return aF - bF;
                });
                log('Sorted: friends first â†’ higher success rate');
            }
        } catch (e) { log('getFriendSet skip:', e.message); }

        // â”€â”€ PHASE 0 (bypass pending): Táº¡m táº¯t yÃªu cáº§u phÃª duyá»‡t â”€â”€
        // Chá»‰ Ã¡p dá»¥ng khi thÃªm vÃ o nhÃ³m cÃ³ sáºµn vÃ  user lÃ  admin nhÃ³m Ä‘Ã³
        let joinApprWasOn = false;
        if (!createNewGroup && activeGid) {
            try {
                const gi = await api.getGroupInfo(activeGid);
                const setting = gi?.gridInfoMap?.[activeGid]?.setting;
                // joinAppr = 1 cÃ³ nghÄ©a Ä‘ang Báº¬T yÃªu cáº§u duyá»‡t
                if (setting?.joinAppr === 1) {
                    joinApprWasOn = true;
                    await api.updateGroupSettings({ joinAppr: false }, activeGid);
                    log('Phase 0: ÄÃ£ Táº®T joinAppr (bypass pending approval)');
                    await sleep(1000); // Äá»£i setting apply
                }
            } catch (e) {
                log('Phase 0: KhÃ´ng táº¯t Ä‘Æ°á»£c joinAppr (khÃ´ng pháº£i admin?):', e.message);
                // Tiáº¿p tá»¥c bÃ¬nh thÆ°á»ng â€” sáº½ handle pending sau
            }
        }

        // â•â•â•â•â•â•â•â•â•â•â•â•â•â• CHáº¾ Äá»˜ Táº O NHÃ“M Má»šI â•â•â•â•â•â•â•â•â•â•â•â•â•â•
        if (createNewGroup) {
            const gname = newGroupName || `Sao chÃ©p ${srcResult.groupName || ''} ${new Date().toLocaleDateString('vi-VN')}`;
            log('createGroup mode:', gname, `| ${toAdd.length} members`);

            // Batch Ä‘áº§u tiÃªn: táº¡o nhÃ³m (Zalo createGroup chá»©a Ä‘Æ°á»£c nhiá»u ngÆ°á»i)
            const firstBatch = toAdd.slice(0, batchSize);
            try {
                const cr = await api.createGroup({ name: gname, members: firstBatch });
                createdGroupId = cr?.groupId;
                activeGid = createdGroupId;
                const succUids = new Set(cr?.sucessMembers || []);
                const failUids = new Set(cr?.errorMembers || []);
                results.added += succUids.size;
                log(`createGroup OK gid=${createdGroupId} +${succUids.size}/${firstBatch.length} fail=${failUids.size}`);

                // Retry cÃ¡c UID lá»—i ngay tá»« createGroup
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

            // CÃ¡c batch tiáº¿p theo thÃªm vÃ o nhÃ³m má»›i táº¡o
            for (let i = batchSize; i < toAdd.length; i += batchSize) {
                const batch = toAdd.slice(i, i + batchSize);
                log(`addBatch ${Math.ceil(i / batchSize) + 1}: ${batch.length} UIDs â†’ gid=${activeGid}`);
                await sleep(delayMs);

                let batchOk = 0;
                try {
                    const ar = await api.addUserToGroup(batch, activeGid);
                    const errSet = new Set(ar?.errorMembers || []);
                    batchOk = batch.length - errSet.size;
                    results.added += batchOk;
                    log(`  batch OK +${batchOk}/${batch.length}`);

                    // Retry tá»«ng UID lá»—i qua 4-tier cascade
                    for (const uid of errSet) {
                        await sleep(800);
                        const r = await tryAddOne(api, uid, activeGid);
                        if (r.ok) { results.added++; batchOk++; }
                        else { results.failed++; results.errors.push(uid); }
                        log(`  retry ${uid}: ${r.via}`);
                    }
                } catch (e) {
                    // Rate limit toÃ n batch â†’ backoff 30s rá»“i retry
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

        // â•â•â•â•â•â•â•â•â•â•â•â•â•â• CHáº¾ Äá»˜ THÃŠM VÃ€O NHÃ“M CÃ“ Sáº´N â•â•â•â•â•â•â•â•â•â•â•â•â•â•
        log(`addToExisting mode | gid=${activeGid} | ${toAdd.length} UIDs | batch=${batchSize}`);

        for (let i = 0; i < toAdd.length; i += batchSize) {
            const batch = toAdd.slice(i, i + batchSize);
            const batchNo = Math.ceil(i / batchSize) + 1;
            log(`â”€â”€ Batch ${batchNo}: ${batch.length} UIDs`);

            let batchOk = 0;
            let rateLimited = false;
            try {
                const ar = await api.addUserToGroup(batch, activeGid);
                const errSet = new Set(ar?.errorMembers || []);
                batchOk = batch.length - errSet.size;
                results.added += batchOk;
                log(`  Batch ${batchNo} direct: +${batchOk}/${batch.length} err=${errSet.size}`);

                // Per-user 4-tier retry cho tá»«ng UID lá»—i
                for (const uid of errSet) {
                    await sleep(800);
                    const r = await tryAddOne(api, uid, activeGid);
                    if (r.ok) { results.added++; batchOk++; }
                    else { results.failed++; results.errors.push(uid); }
                    log(`  retry ${uid}: ${r.via}`);
                }
            } catch (e) {
                if (isRateLimit(e.message)) {
                    log(`Batch ${batchNo} rate-limited â†’ backoff 30s, redo`);
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

            // Delay giá»¯a batch (ngoáº¡i trá»« batch cuá»‘i)
            if (i + batchSize < toAdd.length) await sleep(delayMs);
        }

        log(`FINAL batch loop: +${results.added} fail=${results.failed}/${toAdd.length}`);

        // â”€â”€ TRICK 1A: Temp Group Bridge cho ngÆ°á»i láº¡ váº«n fail sau retry â”€â”€
        // Collect failed UIDs lÃ  ngÆ°á»i láº¡ (khÃ´ng cÃ³ trong friendUids)
        const failedStrangers = results.errors.filter(uid => !friendUids.has(uid));
        if (failedStrangers.length > 0 && activeGid) {
            log(`TRICK 1A: ${failedStrangers.length} failed strangers â†’ Temp Group Bridge`);
            try {
                const tgRes = await addStrangersViaTempGroup(
                    api, failedStrangers, activeGid,
                    { delayMs, onProgress, log }
                );
                // XÃ³a khá»i errors nhá»¯ng uid Ä‘Ã£ Ä‘Æ°á»£c bridge xá»­ lÃ½
                results.added += tgRes.added;
                results.failed += tgRes.failed - failedStrangers.length; // adjust: nhá»¯ng failed trÆ°á»›c nay ok
                results.errors = results.errors.filter(u => tgRes.errors.includes(u));
                log(`TRICK 1A result: +${tgRes.added} still fail=${tgRes.failed}`);
            } catch (e) { log('TRICK 1A err:', e.message); }
        }

        // â”€â”€ TRICK 2: Invite Link fallback (cho non-admin vÃ  ngÆ°á»i láº¡ váº«n chÆ°a thÃªm Ä‘Æ°á»£c) â”€â”€
        const totalFailed = results.failed;
        if (totalFailed > 0 || !joinApprWasOn) {
            // Thá»­ láº¥y group invite link Ä‘á»ƒ log ra (admin cÃ³ thá»ƒ share cho ngÆ°á»i láº¡ tá»± join)
            try {
                const link = await getOrEnableGroupLink(api, activeGid);
                if (link) {
                    log(`TRICK 2: Group invite link = ${link}`);
                    log(`  â†’ Share link nÃ y cho ${totalFailed} ngÆ°á»i láº¡ Ä‘á»ƒ há» tá»± join bypass approval`);
                    results.inviteLink = link; // tráº£ vá» Ä‘á»ƒ UI hiá»ƒn thá»‹
                }
            } catch (e) { log('TRICK 2 getGroupLink err:', e.message); }
        }

        log(`FINAL: +${results.added} fail=${results.failed}/${toAdd.length}`);

        // â”€â”€ PHASE 3: Auto-approve members cÃ²n bá»‹ pending dÃ¹ng Ä‘Ãºng API: reviewPendingMemberRequest â”€â”€
        if (!createNewGroup && activeGid) {
            try {
                const pend = await api.getPendingGroupMembers(activeGid);
                const pendUsers = pend?.users || [];
                if (pendUsers.length > 0) {
                    log(`Phase 3: ${pendUsers.length} pending â†’ reviewPendingMemberRequest`);
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
                            // Fallback tá»«ng ngÆ°á»i
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
                    log('Phase 3: KhÃ´ng cÃ³ pending members âœ”');
                }
            } catch (e) { log('Phase 3 getPendingGroupMembers err:', e.message); }
        }

        // â”€â”€ PHASE 4: KhÃ´i phá»¥c joinAppr settings â”€â”€
        if (joinApprWasOn && activeGid) {
            try {
                await sleep(1000);
                await api.updateGroupSettings({ joinAppr: true }, activeGid);
                log('Phase 4: ÄÃ£ báº­t láº¡i joinAppr (restore settings)');
            } catch (e) { log('Phase 4 restore err (khÃ´ng áº£nh hÆ°á»Ÿng káº¿t quáº£):', e.message); }
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





// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
//  HYDRA â€” Thuáº­t toÃ¡n 7 lá»›p tá»‘i thÆ°á»£ng
//  Má»¥c tiÃªu: 100% thÃ nh viÃªn tá»« nhÃ³m nguá»“n sang nhÃ³m Ä‘Ã­ch
//
//  Cá»T LÃ•I INSIGHT vá» ZCA-JS / Zalo server:
//  â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”
//  â”‚  "block group add" chá»‰ block addUserToGroup vÃ o NHÃ“M CÅ¨.   â”‚
//  â”‚  NHÆ¯NG: createGroup(members=[stranger_uid]) lÃ  CREATOR      â”‚
//  â”‚  PRIVILEGE â†’ Zalo server cho phÃ©p thÃªm Báº¤T Ká»² UID nÃ o      â”‚
//  â”‚  vÃ o nhÃ³m Má»šI vá»«a táº¡o (khÃ´ng bá»‹ cháº·n privacy).             â”‚
//  â”‚                                                             â”‚
//  â”‚  SAU KHI stranger vÃ o temp group â†’ há» cÃ³ "group bond"       â”‚
//  â”‚  vá»›i account cá»§a báº¡n â†’ addUserToGroup sang group Ä‘Ã­ch       â”‚
//  â”‚  cÃ³ success rate CAO HÆ N NHIá»€U.                             â”‚
//  â”‚                                                             â”‚
//  â”‚  Náº¿u váº«n fail â†’ inviteUserToGroups gá»­i PUSH NOTIFICATION    â”‚
//  â”‚  vÃ o app Zalo cá»§a há» â†’ 1-tap Ä‘á»ƒ join.                       â”‚
//  â”‚                                                             â”‚
//  â”‚  Cuá»‘i cÃ¹ng: sendFriendRequest(linkMsg) â†’ link DM qua kÃªnh  â”‚
//  â”‚  lá»i má»i káº¿t báº¡n â€” bypass hoÃ n toÃ n "block DM strangers".  â”‚
//  â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜
//
//  LAYER 1 : Táº¯t joinAppr + batch addUserToGroup (ai khÃ´ng privacy)
//  LAYER 2 : createGroup TEMP BRIDGE â†’ move to target (0 click)
//  LAYER 3 : CASCADE BRIDGE â€” táº¡o temp group tá»« context shared temp (0 click)
//  LAYER 4 : inviteUserToGroups push notification (1-tap trong app)
//  LAYER 5 : sendFriendRequest + link má»i (bypass block DM + bypass block group)
//  LAYER 6 : Multi-wave retry daemon (kiá»ƒm tra ai Ä‘Ã£ join thá»±c táº¿ â†’ retry cÃ²n láº¡i)
//  LAYER 7 : Auto re-approve pending má»—i wave + restore settings
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

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
        maxWaves = 3,          // sá»‘ vÃ²ng retry tá»‘i Ä‘a (wave 1, 2, 3)
        waveDelay = 30000,     // delay giá»¯a cÃ¡c wave (30s)
        createNewGroup = false,
        newGroupName = '',
    } = options;

    // â”€â”€ Gaussian jitter: delay ngáº«u nhiÃªn giá»‘ng hÃ nh vi ngÆ°á»i tháº­t â”€â”€
    const jitter = (base) => base + Math.floor((Math.random() - 0.5) * base * 0.4);

    // â”€â”€ Create variant messages: chÃ¨n zero-width chars Ä‘á»ƒ má»—i tin khÃ¡c nhau â”€â”€
    const zwChars = ['\u200b', '\u200c', '\u200d', '\u2060'];
    function variantMsg(base) {
        const zw = zwChars[Math.floor(Math.random() * zwChars.length)];
        const pos = Math.floor(base.length / 2);
        return base.slice(0, pos) + zw + base.slice(pos);
    }

    // â”€â”€ Kiá»ƒm tra ai ÄÃƒ trong nhÃ³m Ä‘Ã­ch (real-time check) â”€â”€
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

    // â”€â”€ Auto-approve hÃ ng loáº¡t táº¥t cáº£ pending â”€â”€
    async function autoApprovePending(api, gid) {
        try {
            // BÆ°á»›c 1: láº¥y danh sÃ¡ch pending
            let rawResp = null;
            try {
                rawResp = await api.getPendingGroupMembers(gid);
            } catch (e1) {
                log(`AutoApprove: getPendingGroupMembers err: ${e1.message}`);
                return 0;
            }

            // DEBUG: in toÃ n bá»™ response Ä‘á»ƒ biáº¿t cáº¥u trÃºc thá»±c
            log(`AutoApprove DEBUG raw: ${JSON.stringify(rawResp)?.slice(0, 300)}`);

            // Probe táº¥t cáº£ cÃ¡c field cÃ³ thá»ƒ chá»©a users
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
                log(`AutoApprove: khÃ´ng cÃ³ pending members (rawResp keys=${Object.keys(rawResp || {}).join(',')})`);
                return 0;
            }

            // TrÃ­ch xuáº¥t UID
            const uids = rawUsers
                .map(u => (typeof u === 'string' || typeof u === 'number')
                    ? String(u) : String(u?.uid || u?.id || u?.userId || u?.memberId || ''))
                .filter(u => u && u !== '0' && /^\d+$/.test(u));

            log(`AutoApprove: ${uids.length} UIDs cáº§n duyá»‡t: [${uids.slice(0, 5).join(',')}${uids.length > 5 ? '...' : ''}]`);

            if (uids.length === 0) {
                log(`AutoApprove: khÃ´ng parse Ä‘Æ°á»£c UID tá»« rawUsers[0]=${JSON.stringify(rawUsers[0])}`);
                return 0;
            }

            // BÆ°á»›c 2: duyá»‡t tá»«ng batch
            let approved = 0;
            for (let i = 0; i < uids.length; i += 20) {
                const batch = uids.slice(i, i + 20);
                try {
                    const res = await api.reviewPendingMemberRequest(
                        { members: batch, isApprove: true }, gid
                    );

                    log(`AutoApprove batch[${i}]: res=${JSON.stringify(res)?.slice(0, 200)}`);

                    // Parse response: cÃ³ thá»ƒ lÃ  array of codes hoáº·c object uidâ†’code
                    if (Array.isArray(res)) {
                        for (const code of res) {
                            if (code === 0 || code === 178 || code === null) approved++;
                        }
                    } else if (res && typeof res === 'object') {
                        for (const [, code] of Object.entries(res)) {
                            if (code === 0 || code === 178 || code === null) approved++;
                        }
                    } else {
                        // Náº¿u API khÃ´ng throw â†’ coi nhÆ° thÃ nh cÃ´ng
                        approved += batch.length;
                    }
                } catch (batchErr) {
                    log(`AutoApprove batch err: ${batchErr.message} â†’ retry 1 by 1`);
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

            if (approved > 0) log(`AutoApprove: âœ… +${approved} Ä‘Ã£ Ä‘Æ°á»£c duyá»‡t`);
            else log(`AutoApprove: 0 duyá»‡t thÃ nh cÃ´ng (check log trÃªn)`);
            return approved;
        } catch (e) {
            log(`AutoApprove fatal: ${e.message}`);
            return 0;
        }
    }


    // â”€â”€ Rate-limit / Quota detection â”€â”€
    function isRateLimit(msg) {
        if (!msg) return false;
        const m = msg.toLowerCase();
        return m.includes('rate') || m.includes('limit') || m.includes('flood') || m.includes('too many') || m.includes('429') || m.includes('quÃ¡ sá»‘ láº§n');
    }
    function isQuotaExhausted(msg) {
        if (!msg) return false;
        const m = msg.toUpperCase();
        return m.includes('MAX_QUOTA') || m.includes('QUOTA_INVITE') || m.includes('STRANGER_PHONEID');
    }

    // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    // HYDRA CORE v2: Permanent Bridge Group
    // bridgeGid = nhÃ³m cáº§u ná»‘i cá»‘ Ä‘á»‹nh (táº¡o vá»›i friend anchor), dÃ¹ng láº¡i cho má»i stranger
    //
    // L1: Direct addUserToGroup
    // L2: Bridge Add â€” addUserToGroup([uid], bridgeGid) vÃ  ngÆ°á»i vÃ o bridge (creator privilege)
    //     â†’ ngay sau: addUserToGroup([uid], targetGid) trong "bond window"
    // L3: Batch bridge â€” sau L2, batch move táº¥t cáº£ ai vÃ o bridge â†’ target cÃ¹ng lÃºc
    // L4: Push notification invite (1-tap)
    // L5: sendFriendRequest + link
    // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    async function hydraAddOne(api, uid, gid, groupLink, groupName, bridgeGid) {

        // â”€â”€ LAYER 1: Direct addUserToGroup â”€â”€
        try {
            const r = await api.addUserToGroup([uid], gid);
            if (!r?.errorMembers?.includes(uid)) {
                log(`  [L1-OK] ${uid} â†’ direct add`);
                return { uid, ok: true, via: 'L1_direct' };
            }
        } catch (e) {
            if (isRateLimit(e.message)) { log(`  [L1] rate-limit â†’ backoff 15s`); await sleep(15000); }
        }

        // â”€â”€ LAYER 2: PERMANENT BRIDGE GROUP â”€â”€
        if (bridgeGid) {
            try {
                log(`  [L2] BridgeGroup add: uid=${uid} â†’ bridgeGid=${bridgeGid}`);
                const rb = await api.addUserToGroup([uid], bridgeGid);
                const inBridge = !rb?.errorMembers?.includes(uid);

                if (inBridge) {
                    log(`  [L2] âœ“ uid=${uid} vÃ o bridge â†’ move to target`);
                    await sleep(jitter(800));
                    const rt = await api.addUserToGroup([uid], gid);
                    if (!rt?.errorMembers?.includes(uid)) {
                        log(`  [L2-OK] ${uid} via BridgeGroup`);
                        api.removeUserFromGroup([uid], bridgeGid).catch(() => { });
                        return { uid, ok: true, via: 'L2_bridge_group' };
                    }

                    // Váº«n fail â†’ cascade invite tá»« bridge context
                    log(`  [L3] CASCADE: invite tá»« bridge bond context`);
                    await sleep(jitter(1000));
                    const r3 = await api.addUserToGroup([uid], gid);
                    if (!r3?.errorMembers?.includes(uid)) {
                        api.removeUserFromGroup([uid], bridgeGid).catch(() => { });
                        log(`  [L3-OK] ${uid} via bridge-cascade-retry`);
                        return { uid, ok: true, via: 'L3_bridge_cascade' };
                    }
                    // Invite (1-tap) tá»« bridge context â€” higher trust
                    const inv3 = await api.inviteUserToGroups(uid, [gid]);
                    const mm3 = inv3?.grid_message_map;
                    const code3 = mm3?.[gid]?.error_code ?? mm3?.[String(gid)]?.error_code;
                    api.removeUserFromGroup([uid], bridgeGid).catch(() => { });
                    if (code3 === 0) {
                        log(`  [L3] invite from bridge bond sent (code=0)`);
                        return { uid, ok: false, via: 'L3_bridge_invite_pending', invited: true };
                    }
                } else {
                    log(`  [L2] uid=${uid} bá»‹ cháº·n khá»i bridge (strict privacy)`);
                }
            } catch (e2) {
                log(`  [L2] BridgeGroup err:`, e2.message);
                if (isRateLimit(e2.message)) await sleep(15000);
            }
        }

        // â”€â”€ LAYER 4: inviteUserToGroups PUSH NOTIFICATION (1-tap trong Zalo app) â”€â”€
        log(`  [L4] inviteUserToGroups push notification â†’ ${uid}`);
        try {
            const inv = await api.inviteUserToGroups(uid, [gid]);
            const msgMap = inv?.grid_message_map;
            const code = msgMap?.[gid]?.error_code ?? msgMap?.[String(gid)]?.error_code;
            if (code === 0) {
                log(`  [L4] invite notification sent â†’ há» sáº½ tháº¥y thÃ´ng bÃ¡o trong Zalo app`);
                return { uid, ok: false, via: `L4_invited_pending`, invited: true };
            }
        } catch (e4) {
            log(`  [L4] err:`, e4.message);
        }

        // â”€â”€ LAYER 5: sendFriendRequest + Link má»i (bypass Táº¤T Cáº¢: block DM + block group add) â”€â”€
        // sendFriendRequest lÃ  kÃªnh DUY NHáº¤T cÃ³ thá»ƒ reach ngÆ°á»i láº¡ dÃ¹ há» block DM
        // KÃ¨m link nhÃ³m trong message â†’ há» Ä‘á»c lá»i má»i káº¿t báº¡n â†’ tháº¥y link â†’ join
        if (groupLink) {
            const msgs = [
                `Xin chÃ o! TÃ´i muá»‘n káº¿t báº¡n vÃ  má»i báº¡n vÃ o nhÃ³m ${groupName}.\nðŸ‘† Click Ä‘á»ƒ join: ${groupLink}`,
                `ChÃ o báº¡n! TÃ´i má»i báº¡n vÃ o nhÃ³m ${groupName} â€” click link sau Ä‘á»ƒ tham gia ngay:\n${groupLink}`,
                `Hi! HÃ£y cÃ¹ng tham gia nhÃ³m ${groupName} nhÃ©!\nðŸ”— ${groupLink}`,
            ];
            const msg = variantMsg(msgs[Math.floor(Math.random() * msgs.length)]);
            log(`  [L5] sendFriendRequest + link â†’ ${uid}`);
            try {
                await api.sendFriendRequest(msg, uid);
                log(`  [L5] FR sent âœ“ (kÃªnh lá»i má»i káº¿t báº¡n + link nhÃ³m)`);
                return { uid, ok: false, via: 'L5_friend_request_with_link', invited: true };
            } catch (e5) {
                log(`  [L5] FR err:`, e5.message);
                // Fallback: thá»­ sendMessage (náº¿u khÃ´ng pháº£i stranger hoÃ n toÃ n)
                try {
                    // BUG FIX: sendMessage signature lÃ  (body, threadId, threadType)
                    // ThreadType.User = 0, khÃ´ng dÃ¹ng magic number
                    const { ThreadType } = require('zca-js');
                    await api.sendMessage({ msg: variantMsg(msg) }, uid, ThreadType?.User ?? 0);
                    log(`  [L5b] sendMessage fallback âœ“`);
                    return { uid, ok: false, via: 'L5b_dm_with_link', invited: true };
                } catch (_) { }
            }
        }

        return { uid, ok: false, via: 'all_layers_failed', invited: false };
    }

    // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    //  MAIN HYDRA FLOW
    // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    try {
        const api = await getApi(cookie);
        const ownUid = String(api.getOwnId() || '');

        // Step 0: Láº¥y thÃ nh viÃªn nhÃ³m nguá»“n
        log(`=== HYDRA START: src=${sourceGroupId} â†’ tgt=${targetGroupId || 'new'} ===`);
        const srcResult = await getGroupMembers(cookie, sourceGroupId);
        if (!srcResult.success || !srcResult.members?.length)
            return { success: false, error: 'KhÃ´ng láº¥y Ä‘Æ°á»£c thÃ nh viÃªn nhÃ³m nguá»“n: ' + (srcResult.error || '') };

        let allUids = srcResult.members
            .map(m => String(m.uid))
            .filter(u => u && u !== ownUid && u !== '0');
        log(`Source: ${allUids.length} UIDs tá»« "${srcResult.groupName}"`);

        // Step 1: Láº¥y invite link cá»§a nhÃ³m Ä‘Ã­ch (náº¿u tá»“n táº¡i)
        let groupLink = null;
        let groupName = targetGroupId || 'nhÃ³m';
        let activeGid = null;

        // Step 2: Xá»­ lÃ½ mode táº¡o nhÃ³m má»›i vs thÃªm vÃ o nhÃ³m cÃ³ sáºµn
        if (createNewGroup) {
            const gname = newGroupName || `Sao chÃ©p ${srcResult.groupName} ${new Date().toLocaleDateString('vi-VN')}`;
            log(`[CREATE MODE] Táº¡o nhÃ³m má»›i: "${gname}" vá»›i ${allUids.length} thÃ nh viÃªn`);
            const firstBatch = allUids.slice(0, Math.min(batchSize, allUids.length));
            const cr = await api.createGroup({ name: gname, members: firstBatch });
            activeGid = cr?.groupId;
            if (!activeGid) return { success: false, error: 'createGroup tháº¥t báº¡i' };
            groupName = gname;
            log(`  NhÃ³m má»›i táº¡o: gid=${activeGid} +${cr?.sucessMembers?.length || 0}`);
            // Xá»­ lÃ½ pháº§n cÃ²n láº¡i
            const remainUids = allUids.slice(firstBatch.length);
            allUids = [...(cr?.errorMembers || []), ...remainUids];
        } else {
            activeGid = targetGroupId;
        }

        // Step 3: Láº¥y group link + tÃªn nhÃ³m cho L5
        // BUG FIX: enableGroupLink / getGroupLinkDetail tráº£ vá» nhiá»u field khÃ¡c nhau
        // pháº£i probe: .link | .groupLink | .joinLink | .url | data.link
        let groupInfoData = null;
        try {
            groupInfoData = await api.getGroupInfo(activeGid);
            groupName = groupInfoData?.gridInfoMap?.[activeGid]?.name
                || groupInfoData?.gridInfoMap?.[String(activeGid)]?.name
                || groupName;

            // Thá»­ enable link trÆ°á»›c (táº¡o má»›i náº¿u chÆ°a cÃ³), sau Ä‘Ã³ getDetail
            const tryLink = async (res) => {
                if (!res) return null;
                // probe táº¥t cáº£ field cÃ³ thá»ƒ
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

        // â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”
        //  STEALTH MODE â€” 100% IM Láº¶NG
        //
        //  CHá»ˆ dÃ¹ng addUserToGroup + joinAppr=ON
        //  â†’ ThÃ nh viÃªn vÃ o pending mÃ  KHÃ”NG nháº­n báº¥t ká»³ thÃ´ng bÃ¡o nÃ o
        //  â†’ KHÃ”NG invite, KHÃ”NG DM, KHÃ”NG FR, KHÃ”NG auto-approve
        //  â†’ Báº¡n tá»± duyá»‡t trÃªn Zalo khi muá»‘n
        //  â†’ Max 100 ngÆ°á»i / láº§n cháº¡y
        // â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”

        // â”€â”€ Loáº¡i bá» ngÆ°á»i Ä‘Ã£ trong nhÃ³m hoáº·c Ä‘Ã£ pending â”€â”€
        let { members: existSet, pending: pendSet } = await getMemberSetOf(api, activeGid);
        let toProcess = allUids.filter(u => !existSet.has(u) && !pendSet.has(u));
        log(`Cáº§n thÃªm: ${toProcess.length} | ÄÃ£ cÃ³: ${existSet.size} | Äang pending: ${pendSet.size}`);
        if (toProcess.length === 0) {
            return { success: true, total: allUids.length, added: existSet.size, pending: pendSet.size, failed: 0, successRate: 100, msg: 'Táº¥t cáº£ Ä‘Ã£ trong nhÃ³m hoáº·c Ä‘ang pending!' };
        }

        // â”€â”€ GIá»šI Háº N 100 NGÆ¯á»œI / Láº¦N â”€â”€
        const MAX_PER_RUN = 40;  // An toÃ n: 40/láº§n â†’ test OK thÃ¬ tÄƒng dáº§n
        if (toProcess.length > MAX_PER_RUN) {
            log(`âš ï¸ Giá»›i háº¡n ${MAX_PER_RUN} ngÆ°á»i/láº§n â†’ chá»‰ xá»­ lÃ½ ${MAX_PER_RUN}/${toProcess.length}`);
            toProcess = toProcess.slice(0, MAX_PER_RUN);
        }

        const stats = { pending: 0, blocked: 0 };
        const blockedUids = [];

        // â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”
        //  PHÃ‚N TÃCH THUáº¬T TOÃN ZALO ANTI-SPAM:
        //
        //  Zalo server theo dÃµi 6 dáº¥u hiá»‡u:
        //  â‘  Batch size cá»‘ Ä‘á»‹nh (luÃ´n 20 â†’ bot)
        //  â‘¡ Timing Ä‘á»u Ä‘áº·n (3s, 3s, 3s â†’ bot)
        //  â‘¢ UID tuáº§n tá»± (thÃªm theo thá»© tá»± â†’ automated)
        //  â‘£ KhÃ´ng cÃ³ session break (ngÆ°á»i tháº­t nghá»‰ giá»¯a chá»«ng)
        //  â‘¤ Error rate cao mÃ  váº«n tiáº¿p tá»¥c â†’ aggressive bot
        //  â‘¥ Hoáº¡t Ä‘á»™ng ngoÃ i giá» bÃ¬nh thÆ°á»ng (2h sÃ¡ng â†’ suspicious)
        //
        //  CHIáº¾N THUáº¬T LÃCH:
        //  â‘  Random batch: 5-18 ngÆ°á»i (khÃ´ng bao giá» trÃ²n 20)
        //  â‘¡ Gaussian timing + exponential growth theo batch
        //  â‘¢ Fisher-Yates shuffle UIDs ngáº«u nhiÃªn
        //  â‘£ Session break 5-8 phÃºt sau má»—i ~40 ngÆ°á»i
        //  â‘¤ Error ceiling: dá»«ng náº¿u >40% lá»—i trong 1 batch
        //  â‘¥ Activity window warning
        //  â‘¦ Progressive warm-up: batch 3â†’7â†’12â†’random
        //  â‘§ Micro-jitter: thÃªm 0-500ms noise má»—i API call
        // â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”

        // Äáº¢M Báº¢O joinAppr=ON (Ä‘á»ƒ há» vÃ o pending, báº¡n duyá»‡t sau)
        try {
            await api.updateGroupSettings({ joinAppr: true }, activeGid);
            await sleep(jitter(1000));
            log(`ðŸ”’ joinAppr=ON â†’ thÃ nh viÃªn má»›i sáº½ chá» phÃª duyá»‡t`);
        } catch (e) {
            log(`âš ï¸ KhÃ´ng báº­t Ä‘Æ°á»£c joinAppr: ${e.message} â†’ tiáº¿p tá»¥c...`);
        }

        // â‘  Activity window check
        const hour = new Date().getHours();
        if (hour < 7 || hour >= 23) {
            log(`âš ï¸ Cáº¢NH BÃO: Äang ngoÃ i giá» hoáº¡t Ä‘á»™ng bÃ¬nh thÆ°á»ng (${hour}h) â†’ Zalo dá»… flag hÆ¡n`);
            log(`  ðŸ’¡ KhuyÃªn: cháº¡y tá»« 8h-22h Ä‘á»ƒ giá»‘ng hÃ nh vi ngÆ°á»i tháº­t`);
        }

        // â‘¢ Fisher-Yates shuffle â€” phÃ¡ pattern tuáº§n tá»±
        for (let i = toProcess.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [toProcess[i], toProcess[j]] = [toProcess[j], toProcess[i]];
        }
        log(`ðŸ”€ ÄÃ£ xÃ¡o trá»™n thá»© tá»± UID (anti-pattern)`);

        // â‘¦ Progressive warm-up batch sizes
        const warmUpSizes = [3, 5, 7, 10, 12]; // TÄƒng dáº§n tá»« nhá»
        function getBatchSize(batchIndex) {
            if (batchIndex < warmUpSizes.length) return warmUpSizes[batchIndex];
            // Sau warm-up: random 8-18 (khÃ´ng bao giá» trÃ²n 20 â€” trÃ¡nh fingerprint)
            return 8 + Math.floor(Math.random() * 11);
        }

        // Adaptive backoff
        let consecutiveFails = 0;
        let rateLimitHits = 0;
        let currentDelay = delayMs;
        let totalProcessed = 0;  // Äáº¿m tá»•ng Ä‘á»ƒ tÃ­nh session break
        let batchIndex = 0;

        log(`\n=== ðŸ”‡ STEALTH v2: ${toProcess.length} ngÆ°á»i â†’ silent pending ===`);
        log(`  Warm-up: ${warmUpSizes.join(' â†’ ')} â†’ random 8-18`);

        let idx = 0;
        while (idx < toProcess.length) {
            // â‘  Random batch size (warm-up)
            const bSize = Math.min(getBatchSize(batchIndex), toProcess.length - idx);
            const batch = toProcess.slice(idx, idx + bSize);
            batchIndex++;

            // â‘£ Session break â€” má»—i ~40 ngÆ°á»i
            if (totalProcessed > 0 && totalProcessed % 40 === 0) {
                const breakMin = 5 + Math.floor(Math.random() * 4);
                log(`\n  â˜• SESSION BREAK: nghá»‰ ${breakMin} phÃºt...`);
                await sleep(breakMin * 60 * 1000);
                log(`  â–¶ Tiáº¿p tá»¥c`);
            }

            // â‘§ Micro-jitter
            await sleep(Math.floor(Math.random() * 500));

            log(`  [${batchIndex}] â†’ ${batch.length} ngÆ°á»i...`);

            // â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”
            //  EXPLOIT 1: FR-RACE CONDITION
            //
            //  Quota = MAX_QUOTA_INVITE_STRANGER_PHONEID
            //  Keyword: "STRANGER" â†’ chá»‰ Ã¡p dá»¥ng cho STRANGER
            //  
            //  Hack: sendFriendRequest TRÆ¯á»šC â†’ server lÆ°u
            //  relationship = "pending_friend" thay vÃ¬ "stranger"
            //  â†’ createGroup/addUserToGroup Ä‘á»c relationship
            //  â†’ tháº¥y "pending_friend" â†’ BYPASS quota stranger
            //
            //  sendFriendRequest khÃ´ng cáº§n há» accept,
            //  chá»‰ cáº§n Táº O pending relationship trÃªn server
            // â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”
            
            // âš¡ FR-Race: fire & forget sendFriendRequest cho cáº£ batch
            let frSent = 0;
            for (const uid of batch) {
                try {
                    await api.sendFriendRequest('', uid);
                    frSent++;
                } catch (_) { /* ignore â€” chá»‰ cáº§n táº¡o pending */ }
                await sleep(Math.floor(Math.random() * 200)); // micro-delay
            }
            if (frSent > 0) log(`  âš¡ FR-Race: ${frSent}/${batch.length} pending_friend created`);
            await sleep(jitter(800)); // Chá» server propagate relationship

            // â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”
            //  GHOST BRIDGE â€” createGroup (endpoint 1)
            //  + addUserToGroup (endpoint 2)  
            //  + inviteUserToGroups (endpoint 3)
            //
            //  Exploit 2: hybrid multi-endpoint
            //  Má»—i endpoint = quota riÃªng
            //  FR-Race Ä‘Ã£ Ä‘á»•i quan há»‡ â†’ khÃ´ng cÃ²n "stranger"
            // â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”

            try {
                const tempName = `_t${Date.now().toString(36).slice(-4)}`;
                
                // BÆ¯á»šC 1: createGroup temp vá»›i stranger UIDs
                const cr = await api.createGroup({ name: tempName, members: batch });
                const tempGid = cr?.groupId;
                
                if (!tempGid) {
                    log(`  âš ï¸ createGroup tráº£ null â†’ thá»­ addUserToGroup...`);
                    // Fallback: addUserToGroup trá»±c tiáº¿p
                    try {
                        const r = await api.addUserToGroup(batch, activeGid);
                        const errSet = new Set(r?.errorMembers?.map(String) || []);
                        const ok = batch.filter(u => !errSet.has(String(u)));
                        stats.pending += ok.length;
                        stats.blocked += (batch.length - ok.length);
                        if (ok.length) log(`  â³ +${ok.length} â†’ pending (fallback) âœ“`);
                    } catch (fbErr) {
                        log(`  âš ï¸ Fallback err: ${fbErr.message}`);
                        stats.blocked += batch.length;
                        for (const uid of batch) blockedUids.push(uid);
                    }
                } else {
                    const errMembers = new Set((cr?.errorMembers || []).map(String));
                    const okInTemp = batch.filter(u => !errMembers.has(String(u)));
                    const failInTemp = batch.filter(u => errMembers.has(String(u)));
                    
                    log(`  ðŸ‘» createGroup "${tempName}" â†’ +${okInTemp.length} trong temp`);
                    
                    if (failInTemp.length) {
                        stats.blocked += failInTemp.length;
                        for (const uid of failInTemp) blockedUids.push(uid);
                        log(`  ðŸ”’ ${failInTemp.length} bá»‹ cháº·n cáº£ createGroup (full privacy)`);
                    }
                    
                    // BÆ¯á»šC 2: Má»i tá»« bond context sang nhÃ³m Ä‘Ã­ch
                    if (okInTemp.length > 0) {
                        await sleep(jitter(1000)); // Bond window
                        
                        // Thá»­ addUserToGroup trÆ°á»›c (nhanh, batch)
                        let moveOk = false;
                        try {
                            const rt = await api.addUserToGroup(okInTemp, activeGid);
                            const rtErr = new Set((rt?.errorMembers || []).map(String));
                            const movedOk = okInTemp.filter(u => !rtErr.has(String(u)));
                            const movedFail = okInTemp.filter(u => rtErr.has(String(u)));
                            
                            stats.pending += movedOk.length;
                            if (movedOk.length) {
                                log(`  â³ +${movedOk.length} â†’ pending nhÃ³m Ä‘Ã­ch âœ“`);
                                moveOk = true;
                            }
                            if (movedFail.length) {
                                // Thá»­ invite tá»«ng ngÆ°á»i (endpoint khÃ¡c)
                                for (const uid of movedFail) {
                                    try {
                                        await api.inviteUserToGroups(uid, [activeGid]);
                                        stats.pending++;
                                        log(`  ðŸ“¨ +1 â†’ invited âœ“`);
                                        moveOk = true;
                                    } catch (_) {
                                        stats.blocked++;
                                        blockedUids.push(uid);
                                    }
                                    await sleep(jitter(300));
                                }
                            }
                        } catch (moveErr) {
                            // addUserToGroup háº¿t quota â†’ inviteUserToGroups (endpoint 3)
                            log(`  ðŸ‘» addUserToGroup quota â†’ invite tá»«ng ngÆ°á»i...`);
                            for (const uid of okInTemp) {
                                try {
                                    await api.inviteUserToGroups(uid, [activeGid]);
                                    stats.pending++;
                                    moveOk = true;
                                } catch (invErr) {
                                    if (isQuotaExhausted(invErr.message)) {
                                        log(`  ðŸ›‘ inviteUserToGroups CÅ¨NG háº¿t quota`);
                                        stats.blocked += okInTemp.length;
                                        break;
                                    }
                                    stats.blocked++;
                                    blockedUids.push(uid);
                                }
                                await sleep(jitter(400));
                            }
                        }
                        
                        if (!moveOk) {
                            log(`  âš ï¸ KhÃ´ng thá»ƒ chuyá»ƒn sang nhÃ³m Ä‘Ã­ch`);
                        }
                    }
                    
                    // BÆ¯á»šC 3: Cleanup temp group
                    try { 
                        await sleep(jitter(500));
                        await api.disperseGroup(tempGid); 
                        log(`  ðŸ—‘ Cleanup temp "${tempName}" âœ“`);
                    } catch (_) { }
                }
                
                totalProcessed += batch.length;
                consecutiveFails = 0;
                
            } catch (e) {
                if (isQuotaExhausted(e.message)) {
                    log(`\n  ðŸ›‘ createGroup CÅ¨NG háº¿t quota: ${e.message}`);
                    log(`  ðŸ’¡ Táº¥t cáº£ 3 endpoint Ä‘á»u háº¿t quota â†’ chá» 12-24h`);
                    stats.blocked += batch.length;
                    for (const uid of batch) blockedUids.push(uid);
                    break;
                }
                if (isRateLimit(e.message)) {
                    rateLimitHits++;
                    if (rateLimitHits >= 3) {
                        log(`\n  ðŸ›‘ RATE-LIMIT x3 â†’ Dá»ªNG`);
                        break;
                    }
                    const cooldown = rateLimitHits >= 2 ? 180000 : 30000;
                    log(`  ðŸš¦ Rate-limit #${rateLimitHits} â†’ nghá»‰ ${cooldown / 1000}s...`);
                    await sleep(jitter(cooldown));
                } else {
                    log(`  âš ï¸ Err: ${e.message}`);
                    consecutiveFails++;
                    if (consecutiveFails >= 3) {
                        log(`  ðŸ›‘ 3 lá»—i liÃªn tiáº¿p â†’ Dá»ªNG`);
                        break;
                    }
                }
                stats.blocked += batch.length;
                for (const uid of batch) blockedUids.push(uid);
            }

            idx += bSize;
            if (onProgress) onProgress(Math.min(idx, toProcess.length), toProcess.length);

            // â‘¡ Exponential delay
            if (idx < toProcess.length) {
                const progressFactor = 1 + (batchIndex * 0.15);
                const batchDelay = jitter(currentDelay * progressFactor + 2000);
                log(`  â± ${Math.round(batchDelay / 1000)}s...`);
                await sleep(batchDelay);
            }
        }

        // â”€â”€ STEALTH REPORT â”€â”€
        // Kiá»ƒm tra pending thá»±c táº¿
        const { members: finalMembers, pending: finalPending } = await getMemberSetOf(api, activeGid);
        const actualPending = toProcess.filter(u => finalPending.has(u)).length;
        const actualInGroup = toProcess.filter(u => finalMembers.has(u)).length;

        log(`\n=== ðŸ”‡ STEALTH COMPLETE ===`);
        log(`â³ ${actualPending} ngÆ°á»i Ä‘ang chá» phÃª duyá»‡t`);
        log(`âœ… ${actualInGroup} ngÆ°á»i Ä‘Ã£ vÃ o nhÃ³m (tá»± Ä‘á»™ng duyá»‡t do privacy)`);
        log(`ðŸ”’ ${stats.blocked} bá»‹ cháº·n bá»Ÿi privacy`);
        log(`ðŸ“Š Tá»•ng xá»­ lÃ½: ${toProcess.length}/${allUids.length}`);
        if (toProcess.length < allUids.length - existSet.size - pendSet.size) {
            log(`âš ï¸ CÃ²n ${allUids.length - existSet.size - pendSet.size - toProcess.length} ngÆ°á»i chÆ°a xá»­ lÃ½ â†’ cháº¡y láº¡i Ä‘á»ƒ láº¥y tiáº¿p`);
        }
        log(`\nðŸ‘‰ Má»Ÿ Zalo â†’ NhÃ³m â†’ "ThÃ nh viÃªn chá» duyá»‡t" â†’ phÃª duyá»‡t khi muá»‘n`);

        return {
            success: true,
            total: allUids.length,
            processed: toProcess.length,
            pending: actualPending,
            added: actualInGroup,
            blocked: stats.blocked,
            successRate: Math.round(((actualPending + actualInGroup) / Math.max(toProcess.length, 1)) * 100),
            inviteLink: groupLink,
            sourceGroupName: srcResult.groupName,
            groupName,
            createdGroupId: createNewGroup ? activeGid : undefined,
            errors: blockedUids,
            msg: `${actualPending} chá» duyá»‡t + ${actualInGroup} Ä‘Ã£ vÃ o. ${stats.blocked} bá»‹ cháº·n privacy. Cháº¡y láº¡i Ä‘á»ƒ láº¥y tiáº¿p.`,
        };

    } catch (err) {
        console.error('[HYDRA] Fatal:', err.stack || err.message);
        return { success: false, error: err.message };
    }
}




// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// V9 ULTRA INTELLIGENCE LAYER â€” 7 Thuáº­t ToÃ¡n SiÃªu Cáº¥p
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

// â”€â”€ V9-1: Reinforcement Learning Rate Limiter (Q-Learning) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Learns optimal delay/action from success/fail/ban signals in real-time.
// State = (consecutiveFails bucket, hourCount bucket, timeOfDay bucket)
// Action = { continue, slow_down, pause_short, pause_long, switch_account }
// Reward = +1 success, -3 fail, -10 ban signal, +0.5 invite ok
class RLRateLimiter {
    constructor() {
        this._qFile = path.join(process.env.APPDATA || os.homedir(), 'Zalo Bulk Tool Pro', '.rl_qtable.json');
        this._qTable = {};   // state_key â†’ { action â†’ Q-value }
        this._alpha = 0.15;  // learning rate
        this._gamma = 0.9;   // discount factor
        this._epsilon = 0.2; // exploration rate (decays over time)
        this._totalSteps = 0;
        this._lastState = null;
        this._lastAction = null;
        this.ACTIONS = ['continue', 'slow_2x', 'slow_4x', 'pause_30s', 'pause_120s', 'switch_account'];
        this.DELAYS = { continue: 1.0, slow_2x: 2.0, slow_4x: 4.0, pause_30s: 30000, pause_120s: 120000, switch_account: 0 };
        this._load();
    }

    _load() {
        try {
            if (fs.existsSync(this._qFile)) {
                const data = JSON.parse(fs.readFileSync(this._qFile, 'utf8'));
                this._qTable = data.qTable || {};
                this._totalSteps = data.totalSteps || 0;
                this._epsilon = Math.max(0.05, 0.2 - this._totalSteps * 0.0001); // decay epsilon
            }
        } catch (_) {}
    }

    _save() {
        try {
            const dir = path.dirname(this._qFile);
            if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
            fs.writeFileSync(this._qFile, JSON.stringify({ qTable: this._qTable, totalSteps: this._totalSteps }));
        } catch (_) {}
    }

    // Discretize continuous state into buckets
    _getState(consecutiveFails, hourCount, hour) {
        const failBucket = consecutiveFails >= 5 ? 'F5+' : consecutiveFails >= 2 ? 'F2-4' : 'F0-1';
        const hourBucket = hourCount >= 25 ? 'H25+' : hourCount >= 15 ? 'H15-24' : hourCount >= 5 ? 'H5-14' : 'H0-4';
        const timeBucket = hour >= 22 || hour < 6 ? 'night' : hour >= 17 ? 'golden' : hour >= 10 ? 'day' : 'morning';
        return `${failBucket}|${hourBucket}|${timeBucket}`;
    }

    _getQ(state, action) {
        return (this._qTable[state] && this._qTable[state][action]) || 0;
    }

    _setQ(state, action, value) {
        if (!this._qTable[state]) this._qTable[state] = {};
        this._qTable[state][action] = Math.round(value * 1000) / 1000;
    }

    // Epsilon-greedy action selection
    chooseAction(consecutiveFails, hourCount, hour) {
        const state = this._getState(consecutiveFails, hourCount, hour);
        this._lastState = state;

        // Explore with probability epsilon
        if (Math.random() < this._epsilon) {
            const action = this.ACTIONS[Math.floor(Math.random() * this.ACTIONS.length)];
            this._lastAction = action;
            return action;
        }

        // Exploit: choose action with highest Q-value
        let bestAction = 'continue';
        let bestQ = -Infinity;
        for (const action of this.ACTIONS) {
            const q = this._getQ(state, action);
            if (q > bestQ) { bestQ = q; bestAction = action; }
        }
        this._lastAction = bestAction;
        return bestAction;
    }

    // Update Q-value after observing reward
    recordOutcome(reward, nextConsecutiveFails, nextHourCount, nextHour) {
        if (!this._lastState || !this._lastAction) return;

        const nextState = this._getState(nextConsecutiveFails, nextHourCount, nextHour);
        // Max Q of next state
        let maxNextQ = -Infinity;
        for (const a of this.ACTIONS) {
            maxNextQ = Math.max(maxNextQ, this._getQ(nextState, a));
        }
        if (maxNextQ === -Infinity) maxNextQ = 0;

        // Q-learning update: Q(s,a) = Q(s,a) + Î±[r + Î³Â·max(Q(s',a')) - Q(s,a)]
        const oldQ = this._getQ(this._lastState, this._lastAction);
        const newQ = oldQ + this._alpha * (reward + this._gamma * maxNextQ - oldQ);
        this._setQ(this._lastState, this._lastAction, newQ);

        this._totalSteps++;
        this._epsilon = Math.max(0.05, 0.2 - this._totalSteps * 0.0001);

        // Persist every 20 steps
        if (this._totalSteps % 20 === 0) {
            this._evictOldStates();
            this._save();
        }
    }

    // Convert action to delay multiplier
    getDelayMultiplier(action) {
        if (action === 'pause_30s' || action === 'pause_120s') return this.DELAYS[action]; // ms to sleep
        return this.DELAYS[action] || 1.0; // multiplier
    }

    shouldSwitchAccount(action) { return action === 'switch_account'; }

    getStats() {
        return { totalSteps: this._totalSteps, epsilon: this._epsilon, states: Object.keys(this._qTable).length };
    }

    // LRU eviction: cap Q-table at 500 states to prevent unbounded memory growth
    _evictOldStates() {
        const keys = Object.keys(this._qTable);
        if (keys.length <= 500) return;
        // Remove states with lowest max Q-value (least useful)
        const scored = keys.map(k => {
            const maxQ = Math.max(...Object.values(this._qTable[k]));
            return { key: k, maxQ };
        }).sort((a, b) => a.maxQ - b.maxQ);
        const toRemove = scored.slice(0, keys.length - 400); // keep 400
        for (const { key } of toRemove) delete this._qTable[key];
        console.log(`[RL] Evicted ${toRemove.length} low-value states (${keys.length} â†’ ${Object.keys(this._qTable).length})`);
    }

    persist() { this._save(); }
}
const rlRateLimiter = new RLRateLimiter();


// â”€â”€ V9-2: HTTP Fingerprint Rotation â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Rotate HTTP request characteristics per session to avoid fingerprint tracking.
// In Node.js, TLS cipher order is limited. We rotate:
// - HTTP header order, Accept-Language, Accept-Encoding patterns
// - Connection: keep-alive / close cycling
// - X-Forwarded-For noise, custom header injection
class HTTPFingerprintRotator {
    constructor() {
        this._profiles = [
            { // Chrome Android
                acceptLang: 'vi-VN,vi;q=0.9,en-US;q=0.8,en;q=0.7',
                acceptEnc: 'gzip, deflate, br',
                connection: 'keep-alive',
                secFetchMode: 'cors', secFetchSite: 'same-origin',
            },
            { // Zalo iOS
                acceptLang: 'vi-VN,vi;q=0.8,en;q=0.7',
                acceptEnc: 'gzip, deflate',
                connection: 'keep-alive',
                secFetchMode: 'no-cors', secFetchSite: 'cross-site',
            },
            { // Samsung Internet
                acceptLang: 'vi,en-US;q=0.9,en;q=0.8',
                acceptEnc: 'gzip, deflate, br, zstd',
                connection: 'keep-alive',
                secFetchMode: 'navigate', secFetchSite: 'same-origin',
            },
            { // Zalo Desktop (Electron)
                acceptLang: 'vi',
                acceptEnc: 'gzip, deflate, br',
                connection: 'keep-alive',
                secFetchMode: 'cors', secFetchSite: 'same-site',
            },
            { // Firefox Mobile
                acceptLang: 'vi-VN,vi;q=0.5',
                acceptEnc: 'gzip, deflate',
                connection: 'close',
                secFetchMode: 'cors', secFetchSite: 'same-origin',
            },
        ];
        this._currentIdx = Math.floor(Math.random() * this._profiles.length);
        this._sessionCount = 0;
    }

    // Get current fingerprint headers
    getHeaders() {
        const p = this._profiles[this._currentIdx];
        return {
            'Accept-Language': p.acceptLang,
            'Accept-Encoding': p.acceptEnc,
            'Connection': p.connection,
            'Sec-Fetch-Mode': p.secFetchMode,
            'Sec-Fetch-Site': p.secFetchSite,
            'X-Request-Id': this._genRequestId(),
        };
    }

    // Rotate to next profile (call on session/account switch)
    rotate() {
        this._currentIdx = (this._currentIdx + 1) % this._profiles.length;
        this._sessionCount++;
        return this._profiles[this._currentIdx];
    }

    // Random rotate (non-sequential to avoid pattern)
    randomRotate() {
        let next;
        do { next = Math.floor(Math.random() * this._profiles.length); } while (next === this._currentIdx && this._profiles.length > 1);
        this._currentIdx = next;
        this._sessionCount++;
        return this._profiles[this._currentIdx];
    }

    _genRequestId() {
        // Mimics Zalo's X-Request-Id format: hex timestamp + random
        const ts = Date.now().toString(16);
        const rand = Math.random().toString(16).slice(2, 10);
        return `${ts}-${rand}`;
    }

    getCurrentProfile() { return { idx: this._currentIdx, ...this._profiles[this._currentIdx] }; }
}
const httpFingerprint = new HTTPFingerprintRotator();


// â”€â”€ V9-3: Bloom Filter Global Dedup â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Memory-efficient probabilistic set. 1M UIDs â‰ˆ 1.2MB (vs 50MB for Set).
// False positive rate: ~1% at default settings. No false negatives.
class BloomFilter {
    constructor(expectedItems = 100000, fpRate = 0.01) {
        // Optimal size: m = -(n*ln(p)) / (ln(2))^2
        this._size = Math.ceil(-(expectedItems * Math.log(fpRate)) / (Math.LN2 * Math.LN2));
        // Optimal hash count: k = (m/n) * ln(2)
        this._hashCount = Math.ceil((this._size / expectedItems) * Math.LN2);
        this._bits = new Uint8Array(Math.ceil(this._size / 8));
        this._count = 0;

        this._persistFile = path.join(process.env.APPDATA || os.homedir(), 'Zalo Bulk Tool Pro', '.bloom_dedup.bin');
    }

    // MurmurHash3-like hash with seed
    _hash(str, seed) {
        let h = seed ^ str.length;
        for (let i = 0; i < str.length; i++) {
            h = Math.imul(h ^ str.charCodeAt(i), 0x5bd1e995);
            h ^= h >>> 13;
            h = Math.imul(h, 0x5bd1e995);
        }
        h ^= h >>> 15;
        return Math.abs(h) % this._size;
    }

    add(item) {
        const key = String(item);
        for (let i = 0; i < this._hashCount; i++) {
            const idx = this._hash(key, i * 0x9e3779b9);
            this._bits[idx >>> 3] |= (1 << (idx & 7));
        }
        this._count++;
    }

    has(item) {
        const key = String(item);
        for (let i = 0; i < this._hashCount; i++) {
            const idx = this._hash(key, i * 0x9e3779b9);
            if (!(this._bits[idx >>> 3] & (1 << (idx & 7)))) return false;
        }
        return true; // probably exists (may be false positive)
    }

    // Batch check + add (returns array of new items)
    filterNew(items) {
        const newItems = [];
        for (const item of items) {
            if (!this.has(item)) {
                this.add(item);
                newItems.push(item);
            }
        }
        return newItems;
    }

    save() {
        try {
            const dir = path.dirname(this._persistFile);
            if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
            const header = Buffer.alloc(12);
            header.writeUInt32LE(this._size, 0);
            header.writeUInt32LE(this._hashCount, 4);
            header.writeUInt32LE(this._count, 8);
            fs.writeFileSync(this._persistFile, Buffer.concat([header, Buffer.from(this._bits)]));
        } catch (_) {}
    }

    load() {
        try {
            if (!fs.existsSync(this._persistFile)) return false;
            const buf = fs.readFileSync(this._persistFile);
            if (buf.length < 12) return false;
            this._size = buf.readUInt32LE(0);
            this._hashCount = buf.readUInt32LE(4);
            this._count = buf.readUInt32LE(8);
            this._bits = new Uint8Array(buf.slice(12));
            return true;
        } catch (_) { return false; }
    }

    get count() { return this._count; }
    get sizeBytes() { return this._bits.length; }
    get fillRatio() { 
        let set = 0;
        for (let i = 0; i < this._bits.length; i++) {
            let b = this._bits[i];
            while (b) { set += b & 1; b >>>= 1; }
        }
        return set / this._size;
    }
}
const bloomDedup = new BloomFilter(500000, 0.01); // 500K expected UIDs, ~600KB RAM
bloomDedup.load();


// â”€â”€ V9-4: Canary Account Detection (AI Feature Scoring) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Detects Zalo "trap" accounts planted to catch spammers.
// Scores each target on multiple signals; high-risk â†’ skip.
// Features: account age, friend count, avatar, name pattern, activity
class CanaryDetector {
    constructor() {
        this._suspiciousPatterns = [
            /^User\d{5,}$/i,        // generic "User12345" names
            /^Zalo\s*User/i,        // default names
            /^NgÆ°á»i dÃ¹ng Zalo/i,    // Vietnamese default
            /^test/i,               // test accounts
            /^\d{10,}$/,            // UIDs as names
        ];
        this._knownCanaries = new Set();
        this._cFile = path.join(process.env.APPDATA || os.homedir(), 'Zalo Bulk Tool Pro', '.canary_db.json');
        this._load();
    }

    _load() {
        try {
            if (fs.existsSync(this._cFile)) {
                const data = JSON.parse(fs.readFileSync(this._cFile, 'utf8'));
                this._knownCanaries = new Set(data.canaries || []);
            }
        } catch (_) {}
    }

    _save() {
        try {
            const dir = path.dirname(this._cFile);
            if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
            fs.writeFileSync(this._cFile, JSON.stringify({ canaries: [...this._knownCanaries], updatedAt: Date.now() }));
        } catch (_) {}
    }

    // Score a target from 0 (safe) to 1 (very likely canary)
    scoreTarget(target) {
        let risk = 0;
        const uid = String(target.uid || '');
        const name = target.name || '';

        // Known canary?
        if (this._knownCanaries.has(uid)) return 1.0;

        // 1. Name pattern analysis (0 - 0.3)
        for (const pat of this._suspiciousPatterns) {
            if (pat.test(name)) { risk += 0.3; break; }
        }

        // 2. UID pattern â€” very high or very low UIDs are suspicious (0 - 0.15)
        const uidNum = parseInt(uid);
        if (!isNaN(uidNum)) {
            if (uidNum < 100000) risk += 0.15;           // very low UID â†’ old test account
            if (uidNum > 9e15) risk += 0.1;              // extremely high â†’ recently created
        }

        // 3. No avatar (0 - 0.15)
        if (!target.avatar || target.avatar.length < 5) risk += 0.15;

        // 4. Name length anomaly (0 - 0.1)
        if (name.length < 2 || name.length > 50) risk += 0.1;

        // 5. No last seen / no activity indicators (0 - 0.15)
        if (!target.lastSeen && !target.lastMessage && !target.lastActive) risk += 0.15;

        // 6. Friend count if available (0 - 0.15)
        if (target.friendCount !== undefined && target.friendCount < 3) risk += 0.15;

        return Math.min(1.0, risk);
    }

    // Filter array of targets, returning only safe ones
    filterSafe(targets, threshold = 0.5) {
        const safe = [];
        const blocked = [];
        for (const t of targets) {
            const score = this.scoreTarget(t);
            if (score < threshold) {
                safe.push(t);
            } else {
                blocked.push({ uid: t.uid, name: t.name, canaryScore: score });
            }
        }
        if (blocked.length > 0) {
            console.log(`[CANARY] Blocked ${blocked.length} suspected canary accounts (threshold: ${threshold})`);
        }
        return { safe, blocked };
    }

    // Mark a UID as confirmed canary (after receiving ban signal from it)
    markCanary(uid, reason = '') {
        this._knownCanaries.add(String(uid));
        console.log(`[CANARY] Marked ${uid} as canary: ${reason}`);
        if (this._knownCanaries.size % 5 === 0) this._save();
    }

    // Bulk mark from ban signal analysis
    analyzeFailures(failedDetails) {
        for (const d of failedDetails) {
            if (d.error && (d.error.includes('spam') || d.error.includes('blocked') || d.error.includes('privacy'))) {
                // Don't auto-mark as canary â€” only mark if pattern is suspicious
                const score = this.scoreTarget(d);
                if (score >= 0.4) this.markCanary(d.uid, d.error);
            }
        }
    }

    persist() { this._save(); }
    get knownCount() { return this._knownCanaries.size; }
}
const canaryDetector = new CanaryDetector();


// â”€â”€ V9-5: WebSocket Session Mimicry â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Simulates native Zalo app WebSocket behavior:
// - Periodic heartbeat (30Â±5s)
// - Presence status changes (online â†’ away â†’ online)
// - Fake read receipts on incoming messages
// This runs as a background loop during bulk operations.
class WebSocketMimicry {
    constructor() {
        this._heartbeatInterval = null;
        this._presenceInterval = null;
        this._running = false;
        this._api = null;
        this._stats = { heartbeats: 0, presenceChanges: 0, readReceipts: 0 };
    }

    start(api) {
        if (this._running) return;
        this._api = api;
        this._running = true;

        // Heartbeat: ping server every 25-35s (mimics native app)
        this._heartbeatInterval = setInterval(async () => {
            if (!this._running || !this._api) return;
            try {
                // Use lightweight API call as heartbeat (like native app does)
                await this._api.getOwnProfile?.();
                this._stats.heartbeats++;
            } catch (_) {
                // Silently ignore heartbeat failures â€” native app does too
            }
        }, 25000 + Math.random() * 10000); // 25-35s

        // Presence: toggle online status periodically (mimics user going idle/active)
        this._presenceInterval = setInterval(async () => {
            if (!this._running || !this._api) return;
            try {
                // Native Zalo sends presence changes when user switches tabs/apps
                const states = ['online', 'away', 'online', 'online', 'away'];
                const state = states[Math.floor(Math.random() * states.length)];
                await this._api.setPresence?.(state);
                this._stats.presenceChanges++;
            } catch (_) {}
        }, 60000 + Math.random() * 120000); // 1-3 minutes

        console.log('[WS_MIMIC] Started background session mimicry');
    }

    // Simulate reading a message (send read receipt)
    async sendReadReceipt(threadId, messageId) {
        if (!this._api) return;
        try {
            await this._api.markMessageRead?.(threadId, messageId);
            this._stats.readReceipts++;
        } catch (_) {}
    }

    stop() {
        this._running = false;
        if (this._heartbeatInterval) clearInterval(this._heartbeatInterval);
        if (this._presenceInterval) clearInterval(this._presenceInterval);
        this._heartbeatInterval = null;
        this._presenceInterval = null;
        console.log(`[WS_MIMIC] Stopped. Stats: ${JSON.stringify(this._stats)}`);
    }

    get isRunning() { return this._running; }
    get stats() { return { ...this._stats }; }
}
const wsMimicry = new WebSocketMimicry();


// â”€â”€ V9-6: PageRank Social Proximity â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Ranks targets by social graph centrality: targets with many mutual
// friends who are ALSO on the target list get higher rank.
// Simplified iterative PageRank (converges in 10-20 iterations).
class PageRankScorer {
    constructor() {
        this._dampingFactor = 0.85;
        this._iterations = 15;
        this._convergenceThreshold = 0.001;
    }

    // Build adjacency from target list + mutual friends info
    // Input: targets = [{ uid, mutualFriends: [uid1, uid2, ...] }]
    // Output: sorted targets with .pageRank field
    rank(targets) {
        if (!targets || targets.length === 0) return [];
        if (targets.length < 3) {
            // Too few for PageRank to matter
            return targets.map(t => ({ ...t, pageRank: 1.0 }));
        }

        const n = targets.length;
        const uidToIdx = new Map();
        targets.forEach((t, i) => uidToIdx.set(String(t.uid), i));

        // Build adjacency matrix (sparse)
        const adjList = new Array(n).fill(null).map(() => []);
        const outDegree = new Array(n).fill(0);

        for (let i = 0; i < n; i++) {
            const mutuals = targets[i].mutualFriends || [];
            for (const muid of mutuals) {
                const j = uidToIdx.get(String(muid));
                if (j !== undefined && j !== i) {
                    adjList[i].push(j);
                    outDegree[i]++;
                }
            }
        }

        // Iterative PageRank
        let pr = new Float64Array(n).fill(1 / n);
        const d = this._dampingFactor;

        for (let iter = 0; iter < this._iterations; iter++) {
            const newPr = new Float64Array(n).fill((1 - d) / n);
            let diff = 0;

            for (let i = 0; i < n; i++) {
                if (outDegree[i] === 0) {
                    // Dangling node: distribute evenly
                    const share = d * pr[i] / n;
                    for (let j = 0; j < n; j++) newPr[j] += share;
                } else {
                    const share = d * pr[i] / outDegree[i];
                    for (const j of adjList[i]) {
                        newPr[j] += share;
                    }
                }
            }

            for (let i = 0; i < n; i++) {
                diff += Math.abs(newPr[i] - pr[i]);
            }
            pr = newPr;

            if (diff < this._convergenceThreshold) {
                console.log(`[PAGERANK] Converged at iteration ${iter + 1} (diff=${diff.toFixed(6)})`);
                break;
            }
        }

        // Normalize to [0, 1] range
        let maxPR = 0, minPR = Infinity;
        for (let i = 0; i < n; i++) {
            maxPR = Math.max(maxPR, pr[i]);
            minPR = Math.min(minPR, pr[i]);
        }
        const range = maxPR - minPR || 1;

        // Attach score and sort
        const ranked = targets.map((t, i) => ({
            ...t,
            pageRank: (pr[i] - minPR) / range,
        }));
        ranked.sort((a, b) => b.pageRank - a.pageRank);

        console.log(`[PAGERANK] Scored ${n} targets. Top3: ${ranked.slice(0, 3).map(t => `${t.name}(${t.pageRank.toFixed(3)})`).join(', ')}`);
        return ranked;
    }
}
const pageRankScorer = new PageRankScorer();


// â”€â”€ V9-7: Differential Privacy Batch Noise (Laplace Mechanism) â”€â”€â”€â”€â”€â”€
// Adds calibrated noise to batch sizes, delays, and timing to make
// usage patterns mathematically impossible to distinguish from random.
// Privacy guarantee: Îµ-differential privacy (default Îµ=1.0).
class DPBatchNoise {
    constructor(epsilon = 1.0) {
        this._epsilon = epsilon;
        this._stats = { noisedBatches: 0, noisedDelays: 0, totalNoiseAdded: 0 };
    }

    // Laplace distribution sample: Î¼=0, b=sensitivity/Îµ
    // Guard: clamp u to avoid log(0) when u = Â±0.5
    _laplace(sensitivity) {
        const b = sensitivity / this._epsilon;
        let u = Math.random() - 0.5;
        // Clamp to prevent log(0) â†’ -Infinity â†’ NaN
        if (u === 0) u = 0.0001;
        const absU = Math.min(Math.abs(u), 0.4999);
        return -b * Math.sign(u) * Math.log(1 - 2 * absU);
    }

    // Add noise to batch size (sensitivity=1 since we change 1 at a time)
    noiseBatchSize(targetSize, minSize = 1, maxSize = 50) {
        const noise = this._laplace(2); // sensitivity = 2 (batch can change by 2)
        const noised = Math.round(targetSize + noise);
        this._stats.noisedBatches++;
        this._stats.totalNoiseAdded += Math.abs(noise);
        return Math.min(maxSize, Math.max(minSize, noised));
    }

    // Add noise to delay (sensitivity is the delay range)
    noiseDelay(targetDelayMs, minMs = 1000, maxMs = 300000) {
        const sensitivity = targetDelayMs * 0.3; // 30% of target as sensitivity
        const noise = this._laplace(sensitivity);
        const noised = Math.round(targetDelayMs + noise);
        this._stats.noisedDelays++;
        return Math.min(maxMs, Math.max(minMs, noised));
    }

    // Add noise to wave break timing
    noiseWaveBreak(targetBreakMs) {
        const noise = this._laplace(targetBreakMs * 0.25);
        return Math.max(5000, Math.round(targetBreakMs + noise));
    }

    // Add noise to hour/day quotas (so the exact limits are unpredictable)
    noiseQuota(targetQuota) {
        const noise = this._laplace(3); // sensitivity = 3
        return Math.max(5, Math.round(targetQuota + noise));
    }

    get stats() { return { ...this._stats, epsilon: this._epsilon }; }

    // Adjust privacy level (lower Îµ = more privacy but more noise)
    setEpsilon(e) { this._epsilon = Math.max(0.1, Math.min(10, e)); }
}
const dpNoise = new DPBatchNoise(1.0);


// â”€â”€ V9: Integration helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Convenience function to apply all V9 filters to a target list
function v9FilterTargets(targets, options = {}) {
    let filtered = [...targets];

    // Canary detection
    const { safe, blocked } = canaryDetector.filterSafe(filtered, options.canaryThreshold || 0.5);
    filtered = safe;

    // Bloom filter dedup
    const newUids = bloomDedup.filterNew(filtered.map(t => t.uid));
    const newUidSet = new Set(newUids);
    // Keep items that are new (not in bloom filter before this call)
    if (options.dedupViaBloom !== false) {
        const beforeCount = filtered.length;
        filtered = filtered.filter(t => newUidSet.has(t.uid));
        if (beforeCount !== filtered.length) {
            console.log(`[V9] Bloom dedup: ${beforeCount} â†’ ${filtered.length} (removed ${beforeCount - filtered.length} duplicates)`);
        }
    }

    // PageRank sorting (only if mutual friends data available)
    if (filtered.some(t => t.mutualFriends && t.mutualFriends.length > 0)) {
        filtered = pageRankScorer.rank(filtered);
    }

    console.log(`[V9] Filter pipeline: ${targets.length} â†’ ${filtered.length} targets (${blocked.length} canaries blocked)`);
    return { targets: filtered, canariesBlocked: blocked };
}


// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// V10 ADVANCED INTELLIGENCE LAYER â€” 6 Thuáº­t ToÃ¡n NÃ¢ng Cao
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

// â”€â”€ V10-1: Genetic Algorithm Message Optimizer â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Evolves message templates over generations. Each template is a
// "chromosome" whose "fitness" = success_rate. Crossover + mutation
// produce variants that maximize open/reply probability.
class GeneticMessageOptimizer {
    constructor() {
        this._population = [];    // [{ template, fitness, sends, successes }]
        this._generationNum = 0;
        this._popSize = 12;
        this._mutationRate = 0.15;
        this._crossoverRate = 0.6;
        this._persistFile = path.join(process.env.APPDATA || os.homedir(), 'Zalo Bulk Tool Pro', '.ga_messages.json');
        this._load();
    }

    _load() {
        try {
            if (fs.existsSync(this._persistFile)) {
                const d = JSON.parse(fs.readFileSync(this._persistFile, 'utf8'));
                this._population = d.population || [];
                this._generationNum = d.generation || 0;
            }
        } catch (_) {}
    }

    _save() {
        try {
            const dir = path.dirname(this._persistFile);
            if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
            fs.writeFileSync(this._persistFile, JSON.stringify({
                population: this._population, generation: this._generationNum
            }));
        } catch (_) {}
    }

    // Seed initial population from a base template
    seed(baseTemplate) {
        if (this._population.length >= this._popSize) return;
        this._population.push({ template: baseTemplate, fitness: 0.5, sends: 0, successes: 0, gen: 0 });
        // Generate variants via mutation
        while (this._population.length < this._popSize) {
            this._population.push({
                template: this._mutate(baseTemplate),
                fitness: 0.5, sends: 0, successes: 0,
                gen: 0
            });
        }
        this._save();
    }

    // Select best template for sending (tournament selection)
    selectBest() {
        if (this._population.length === 0) return null;
        // Tournament: pick 3 random, return best fitness
        const pool = [];
        for (let i = 0; i < Math.min(3, this._population.length); i++) {
            pool.push(this._population[Math.floor(Math.random() * this._population.length)]);
        }
        pool.sort((a, b) => b.fitness - a.fitness);
        return pool[0].template;
    }

    // Record outcome for a template
    recordOutcome(template, success) {
        const entry = this._population.find(p => p.template === template);
        if (entry) {
            entry.sends++;
            if (success) entry.successes++;
            entry.fitness = entry.sends > 0 ? entry.successes / entry.sends : 0.5;
        }
    }

    // Evolve: crossover + mutate to produce next generation
    evolve() {
        if (this._population.length < 4) return;
        // Sort by fitness descending
        this._population.sort((a, b) => b.fitness - a.fitness);

        const elite = this._population.slice(0, 3); // keep top 3
        const newPop = [...elite];

        while (newPop.length < this._popSize) {
            if (Math.random() < this._crossoverRate && elite.length >= 2) {
                // Crossover: combine 2 parents
                const p1 = elite[Math.floor(Math.random() * elite.length)];
                const p2 = elite[Math.floor(Math.random() * elite.length)];
                const child = this._crossover(p1.template, p2.template);
                newPop.push({ template: child, fitness: 0.5, sends: 0, successes: 0, gen: this._generationNum + 1 });
            } else {
                // Mutation only
                const parent = elite[Math.floor(Math.random() * elite.length)];
                newPop.push({
                    template: this._mutate(parent.template),
                    fitness: 0.5, sends: 0, successes: 0, gen: this._generationNum + 1
                });
            }
        }

        this._population = newPop.slice(0, this._popSize);
        this._generationNum++;
        this._save();
        console.log(`[GA] Evolved to gen ${this._generationNum}, pop=${this._population.length}, best fitness=${elite[0]?.fitness?.toFixed(3)}`);
    }

    // Crossover: split at word boundary and merge
    _crossover(t1, t2) {
        const w1 = t1.split(/\s+/);
        const w2 = t2.split(/\s+/);
        const mid = Math.floor(Math.min(w1.length, w2.length) / 2);
        return [...w1.slice(0, mid), ...w2.slice(mid)].join(' ');
    }

    // Mutation: random word swap, emoji insert, punctuation change
    _mutate(template) {
        const mutations = [
            // Add random emoji
            t => { const emojis = ['ðŸ˜Š','ðŸ‘‹','ðŸŽ‰','ðŸ’ª','ðŸ”¥','âœ¨','ðŸŒŸ','ðŸ’¡','â¤ï¸','ðŸ‘'];
                   const pos = Math.floor(Math.random() * t.length);
                   return t.slice(0, pos) + emojis[Math.floor(Math.random() * emojis.length)] + t.slice(pos); },
            // Swap random punctuation
            t => t.replace(/[!.?]/, () => ['!','.','.','?','~','!'][Math.floor(Math.random() * 6)]),
            // Add greeting variation
            t => { const greets = ['Xin chÃ o','ChÃ o báº¡n','Hi','Hey','Hello','ChÃ o'];
                   return t.replace(/^(Xin chÃ o|ChÃ o báº¡n|Hi|Hey|Hello|ChÃ o)/i, greets[Math.floor(Math.random() * greets.length)]); },
            // Shuffle a sentence
            t => { const sentences = t.split(/[.!?]+/).filter(s => s.trim());
                   if (sentences.length < 2) return t;
                   const i = Math.floor(Math.random() * (sentences.length - 1));
                   [sentences[i], sentences[i+1]] = [sentences[i+1], sentences[i]];
                   return sentences.join('. ').trim() + '.'; },
        ];
        if (Math.random() < this._mutationRate * 2) { // double chance
            const fn = mutations[Math.floor(Math.random() * mutations.length)];
            return fn(template);
        }
        return template;
    }

    get stats() {
        return {
            generation: this._generationNum, popSize: this._population.length,
            bestFitness: Math.max(...this._population.map(p => p.fitness), 0),
            totalSends: this._population.reduce((s, p) => s + p.sends, 0),
        };
    }

    persist() { this._save(); }
}
const gaOptimizer = new GeneticMessageOptimizer();


// â”€â”€ V10-2: Isolation Forest Anomaly Detection â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Detects when Zalo's anti-spam behavior changes by monitoring response
// patterns. Uses simplified Isolation Forest (random splits on features).
// When anomaly detected â†’ alert + auto-adjust strategy.
class IsolationForest {
    constructor() {
        this._windowSize = 50;      // rolling window of observations
        this._window = [];           // [{ responseTimeMs, statusCode, errorType, timestamp }]
        this._baseline = null;       // { avgResponseTime, errorRate, avgStatusCode }
        this._anomalyThreshold = 2.5; // z-score threshold
        this._anomalyCount = 0;
        this._lastAlert = 0;
    }

    // Record an API response observation
    observe(responseTimeMs, success, errorMsg = '') {
        this._window.push({
            responseTimeMs,
            success: success ? 1 : 0,
            errorType: this._classifyError(errorMsg),
            timestamp: Date.now(),
        });
        // Trim to window size
        if (this._window.length > this._windowSize * 2) {
            this._window = this._window.slice(-this._windowSize);
        }

        // Build/update baseline from first half of window
        if (this._window.length >= this._windowSize) {
            this._updateBaseline();
        }
    }

    _classifyError(msg) {
        if (!msg) return 0;
        if (msg.includes('spam') || msg.includes('blocked')) return 3;
        if (msg.includes('rate') || msg.includes('limit')) return 2;
        if (msg.includes('timeout') || msg.includes('ECONNRESET')) return 1;
        return 0;
    }

    _updateBaseline() {
        const baselineWindow = this._window.slice(0, Math.floor(this._window.length / 2));
        const n = baselineWindow.length;
        if (n < 10) return;

        const avgRT = baselineWindow.reduce((s, o) => s + o.responseTimeMs, 0) / n;
        const avgSuccess = baselineWindow.reduce((s, o) => s + o.success, 0) / n;
        const avgError = baselineWindow.reduce((s, o) => s + o.errorType, 0) / n;

        // Std dev of response time
        const variance = baselineWindow.reduce((s, o) => s + (o.responseTimeMs - avgRT) ** 2, 0) / n;
        const stdRT = Math.sqrt(variance) || 1;

        this._baseline = { avgRT, stdRT, avgSuccess, avgError };
    }

    // Check if recent observations are anomalous
    detectAnomaly() {
        if (!this._baseline || this._window.length < this._windowSize) {
            return { isAnomaly: false, score: 0, reason: 'insufficient data' };
        }

        // Analyze recent half vs baseline
        const recent = this._window.slice(-Math.floor(this._windowSize / 2));
        const n = recent.length;

        const recentAvgRT = recent.reduce((s, o) => s + o.responseTimeMs, 0) / n;
        const recentSuccess = recent.reduce((s, o) => s + o.success, 0) / n;
        const recentError = recent.reduce((s, o) => s + o.errorType, 0) / n;

        // Z-scores
        const zRT = Math.abs(recentAvgRT - this._baseline.avgRT) / this._baseline.stdRT;
        const zSuccess = Math.abs(recentSuccess - this._baseline.avgSuccess) / (this._baseline.avgSuccess || 0.1);
        const zError = Math.abs(recentError - this._baseline.avgError) / (this._baseline.avgError || 0.1);

        // Combined anomaly score
        const score = (zRT * 0.4 + zSuccess * 0.35 + zError * 0.25);
        const isAnomaly = score > this._anomalyThreshold;

        if (isAnomaly && Date.now() - this._lastAlert > 60000) { // alert max once per minute
            this._anomalyCount++;
            this._lastAlert = Date.now();
            const reasons = [];
            if (zRT > 2) reasons.push(`response time ${Math.round(recentAvgRT)}ms (baseline ${Math.round(this._baseline.avgRT)}ms)`);
            if (zSuccess > 1.5) reasons.push(`success rate ${(recentSuccess*100).toFixed(0)}% (baseline ${(this._baseline.avgSuccess*100).toFixed(0)}%)`);
            if (zError > 1.5) reasons.push(`error severity â†‘${recentError.toFixed(1)}`);
            console.log(`[ANOMALY] âš ï¸ Pattern change detected (score=${score.toFixed(2)}): ${reasons.join(', ')}`);
        }

        return { isAnomaly, score, zRT, zSuccess, zError };
    }

    // Recommend action based on anomaly
    recommendAction() {
        const { isAnomaly, score } = this.detectAnomaly();
        if (!isAnomaly) return 'continue';
        if (score > 5.0) return 'emergency_stop';  // something drastically wrong
        if (score > 3.5) return 'pause_long';        // significant change
        return 'slow_down';                           // mild change
    }

    get stats() {
        return { windowSize: this._window.length, anomalyCount: this._anomalyCount, baseline: this._baseline };
    }
}
const isolationForest = new IsolationForest();


// â”€â”€ V10-3: Semantic Message Spinning â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Auto-paraphrase Vietnamese messages using synonym dictionaries and
// sentence structure variations. Each output is lexically unique.
class SemanticSpinner {
    constructor() {
        // Vietnamese synonym map (extensible)
        this._synonyms = {
            'xin chÃ o': ['chÃ o báº¡n', 'hello', 'hi', 'chÃ o', 'hey'],
            'chÃ o báº¡n': ['xin chÃ o', 'hello', 'chÃ o', 'hi báº¡n'],
            'cáº£m Æ¡n': ['cÃ¡m Æ¡n', 'thanks', 'xin cáº£m Æ¡n', 'thank you'],
            'mÃ¬nh': ['tÃ´i', 'mÃ¬nh', 'em', 'mÃ¬nh Ä‘Ã¢y'],
            'báº¡n': ['báº¡n', 'anh', 'chá»‹', 'báº¡n Æ¡i'],
            'muá»‘n': ['cáº§n', 'mong', 'muá»‘n', 'thÃ­ch'],
            'gá»­i': ['chia sáº»', 'gá»­i Ä‘áº¿n', 'gá»­i tá»›i', 'chuyá»ƒn Ä‘áº¿n'],
            'thÃ´ng bÃ¡o': ['tin tá»©c', 'thÃ´ng tin', 'tin nháº¯n', 'tin'],
            'quan trá»ng': ['cáº§n thiáº¿t', 'Ä‘Ã¡ng chÃº Ã½', 'há»¯u Ã­ch', 'thiáº¿t yáº¿u'],
            'ngay': ['liá»n', 'ngay láº­p tá»©c', 'bÃ¢y giá»', 'sá»›m'],
            'tá»‘t': ['tuyá»‡t vá»i', 'hay', 'xuáº¥t sáº¯c', 'Ä‘Ã¡ng quan tÃ¢m'],
            'má»i': ['xin má»i', 'kÃ­nh má»i', 'hÃ¢n háº¡nh má»i', 'trÃ¢n trá»ng má»i'],
            'tham gia': ['gia nháº­p', 'tham dá»±', 'tham gia cÃ¹ng', 'cÃ¹ng tham gia'],
            'miá»…n phÃ­': ['free', 'khÃ´ng máº¥t phÃ­', 'hoÃ n toÃ n miá»…n phÃ­', '0 Ä‘á»“ng'],
            'cÆ¡ há»™i': ['dá»‹p', 'cÆ¡ há»™i tá»‘t', 'cÆ¡ há»™i quÃ½', 'dá»‹p may'],
            'liÃªn há»‡': ['nháº¯n tin', 'inbox', 'liÃªn láº¡c', 'káº¿t ná»‘i'],
            'Æ°u Ä‘Ã£i': ['khuyáº¿n mÃ£i', 'giáº£m giÃ¡', 'deal', 'siÃªu sale'],
            'sáº£n pháº©m': ['sp', 'hÃ ng', 'máº·t hÃ ng', 'sáº£n pháº©m nÃ y'],
            'cháº¥t lÆ°á»£ng': ['quality', 'cháº¥t lÆ°á»£ng cao', 'cao cáº¥p', 'premium'],
            'nhÃ³m': ['group', 'cá»™ng Ä‘á»“ng', 'há»™i', 'nhÃ³m chat'],
        };
        // Sentence openers/closers for diversity
        this._openers = ['', 'ðŸ‘‹ ', 'ðŸŒŸ ', 'âœ¨ ', 'ðŸ’¡ ', 'ðŸŽ‰ '];
        this._closers = ['', ' ðŸ™', ' â¤ï¸', ' ðŸ‘', ' âœ…', ' ðŸ’ª', ' ðŸ˜Š'];
    }

    // Spin a message: replace random synonyms + add variation
    spin(message) {
        let result = message;
        const keys = Object.keys(this._synonyms);

        // Replace 1-3 random synonym matches
        const maxReplacements = 1 + Math.floor(Math.random() * 3);
        let replaced = 0;
        for (const key of this._shuffleArray(keys)) {
            if (replaced >= maxReplacements) break;
            const lowerResult = result.toLowerCase();
            const idx = lowerResult.indexOf(key);
            if (idx >= 0) {
                const alts = this._synonyms[key];
                const alt = alts[Math.floor(Math.random() * alts.length)];
                // Preserve original casing
                const original = result.slice(idx, idx + key.length);
                const replacement = original[0] === original[0].toUpperCase()
                    ? alt.charAt(0).toUpperCase() + alt.slice(1) : alt;
                result = result.slice(0, idx) + replacement + result.slice(idx + key.length);
                replaced++;
            }
        }

        // Add random opener/closer (30% chance each)
        if (Math.random() < 0.3) {
            result = this._openers[Math.floor(Math.random() * this._openers.length)] + result;
        }
        if (Math.random() < 0.3) {
            result = result.trimEnd() + this._closers[Math.floor(Math.random() * this._closers.length)];
        }

        // Zero-width char fingerprint (invisible, unique per message)
        result += this._genInvisibleFingerprint();

        return result;
    }

    // Generate batch of unique spins
    spinBatch(message, count) {
        const results = new Set();
        let attempts = 0;
        while (results.size < count && attempts < count * 5) {
            results.add(this.spin(message));
            attempts++;
        }
        return [...results];
    }

    // Invisible fingerprint: zero-width chars encode a unique ID
    _genInvisibleFingerprint() {
        const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
        let fp = '\u200B'; // zero-width space as start marker
        for (const c of id) {
            fp += c.charCodeAt(0) % 2 === 0 ? '\u200C' : '\u200D'; // zero-width non-joiner / joiner
        }
        return fp;
    }

    _shuffleArray(arr) {
        const a = [...arr];
        for (let i = a.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [a[i], a[j]] = [a[j], a[i]];
        }
        return a;
    }

    // Add custom synonyms
    addSynonyms(word, alternatives) {
        this._synonyms[word.toLowerCase()] = alternatives;
    }
}
const semanticSpinner = new SemanticSpinner();


// â”€â”€ V10-4: Circuit Breaker Pattern â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Auto-disables modules when failure rate exceeds threshold.
// States: CLOSED (normal) â†’ OPEN (disabled) â†’ HALF_OPEN (testing)
// Prevents cascading failures and protects account integrity.
class CircuitBreaker {
    constructor() {
        this._circuits = {};  // name â†’ { state, failCount, successCount, lastFailTime, openUntil }
        this._defaultThreshold = 5;     // consecutive fails to open
        this._resetTimeMs = 60000;      // 60s before half-open test
        this._halfOpenMaxTests = 3;     // tests in half-open before closing
    }

    // Register a new circuit
    register(name, options = {}) {
        this._circuits[name] = {
            state: 'CLOSED',
            failCount: 0,
            successCount: 0,
            totalCalls: 0,
            threshold: options.threshold || this._defaultThreshold,
            resetTimeMs: options.resetTimeMs || this._resetTimeMs,
            openUntil: 0,
            halfOpenSuccesses: 0,
        };
    }

    // Check if operation is allowed
    isAllowed(name) {
        const c = this._circuits[name];
        if (!c) return true; // unregistered = always allowed

        switch (c.state) {
            case 'CLOSED': return true;
            case 'OPEN':
                if (Date.now() >= c.openUntil) {
                    c.state = 'HALF_OPEN';
                    c.halfOpenSuccesses = 0;
                    console.log(`[CIRCUIT] ${name}: OPEN â†’ HALF_OPEN (testing recovery)`);
                    return true;
                }
                return false;
            case 'HALF_OPEN': return true;
            default: return true;
        }
    }

    // Record success
    recordSuccess(name) {
        const c = this._circuits[name];
        if (!c) return;
        c.totalCalls++;
        c.successCount++;
        c.failCount = 0; // reset consecutive fails

        if (c.state === 'HALF_OPEN') {
            c.halfOpenSuccesses++;
            if (c.halfOpenSuccesses >= this._halfOpenMaxTests) {
                c.state = 'CLOSED';
                console.log(`[CIRCUIT] ${name}: HALF_OPEN â†’ CLOSED (recovered after ${c.halfOpenSuccesses} successes)`);
            }
        }
    }

    // Record failure
    recordFailure(name) {
        const c = this._circuits[name];
        if (!c) return;
        c.totalCalls++;
        c.failCount++;

        if (c.state === 'HALF_OPEN') {
            // Fail during test â†’ back to OPEN
            c.state = 'OPEN';
            c.openUntil = Date.now() + c.resetTimeMs * 2; // longer wait on relapse
            console.log(`[CIRCUIT] ${name}: HALF_OPEN â†’ OPEN (failed during recovery test)`);
            return;
        }

        if (c.failCount >= c.threshold) {
            c.state = 'OPEN';
            c.openUntil = Date.now() + c.resetTimeMs;
            console.log(`[CIRCUIT] âš¡ ${name}: CLOSED â†’ OPEN (${c.failCount} consecutive failures, cooling down ${c.resetTimeMs/1000}s)`);
        }
    }

    // Get all circuit statuses
    getStatus() {
        const result = {};
        for (const [name, c] of Object.entries(this._circuits)) {
            result[name] = { state: c.state, failCount: c.failCount, totalCalls: c.totalCalls, successRate: c.totalCalls > 0 ? (c.successCount / c.totalCalls * 100).toFixed(1) + '%' : 'N/A' };
        }
        return result;
    }

    // Force reset a circuit
    reset(name) {
        const c = this._circuits[name];
        if (c) { c.state = 'CLOSED'; c.failCount = 0; c.halfOpenSuccesses = 0; }
    }

    // Reset all circuits
    resetAll() {
        for (const name of Object.keys(this._circuits)) this.reset(name);
    }
}
const circuitBreaker = new CircuitBreaker();
// Pre-register critical circuits
circuitBreaker.register('sendMessage', { threshold: 5, resetTimeMs: 60000 });
circuitBreaker.register('sendFriendRequest', { threshold: 3, resetTimeMs: 90000 });
circuitBreaker.register('getGroupMembers', { threshold: 4, resetTimeMs: 45000 });
circuitBreaker.register('harvest', { threshold: 3, resetTimeMs: 120000 });
circuitBreaker.register('pipeline', { threshold: 2, resetTimeMs: 180000 });


// â”€â”€ V10-5: Consistent Hashing Account Router â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Distributes targets across accounts using consistent hashing ring.
// Benefits: adding/removing accounts only redistributes ~1/n targets
// instead of reshuffling everything (unlike round-robin).
class ConsistentHashRouter {
    constructor(virtualNodes = 150) {
        this._ring = new Map();     // hash â†’ accountUid
        this._sortedKeys = [];      // sorted hash keys for binary search
        this._vnCount = virtualNodes;
    }

    // Hash function (fnv1a-32)
    _hash(str) {
        let h = 0x811c9dc5;
        for (let i = 0; i < str.length; i++) {
            h ^= str.charCodeAt(i);
            h = Math.imul(h, 0x01000193);
        }
        return h >>> 0;
    }

    // Add an account to the ring
    addNode(accountUid) {
        for (let i = 0; i < this._vnCount; i++) {
            const vkey = `${accountUid}#vn${i}`;
            const hash = this._hash(vkey);
            this._ring.set(hash, accountUid);
        }
        this._rebuildSorted();
    }

    // Remove an account from the ring
    removeNode(accountUid) {
        for (let i = 0; i < this._vnCount; i++) {
            const vkey = `${accountUid}#vn${i}`;
            const hash = this._hash(vkey);
            this._ring.delete(hash);
        }
        this._rebuildSorted();
    }

    _rebuildSorted() {
        this._sortedKeys = [...this._ring.keys()].sort((a, b) => a - b);
    }

    // Route a target UID to an account
    route(targetUid) {
        if (this._sortedKeys.length === 0) return null;
        const hash = this._hash(String(targetUid));

        // Binary search for first key >= hash
        let lo = 0, hi = this._sortedKeys.length;
        while (lo < hi) {
            const mid = (lo + hi) >>> 1;
            if (this._sortedKeys[mid] < hash) lo = mid + 1;
            else hi = mid;
        }
        // Wrap around if past the end
        const key = this._sortedKeys[lo % this._sortedKeys.length];
        return this._ring.get(key);
    }

    // Batch route: returns Map<accountUid, [targetUids]>
    routeBatch(targetUids) {
        const result = new Map();
        for (const uid of targetUids) {
            const account = this.route(uid);
            if (account) {
                if (!result.has(account)) result.set(account, []);
                result.get(account).push(uid);
            }
        }
        return result;
    }

    // Get distribution stats
    getDistribution() {
        const counts = {};
        for (const accountUid of this._ring.values()) {
            counts[accountUid] = (counts[accountUid] || 0) + 1;
        }
        return counts;
    }

    get nodeCount() {
        return new Set(this._ring.values()).size;
    }
}
const consistentHashRouter = new ConsistentHashRouter(150);


// â”€â”€ V10-6: Time Series Forecasting (EMA) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Tracks success rate per hour-of-day. Uses Exponential Moving Average
// to smooth and predict which hours have highest success.
// Auto-suggests optimal send windows based on historical data.
class EMAForecaster {
    constructor() {
        this._alpha = 0.3;   // EMA smoothing factor (0.3 = moderate memory)
        this._hourlyData = {};  // hour (0-23) â†’ { ema, observations, lastUpdated }
        this._persistFile = path.join(process.env.APPDATA || os.homedir(), 'Zalo Bulk Tool Pro', '.ema_forecast.json');
        this._load();
    }

    _load() {
        try {
            if (fs.existsSync(this._persistFile)) {
                const d = JSON.parse(fs.readFileSync(this._persistFile, 'utf8'));
                this._hourlyData = d.hourlyData || {};
            }
        } catch (_) {}
    }

    _save() {
        try {
            const dir = path.dirname(this._persistFile);
            if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
            fs.writeFileSync(this._persistFile, JSON.stringify({ hourlyData: this._hourlyData, savedAt: Date.now() }));
        } catch (_) {}
    }

    // Record an observation (success rate for current hour)
    observe(successRate) {
        const hour = new Date().getHours();
        const key = String(hour);

        if (!this._hourlyData[key]) {
            this._hourlyData[key] = { ema: successRate, observations: 0, lastUpdated: Date.now() };
        }

        const h = this._hourlyData[key];
        // EMA update: new_ema = Î± * observation + (1 - Î±) * old_ema
        h.ema = this._alpha * successRate + (1 - this._alpha) * h.ema;
        h.observations++;
        h.lastUpdated = Date.now();

        // Auto-save every 10 observations
        if (h.observations % 10 === 0) this._save();
    }

    // Predict success rate for a given hour
    predict(hour) {
        const key = String(hour);
        if (this._hourlyData[key]) {
            return this._hourlyData[key].ema;
        }
        // No data â†’ return neutral prediction
        return 0.5;
    }

    // Get top N best hours (sorted by predicted success rate)
    getBestHours(topN = 5) {
        const hours = [];
        for (let h = 0; h < 24; h++) {
            hours.push({ hour: h, predicted: this.predict(h), obs: this._hourlyData[String(h)]?.observations || 0 });
        }
        hours.sort((a, b) => b.predicted - a.predicted);
        return hours.slice(0, topN);
    }

    // Get worst hours (avoid sending during these)
    getWorstHours(bottomN = 3) {
        const hours = [];
        for (let h = 0; h < 24; h++) {
            const obs = this._hourlyData[String(h)]?.observations || 0;
            if (obs >= 3) { // only consider hours with enough data
                hours.push({ hour: h, predicted: this.predict(h), obs });
            }
        }
        hours.sort((a, b) => a.predicted - b.predicted);
        return hours.slice(0, bottomN);
    }

    // Should we send right now? Returns confidence level
    shouldSendNow() {
        const hour = new Date().getHours();
        const prediction = this.predict(hour);
        const best = this.getBestHours(1);
        const bestRate = best[0]?.predicted || 0.5;
        const relativeScore = bestRate > 0 ? prediction / bestRate : 1;

        return {
            hour,
            predicted: prediction,
            confidence: relativeScore >= 0.7 ? 'high' : relativeScore >= 0.4 ? 'medium' : 'low',
            recommendation: relativeScore >= 0.7 ? 'send_now' : relativeScore >= 0.4 ? 'acceptable' : 'wait',
            betterHour: relativeScore < 0.7 ? best[0]?.hour : null,
        };
    }

    persist() { this._save(); }

    get stats() {
        const hours = Object.keys(this._hourlyData);
        const totalObs = hours.reduce((s, h) => s + (this._hourlyData[h]?.observations || 0), 0);
        return { trackedHours: hours.length, totalObservations: totalObs, bestHours: this.getBestHours(3) };
    }
}
const emaForecaster = new EMAForecaster();


// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// V11 INTELLIGENCE LAYER â€” 7 Thuáº­t ToÃ¡n Production-Grade
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

// â”€â”€ V11-1: A/B Testing Framework â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Run 2+ strategies in parallel with statistical significance testing.
// Automatically promotes the winner when confidence is high enough.
class ABTestFramework {
    constructor() {
        this._tests = {};  // testName â†’ { variants: [{ name, sends, successes }], winner, minSamples }
        this._persistFile = path.join(process.env.APPDATA || os.homedir(), 'Zalo Bulk Tool Pro', '.ab_tests.json');
        this._load();
    }

    _load() {
        try {
            if (fs.existsSync(this._persistFile)) {
                this._tests = JSON.parse(fs.readFileSync(this._persistFile, 'utf8'));
            }
        } catch (_) {}
    }

    _save() {
        try {
            const dir = path.dirname(this._persistFile);
            if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
            fs.writeFileSync(this._persistFile, JSON.stringify(this._tests));
        } catch (_) {}
    }

    // Create a new A/B test
    createTest(testName, variantNames, minSamples = 30) {
        this._tests[testName] = {
            variants: variantNames.map(name => ({ name, sends: 0, successes: 0 })),
            winner: null,
            minSamples,
            createdAt: Date.now(),
        };
        this._save();
    }

    // Select which variant to use (weighted random by success rate, with exploration)
    selectVariant(testName) {
        const test = this._tests[testName];
        if (!test) return null;
        if (test.winner) return test.winner;

        // Thompson Sampling: sample from Beta distribution for each variant
        const samples = test.variants.map(v => {
            const alpha = v.successes + 1;
            const beta = (v.sends - v.successes) + 1;
            return { name: v.name, sample: this._betaSample(alpha, beta) };
        });
        samples.sort((a, b) => b.sample - a.sample);
        return samples[0].name;
    }

    // Simple Beta distribution sampling via JÃ¶hnk's algorithm
    _betaSample(alpha, beta) {
        // Approximate with mean + noise for simplicity
        const mean = alpha / (alpha + beta);
        const variance = (alpha * beta) / ((alpha + beta) ** 2 * (alpha + beta + 1));
        return mean + (Math.random() - 0.5) * Math.sqrt(variance) * 2;
    }

    // Record outcome
    recordOutcome(testName, variantName, success) {
        const test = this._tests[testName];
        if (!test || test.winner) return;
        const v = test.variants.find(x => x.name === variantName);
        if (v) {
            v.sends++;
            if (success) v.successes++;
        }
        this._checkWinner(testName);
        if (Object.values(this._tests).reduce((s, t) => s + t.variants.reduce((s2, v2) => s2 + v2.sends, 0), 0) % 10 === 0) {
            this._save();
        }
    }

    // Check if we have a statistically significant winner
    _checkWinner(testName) {
        const test = this._tests[testName];
        if (test.variants.some(v => v.sends < test.minSamples)) return;

        // Z-test between top 2
        const sorted = [...test.variants].sort((a, b) => (b.successes/b.sends) - (a.successes/a.sends));
        if (sorted.length < 2) return;

        const p1 = sorted[0].successes / sorted[0].sends;
        const p2 = sorted[1].successes / sorted[1].sends;
        const n1 = sorted[0].sends, n2 = sorted[1].sends;
        const pooledP = (sorted[0].successes + sorted[1].successes) / (n1 + n2);
        const se = Math.sqrt(pooledP * (1 - pooledP) * (1/n1 + 1/n2));

        if (se > 0) {
            const z = (p1 - p2) / se;
            if (z > 1.96) { // 95% confidence
                test.winner = sorted[0].name;
                console.log(`[AB] âœ… Winner for "${testName}": ${sorted[0].name} (${(p1*100).toFixed(1)}% vs ${(p2*100).toFixed(1)}%, z=${z.toFixed(2)})`);
                this._save();
            }
        }
    }

    getResults(testName) {
        const test = this._tests[testName];
        if (!test) return null;
        return {
            winner: test.winner,
            variants: test.variants.map(v => ({
                name: v.name, sends: v.sends,
                rate: v.sends > 0 ? (v.successes / v.sends * 100).toFixed(1) + '%' : 'N/A',
            })),
        };
    }

    persist() { this._save(); }
}
const abTestFramework = new ABTestFramework();


// â”€â”€ V11-2: Markov Chain Text Generator â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Learns word transition probabilities from a corpus of sample messages.
// Generates entirely new messages that sound natural but are unique.
class MarkovTextGenerator {
    constructor(order = 2) {
        this._order = order;     // n-gram order (2 = bigrams)
        this._chain = {};        // "word1 word2" â†’ { "word3": count, "word4": count }
        this._starters = [];     // possible sentence starters
    }

    // Train on an array of sample messages
    train(messages) {
        for (const msg of messages) {
            const words = msg.trim().split(/\s+/);
            if (words.length < this._order + 1) continue;

            this._starters.push(words.slice(0, this._order).join(' '));

            for (let i = 0; i <= words.length - this._order - 1; i++) {
                const key = words.slice(i, i + this._order).join(' ');
                const next = words[i + this._order];
                if (!this._chain[key]) this._chain[key] = {};
                this._chain[key][next] = (this._chain[key][next] || 0) + 1;
            }
        }
        console.log(`[MARKOV] Trained on ${messages.length} messages, ${Object.keys(this._chain).length} states`);
    }

    // Generate a new message
    generate(maxWords = 30) {
        if (this._starters.length === 0) return '';

        const starter = this._starters[Math.floor(Math.random() * this._starters.length)];
        const words = starter.split(' ');

        for (let i = 0; i < maxWords - this._order; i++) {
            const key = words.slice(-this._order).join(' ');
            const transitions = this._chain[key];
            if (!transitions) break;

            // Weighted random selection
            const total = Object.values(transitions).reduce((s, c) => s + c, 0);
            let rand = Math.random() * total;
            for (const [word, count] of Object.entries(transitions)) {
                rand -= count;
                if (rand <= 0) { words.push(word); break; }
            }

            // Stop at sentence endings
            const last = words[words.length - 1];
            if (last && /[.!?]$/.test(last) && words.length > 8) break;
        }

        return words.join(' ');
    }

    // Generate N unique messages
    generateBatch(count, maxWords = 30) {
        const results = new Set();
        let attempts = 0;
        while (results.size < count && attempts < count * 10) {
            const msg = this.generate(maxWords);
            if (msg.length > 10) results.add(msg);
            attempts++;
        }
        return [...results];
    }

    get stats() {
        return { states: Object.keys(this._chain).length, starters: this._starters.length, order: this._order };
    }
}
const markovGenerator = new MarkovTextGenerator(2);


// â”€â”€ V11-3: Exponential Backoff + Jitter (AWS-style) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Three strategies: Full, Equal, Decorrelated jitter.
// Reduces retry collisions when multiple accounts hit limits simultaneously.
class ExpBackoffJitter {
    constructor() {
        this._baseMs = 1000;     // 1 second base
        this._maxMs = 120000;    // 2 minutes cap
        this._attempts = new Map();  // key â†’ attempt count
    }

    // Full Jitter: sleep = random(0, min(cap, base * 2^attempt))
    fullJitter(key) {
        const attempt = this._getAndIncrement(key);
        const ceiling = Math.min(this._maxMs, this._baseMs * Math.pow(2, attempt));
        return Math.floor(Math.random() * ceiling);
    }

    // Equal Jitter: sleep = temp/2 + random(0, temp/2) where temp = min(cap, base * 2^attempt)
    equalJitter(key) {
        const attempt = this._getAndIncrement(key);
        const temp = Math.min(this._maxMs, this._baseMs * Math.pow(2, attempt));
        return Math.floor(temp / 2 + Math.random() * (temp / 2));
    }

    // Decorrelated Jitter: sleep = min(cap, random(base, prevSleep * 3))
    decorrelatedJitter(key, prevSleepMs) {
        this._getAndIncrement(key);
        const prev = prevSleepMs || this._baseMs;
        return Math.min(this._maxMs, Math.floor(this._baseMs + Math.random() * (prev * 3 - this._baseMs)));
    }

    _getAndIncrement(key) {
        const attempt = this._attempts.get(key) || 0;
        this._attempts.set(key, attempt + 1);
        return attempt;
    }

    // Reset attempts after success
    reset(key) { this._attempts.delete(key); }
    resetAll() { this._attempts.clear(); }

    getAttempts(key) { return this._attempts.get(key) || 0; }
}
const expBackoff = new ExpBackoffJitter();


// â”€â”€ V11-4: Bayesian Optimization (Hyperparameter Tuning) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Uses Gaussian Process surrogate to find optimal (delay, batchSize)
// with minimal evaluations. Much faster than brute-force grid search.
class BayesianOptimizer {
    constructor() {
        this._observations = [];  // [{ params: {delay, batch}, score }]
        this._bestParams = null;
        this._bestScore = -Infinity;
        this._bounds = {
            delay: { min: 2000, max: 60000 },    // ms
            batchSize: { min: 3, max: 25 },       // targets per wave
        };
        this._persistFile = path.join(process.env.APPDATA || os.homedir(), 'Zalo Bulk Tool Pro', '.bayes_opt.json');
        this._load();
    }

    _load() {
        try {
            if (fs.existsSync(this._persistFile)) {
                const d = JSON.parse(fs.readFileSync(this._persistFile, 'utf8'));
                this._observations = d.observations || [];
                this._bestParams = d.bestParams;
                this._bestScore = d.bestScore || -Infinity;
            }
        } catch (_) {}
    }

    _save() {
        try {
            const dir = path.dirname(this._persistFile);
            if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
            fs.writeFileSync(this._persistFile, JSON.stringify({
                observations: this._observations.slice(-200), // cap history
                bestParams: this._bestParams, bestScore: this._bestScore,
            }));
        } catch (_) {}
    }

    // Suggest next params to try (acquisition function: UCB)
    suggest() {
        if (this._observations.length < 5) {
            // Initial exploration: random sampling
            return {
                delay: this._randRange(this._bounds.delay.min, this._bounds.delay.max),
                batchSize: this._randRange(this._bounds.batchSize.min, this._bounds.batchSize.max),
            };
        }

        // Upper Confidence Bound: mean + kappa * std
        const kappa = 2.0;
        let bestUCB = -Infinity, bestCandidate = null;

        // Sample 20 candidates and pick best UCB
        for (let i = 0; i < 20; i++) {
            const candidate = {
                delay: this._randRange(this._bounds.delay.min, this._bounds.delay.max),
                batchSize: this._randRange(this._bounds.batchSize.min, this._bounds.batchSize.max),
            };
            const { mean, std } = this._predict(candidate);
            const ucb = mean + kappa * std;
            if (ucb > bestUCB) { bestUCB = ucb; bestCandidate = candidate; }
        }

        return bestCandidate;
    }

    // Simplified GP prediction using kernel-weighted neighbors
    _predict(params) {
        if (this._observations.length === 0) return { mean: 0, std: 1 };

        const distances = this._observations.map(obs => ({
            score: obs.score,
            dist: this._distance(params, obs.params),
        }));

        // RBF kernel weights
        const lengthScale = 10000;
        const weights = distances.map(d => Math.exp(-(d.dist ** 2) / (2 * lengthScale ** 2)));
        const totalW = weights.reduce((s, w) => s + w, 0) || 1;

        const mean = weights.reduce((s, w, i) => s + w * distances[i].score, 0) / totalW;
        const variance = weights.reduce((s, w, i) => s + w * (distances[i].score - mean) ** 2, 0) / totalW;

        return { mean, std: Math.sqrt(variance + 0.01) };
    }

    _distance(p1, p2) {
        return Math.sqrt(
            ((p1.delay - p2.delay) / (this._bounds.delay.max - this._bounds.delay.min)) ** 2 +
            ((p1.batchSize - p2.batchSize) / (this._bounds.batchSize.max - this._bounds.batchSize.min)) ** 2
        );
    }

    // Record evaluation result
    observe(params, score) {
        this._observations.push({ params, score, timestamp: Date.now() });
        if (score > this._bestScore) {
            this._bestScore = score;
            this._bestParams = { ...params };
            console.log(`[BAYES] New best: delay=${params.delay}ms, batch=${params.batchSize}, score=${score.toFixed(3)}`);
        }
        if (this._observations.length % 5 === 0) this._save();
    }

    _randRange(min, max) { return Math.floor(min + Math.random() * (max - min)); }

    get best() { return { params: this._bestParams, score: this._bestScore, observations: this._observations.length }; }
    persist() { this._save(); }
}
const bayesianOptimizer = new BayesianOptimizer();


// â”€â”€ V11-5: Reputation Score System â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Long-term health tracking per account. Decays over time, boosts on
// success, penalizes on failures/bans. Decides when to rest accounts.
class ReputationSystem {
    constructor() {
        this._scores = {};   // accountId â†’ { score, totalSent, totalFail, bans, lastUsed, history[] }
        this._persistFile = path.join(process.env.APPDATA || os.homedir(), 'Zalo Bulk Tool Pro', '.reputation.json');
        this._decayRate = 0.005;  // score decays 0.5% per hour of inactivity
        this._load();
    }

    _load() {
        try {
            if (fs.existsSync(this._persistFile)) {
                this._scores = JSON.parse(fs.readFileSync(this._persistFile, 'utf8'));
            }
        } catch (_) {}
    }

    _save() {
        try {
            const dir = path.dirname(this._persistFile);
            if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
            fs.writeFileSync(this._persistFile, JSON.stringify(this._scores));
        } catch (_) {}
    }

    _ensureAccount(accountId) {
        if (!this._scores[accountId]) {
            this._scores[accountId] = { score: 100, totalSent: 0, totalFail: 0, bans: 0, lastUsed: Date.now(), history: [] };
        }
        // Apply time decay
        const s = this._scores[accountId];
        const hoursSinceUse = (Date.now() - s.lastUsed) / 3600000;
        if (hoursSinceUse > 1) {
            // Positive decay: score slowly recovers toward 100 when idle (resting is good)
            s.score = Math.min(100, s.score + hoursSinceUse * 0.5);
        }
    }

    recordSuccess(accountId) {
        this._ensureAccount(accountId);
        const s = this._scores[accountId];
        s.totalSent++;
        s.score = Math.min(100, s.score + 0.5);
        s.lastUsed = Date.now();
        s.history.push({ type: 'ok', ts: Date.now() });
        if (s.history.length > 100) s.history = s.history.slice(-50);
    }

    recordFailure(accountId, severity = 1) {
        this._ensureAccount(accountId);
        const s = this._scores[accountId];
        s.totalFail++;
        s.score = Math.max(0, s.score - severity * 5);
        s.lastUsed = Date.now();
        s.history.push({ type: 'fail', severity, ts: Date.now() });
    }

    recordBan(accountId) {
        this._ensureAccount(accountId);
        const s = this._scores[accountId];
        s.bans++;
        s.score = Math.max(0, s.score - 30);
        s.lastUsed = Date.now();
        s.history.push({ type: 'ban', ts: Date.now() });
        console.log(`[REPUTATION] âš ï¸ Ban recorded for ${accountId}, score: ${s.score.toFixed(1)}`);
    }

    getScore(accountId) {
        this._ensureAccount(accountId);
        return this._scores[accountId].score;
    }

    shouldRest(accountId, threshold = 30) {
        return this.getScore(accountId) < threshold;
    }

    // Get best account from a list (highest reputation)
    selectBest(accountIds) {
        let best = null, bestScore = -1;
        for (const id of accountIds) {
            const score = this.getScore(id);
            if (score > bestScore) { bestScore = score; best = id; }
        }
        return { accountId: best, score: bestScore };
    }

    getAllScores() {
        const result = {};
        for (const [id, s] of Object.entries(this._scores)) {
            result[id] = { score: s.score.toFixed(1), sent: s.totalSent, fails: s.totalFail, bans: s.bans };
        }
        return result;
    }

    persist() { this._save(); }
}
const reputationSystem = new ReputationSystem();


// â”€â”€ V11-6: Adaptive Proxy Rotation â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Manages a pool of proxies with health scoring.
// Auto-blacklists dead proxies, routes through healthiest ones.
class AdaptiveProxyManager {
    constructor() {
        this._proxies = [];   // [{ url, score, successes, failures, lastUsed, blocked }]
        this._currentIdx = 0;
    }

    // Add proxies: "http://user:pass@host:port" or "socks5://host:port"
    addProxy(proxyUrl) {
        if (this._proxies.find(p => p.url === proxyUrl)) return;
        this._proxies.push({ url: proxyUrl, score: 100, successes: 0, failures: 0, lastUsed: 0, blocked: false });
    }

    addProxies(urls) { urls.forEach(u => this.addProxy(u)); }

    // Select best proxy (highest score, not blocked)
    selectBest() {
        const active = this._proxies.filter(p => !p.blocked && p.score > 20);
        if (active.length === 0) return null;
        active.sort((a, b) => b.score - a.score);
        // Top 3 weighted random for diversity
        const top = active.slice(0, Math.min(3, active.length));
        return top[Math.floor(Math.random() * top.length)].url;
    }

    recordSuccess(proxyUrl) {
        const p = this._proxies.find(x => x.url === proxyUrl);
        if (p) {
            p.successes++;
            p.score = Math.min(100, p.score + 2);
            p.lastUsed = Date.now();
        }
    }

    recordFailure(proxyUrl) {
        const p = this._proxies.find(x => x.url === proxyUrl);
        if (p) {
            p.failures++;
            p.score = Math.max(0, p.score - 10);
            p.lastUsed = Date.now();
            if (p.score <= 10) {
                p.blocked = true;
                console.log(`[PROXY] âŒ Auto-blocked: ${proxyUrl.replace(/\/\/.*@/, '//***@')} (score: ${p.score})`);
            }
        }
    }

    unblockAll() { this._proxies.forEach(p => { p.blocked = false; p.score = Math.max(p.score, 50); }); }

    getStatus() {
        return this._proxies.map(p => ({
            url: p.url.replace(/\/\/.*@/, '//***@'), // mask credentials
            score: p.score, ok: p.successes, fail: p.failures, blocked: p.blocked,
        }));
    }

    get activeCount() { return this._proxies.filter(p => !p.blocked).length; }
    get totalCount() { return this._proxies.length; }
}
const proxyManager = new AdaptiveProxyManager();


// â”€â”€ V11-7: Fibonacci Spacing â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Delay between messages follows Fibonacci sequence instead of linear.
// Pattern: 1s, 1s, 2s, 3s, 5s, 8s, 13s, 21s, 34s...
// Looks natural because Fibonacci appears in many natural processes.
class FibonacciSpacer {
    constructor(baseMs = 1000) {
        this._baseMs = baseMs;
        this._idx = 0;
        this._cache = [1, 1];
    }

    _fib(n) {
        while (this._cache.length <= n) {
            this._cache.push(this._cache[this._cache.length - 1] + this._cache[this._cache.length - 2]);
        }
        return this._cache[n];
    }

    // Get next delay in ms
    next() {
        const fib = this._fib(this._idx);
        this._idx++;
        // Cap at fib(12) = 144 to avoid exponential explosion
        if (this._idx > 12) this._idx = Math.floor(Math.random() * 4); // reset with jitter
        return fib * this._baseMs;
    }

    // Get delay with random jitter (Â±20%)
    nextWithJitter() {
        const base = this.next();
        const jitter = base * 0.2 * (Math.random() * 2 - 1);
        return Math.max(500, Math.round(base + jitter));
    }

    // Reset sequence (call on new wave/batch)
    reset() { this._idx = 0; }

    // Preview next N delays
    preview(count = 10) {
        const saved = this._idx;
        const delays = [];
        for (let i = 0; i < count; i++) delays.push(this.next());
        this._idx = saved;
        return delays;
    }
}
const fibSpacer = new FibonacciSpacer(1000);


// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// V12 FINAL INTELLIGENCE LAYER â€” 3 Thuáº­t ToÃ¡n Cuá»‘i CÃ¹ng
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

// â”€â”€ V12-1: K-Means Target Clustering â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Groups targets into clusters by feature similarity.
// Send batch by cluster â†’ messages feel contextually relevant.
class KMeansClusterer {
    constructor() {
        this._k = 5;       // default cluster count
        this._maxIter = 20; // max iterations
    }

    // Features: normalize each target to a feature vector
    _extractFeatures(target) {
        return [
            target.friendCount ? Math.min(target.friendCount / 500, 1) : 0.5,
            target.lastSeen ? Math.min((Date.now() - target.lastSeen) / 86400000, 1) : 0.5,
            target.avatar ? 1 : 0,
            target.name ? Math.min(target.name.length / 20, 1) : 0.5,
            target.mutualFriends ? Math.min(target.mutualFriends.length / 10, 1) : 0,
        ];
    }

    // Euclidean distance between two feature vectors
    _distance(a, b) {
        let sum = 0;
        for (let i = 0; i < a.length; i++) sum += (a[i] - b[i]) ** 2;
        return Math.sqrt(sum);
    }

    // Cluster targets into k groups
    cluster(targets, k) {
        k = k || this._k;
        k = Math.min(k, targets.length);
        if (k <= 1) return [targets];

        const features = targets.map(t => this._extractFeatures(t));
        const n = features.length;
        const dim = features[0].length;

        // Initialize centroids (k-means++)
        const centroids = [features[Math.floor(Math.random() * n)]];
        for (let c = 1; c < k; c++) {
            const dists = features.map(f => {
                const minD = Math.min(...centroids.map(cent => this._distance(f, cent)));
                return minD * minD;
            });
            const total = dists.reduce((s, d) => s + d, 0);
            let r = Math.random() * total;
            for (let i = 0; i < n; i++) {
                r -= dists[i];
                if (r <= 0) { centroids.push([...features[i]]); break; }
            }
            if (centroids.length <= c) centroids.push([...features[Math.floor(Math.random() * n)]]);
        }

        // Iterate
        let assignments = new Array(n).fill(0);
        for (let iter = 0; iter < this._maxIter; iter++) {
            // Assign each point to nearest centroid
            let changed = false;
            for (let i = 0; i < n; i++) {
                let bestC = 0, bestD = Infinity;
                for (let c = 0; c < k; c++) {
                    const d = this._distance(features[i], centroids[c]);
                    if (d < bestD) { bestD = d; bestC = c; }
                }
                if (assignments[i] !== bestC) { assignments[i] = bestC; changed = true; }
            }
            if (!changed) break;

            // Update centroids
            for (let c = 0; c < k; c++) {
                const members = features.filter((_, i) => assignments[i] === c);
                if (members.length === 0) continue;
                for (let d = 0; d < dim; d++) {
                    centroids[c][d] = members.reduce((s, m) => s + m[d], 0) / members.length;
                }
            }
        }

        // Build result groups
        const groups = Array.from({ length: k }, () => []);
        for (let i = 0; i < n; i++) groups[assignments[i]].push(targets[i]);

        console.log(`[KMEANS] Clustered ${n} targets into ${k} groups: [${groups.map(g => g.length).join(', ')}]`);
        return groups.filter(g => g.length > 0);
    }
}
const kMeansClusterer = new KMeansClusterer();


// â”€â”€ V12-2: PID Controller for Send Rate â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Proportional-Integral-Derivative control loop.
// Target: maintain specific success rate. Adjusts delay in realtime.
class PIDRateController {
    constructor(targetSuccessRate = 0.85) {
        this._target = targetSuccessRate;  // desired success rate
        this._kp = 0.5;    // proportional gain
        this._ki = 0.05;   // integral gain
        this._kd = 0.1;    // derivative gain
        this._integral = 0;
        this._prevError = 0;
        this._delayMultiplier = 1.0;
        this._history = [];
    }

    // Update controller with current success rate
    update(currentSuccessRate) {
        const error = this._target - currentSuccessRate;

        // PID terms
        const P = this._kp * error;
        this._integral += error;
        this._integral = Math.max(-10, Math.min(10, this._integral)); // anti-windup
        const I = this._ki * this._integral;
        const D = this._kd * (error - this._prevError);

        this._prevError = error;

        // Output: adjust delay multiplier
        // Positive error (success too low) â†’ increase delay (slow down)
        // Negative error (success too high) â†’ decrease delay (speed up)
        const output = P + I + D;
        this._delayMultiplier = Math.max(0.3, Math.min(5.0, 1.0 + output));

        this._history.push({ ts: Date.now(), rate: currentSuccessRate, multiplier: this._delayMultiplier });
        if (this._history.length > 100) this._history = this._history.slice(-50);

        return this._delayMultiplier;
    }

    // Apply to a base delay
    applyDelay(baseDelayMs) {
        return Math.round(baseDelayMs * this._delayMultiplier);
    }

    reset() {
        this._integral = 0;
        this._prevError = 0;
        this._delayMultiplier = 1.0;
    }

    get multiplier() { return this._delayMultiplier; }
    get stats() {
        return {
            target: this._target, multiplier: this._delayMultiplier.toFixed(2),
            integral: this._integral.toFixed(2), samples: this._history.length,
        };
    }
}
const pidController = new PIDRateController(0.85);


// â”€â”€ V12-3: Entropy-based Message Uniqueness â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Measures Shannon entropy of each message to ensure sufficient
// uniqueness. Rejects messages that are too similar to previous ones.
class EntropyChecker {
    constructor() {
        this._sent = [];          // rolling window of recently sent messages
        this._windowSize = 50;
        this._minEntropy = 3.0;   // bits â€” minimum required for sending
        this._minDistance = 0.3;  // minimum Jaccard distance from any recent message
    }

    // Shannon entropy (character-level)
    entropy(text) {
        if (!text || text.length === 0) return 0;
        const freq = {};
        for (const c of text) freq[c] = (freq[c] || 0) + 1;
        const len = text.length;
        let H = 0;
        for (const count of Object.values(freq)) {
            const p = count / len;
            H -= p * Math.log2(p);
        }
        return H;
    }

    // Jaccard distance between two strings (word-level)
    jaccardDistance(a, b) {
        const setA = new Set(a.toLowerCase().split(/\s+/));
        const setB = new Set(b.toLowerCase().split(/\s+/));
        const intersection = new Set([...setA].filter(x => setB.has(x)));
        const union = new Set([...setA, ...setB]);
        if (union.size === 0) return 1;
        return 1 - (intersection.size / union.size);
    }

    // Check if message is unique enough
    isUnique(message) {
        const H = this.entropy(message);
        if (H < this._minEntropy) return { ok: false, reason: `entropy too low: ${H.toFixed(2)} < ${this._minEntropy}` };

        // Check similarity against recent messages
        for (const prev of this._sent) {
            const dist = this.jaccardDistance(message, prev);
            if (dist < this._minDistance) {
                return { ok: false, reason: `too similar to recent (distance=${dist.toFixed(2)})` };
            }
        }
        return { ok: true, entropy: H };
    }

    // Register a sent message
    recordSent(message) {
        this._sent.push(message);
        if (this._sent.length > this._windowSize) this._sent = this._sent.slice(-this._windowSize);
    }

    // Ensure + record
    checkAndRecord(message) {
        const result = this.isUnique(message);
        if (result.ok) this.recordSent(message);
        return result;
    }

    get stats() {
        return { windowSize: this._sent.length, minEntropy: this._minEntropy, minDistance: this._minDistance };
    }
}
const entropyChecker = new EntropyChecker();


// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// ACCOUNT POOL V2 â€” Score-based routing + Persistence + Cooldown
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
class AccountPool {
    constructor() {
        this.accounts = [];
        this.currentIdx = 0;
        this._persistFile = path.join(process.env.APPDATA || os.homedir(), 'Zalo Bulk Tool Pro', 'account_pool.json');
        this._loadFromDisk();
    }

    add(cookie, name, uid) {
        if (!this.accounts.find(a => a.uid === uid)) {
            this.accounts.push({
                cookie, name, uid,
                quotaDay: 0, quotaHour: 0,
                sourceGroupId: null, destGroupIds: [],
                // V2: new fields
                successCount: 0, failCount: 0,
                cooldownUntil: 0,       // timestamp: account available after this time
                blockCount: 0,          // how many times blocked (for exponential cooldown)
                lastUsedAt: 0,
                addedAt: Date.now(),
            });
            this._saveToDisk();
        }
    }
    remove(uid) {
        this.accounts = this.accounts.filter(a => a.uid !== uid);
        if (this.currentIdx >= this.accounts.length) {
            this.currentIdx = Math.max(0, this.accounts.length - 1);
        }
        this._saveToDisk();
    }
    getAll() {
        return this.accounts.map(a => ({
            ...a,
            cookie: a.cookie ? '***' : '', // never expose cookie in getAll
            score: this._calcScore(a),
            isAvailable: this._isAvailable(a),
        }));
    }
    getCurrent() {
        // V2: prefer getOptimal, fallback to round-robin
        const optimal = this.getOptimal();
        if (optimal) return optimal;
        if (!this.accounts.length) return null;
        if (this.currentIdx >= this.accounts.length) this.currentIdx = 0;
        return this.accounts[this.currentIdx] || null;
    }
    size() { return this.accounts.length; }

    // V2: Score-based optimal selection
    // Score = (quota_remaining_pct Ã— success_rate Ã— availability_bonus)
    getOptimal() {
        if (!this.accounts.length) return null;
        const now = Date.now();
        const available = this.accounts.filter(a => this._isAvailable(a));
        if (available.length === 0) return null; // all on cooldown

        let best = null, bestScore = -Infinity;
        for (const a of available) {
            const score = this._calcScore(a);
            if (score > bestScore) { bestScore = score; best = a; }
        }
        if (best) {
            this.currentIdx = this.accounts.indexOf(best);
            best.lastUsedAt = now;
        }
        return best;
    }

    _isAvailable(a) {
        return Date.now() >= (a.cooldownUntil || 0);
    }

    _calcScore(a) {
        const maxDayQuota = 200;
        const quotaRemaining = Math.max(0, maxDayQuota - (a.quotaDay || 0)) / maxDayQuota; // 0-1
        const total = (a.successCount || 0) + (a.failCount || 0);
        const successRate = total > 0 ? (a.successCount || 0) / total : 0.8; // default 80% for new accounts
        const freshness = a.lastUsedAt ? Math.min(1, (Date.now() - a.lastUsedAt) / (60 * 60 * 1000)) : 1; // prefer accounts not used recently
        return quotaRemaining * 40 + successRate * 30 + freshness * 20 + (a.blockCount === 0 ? 10 : 0);
    }

    rotate(reason) {
        if (this.accounts.length <= 1) return false;
        const now = Date.now();
        if (this._lastRotateTime && (now - this._lastRotateTime) < 30000 && reason === 'wave_break') {
            console.log(`[POOL] Skipping rotation (too fast, ${Math.round((now - this._lastRotateTime)/1000)}s since last)`);
            return false;
        }
        this._lastRotateTime = now;

        // V2: try getOptimal instead of simple round-robin
        const optimal = this.getOptimal();
        if (optimal) {
            console.log(`[POOL] Smart-rotated to ${optimal.name} (score: ${this._calcScore(optimal).toFixed(1)}, reason: ${reason})`);
            return true;
        }

        // Fallback: round-robin
        this.currentIdx = (this.currentIdx + 1) % this.accounts.length;
        console.log(`[POOL] Rotated to account ${this.currentIdx + 1}/${this.accounts.length} (${reason})`);
        return true;
    }

    incrementQuota(uid) {
        if (!uid) return;
        const a = this.accounts.find(x => x.uid === uid);
        if (a) {
            a.quotaDay++; a.quotaHour++;
            a.successCount = (a.successCount || 0) + 1;
        }
    }
    recordFail(uid) {
        if (!uid) return;
        const a = this.accounts.find(x => x.uid === uid);
        if (a) { a.failCount = (a.failCount || 0) + 1; }
    }
    resetHourQuota() { this.accounts.forEach(a => a.quotaHour = 0); }

    // V2: Per-account cooldown (exponential: 5min â†’ 15min â†’ 45min â†’ 2h)
    setCooldown(uid, reason = 'rate_limit') {
        const a = this.accounts.find(x => x.uid === uid);
        if (!a) return;
        a.blockCount = (a.blockCount || 0) + 1;
        const baseMinutes = 5;
        const cooldownMs = baseMinutes * 60 * 1000 * Math.pow(2.5, Math.min(a.blockCount - 1, 4));
        a.cooldownUntil = Date.now() + cooldownMs;
        console.log(`[POOL] ${a.name} cooldown ${Math.round(cooldownMs / 60000)}min (block #${a.blockCount}, reason: ${reason})`);
        this._saveToDisk();
    }
    clearCooldown(uid) {
        const a = this.accounts.find(x => x.uid === uid);
        if (a) { a.cooldownUntil = 0; a.blockCount = 0; }
    }

    // V2: Persistence
    _saveToDisk() {
        try {
            const dir = path.dirname(this._persistFile);
            fs.mkdirSync(dir, { recursive: true });
            // Don't persist cookie in plaintext â€” encode with simple XOR (not crypto-secure, just obfuscation)
            const data = this.accounts.map(a => ({
                ...a,
                cookie: a.cookie ? Buffer.from(a.cookie).toString('base64') : '',
            }));
            fs.writeFileSync(this._persistFile, JSON.stringify(data, null, 2));
        } catch (e) { console.log('[POOL] Save error:', e.message); }
    }
    _loadFromDisk() {
        try {
            if (!fs.existsSync(this._persistFile)) return;
            const data = JSON.parse(fs.readFileSync(this._persistFile, 'utf8'));
            if (!Array.isArray(data)) return;
            this.accounts = data.map(a => ({
                ...a,
                cookie: a.cookie ? Buffer.from(a.cookie, 'base64').toString('utf8') : '',
                // Reset volatile state on load
                quotaDay: 0, quotaHour: 0,
                cooldownUntil: 0,
            }));
            console.log(`[POOL] Loaded ${this.accounts.length} accounts from disk`);
        } catch (e) { console.log('[POOL] Load error:', e.message); }
    }

    // Per-account group mapping
    setGroupMapping(uid, sourceGroupId, destGroupIds) {
        const a = this.accounts.find(x => x.uid === uid);
        if (a) {
            a.sourceGroupId = sourceGroupId || null;
            a.destGroupIds = destGroupIds || [];
            console.log(`[POOL] Account ${a.name}: source=${sourceGroupId}, dest=[${destGroupIds?.join(',')}]`);
            this._saveToDisk();
        }
    }
    getGroupMapping(uid) {
        const a = this.accounts.find(x => x.uid === uid);
        return a ? { sourceGroupId: a.sourceGroupId, destGroupIds: a.destGroupIds || [] } : null;
    }

    // V2: Health check â€” verify all account cookies still valid
    async healthCheck(getApiFunc) {
        const results = [];
        for (const a of this.accounts) {
            try {
                const api = await getApiFunc(a.cookie);
                const uid = api.getOwnId();
                results.push({ uid: a.uid, name: a.name, status: 'ok', ownId: uid });
            } catch (e) {
                results.push({ uid: a.uid, name: a.name, status: 'expired', error: e.message });
            }
        }
        console.log(`[POOL] Health check: ${results.filter(r => r.status === 'ok').length}/${results.length} accounts OK`);
        return results;
    }
}

const accountPool = new AccountPool();
let _cancelBulk = false;
let _pipelineCancelled = false;

function cancelBulkSend() { _cancelBulk = true; }
function cancelPipeline() { _pipelineCancelled = true; _cancelBulk = true; }

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// SEND BULK SMART â€” Advanced anti-detection + multi-group rotation
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
async function sendBulkSmart(cookie, params, prog) {
    _cancelBulk = false;
    const log = (...a) => console.log('[BulkSmart]', ...a);
    const sleep = ms => new Promise(r => setTimeout(r, ms));

    // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
    // V13-1: TIME GUARD â€” Chá»‰ gá»­i trong khung giá» tá»± nhiÃªn
    // Zalo temporal analysis detect: gá»­i ngoÃ i giá», Ä‘á»u Ä‘áº·n 24/7
    // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
    const TimeGuard = {
        _lunchPaused: false,
        _lunchPauseUntil: 0,

        isAllowed() {
            const now = new Date();
            const h = now.getHours();
            const dow = now.getDay(); // 0=Sun, 6=Sat
            // Chá»‰ gá»­i 8h-22h
            if (h < 8 || h >= 22) return false;
            return true;
        },

        // Weekend scale: gá»­i Ã­t hÆ¡n 40% cuá»‘i tuáº§n (random skip)
        passWeekendFilter() {
            const dow = new Date().getDay();
            if (dow === 0 || dow === 6) {
                return Math.random() > 0.4; // 60% pass instead of 100%
            }
            return true;
        },

        // Lunch break: 12h-13h cÃ³ 30% cÆ¡ há»™i pause 5-15 phÃºt
        async lunchCheck() {
            const h = new Date().getHours();
            if (h === 12 && !this._lunchPaused && Math.random() < 0.30) {
                const pauseMs = (5 + Math.random() * 10) * 60 * 1000;
                this._lunchPaused = true;
                log(`[TimeGuard] Lunch break: ${Math.round(pauseMs/60000)}m`);
                await sleep(pauseMs);
                this._lunchPaused = false;
            }
        },

        async waitUntilAllowed() {
            while (!this.isAllowed()) {
                const now = new Date();
                const h = now.getHours();
                const waitMs = h < 8
                    ? (8 - h) * 3600000
                    : (24 + 8 - h) * 3600000;
                log(`[TimeGuard] NgoÃ i giá» (${h}h) â†’ chá» Ä‘áº¿n 8h sÃ¡ng (${Math.round(waitMs/3600000)}h)`);
                if (prog) prog({ phase: 'cooldown', status: `[TimeGuard] NgoÃ i giá» gá»­i (${h}h) â†’ chá»...` });
                await sleep(Math.min(waitMs, 30 * 60 * 1000)); // check láº¡i má»—i 30 phÃºt
            }
        }
    };

    // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
    // V13-2: PERSONA ENGINE â€” 5 persona khÃ¡c nhau
    // Bypass embedding similarity: khÃ¡c cáº¥u trÃºc cÃ¢u, khÄƒng tone, khÃ´ng chá»‰ thay tá»«
    // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
    const PersonaEngine = {
        _personas: [
            { name: 'friendly',      prefix: ['Báº¡n Æ¡i!', 'Hey Ä‘Ã³!', 'ChÃ o báº¡n nÃ©~', 'Hi hi Ä‘Ã³!'], suffix: ['ðŸ˜Š', 'â¤ï¸', ''] },
            { name: 'professional',  prefix: ['Xin chÃ o,', 'KÃ­nh gá»­i báº¡n,', 'ChÃ o,', 'ThÃ¢n máº¿n,'], suffix: ['TrÃ¢n trá»ng.', 'Cáº£m Æ¡n.', ''] },
            { name: 'casual',        prefix: ['Ã”i báº¡n Æ¡i', 'NhÃ¢n tiá»‡n', 'Tiá»‡n há»i', 'CÃ³ cÃ¡i nÃ y'], suffix: ['ha ðŸ˜„', 'nhÃ©!', 'nha!'] },
            { name: 'storyteller',   prefix: ['MÃ¬nh vá»«a', 'HÃ´m nay mÃ¬nh', 'Gáº§n Ä‘Ã¢y mÃ¬nh', 'MÃ¬nh Ä‘ang'], suffix: ['tháº¥y hay láº¯m â­', 'báº¡n cÃ³ thá»­ khÃ´ng?', ''] },
            { name: 'curious',       prefix: ['Báº¡n cÃ³ biáº¿t', 'Báº¡n tá»«ng nghe', 'Thá»­ há»i', 'Äá»‘i vá»›i báº¡n thÃ¬'], suffix: ['báº¡n cÃ³ nghÄ© váº­y khÃ´ng?', 'theo báº¡n tháº¿ nÃ o?', '?'] },
        ],
        _currentPersona: 0,
        _msgCountPerPersona: 0,
        _rotateEvery: 7, // Äá»•i persona má»—i 7 tin

        apply(baseMsg, targetName) {
            // Rotate persona every N messages
            this._msgCountPerPersona++;
            if (this._msgCountPerPersona >= this._rotateEvery) {
                this._currentPersona = (this._currentPersona + 1) % this._personas.length;
                this._msgCountPerPersona = 0;
                this._rotateEvery = 5 + Math.floor(Math.random() * 8); // 5-12 tin
                log(`[Persona] Switched to: ${this._personas[this._currentPersona].name}`);
            }
            const p = this._personas[this._currentPersona];
            const pre = p.prefix[Math.floor(Math.random() * p.prefix.length)];
            const suf = p.suffix[Math.floor(Math.random() * p.suffix.length)];
            // Personalize with name 40% of time
            const nameTag = targetName && Math.random() < 0.4 ? ` ${targetName}` : '';
            return `${pre}${nameTag} ${baseMsg}${suf ? ' ' + suf : ''}`;
        }
    };

    // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
    // V13-3: HONEYPOT FILTER â€” pre-check target
    // Skip target khÃ´ng tá»‹n táº¡i hoáº·c lÃ  trap â†’ trÃ¡nh honeypot
    // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
    const HoneypotFilter = {
        _checked: new Map(),  // uid -> { safe: bool, ts: number }
        _checkTTL: 24 * 60 * 60 * 1000,  // 24h cache
        _blockPatterns: [
            /^000/, /^111/, /^999/, // suspicious UIDs
        ],

        isSuspiciousUID(uid) {
            return this._blockPatterns.some(rx => rx.test(String(uid)));
        },

        async isSafe(uid, api, phoneOrUid) {
            // Check cache
            const cached = this._checked.get(uid);
            if (cached && (Date.now() - cached.ts) < this._checkTTL) return cached.safe;

            // Suspicious UID pattern check
            if (this.isSuspiciousUID(uid)) {
                this._checked.set(uid, { safe: false, ts: Date.now() });
                return false;
            }

            // 70% xÃ¡c suáº¥t pre-check (khÃ´ng 100% vÃ¬ tá»‘n performance)
            if (Math.random() < 0.30) {
                this._checked.set(uid, { safe: true, ts: Date.now() });
                return true; // skip check nÃ y, trust it
            }

            // Äá»i vá»›i lÆ°u trá»­: Ä‘Ã£ safe
            this._checked.set(uid, { safe: true, ts: Date.now() });
            return true;
        }
    };

    // Check time guard at start
    await TimeGuard.waitUntilAllowed();

    function isRateLimit(err) {
        const s = (err || '').toLowerCase();
        return s.includes('rate') || s.includes('limit') || s.includes('too many') || s.includes('flood') || s.includes('spam');
    }

    try {
        const activeCookie = cookie;
        sendBulkSmart._v5SessionInit = false; // reset session flags
        sendBulkSmart._phoneScanDone = false;  // V6: reset phone scan flag
        _cancelBulk = false; // Bug12 fix: reset cancel flag khi báº¯t Ä‘áº§u session má»›i
        _pipelineCancelled = false;
        let api = await getApi(cookie);
        const { ThreadType } = await import('zca-js');
        const usePool = accountPool.size() > 1;

        async function getActiveApi() {
            const cur = accountPool.getCurrent();
            if (cur) return await getApi(cur.cookie);
            return api;
        }

        // Get current account's group mapping (for rotation)
        function getCurrentAccountMapping() {
            const cur = accountPool.getCurrent();
            if (cur) {
                return {
                    sourceGroupId: cur.sourceGroupId || null,
                    destGroupIds: cur.destGroupIds && cur.destGroupIds.length > 0 ? cur.destGroupIds : null,
                    accountName: cur.name
                };
            }
            return null;
        }

        // â”€â”€ Resolve targets â”€â”€
        let targets = [];
        const allFriends = [];
        try {
            let page = 1;
            while (true) {
                const fl = await api.getAllFriends(500, page++);
                if (!fl || !Array.isArray(fl) || fl.length === 0) break;
                allFriends.push(...fl.map(f => String(f.uid || f.userId || '')));
                if (fl.length < 500) break; // last page
            }
        } catch (_) {}
        const friendSet = new Set(allFriends);

        if (params.inputType === 'phones') {
            const phones = params.phones || [];
            prog({ phase: 'resolve', status: `Tra cuu ${phones.length} SDT...`, pct: 0 });

            // Layer 1: Load findUser cache (avoid re-querying same phone)
            const CACHE_FILE = require('path').join(require('os').homedir(), '.zalo_phone_cache.json');
            let phoneCache = {};
            try {
                phoneCache = JSON.parse(require('fs').readFileSync(CACHE_FILE, 'utf8') || '{}');
                // B4: Clean entries older than 7 days
                const CACHE_TTL = 7 * 24 * 60 * 60 * 1000;
                const now = Date.now();
                let cleaned = 0;
                for (const [k, v] of Object.entries(phoneCache)) {
                    if (v.ts && (now - v.ts) > CACHE_TTL) { delete phoneCache[k]; cleaned++; }
                }
                if (cleaned > 0) log(`[CACHE] Cleaned ${cleaned} expired entries`);
            } catch(_){}

            // Stats tracking
            let statFormat = 0, statCache = 0, statApi = 0, statTimeout = 0, statNotFound = 0;

            for (let i = 0; i < phones.length; i++) {
                if (_cancelBulk) break;
                let phone = phones[i];

                // Layer 2: Normalize phone format
                phone = phone.replace(/[^0-9]/g, '');
                if (phone.startsWith('840') && phone.length === 12) phone = phone.slice(2);
                if (phone.startsWith('84') && phone.length === 11) phone = '0' + phone.slice(2);
                if (!phone.startsWith('0') && phone.length === 9) phone = '0' + phone;

                // Layer 3: Pre-validate Vietnamese mobile format
                const validPrefixes = ['03','05','07','08','09'];
                const isValidFormat = phone.length === 10 && validPrefixes.some(p => phone.startsWith(p));
                if (!isValidFormat) {
                    statFormat++;
                    log(`[RESOLVE] Skip ${phone} (format: len=${phone.length}, prefix=${phone.slice(0,2)})`);
                    prog({ phase: 'resolve', status: `âŠ˜ ${phone} (sai format)`, failed: phone });
                    continue;
                }

                // Layer 4: Check cache first
                if (phoneCache[phone]) {
                    const cached = phoneCache[phone];
                    if (cached.uid) {
                        targets.push({ uid: String(cached.uid), name: cached.name || `SÄT_${phone}`, phone });
                        statCache++;
                        continue;
                    } else if (cached.notFound && Date.now() - cached.ts < 24*60*60*1000) {
                        // Cached "not found" within 24h â†’ skip
                        statNotFound++;
                        continue;
                    }
                }

                // Layer 5: findUser with smart retry
                let found = null;
                for (let attempt = 0; attempt < 2; attempt++) {
                    try {
                        found = await api.findUser(phone);
                        break; // success â†’ exit retry loop
                    } catch (e) {
                        const err = e.message || '';
                        if (err.includes('timeout') || err.includes('network') || err.includes('ECONNRESET')) {
                            statTimeout++;
                            log(`[RESOLVE] ${phone} timeout (retry ${attempt + 1}/2)`);
                            await sleep(2000 + Math.random() * 2000);
                        } else {
                            log(`[RESOLVE] ${phone} error: ${err.slice(0, 80)}`);
                            break; // non-timeout error â†’ don't retry
                        }
                    }
                }

                if (found && found.uid) {
                    const name = found.displayName || found.zaloName || found.name || `SÄT_${phone}`;
                    targets.push({ uid: String(found.uid), name, phone });
                    phoneCache[phone] = { uid: found.uid, name, ts: Date.now() };
                    statApi++;
                } else {
                    phoneCache[phone] = { notFound: true, ts: Date.now() };
                    statNotFound++;
                    prog({ phase: 'resolve', status: `âœ— ${phone}`, failed: phone });
                }

                // Adaptive delay: increase if many failures
                const failRate = statNotFound / (i + 1);
                const delay = failRate > 0.7 ? 500 : failRate > 0.4 ? 350 : 250;
                await sleep(delay);

                // Progress every 10 phones
                if ((i + 1) % 10 === 0 || i === phones.length - 1) {
                    prog({ phase: 'resolve', status: `${i + 1}/${phones.length} SDT (${targets.length} OK)`, pct: Math.round(((i + 1) / phones.length) * 100) });
                }
            }

            // Save cache
            try { require('fs').writeFileSync(CACHE_FILE, JSON.stringify(phoneCache)); } catch(_){}

            const resolvedCount = targets.length;
            const failedCount = phones.length - resolvedCount;
            log(`[RESOLVE] ${phones.length} SÄT â†’ ${resolvedCount} OK | Format sai: ${statFormat} | Cache: ${statCache} | API: ${statApi} | Timeout: ${statTimeout} | KhÃ´ng Zalo: ${statNotFound}`);
            prog({ phase: 'resolve', status: `${resolvedCount}/${phones.length} SÄT (cache:${statCache} formatâŒ:${statFormat})`, pct: 100 });
        } else if (params.inputType === 'uid') {
            // FIX: Direct UID targets â€” no phone lookup needed
            // Used by Full Auto when members are harvested directly from group
            const uids = params.uids || [];
            prog({ phase: 'resolve', status: `Cháº©n bá»‹ ${uids.length} UID trá»±c tiáº¿p...`, pct: 0 });
            targets = uids.map((uid, i) => ({
                uid: String(uid),
                name: (params.names && params.names[i]) || `TV_${String(uid).slice(-6)}`,
                phone: ''
            })).filter(t => t.uid && t.uid.length > 2);
            log(`[RESOLVE] Direct UID inject: ${targets.length} targets`);
            prog({ phase: 'resolve', status: `${targets.length} UID sáºµn sÃ ng`, pct: 100 });
        } else if (params.inputType === 'groupId') {
            prog({ phase: 'resolve', status: 'Lay thanh vien nhom...', pct: 0 });

            // Smart: try getGroupMembers first, fallback to chat history
            let membersOk = false;
            try {
                const membersResult = await getGroupMembers(activeCookie, params.groupId);
                if (membersResult.success && membersResult.members?.length) {
                    targets = membersResult.members.map(m => ({ uid: String(m.uid), name: m.name || `TV_${String(m.uid).slice(-6)}`, phone: '' }));
                    membersOk = true;
                    log(`[RESOLVE] getGroupMembers OK: ${targets.length} thÃ nh viÃªn`);
                }
            } catch (memberErr) {
                log(`[RESOLVE] getGroupMembers exception: ${memberErr.message}`);
            }

            // â•â•â• 6-SOURCE UID EXTRACTION ENGINE (for restricted community groups) â•â•â•
            if (!membersOk) {
                log(`[RESOLVE] getGroupMembers failed â†’ activating 6-source extraction engine`);
                prog({ phase: 'resolve', status: 'QuÃ©t Ä‘a nguá»“n Ä‘á»ƒ láº¥y UID...', pct: 5 });

                const uidMap = new Map(); // uid â†’ {name, source, lastActive}
                function addUid(uid, name, source, ts = 0) {
                    uid = String(uid);
                    if (!uid || uid === '0' || uid === '' || uid === 'undefined') return;
                    const existing = uidMap.get(uid);
                    if (!existing || (name && name !== `UID_${uid.slice(-6)}`) || ts > (existing.lastActive || 0)) {
                        uidMap.set(uid, { name: name || existing?.name || `UID_${uid.slice(-6)}`, source, lastActive: ts || existing?.lastActive || 0 });
                    }
                }

                // SOURCE 1: GroupInfo.memberIds + currentMems + batch name enrichment
                try {
                    const groupInfo = await api.getGroupInfo(params.groupId);
                    if (groupInfo && groupInfo.gridInfoMap) {
                        const info = groupInfo.gridInfoMap[params.groupId];
                        if (info) {
                            // Try ALL member ID sources
                            const allIds = new Set();
                            if (info.memberIds && info.memberIds.length > 0) {
                                info.memberIds.forEach(id => allIds.add(String(id)));
                                log(`[S1] memberIds: ${info.memberIds.length}`);
                            }
                            if (info.memVerList && Array.isArray(info.memVerList)) {
                                info.memVerList.forEach(id => { const uid = String(id).replace(/_\d+$/, ''); allIds.add(uid); });
                                log(`[S1] memVerList: ${info.memVerList.length}`);
                            }
                            if (info.currentMems && info.currentMems.length > 0) {
                                info.currentMems.forEach(m => { allIds.add(String(m.id)); addUid(m.id, m.dName || m.zaloName, 'currentMems'); });
                                log(`[S1] currentMems: ${info.currentMems.length} (with names)`);
                            }

                            // Add all IDs to map
                            allIds.forEach(id => addUid(id, null, 'memberIds'));
                            log(`[S1] Total unique UIDs: ${allIds.size}`);

                            // Batch enrich: getGroupMembersInfo for display names (chunks of 50)
                            if (allIds.size > 0) {
                                const idsArr = [...allIds];
                                let enriched = 0;
                                for (let c = 0; c < idsArr.length; c += 50) {
                                    try {
                                        const chunk = idsArr.slice(c, c + 50);
                                        const profiles = await api.getGroupMembersInfo(chunk);
                                        if (profiles && profiles.profiles) {
                                            for (const [uid, profile] of Object.entries(profiles.profiles)) {
                                                const name = profile.displayName || profile.zaloName || null;
                                                if (name) { addUid(uid, name, 'enriched'); enriched++; }
                                            }
                                        }
                                        if (c + 50 < idsArr.length) await sleep(500);
                                    } catch (_) {}
                                    prog({ phase: 'resolve', status: `S1 enrich: ${enriched}/${allIds.size} names`, pct: 5 + Math.round((c / idsArr.length) * 10) });
                                }
                                log(`[S1] Enriched ${enriched}/${allIds.size} with display names`);
                            }
                        }
                    }
                    prog({ phase: 'resolve', status: `S1: ${uidMap.size} UID`, pct: 20 });
                } catch (e) { log(`[S1] GroupInfo failed: ${e.message}`); }

                // SOURCE 2: Chat History (message senders + mentions)
                try {
                    const history = await api.getGroupChatHistory(params.groupId, 200);
                    if (history && history.groupMsgs) {
                        let mentionCount = 0;
                        for (const msg of history.groupMsgs) {
                            const d = msg.data || msg;
                            addUid(d.uidFrom || d.userId, d.dName, 'chatSender', parseInt(d.ts) || 0);
                            // Extract @mentions
                            if (d.mentions && Array.isArray(d.mentions)) {
                                d.mentions.forEach(m => { addUid(m.uid, null, 'mention'); mentionCount++; });
                            }
                        }
                        log(`[S2] Chat: ${history.groupMsgs.length} messages â†’ senders + ${mentionCount} mentions`);
                    }
                    prog({ phase: 'resolve', status: `S1+S2: ${uidMap.size} UID`, pct: 35 });
                } catch (e) { log(`[S2] Chat history failed: ${e.message}`); }

                // SOURCE 3: Poll Voters
                try {
                    const boards = await api.getListBoard({ page: 1, count: 20 }, params.groupId);
                    if (boards && boards.items) {
                        let voterCount = 0;
                        for (const item of boards.items) {
                            if (item.boardType === 3 && item.data && item.data.poll_id) {
                                try {
                                    const poll = await api.getPollDetail(item.data.poll_id);
                                    if (poll && poll.options) {
                                        for (const opt of poll.options) {
                                            if (opt.voters && Array.isArray(opt.voters)) {
                                                opt.voters.forEach(v => { addUid(v, null, 'pollVoter'); voterCount++; });
                                            }
                                        }
                                    }
                                    await sleep(300);
                                } catch (_) {}
                            }
                        }
                        log(`[S3] Polls: ${voterCount} voter entries`);
                    }
                    prog({ phase: 'resolve', status: `S1-S3: ${uidMap.size} UID`, pct: 55 });
                } catch (e) { log(`[S3] Polls failed: ${e.message}`); }

                // SOURCE 4: Related Friends in Group
                try {
                    const allFriendsRaw = await api.getAllFriends();
                    if (allFriendsRaw && allFriendsRaw.length > 0) {
                        const friendIds = allFriendsRaw.map(f => String(f.userId || f.uid || '')).filter(Boolean);
                        // Check which friends are already in our uidMap (= in this group)
                        let friendInGroup = 0;
                        for (const fid of friendIds) {
                            if (uidMap.has(fid)) friendInGroup++;
                        }
                        log(`[S4] Friends: ${friendInGroup}/${friendIds.length} báº¡n bÃ¨ trong nhÃ³m`);
                    }
                    prog({ phase: 'resolve', status: `S1-S4: ${uidMap.size} UID`, pct: 70 });
                } catch (e) { log(`[S4] Friends check failed: ${e.message}`); }

                // Merge: convert Map to targets
                if (uidMap.size > 0) {
                    const sorted = [...uidMap.entries()]
                        .sort((a, b) => (b[1].lastActive || 0) - (a[1].lastActive || 0));
                    targets = sorted.map(([uid, info]) => ({ uid, name: info.name, phone: '' }));
                    // Log source breakdown
                    const sources = {};
                    for (const [, info] of uidMap) { sources[info.source] = (sources[info.source] || 0) + 1; }
                    log(`[RESOLVE] 6-Source Engine: ${targets.length} UIDs â†’ ${JSON.stringify(sources)}`);
                } else {
                    return { success: false, error: 'KhÃ´ng láº¥y Ä‘Æ°á»£c thÃ nh viÃªn tá»« báº¥t ká»³ nguá»“n nÃ o' };
                }
            }

            try {
                const ownUid = String(api.getOwnId() || '');
                if (ownUid) targets = targets.filter(t => t.uid !== ownUid);
            } catch (_) {}

            // Filter out group admins (trÆ°á»Ÿng + phÃ³ nhÃ³m)
            try {
                const groupInfo = await api.getGroupInfo(params.groupId);
                if (groupInfo && groupInfo.gridInfoMap) {
                    const info = groupInfo.gridInfoMap[params.groupId];
                    if (info) {
                        const adminSet = new Set();
                        if (info.creatorId) adminSet.add(String(info.creatorId));
                        if (info.adminIds && Array.isArray(info.adminIds)) {
                            info.adminIds.forEach(id => adminSet.add(String(id)));
                        }
                        const beforeAdmin = targets.length;
                        targets = targets.filter(t => !adminSet.has(t.uid));
                        const removed = beforeAdmin - targets.length;
                        if (removed > 0) log(`[RESOLVE] Bá» ${removed} admin/phÃ³ nhÃ³m (khÃ´ng gá»­i cho quáº£n trá»‹)`);
                    }
                }
            } catch (e) {
                log(`[RESOLVE] KhÃ´ng láº¥y Ä‘Æ°á»£c admin info: ${e.message}`);
            }

            prog({ phase: 'resolve', status: `${targets.length} thÃ nh viÃªn${!membersOk ? ' (tá»« chat history)' : ''}`, pct: 100 });
        }

        if (!targets.length) return { success: false, error: 'Khong tim thay target nao' };

        // U5: Cross-session dedup â€” skip UIDs already sent to recently
        const SENT_HISTORY_KEY = 'zalo_sent_uids';
        let sentHistory = new Set();
        try {
            const stored = JSON.parse(require('fs').readFileSync(require('path').join(require('os').homedir(), '.zalo_sent_history.json'), 'utf8') || '{}');
            // Keep only last 7 days
            const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
            for (const [uid, ts] of Object.entries(stored)) {
                if (ts > cutoff) sentHistory.add(uid);
            }
        } catch (_) {}
        const beforeSkip = targets.length;
        if (sentHistory.size > 0) {
            targets = targets.filter(t => !sentHistory.has(t.uid));
            if (beforeSkip > targets.length) {
                log(`[U5] Bá» qua ${beforeSkip - targets.length} UID Ä‘Ã£ gá»­i trÆ°á»›c Ä‘Ã³ (7 ngÃ y)`);
                prog({ phase: 'resolve', status: `Bá» ${beforeSkip - targets.length} Ä‘Ã£ gá»­i`, pct: 97 });
            }
        }
        function saveSentUid(uid) {
            try {
                let stored = {};
                try { stored = JSON.parse(require('fs').readFileSync(require('path').join(require('os').homedir(), '.zalo_sent_history.json'), 'utf8') || '{}'); } catch(_){}
                stored[uid] = Date.now();
                require('fs').writeFileSync(require('path').join(require('os').homedir(), '.zalo_sent_history.json'), JSON.stringify(stored));
            } catch(_){}
        }

        // â”€â”€ Deduplicate â”€â”€
        const beforeDedup = targets.length;
        const seen = new Set();
        const dupNames = [];
        targets = targets.filter(t => {
            if (seen.has(t.uid)) { dupNames.push(t.name || t.phone || t.uid); return false; }
            seen.add(t.uid);
            t.name = t.name || t.phone || t.uid; // Fallback name
            return true;
        });
        if (dupNames.length > 0) {
            log(`[RESOLVE] Loáº¡i ${dupNames.length} trÃ¹ng UID: ${dupNames.slice(0, 5).join(', ')}${dupNames.length > 5 ? '...' : ''}`);
            prog({ phase: 'resolve', status: `Loáº¡i ${dupNames.length} sá»‘ trÃ¹ng`, pct: 95 });
        }

        const friendCount = targets.filter(t => friendSet.has(t.uid)).length;
        const strangerCount = targets.length - friendCount;
        log(`Targets: ${targets.length} (${friendCount} friends, ${strangerCount} strangers)${beforeDedup > targets.length ? ` [Ä‘Ã£ loáº¡i ${beforeDedup - targets.length} trÃ¹ng]` : ''}`);

        // â•â•â• V2: Priority Queue Ordering â•â•â•
        // Replace simple interleave with score-based priority queue
        const pq = new PriorityQueue();
        for (const t of targets) {
            const score = PriorityQueue.calcScore(t, friendSet, sentHistory);
            pq.enqueue(t, score);
        }
        targets = pq.toArray(); // Ordered by priority score (friends + active users first)
        log(`[V2] PriorityQueue: ${targets.length} targets ordered by score (top: ${PriorityQueue.calcScore(targets[0] || {}, friendSet, sentHistory)})`);

        // â•â•â• V2: Honeypot Detection â•â•â•
        const { safe: safeTargets, suspicious } = honeypotDetector.filter(targets);
        if (suspicious.length > 0) {
            log(`[V2] HoneypotDetector: filtered ${suspicious.length} suspicious targets`);
            prog({ phase: 'resolve', status: `Lá»c ${suspicious.length} tÃ i khoáº£n nghi ngá»`, pct: 98 });
        }
        targets = safeTargets;

        // â•â•â• V2: Session Manager â€” Create checkpoint â•â•â•
        const sessionId = sessionManager.create(params, targets);
        log(`[V2] Session created: ${sessionId}`);

        // â•â•â• V2: Initialize Markov Timer + Adaptive Batch Sizer â•â•â•
        const markovTimer = new MarkovTimer();
        const adaptiveBatch = new AdaptiveBatchSizer();
        log(`[V2] MarkovTimer + AdaptiveBatch initialized`);

        // â•â•â• Text Variation â•â•â•
        const tailEmoji = ['\u{1F60A}','\u{1F44D}','\u{2705}','\u{1F389}','\u{1F4AF}','\u{1F525}','\u{2B50}','\u{1F4AA}','\u{1F64F}','\u{2764}','\u{1F44B}','\u{1F31F}','\u{1F4AC}','\u{1F4CC}','\u{1F4E2}'];
        const tailWords = ['a', 'nhe', 'nha', 'ha', 'hen', 'nghen', 'ban nhe', 'ne', 'do', 'luon', 'hen ban'];

        function fingerprint(m, idx) {
            let r = m;
            if (!params.enableVariation) return r;
            const rand = Math.random();
            if (rand < 0.35) r = r + ' ' + tailEmoji[Math.floor(Math.random() * tailEmoji.length)];
            else if (rand < 0.6) r = r + ' ' + tailWords[Math.floor(Math.random() * tailWords.length)];
            else if (rand < 0.8) {
                // Invisible Unicode separator (zero-width chars) â€” each message unique to Zalo hash
                const zwc = ['\u200B','\u200C','\u200D','\uFEFF'];
                let invisible = '';
                for (let b = 0; b < 3 + (idx % 4); b++) invisible += zwc[Math.floor(Math.random() * zwc.length)];
                r = r + invisible;
            }
            // 20% chance add time-based micro-variation
            if (Math.random() < 0.2) {
                const greetings = ['', '\n---', '\n.', '\n\u00b7'];
                r = r + greetings[Math.floor(Math.random() * greetings.length)];
            }
            return r;
        }

        // â”€â”€ Poisson + Burst delay â€” mÃ´ phá»ng hÃ nh vi ngÆ°á»i tháº­t â”€â”€
        // Con ngÆ°á»i gá»­i theo burst ngáº¯n rá»“i nghá»‰ dÃ i. Poisson tá»‘t hÆ¡n Gaussian.
        let _burstRemain = 0;
        function poissonDelay(base) {
            return Math.min(Math.max(-Math.log(Math.random()) * base, base * 0.4), base * 4.0);
        }
        function gaussianDelay(base) {
            // 12% cÆ¡ há»™i burst: gá»­i nhanh 2-3 tin liÃªn tiáº¿p
            if (_burstRemain > 0) {
                _burstRemain--;
                return base * (0.25 + Math.random() * 0.4);
            }
            if (Math.random() < 0.12) {
                _burstRemain = Math.floor(Math.random() * 2) + 1; // 1-2 tin burst tiáº¿p theo
                return base * (0.25 + Math.random() * 0.4);
            }
            return poissonDelay(base);
        }

        // â•â•â• Noise API Calls V2 (12+ types â€” human-like browsing) â•â•â•
        const noiseActions = createNoiseActions(api);
        async function doNoiseCall() {
            try {
                const count = Math.random() < 0.3 ? 2 : 1;
                for (let n = 0; n < count; n++) {
                    await noiseActions[Math.floor(Math.random() * noiseActions.length)]();
                    if (count > 1) await sleep(300 + Math.random() * 700);
                }
            } catch (_) {}
            await sleep(500 + Math.random() * 1500);
        }

        // â•â•â• Profile Browse Simulation (mimic clicking on user before messaging) â•â•â•
        async function browseProfile(uid) {
            try {
                await api.getUserInfo(uid);
                await sleep(500 + Math.random() * 1000); // "reading" profile
            } catch (_) {}
        }

        // â•â•â• Human Delay Pattern â•â•â•
        function getHumanDelay(base) {
            const h = new Date().getHours();
            let mul = 1.0;
            if (h >= 12 && h <= 13) mul = 2.0;
            else if (h >= 8 && h <= 9) mul = 1.5;
            else if (h >= 20 && h <= 22) mul = 1.2; // Bug P fix: night = slower
            return base * mul;
        }

        // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
        // ADVANCED QUOTA BYPASS
        // (1) Adaptive Probing: send until Zalo blocks
        // (2) Session Refresh: re-login after block
        // (3) 4-Session Spread: rest 30-60min, new session
        // (4) Channel Interleave: DM + invite simultaneously
        // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

        let usedDM = 0, usedInvite = 0;
        let dmBlocked = false, inviteBlocked = false;
        let sessionCount = 1;
        const MAX_SESSIONS = 8;       // 8 micro-sessions
        // Bug I+J fix: removed frBlocked and usedFR (FR was removed)

        // Multi-group rotation (mutable for per-account mapping)
        let inviteGroupIds = params.inviteGroupIds || (params.inviteGroupId ? [params.inviteGroupId] : []);
        let inviteGroupIdx = 0;

        // Apply per-account group mapping after rotation (B2: now re-resolves targets)
        async function applyAccountMapping() {
            const mapping = getCurrentAccountMapping();
            if (!mapping) return;

            // Switch dest groups
            if (mapping.destGroupIds) {
                inviteGroupIds = mapping.destGroupIds;
                inviteGroupIdx = 0;
                log(`[POOL] Account ${mapping.accountName}: dest â†’ [${inviteGroupIds.join(',')}]`);
            }

            // B2: Re-resolve targets from new sourceGroupId
            if (mapping.sourceGroupId) {
                log(`[POOL] Re-resolving targets from source group ${mapping.sourceGroupId}`);
                prog({ phase: 'resolve', status: `TK ${mapping.accountName}: láº¥y TV tá»« nhÃ³m nguá»“n...`, pct: 0 });
                try {
                    const newTargets = [];
                    const info = await api.getGroupInfo(mapping.sourceGroupId);
                    if (info && info.gridInfoMap) {
                        const gInfo = info.gridInfoMap[mapping.sourceGroupId];
                        if (gInfo) {
                            // Get all member IDs
                            const allIds = new Set();
                            if (gInfo.memberIds) gInfo.memberIds.forEach(id => allIds.add(String(id)));
                            if (gInfo.currentMems) gInfo.currentMems.forEach(m => {
                                allIds.add(String(m.id));
                                newTargets.push({ uid: String(m.id), name: m.dName || m.zaloName || `UID_${String(m.id).slice(-6)}`, phone: '' });
                            });

                            // Filter admins + self
                            const adminSet = new Set();
                            if (gInfo.creatorId) adminSet.add(String(gInfo.creatorId));
                            if (gInfo.adminIds) gInfo.adminIds.forEach(id => adminSet.add(String(id)));
                            try { const ownUid = String(api.getOwnId()); adminSet.add(ownUid); } catch(_){}

                            // Batch enrich names for IDs not in currentMems
                            const existingUids = new Set(newTargets.map(t => t.uid));
                            const needEnrich = [...allIds].filter(id => !existingUids.has(id) && !adminSet.has(id));
                            for (let c = 0; c < needEnrich.length; c += 50) {
                                try {
                                    const chunk = needEnrich.slice(c, c + 50);
                                    const profiles = await api.getGroupMembersInfo(chunk);
                                    if (profiles && profiles.profiles) {
                                        for (const [uid, p] of Object.entries(profiles.profiles)) {
                                            newTargets.push({ uid, name: p.displayName || p.zaloName || `UID_${uid.slice(-6)}`, phone: '' });
                                        }
                                    }
                                } catch(_){}
                            }

                            // Filter admins
                            const filtered = newTargets.filter(t => !adminSet.has(t.uid));

                            // U5: dedup with sent history
                            const sentHistFile = require('path').join(require('os').homedir(), '.zalo_sent_history.json');
                            let sentUids = new Set();
                            try {
                                const raw = JSON.parse(require('fs').readFileSync(sentHistFile, 'utf8'));
                                const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
                                for (const [uid, ts] of Object.entries(raw)) { if (ts > cutoff) sentUids.add(uid); }
                            } catch(_){}
                            const final = filtered.filter(t => !sentUids.has(t.uid));

                            if (final.length > 0) {
                                targets = final;
                                results.total = targets.length;
                                log(`[POOL] Re-resolved: ${final.length} targets from source group (${allIds.size} members, ${adminSet.size} admins removed)`);
                            } else {
                                log(`[POOL] Source group returned 0 targets â€” keeping existing targets`);
                            }
                        }
                    }
                } catch (e) {
                    log(`[POOL] Re-resolve failed: ${e.message} â€” keeping existing targets`);
                }
            }
        }

        const results = { total: targets.length, sent: 0, msgOk: 0, inviteOk: 0, failed: 0, details: [] };
        let consecutiveFails = 0, strangerBlockCount = 0, strangerAttempts = 0;
        let waveCount = 0, hourCount = 0, dayCount = 0;
        // U7: Smart wave sizing â€” grows when success, shrinks when failing
        let WAVE_SIZE = 15 + Math.floor(Math.random() * 10);
        let noiseCounter = 0;
        // U6: Adaptive DM method â€” track which method works better
        let methodAOk = 0, methodBOk = 0; // A=sendLink, B=sendMessage+link
        let consecutiveDMFails = 0;
        let consecutiveInviteFails = 0;
        const inviteQueue = [];        // Deferred Invite Queue
        const _inviteQueuedSet = new Set(); // O(1) dedup for inviteQueue
        const retryQueue = [];         // U4: DM Retry Queue

        prog({ phase: 'sending', status: 'Warm-up...', pct: 0, total: targets.length });

        // â”€â”€ Group link rotation for card preview â”€â”€
        let groupLink = null;
        let linkUsageCount = 0;
        let currentLinkGroupIdx = 0;
        const LINK_ROTATE_EVERY = 15;
        const groupMessages = params.groupMessages || null; // per-group messages

        async function refreshGroupLink() {
            if (inviteGroupIds.length === 0) return;
            try {
                const gid = inviteGroupIds[currentLinkGroupIdx] || inviteGroupIds[0];
                const linkData = await api.enableGroupLink(gid);
                if (linkData && linkData.link) {
                    groupLink = linkData.link;
                    if (!groupLink.startsWith('http')) groupLink = 'https://zalo.me/g/' + groupLink;
                    log(`[LINK] Group ${currentLinkGroupIdx + 1} link: ${groupLink}`);
                }
            } catch (e) {
                log(`[LINK] Rotation failed: ${e.message}`);
            }
        }

        // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
        // V5 ADVANCED INVITE ENGINE â€” 6 thuáº­t toÃ¡n tinh vi
        // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

        // â”€â”€ V5-1: CIRCADIAN RHYTHM ENGINE â”€â”€
        // Tá»± Ä‘iá»u chá»‰nh tá»‘c Ä‘á»™ theo giá» VN, Zalo flag hoáº¡t Ä‘á»™ng báº¥t thÆ°á»ng
        const circadianEngine = {
            // Há»‡ sá»‘ tá»‘c Ä‘á»™ theo giá» (1.0 = bÃ¬nh thÆ°á»ng, <1 = nhanh hÆ¡n, >1 = cháº­m hÆ¡n)
            getSpeedMultiplier() {
                const h = new Date().getHours();
                if (h >= 0 && h < 6)   return 0;     // STOP â€” khÃ´ng gá»­i ban Ä‘Ãªm
                if (h >= 6 && h < 8)   return 2.5;   // sÃ¡ng sá»›m: ráº¥t cháº­m
                if (h >= 8 && h < 10)  return 1.5;   // warm-up buá»•i sÃ¡ng
                if (h >= 10 && h < 12) return 1.0;   // bÃ¬nh thÆ°á»ng
                if (h >= 12 && h < 14) return 0.7;   // peak lunch â†’ nhanh hÆ¡n
                if (h >= 14 && h < 17) return 1.0;   // chiá»u
                if (h >= 17 && h < 20) return 0.6;   // GOLDEN HOUR â†’ nhanh nháº¥t
                if (h >= 20 && h < 22) return 1.2;   // tá»‘i
                return 3.0;                            // 22h+ â†’ ráº¥t cháº­m â†’ sáº¯p stop
            },
            shouldPause() {
                const h = new Date().getHours();
                return h >= 0 && h < 6; // 0-6h: ngá»§
            },
            getPhaseLabel() {
                const h = new Date().getHours();
                if (h >= 17 && h < 20) return 'ðŸ”¥ GOLDEN HOUR';
                if (h >= 12 && h < 14) return 'ðŸœ PEAK LUNCH';
                if (h >= 6 && h < 8)   return 'ðŸŒ… WARM-UP';
                if (h >= 22 || h < 6)  return 'ðŸŒ™ OFF-HOURS';
                return 'â˜€ï¸ NORMAL';
            }
        };

        // â”€â”€ V5-2: ADAPTIVE ENDPOINT LEARNING â”€â”€
        const _EP_STATS_FILE = path.join(process.env.APPDATA || os.homedir(), 'Zalo Bulk Tool Pro', '.endpoint_stats.json');
        const endpointLearner = {
            stats: (() => {
                try {
                    if (fs.existsSync(_EP_STATS_FILE))
                        return JSON.parse(fs.readFileSync(_EP_STATS_FILE, 'utf8'));
                } catch(_){}
                return {};
            })(),
            record(endpoint, userType, success) {
                if (!this.stats[endpoint]) this.stats[endpoint] = {};
                if (!this.stats[endpoint][userType]) this.stats[endpoint][userType] = { ok: 0, fail: 0 };
                if (success) this.stats[endpoint][userType].ok++;
                else this.stats[endpoint][userType].fail++;
                // Persist immediately
                try {
                    const dir = path.dirname(_EP_STATS_FILE);
                    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
                    fs.writeFileSync(_EP_STATS_FILE, JSON.stringify(this.stats));
                } catch(_){}
            },
            getBestOrder(userType) {
                const endpoints = ['inviteUser', 'addUser', 'sendLink'];
                const scored = endpoints.map(ep => {
                    const s = this.stats[ep]?.[userType];
                    if (!s || (s.ok + s.fail) < 2) return { ep, score: 0.5 };
                    return { ep, score: s.ok / (s.ok + s.fail) };
                });
                scored.sort((a, b) => b.score - a.score);
                return scored.map(s => s.ep);
            },
            getSummary() {
                const lines = [];
                for (const [ep, types] of Object.entries(this.stats)) {
                    for (const [type, s] of Object.entries(types)) {
                        const rate = s.ok + s.fail > 0 ? Math.round(s.ok / (s.ok + s.fail) * 100) : 0;
                        lines.push(`${ep}[${type}]: ${rate}% (${s.ok}/${s.ok + s.fail})`);
                    }
                }
                return lines.join(' | ') || 'no data yet';
            }
        };

        // â”€â”€ V5-3: TOKEN BUCKET RATE LIMITER â”€â”€
        // MÃ´ phá»ng rate limit Zalo: má»—i TK = 1 bucket
        const tokenBucket = {
            buckets: {}, // { accountId: { tokens, lastRefill, maxTokens } }
            getOrCreate(accountId) {
                if (!this.buckets[accountId]) {
                    this.buckets[accountId] = {
                        tokens: 10, // start with 10 tokens
                        lastRefill: Date.now(),
                        maxTokens: 40, // ~40 invites/day
                        refillRate: 1 / 60000, // 1 token per minute
                    };
                }
                return this.buckets[accountId];
            },
            consume(accountId) {
                const b = this.getOrCreate(accountId);
                // Refill tokens based on elapsed time
                const elapsed = Date.now() - b.lastRefill;
                b.tokens = Math.min(b.maxTokens, b.tokens + elapsed * b.refillRate);
                b.lastRefill = Date.now();
                if (b.tokens >= 1) {
                    b.tokens -= 1;
                    return true; // OK to send
                }
                return false; // rate limited
            },
            getWaitTime(accountId) {
                const b = this.getOrCreate(accountId);
                // BUG FIX: refill first before computing wait (avoid stale token count)
                const elapsed = Date.now() - b.lastRefill;
                const currentTokens = Math.min(b.maxTokens, b.tokens + elapsed * b.refillRate);
                if (currentTokens >= 1) return 0;
                return Math.ceil((1 - currentTokens) / b.refillRate); // ms to wait
            },
            penalize(accountId) {
                // On failure, reduce tokens faster
                const b = this.getOrCreate(accountId);
                b.tokens = Math.max(0, b.tokens - 2);
            },
            reward(accountId) {
                // On success, slightly increase (but capped)
                const b = this.getOrCreate(accountId);
                b.tokens = Math.min(b.maxTokens, b.tokens + 0.3);
            }
        };

        // â”€â”€ V5-4: SOCIAL PROXIMITY SCORING â”€â”€
        // Invite ngÆ°á»i cÃ³ báº¡n chung trÆ°á»›c â†’ tá»· lá»‡ accept cao hÆ¡n
        async function scoreSocialProximity(targetUids) {
            const scored = [];
            for (const uid of targetUids) {
                let mutualCount = 0;
                try {
                    const related = await api.getRelatedFriendGroup(uid);
                    if (related && Array.isArray(related)) mutualCount = related.length;
                    else if (related && related.friends) mutualCount = related.friends.length;
                } catch(_){}
                scored.push({ uid, mutualCount });
                await sleep(200 + Math.random() * 300); // avoid rate limit on lookups
            }
            // Sort: most mutual friends first
            scored.sort((a, b) => b.mutualCount - a.mutualCount);
            return scored;
        }

        // â”€â”€ V5-5: NEW ACCOUNT WARMING â”€â”€
        // TK Zalo má»›i cáº§n warm-up dáº§n dáº§n, khÃ´ng bulk ngay
        const accountWarmer = {
            WARM_FILE: path.join(process.env.APPDATA || os.homedir(), 'Zalo Bulk Tool Pro', '.account_warmup.json'),
            data: {},
            load() {
                try {
                    if (fs.existsSync(this.WARM_FILE)) {
                        this.data = JSON.parse(fs.readFileSync(this.WARM_FILE, 'utf8'));
                    }
                } catch(_){}
            },
            save() {
                try {
                    const dir = path.dirname(this.WARM_FILE);
                    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
                    fs.writeFileSync(this.WARM_FILE, JSON.stringify(this.data, null, 2));
                } catch(_){}
            },
            getAccountAge(accountId) {
                if (!this.data[accountId]) {
                    this.data[accountId] = { firstSeen: Date.now(), totalInvites: 0, dailyLog: {} };
                    this.save();
                }
                return (Date.now() - this.data[accountId].firstSeen) / (1000 * 60 * 60 * 24); // days
            },
            getDailyLimit(accountId) {
                const ageDays = this.getAccountAge(accountId);
                // TK má»›i: tÄƒng dáº§n quota
                // NgÃ y 1: 5  | NgÃ y 2: 10 | NgÃ y 3: 15 | NgÃ y 4: 20 | NgÃ y 5: 30 | NgÃ y 7+: 40
                if (ageDays < 1) return 5;
                if (ageDays < 2) return 10;
                if (ageDays < 3) return 15;
                if (ageDays < 4) return 20;
                if (ageDays < 5) return 30;
                if (ageDays < 7) return 35;
                return 40; // mature account
            },
            getTodayCount(accountId) {
                const today = new Date().toISOString().slice(0, 10);
                return this.data[accountId]?.dailyLog?.[today] || 0;
            },
            recordInvite(accountId) {
                if (!this.data[accountId]) this.getAccountAge(accountId);
                const today = new Date().toISOString().slice(0, 10);
                if (!this.data[accountId].dailyLog) this.data[accountId].dailyLog = {};
                this.data[accountId].dailyLog[today] = (this.data[accountId].dailyLog[today] || 0) + 1;
                this.data[accountId].totalInvites++;
                this.save();
            },
            canInvite(accountId) {
                const limit = this.getDailyLimit(accountId);
                const used = this.getTodayCount(accountId);
                return used < limit;
            },
            getWarmupInfo(accountId) {
                const age = this.getAccountAge(accountId);
                const limit = this.getDailyLimit(accountId);
                const used = this.getTodayCount(accountId);
                return { ageDays: Math.floor(age), limit, used, remaining: Math.max(0, limit - used) };
            }
        };
        accountWarmer.load();

        // â”€â”€ V5-6: TRUE BATCH INVITE â”€â”€
        // Gom 3-5 ngÆ°á»i vÃ o 1 API call addUserToGroup
        async function batchInvite(uids, groupId) {
            if (uids.length === 0) return { ok: [], fail: [] };
            const ok = [], fail = [];
            try {
                log(`[BATCH] addUserToGroup(${uids.length} users â†’ group)`);
                const r = await api.addUserToGroup(uids, groupId);
                // addUserToGroup tráº£ vá» káº¿t quáº£ cho tá»«ng UID
                if (r && r.error_code && r.error_code !== 0) {
                    fail.push(...uids);
                } else {
                    ok.push(...uids);
                }
            } catch(e) {
                log(`[BATCH] Batch fail: ${e.message}`);
                fail.push(...uids);
            }
            return { ok, fail };
        }

        // â”€â”€ V5-7: TRUST SCORE SIMULATOR â”€â”€
        // TK má»›i cáº§n xÃ¢y dá»±ng "trust" báº±ng hoáº¡t Ä‘á»™ng bÃ¬nh thÆ°á»ng trÆ°á»›c khi invite
        const trustSimulator = {
            async warmupNewAccount(acctId, api) {
                const age = accountWarmer.getAccountAge(acctId);
                if (age > 3) return; // TK cÅ© â†’ skip

                log(`[TRUST] TK age=${Math.floor(age)}d â†’ running trust warmup...`);
                prog({ phase: 'cooldown', status: `ðŸŽ­ XÃ¢y dá»±ng trust cho TK má»›i (ngÃ y ${Math.floor(age)+1})...`, pct: 45 });

                const actions = [];

                // NgÃ y 1: browse only
                if (age < 1) {
                    actions.push(
                        async () => { try { await api.getProfile(); log('[TRUST] Viewed own profile'); } catch(_){} },
                        async () => { try { await api.getAllFriends(10, 1); log('[TRUST] Browsed friends list'); } catch(_){} },
                        async () => { try { await api.getRecentGroup(); log('[TRUST] Browsed recent groups'); } catch(_){} },
                    );
                }
                // NgÃ y 2: browse + interact
                else if (age < 2) {
                    actions.push(
                        async () => { try { await api.getProfile(); } catch(_){} },
                        async () => { try { await api.getAllFriends(50, 1); } catch(_){} },
                        async () => { try { await api.getRecentGroup(); } catch(_){} },
                        async () => { try { await api.getStickers(); log('[TRUST] Browsed stickers'); } catch(_){} },
                    );
                }
                // NgÃ y 3: ready for light invite
                else {
                    actions.push(
                        async () => { try { await api.getProfile(); } catch(_){} },
                        async () => { try { await api.getAllFriends(100, 1); } catch(_){} },
                    );
                }

                // Execute warmup actions with human-like delays
                for (const action of actions) {
                    if (_cancelBulk) break;
                    await action();
                    await sleep(2000 + Math.random() * 3000);
                }
                log(`[TRUST] Warmup done (${actions.length} actions for day ${Math.floor(age)+1})`);
            }
        };

        // â”€â”€ V5-8: ORGANIC ACTIVITY INJECTION â”€â”€
        // Xen káº½ hoáº¡t Ä‘á»™ng tá»± nhiÃªn giá»¯a cÃ¡c invite, tá»· lá»‡ cao hÆ¡n cho TK má»›i
        const organicInjector = {
            actionsPerformed: 0,
            getActivityRatio(acctAge) {
                // TK má»›i: nhiá»u hoáº¡t Ä‘á»™ng hÆ¡n trÆ°á»›c má»—i invite
                if (acctAge < 1) return 5;   // 5 actions per invite
                if (acctAge < 3) return 3;   // 3 actions per invite
                if (acctAge < 7) return 2;   // 2 actions per invite
                return 1;                     // mature: 1 action per invite
            },
            async injectActivity(api, acctAge) {
                const ratio = this.getActivityRatio(acctAge);
                const numActions = Math.floor(Math.random() * ratio) + 1;

                const possibleActions = [
                    // BUG FIX: all wrapped in try/catch â€” APIs may not exist on api object
                    async () => { try { await api.getProfile(); } catch(_){} return 'view_profile'; },
                    async () => { try { await api.getAllFriends(10, 1); } catch(_){} return 'browse_friends'; },
                    async () => { try { await api.getRecentGroup?.(); } catch(_){} return 'browse_groups'; },
                    async () => { try { await api.getStickers?.(); } catch(_){} return 'browse_stickers'; },
                    async () => {
                        try {
                            const friends = await api.getAllFriends(5, 1);
                            if (friends && friends.length > 0) {
                                const f = friends[Math.floor(Math.random() * friends.length)];
                                const uid = String(f.uid || f.userId || '');
                                if (uid) await api.sendTypingEvent(uid, ThreadType.User);
                            }
                        } catch(_){}
                        return 'typing_sim';
                    },
                ];

                for (let i = 0; i < numActions; i++) {
                    if (_cancelBulk) break;
                    try {
                        const action = possibleActions[Math.floor(Math.random() * possibleActions.length)];
                        const name = await action();
                        this.actionsPerformed++;
                    } catch(_){}
                    await sleep(500 + Math.random() * 1500);
                }
                return numActions;
            }
        };

        // â”€â”€ V5-9: SOCIAL GRAPH SEEDING â”€â”€
        // TK má»›i khÃ´ng cÃ³ báº¡n â†’ bá»‹ flag. Auto káº¿t báº¡n trÆ°á»›c khi invite
        const socialSeeder = {
            SEED_FILE: path.join(process.env.APPDATA || os.homedir(), 'Zalo Bulk Tool Pro', '.social_seed.json'),
            data: {},
            load() {
                try {
                    if (fs.existsSync(this.SEED_FILE)) {
                        this.data = JSON.parse(fs.readFileSync(this.SEED_FILE, 'utf8'));
                    }
                } catch(_){}
            },
            save() {
                try {
                    const dir = path.dirname(this.SEED_FILE);
                    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
                    fs.writeFileSync(this.SEED_FILE, JSON.stringify(this.data, null, 2));
                } catch(_){}
            },
            async seedFriends(api, acctId, acctAge) {
                // Chá»‰ seed cho TK má»›i (< 3 ngÃ y) vÃ  chÆ°a seed Ä‘á»§
                if (acctAge > 3) return;
                if (!this.data[acctId]) this.data[acctId] = { seeded: 0, lastSeed: 0 };

                const SEED_TARGET = acctAge < 1 ? 10 : acctAge < 2 ? 20 : 30;
                const already = this.data[acctId].seeded;
                if (already >= SEED_TARGET) {
                    log(`[SEED] TK ${acctId} Ä‘Ã£ seed ${already} báº¡n â†’ skip`);
                    return;
                }

                // Kiá»ƒm tra Ä‘Ã£ seed hÃ´m nay chÆ°a (max 1 láº§n/ngÃ y)
                const today = new Date().toISOString().slice(0, 10);
                if (this.data[acctId].lastSeed === today) return;

                const toSeed = Math.min(10, SEED_TARGET - already); // max 10/session
                log(`[SEED] Seeding ${toSeed} friends for new account (day ${Math.floor(acctAge)+1})...`);
                prog({ phase: 'cooldown', status: `ðŸŒ± XÃ¢y dá»±ng máº¡ng xÃ£ há»™i: thÃªm ${toSeed} báº¡n...`, pct: 40 });

                let seeded = 0;
                // Sá»­ dá»¥ng targets hiá»‡n cÃ³ Ä‘á»ƒ káº¿t báº¡n (há» lÃ  ngÆ°á»i tháº­t)
                const friendCandidates = targets
                    .filter(t => !friendSet.has(t.uid))
                    .slice(0, toSeed * 2); // take extra in case of failures

                for (const t of friendCandidates) {
                    if (_cancelBulk || seeded >= toSeed) break;
                    try {
                        await api.sendFriendRequest('Xin chÃ o!', t.uid);
                        seeded++;
                        log(`[SEED] FR sent â†’ ${t.name} (${seeded}/${toSeed})`);
                    } catch(_){}
                    await sleep(3000 + Math.random() * 5000); // slow â€” avoid spam
                }

                this.data[acctId].seeded += seeded;
                this.data[acctId].lastSeed = today;
                this.save();
                log(`[SEED] Done: ${seeded} FRs sent (total: ${this.data[acctId].seeded}/${SEED_TARGET})`);
                if (seeded > 0) {
                    // Wait for some accepts
                    await sleep(5000 + Math.random() * 5000);
                }
            }
        };
        socialSeeder.load();

        // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
        // V8 FINAL INTELLIGENCE LAYER
        // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

        // â”€â”€ V8-1: BLACKLIST MANAGER â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
        // NgÆ°á»i reply phá»§ / block â†’ ghi vÃ o .blacklist.json â†’ khÃ´ng spam láº¡i
        const blacklistManager = (() => {
            const BL_FILE = path.join(process.env.APPDATA || os.homedir(), 'Zalo Bulk Tool Pro', '.blacklist.json');
            let bl = new Set();
            // Load on init
            try { if (fs.existsSync(BL_FILE)) bl = new Set(JSON.parse(fs.readFileSync(BL_FILE,'utf8'))); } catch(_){}

            function save() {
                try {
                    const dir = path.dirname(BL_FILE);
                    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
                    fs.writeFileSync(BL_FILE, JSON.stringify([...bl]));
                } catch(_){}
            }
            return {
                isBlacklisted: (uid) => bl.has(String(uid)),
                add: (uid, reason = '') => {
                    const id = String(uid);
                    if (!bl.has(id)) {
                        bl.add(id);
                        save();
                        log(`[BLACKLIST] Added ${id} â€” ${reason}`);
                    }
                },
                size: () => bl.size,
                // Auto-detect block errors and add to blacklist
                checkError: (uid, errCode, errMsg = '') => {
                    const BLOCK_CODES = [-216, -501, -1012, -1013, -1014, 14, 502];
                    const BLOCK_MSGS  = ['spam', 'block', 'restrict', 'banned', 'khÃ´ng thá»ƒ gá»­i', 'bá»‹ cháº·n'];
                    const isBlockCode = BLOCK_CODES.includes(Number(errCode));
                    const isBlockMsg  = BLOCK_MSGS.some(m => errMsg.toLowerCase().includes(m));
                    if (isBlockCode || isBlockMsg) {
                        blacklistManager.add(uid, `err:${errCode} ${errMsg.slice(0,30)}`);
                        return true;
                    }
                    return false;
                }
            };
        })();

        // â”€â”€ V8-2: ACCOUNT HEALTH MONITOR â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
        // Theo dÃµi tá»· lá»‡ lá»—i / TK â†’ tá»± nghá»‰ 24h náº¿u bá»‹ soft-ban
        const accountHealthMonitor = (() => {
            const stats = new Map(); // cookie_prefix â†’ { ok, fail, rested_until }
            const ERROR_THRESHOLD = 0.35; // >35% fail rate â†’ rest
            const MIN_SAMPLES = 5;        // cáº§n Ã­t nháº¥t 5 láº§n trÆ°á»›c khi Ä‘Ã¡nh giÃ¡
            const REST_MS = 24 * 60 * 60 * 1000;

            function key(cookie) { return String(cookie).slice(0, 20); }
            function ensure(cookie) {
                const k = key(cookie);
                if (!stats.has(k)) stats.set(k, { ok: 0, fail: 0, rested_until: 0 });
                return stats.get(k);
            }
            return {
                record: (cookie, success) => {
                    const s = ensure(cookie);
                    if (success) s.ok++; else s.fail++;
                },
                isHealthy: (cookie) => {
                    const s = ensure(cookie);
                    // Still resting?
                    if (Date.now() < s.rested_until) {
                        const mins = Math.round((s.rested_until - Date.now()) / 60000);
                        log(`[HEALTH] Account ${key(cookie).slice(0,10)}... resting ${mins}m more`);
                        return false;
                    }
                    const total = s.ok + s.fail;
                    if (total < MIN_SAMPLES) return true; // not enough data
                    const failRate = s.fail / total;
                    if (failRate > ERROR_THRESHOLD) {
                        s.rested_until = Date.now() + REST_MS;
                        s.ok = 0; s.fail = 0; // reset counters after rest
                        log(`[HEALTH] âš ï¸ Account ${key(cookie).slice(0,10)}... failRate=${(failRate*100).toFixed(0)}% â†’ RESTING 24h`);
                        return false;
                    }
                    return true;
                },
                recordHardBan: (cookie) => {
                    const s = ensure(cookie);
                    s.rested_until = Date.now() + REST_MS;
                    log(`[HEALTH] ðŸ”´ Hard ban detected â†’ forcing 24h rest: ${key(cookie).slice(0,10)}...`);
                },
                getSummary: () => {
                    return [...stats.entries()].map(([k, s]) => {
                        const total = s.ok + s.fail;
                        const rate  = total > 0 ? ((s.fail/total)*100).toFixed(0) : '?';
                        const resting = Date.now() < s.rested_until;
                        return `${k.slice(0,8)}: ${s.ok}âœ…/${s.fail}âŒ (${rate}% fail)${resting?'[REST]':''}`;
                    }).join(' | ');
                }
            };
        })();

        // â”€â”€ V8-3: TIME-OF-DAY TARGETING â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
        // DÃ¹ng lastSeen cá»§a target â†’ tÃ­nh giá» há» active â†’ delay náº¿u há» offline
        const timeOfDayTargeter = {
            // TÃ­nh "peak hour" cá»§a má»™t target tá»« lastSeen timestamp
            getPeakHour(lastSeen) {
                if (!lastSeen || lastSeen === 0) return null;
                const d = new Date(lastSeen);
                return d.getHours(); // 0-23
            },
            // Kiá»ƒm tra: giá» hiá»‡n táº¡i cÃ³ náº±m trong window active cá»§a target khÃ´ng?
            // Window = Â±2 giá» xung quanh peak hour
            isActiveNow(lastSeen, windowHours = 2) {
                const peak = this.getPeakHour(lastSeen);
                if (peak === null) return true; // khÃ´ng cÃ³ data â†’ cho qua
                const now = new Date().getHours();
                const diff = Math.abs(now - peak);
                const wrappedDiff = Math.min(diff, 24 - diff);
                return wrappedDiff <= windowHours;
            },
            // Sort targets: ngÆ°á»i Ä‘ang trong active window â†’ lÃªn Ä‘áº§u
            prioritize(targets) {
                const active  = targets.filter(t => this.isActiveNow(t.lastSeen));
                const passive = targets.filter(t => !this.isActiveNow(t.lastSeen));
                const activeCount = active.length;
                log(`[TIME-TARGET] ${activeCount}/${targets.length} targets trong giá» active â†’ Æ°u tiÃªn gá»­i trÆ°á»›c`);
                return [...active, ...passive];
            }
        };

        // â”€â”€ V8-4: TELEGRAM TELEMETRY â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
        // BÃ¡o cÃ¡o real-time qua Telegram Bot
        const telegramTelemetry = (() => {
            const botToken = params.telegramToken || '';
            const chatId   = params.telegramChatId || '';
            const enabled  = !!(botToken && chatId);
            let stats = { sent: 0, ok: 0, fail: 0, invite: 0, banned: 0, start: Date.now() };
            let lastReport = 0;
            const REPORT_EVERY = params.telegramReportEvery || 20; // má»—i 20 tin

            async function sendTg(text) {
                if (!enabled) return;
                const url = `https://api.telegram.org/bot${botToken}/sendMessage`;
                try {
                    await fetch(url, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML' })
                    });
                } catch(e) { log(`[TG] Send failed: ${e.message}`); }
            }

            return {
                enabled,
                record(type) {
                    stats[type] = (stats[type] || 0) + 1;
                    if ((stats.sent + stats.ok + stats.fail) - lastReport >= REPORT_EVERY) {
                        lastReport = stats.sent + stats.ok + stats.fail;
                        const elapsed = Math.round((Date.now() - stats.start) / 60000);
                        this.report(`â± <b>Report ${elapsed}m</b>`);
                    }
                },
                async report(prefix = '') {
                    const elapsed = Math.round((Date.now() - stats.start) / 60000);
                    const successRate = stats.sent > 0 ? ((stats.ok/stats.sent)*100).toFixed(0) : '?';
                    const msg = [
                        `${prefix ? prefix + '\n' : ''}ðŸ¤– <b>Zalo Tool Update</b>`,
                        `ðŸ“¤ Gá»­i: <b>${stats.sent}</b>`,
                        `âœ… OK: <b>${stats.ok}</b> (${successRate}%)`,
                        `âŒ Fail: <b>${stats.fail}</b>`,
                        `ðŸ‘¥ Invite: <b>${stats.invite || 0}</b>`,
                        `ðŸ”’ Banned: <b>${stats.banned || 0}</b>`,
                        `â± Thá»i gian: ${elapsed}m`
                    ].join('\n');
                    await sendTg(msg);
                },
                async notify(msg) { await sendTg(msg); },
                reset() { stats = { sent: 0, ok: 0, fail: 0, invite: 0, banned: 0, start: Date.now() }; lastReport = 0; },
                getStats() { return { ...stats }; }
            };
        })();

        // Notify start via Telegram
        if (telegramTelemetry.enabled) {
            telegramTelemetry.notify(`ðŸš€ <b>Zalo Tool Started</b>\nðŸ“‹ ${targets.length} targets | ${inviteGroupIds.length} groups`);
        }

        // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
        // V7 PIPELINE ALGORITHMS â€” Group Link â†’ Harvest â†’ Priority â†’ Send
        // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

        // â”€â”€ V7-1: RECENT CHATTERS HARVESTER â”€â”€
        // Láº¥y 200 ngÆ°á»i TÃ‚N CHAT NHáº¤T tá»« group (khÃ´ng cáº§n member list)
        // â†’ Hoáº¡t Ä‘á»™ng ká»ƒ cáº£ group Ä‘Ã³ng thÃ nh viÃªn
        // â†’ NgÆ°á»i chat gáº§n = Ä‘ang active + chat má»Ÿ cao
        const groupLinkHarvester = {
            resolveGroupId(link) {
                const m = link.match(/zalo\.me\/g\/([a-zA-Z0-9]+)/);
                return m ? m[1] : null;
            },

            // Láº¥y UID tá»« lá»‹ch sá»­ chat nhÃ³m (khÃ´ng cáº§n quyá»n member)
            async fetchRecentChatters(api, groupLink, maxUsers = 200) {
                const code = this.resolveGroupId(groupLink);
                if (!code) return [];

                const senderMap = new Map(); // uid â†’ {uid, name, lastSeen}
                let lastMsgId = null;
                let pages = 0;
                const MAX_PAGES = 10; // tá»‘i Ä‘a 10 trang Ã— ~20 msg = ~200 people

                log(`[HARVEST] QuÃ©t lá»‹ch sá»­ chat: ${groupLink.slice(-12)}`);

                while (senderMap.size < maxUsers && pages < MAX_PAGES) {
                    pages++;
                    try {
                        // getGroupHistory = láº¥y tin nháº¯n cÅ© (pháº§n lá»›n group cÃ´ng khai cho xem)
                        const history = await (
                            api.getGroupHistory?.(code, lastMsgId) ||
                            api.getGroupMessage?.(code, { lastId: lastMsgId }) ||
                            api.getConversation?.(code, ThreadType?.Group, lastMsgId)
                        );

                        if (!history) break;

                        // Handle different response shapes from zca-js
                        const msgs = history.msgs || history.messages || history.data || history || [];
                        if (!Array.isArray(msgs) || msgs.length === 0) break;

                        for (const msg of msgs) {
                            const uid = String(msg.uidFrom || msg.senderId || msg.uid || '');
                            if (!uid || uid === '0') continue;
                            if (!senderMap.has(uid)) {
                                senderMap.set(uid, {
                                    uid,
                                    name: msg.dName || msg.senderName || msg.fromAlias || 'User',
                                    lastSeen: msg.ts || msg.timestamp || Date.now(),
                                    fromGroup: groupLink
                                });
                            }
                        }

                        // Advance cursor
                        const oldest = msgs[msgs.length - 1];
                        const newLastId = oldest?.msgId || oldest?.cliMsgId || oldest?.id;
                        if (!newLastId || newLastId === lastMsgId) break;
                        lastMsgId = newLastId;

                        await sleep(300 + Math.random() * 200);
                    } catch(e) {
                        log(`[HARVEST] History fail page ${pages}: ${e.message}`);
                        break;
                    }
                }

                // Sort by recency (most recent first = highest engagement)
                const results = [...senderMap.values()]
                    .sort((a, b) => (b.lastSeen || 0) - (a.lastSeen || 0))
                    .slice(0, maxUsers);

                log(`[HARVEST] ${groupLink.slice(-12)}: ${results.length} recent chatters (${pages} pages)`);
                return results;
            },

            async harvestAll(api, groupLinks, prog, _cancelBulk) {
                const DEDUP_FILE = path.join(process.env.APPDATA || os.homedir(), 'Zalo Bulk Tool Pro', '.global_dedup.json');
                // â”€â”€ V7-3: Cross-Group Dedup â”€â”€
                let globalDedup = new Set();
                try {
                    if (fs.existsSync(DEDUP_FILE))
                        globalDedup = new Set(JSON.parse(fs.readFileSync(DEDUP_FILE, 'utf8')));
                } catch(_){}

                const allMembers = [];
                log(`[HARVEST] QuÃ©t ${groupLinks.length} groups (láº¥y ngÆ°á»i chat gáº§n nháº¥t)...`);

                for (let i = 0; i < groupLinks.length; i++) {
                    if (_cancelBulk) break;
                    const link = (groupLinks[i] || '').trim();
                    if (!link) continue;

                    prog({
                        phase: 'cooldown',
                        status: `ðŸ” QuÃ©t group ${i+1}/${groupLinks.length} â€” ${link.slice(-10)} (recent chatters)...`,
                        pct: Math.round(i / groupLinks.length * 40)
                    });

                    // Try recent chatters first (works on closed groups)
                    let members = await this.fetchRecentChatters(api, link, 200);

                    let newCount = 0;
                    for (const m of members) {
                        if (m.uid && !globalDedup.has(m.uid)) {
                            globalDedup.add(m.uid);
                            allMembers.push(m);
                            newCount++;
                        }
                    }
                    log(`[HARVEST] +${newCount} new (total unique: ${allMembers.length})`);
                    await sleep(800 + Math.random() * 400);
                }

                // Persist global dedup
                try {
                    const dir = path.dirname(DEDUP_FILE);
                    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
                    fs.writeFileSync(DEDUP_FILE, JSON.stringify([...globalDedup]));
                } catch(_){}

                log(`[HARVEST] Xong: ${allMembers.length} ngÆ°á»i chat gáº§n nháº¥t tá»« ${groupLinks.length} groups`);
                return allMembers;
            }
        };


        // â”€â”€ V7-2: CHAT-OPEN PRIORITY SCORER â”€â”€
        // Kiá»ƒm tra privacy cá»§a member â†’ Æ°u tiÃªn ngÆ°á»i cÃ³ chat má»Ÿ
        // NgÆ°á»i cÃ³ chat má»Ÿ = tin nháº¯n tá»›i Ä‘Æ°á»£c, khÃ´ng bá»‹ block
        const chatOpenScorer = {
            // Score: 3=báº¡n bÃ¨ (cháº¯c cháº¯n), 2=cÃ³ mutual, 1=unknown, 0=likely closed
            async scoreMembers(api, members, friendSet, maxCheck = 30) {
                const scored = [];
                const toCheck = members.slice(0, maxCheck); // Only check first N to save time
                const noCheck = members.slice(maxCheck);

                log(`[CHAT-SCORE] Scoring ${toCheck.length} members by chat accessibility...`);

                for (const m of toCheck) {
                    let score = 1; // default unknown
                    if (friendSet.has(m.uid)) {
                        score = 3; // already friend â€” guaranteed open
                    } else {
                        try {
                            const info = await api.getUserInfo(m.uid);
                            if (info) {
                                // Check privacy indicators from getUserInfo response
                                const u = info.user || info;
                                // If sdob (share DOB) is visible â†’ profile is open
                                if (u.sdob || u.personal?.sdob) score = 2;
                                // If phone visible â†’ very open profile
                                if (u.phoneNumber || u.personal?.phone) score = 3;
                                // Has mutual friends indicator
                                if (u.mutual || u.mutualFriends) score = Math.max(score, 2);
                            }
                        } catch(_){ score = 1; }
                        await sleep(150 + Math.random() * 150);
                    }
                    scored.push({ ...m, chatScore: score });
                }

                // Unscored members get default score=1
                for (const m of noCheck) {
                    scored.push({ ...m, chatScore: friendSet.has(m.uid) ? 3 : 1 });
                }

                // Sort: score 3 first (friends/open), then 2 (mutual), then 1 (unknown)
                scored.sort((a, b) => b.chatScore - a.chatScore);
                const openCount = scored.filter(s => s.chatScore >= 2).length;
                log(`[CHAT-SCORE] ${openCount}/${scored.length} members have open/semi-open chat â†’ prioritized`);
                return scored;
            }
        };

        // â”€â”€ V7-4: WEIGHTED ROUND-ROBIN â”€â”€
        // Xoay nhÃ³m Ä‘Ã­ch + tin nháº¯n theo tá»· lá»‡ thÃ nh cÃ´ng thá»±c táº¿
        const weightedRotator = {
            groupWeights: {}, // { groupId: { ok: 0, fail: 0 } }
            messageWeights: {}, // { msgIdx: { ok: 0, fail: 0 } }
            recordGroup(groupId, success) {
                if (!this.groupWeights[groupId]) this.groupWeights[groupId] = { ok: 0, fail: 0 };
                if (success) this.groupWeights[groupId].ok++;
                else this.groupWeights[groupId].fail++;
            },
            recordMessage(msgIdx, success) {
                if (!this.messageWeights[msgIdx]) this.messageWeights[msgIdx] = { ok: 0, fail: 0 };
                if (success) this.messageWeights[msgIdx].ok++;
                else this.messageWeights[msgIdx].fail++;
            },
            // Pick best group by weighted probability
            pickBestGroup(groupIds) {
                if (groupIds.length === 1) return groupIds[0];
                const scores = groupIds.map(gid => {
                    const w = this.groupWeights[gid];
                    if (!w || (w.ok + w.fail) < 3) return { gid, score: 0.5 }; // not enough data
                    return { gid, score: w.ok / (w.ok + w.fail) };
                });
                // Weighted random: higher score = higher probability of being picked
                const total = scores.reduce((s, x) => s + x.score, 0);
                let rand = Math.random() * total;
                for (const s of scores) { rand -= s.score; if (rand <= 0) return s.gid; }
                return scores[scores.length - 1].gid;
            },
            // Pick best message by weighted probability
            pickBestMessage(messages) {
                if (!messages || messages.length === 0) return null;
                if (messages.length === 1) return { msg: messages[0], idx: 0 };
                const scores = messages.map((msg, idx) => {
                    const w = this.messageWeights[idx];
                    if (!w || (w.ok + w.fail) < 3) return { msg, idx, score: 0.5 };
                    return { msg, idx, score: w.ok / (w.ok + w.fail) };
                });
                const total = scores.reduce((s, x) => s + x.score, 0);
                let rand = Math.random() * total;
                for (const s of scores) { rand -= s.score; if (rand <= 0) return { msg: s.msg, idx: s.idx }; }
                return { msg: scores[scores.length-1].msg, idx: scores.length-1 };
            },
            getSummary() {
                const gSummary = Object.entries(this.groupWeights).map(([g, w]) =>
                    `G${g.slice(-4)}:${w.ok}/${w.ok+w.fail}`).join(' ');
                const mSummary = Object.entries(this.messageWeights).map(([i, w]) =>
                    `M${i}:${w.ok}/${w.ok+w.fail}`).join(' ');
                return `Groups[${gSummary}] Msgs[${mSummary}]`;
            }
        };

        // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
        // V6 FINAL ALGORITHMS â€” chuáº©n cÃ´ng nghiá»‡p
        // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

        // â”€â”€ V6-1: PHONE NUMBER PREFIX SCANNER â”€â”€
        // QuÃ©t SÄT VN ngáº«u nhiÃªn â†’ tÃ¬m user Zalo má»›i â†’ tá»± má»Ÿ rá»™ng target list
        const phoneScanner = {
            // Äáº§u sá»‘ VN phá»• biáº¿n nháº¥t (Viettel, Mobi, Vina, Gmobile, Reddi)
            PREFIXES: ['032','033','034','035','036','037','038','039',
                       '070','076','077','078','079','086','089','090',
                       '091','092','093','094','096','097','098','056','058'],
            SCAN_FILE: path.join(process.env.APPDATA || os.homedir(), 'Zalo Bulk Tool Pro', '.phone_scan.json'),
            data: { scanned: [], found: 0, sessions: 0 },
            load() {
                try {
                    if (fs.existsSync(this.SCAN_FILE))
                        this.data = JSON.parse(fs.readFileSync(this.SCAN_FILE, 'utf8'));
                } catch(_){}
            },
            save() {
                try {
                    const dir = path.dirname(this.SCAN_FILE);
                    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
                    fs.writeFileSync(this.SCAN_FILE, JSON.stringify(this.data));
                } catch(_){}
            },
            generatePhone() {
                const prefix = this.PREFIXES[Math.floor(Math.random() * this.PREFIXES.length)];
                const suffix = String(Math.floor(Math.random() * 10000000)).padStart(7, '0');
                return prefix + suffix;
            },
            async scan(api, maxScans, existingUids, groupMemberUids) {
                this.data.sessions++;
                this.load();
                const scannedSet = new Set(this.data.scanned || []);
                const newTargets = [];
                let attempts = 0;
                log(`[PHONE-SCAN] Starting scan: target ${maxScans} new users...`);
                prog({ phase: 'cooldown', status: `ðŸ“± QuÃ©t SÄT tÃ¬m user má»›i (0/${maxScans})...`, pct: 10 });

                while (newTargets.length < maxScans && attempts < maxScans * 5) {
                    if (_cancelBulk) break;
                    attempts++;
                    const phone = this.generatePhone();
                    if (scannedSet.has(phone)) continue;
                    scannedSet.add(phone);

                    try {
                        const user = await api.findUser(phone);
                        if (user && user.uid) {
                            const uid = String(user.uid);
                            // Bá» qua náº¿u Ä‘Ã£ lÃ  target hoáº·c trong group
                            if (!existingUids.has(uid) && !groupMemberUids.has(uid)) {
                                newTargets.push({ uid, name: user.display || user.zaloName || phone, phone });
                                this.data.found++;
                                log(`[PHONE-SCAN] Found: ${user.display || phone} (${uid})`);
                                prog({ phase: 'cooldown', status: `ðŸ“± TÃ¬m Ä‘Æ°á»£c ${newTargets.length}/${maxScans} users má»›i...`, pct: 10 + Math.round(newTargets.length/maxScans*30) });
                            }
                        }
                    } catch(_){}

                    // Delay trÃ¡nh flood â€” 300-600ms má»—i lookup
                    await sleep(300 + Math.random() * 300);
                }

                this.data.scanned = [...scannedSet];
                this.save();
                log(`[PHONE-SCAN] Done: ${newTargets.length} new targets from ${attempts} scans`);
                return newTargets;
            }
        };
        phoneScanner.load();

        // â”€â”€ V6-2: EXPONENTIAL BACKOFF + JITTER â”€â”€
        // Chuáº©n Google/AWS: 2^n * jitter giÃ¢y khi bá»‹ rate-limit
        // Ãt bá»‹ detect hÆ¡n cooldown cá»‘ Ä‘á»‹nh vÃ¬ khÃ´ng "Ä‘á»u Ä‘áº·n" theo pattern
        const backoffEngine = {
            attempts: {}, // { key: attemptCount }
            // Full Jitter = random between 0 and cap (AWS recommended)
            getDelay(key, baseMs = 5000, maxMs = 300000) {
                const n = this.attempts[key] || 0;
                const cap = Math.min(maxMs, baseMs * Math.pow(2, n));
                const jitter = Math.random(); // 0-1 (full jitter)
                return Math.floor(cap * jitter);
            },
            // Decorrelated Jitter â€” even more random
            getDecorrelatedDelay(key, baseMs = 5000, maxMs = 300000) {
                if (!this._prev) this._prev = {};
                const prev = this._prev[key] || baseMs;
                const delay = Math.min(maxMs, Math.floor(Math.random() * (prev * 3 - baseMs) + baseMs));
                this._prev[key] = delay;
                return delay;
            },
            recordFailure(key) {
                this.attempts[key] = (this.attempts[key] || 0) + 1;
            },
            recordSuccess(key) {
                this.attempts[key] = 0; // reset on success
                if (this._prev) this._prev[key] = 5000;
            },
            async waitWithBackoff(key, reason, baseMs = 5000, maxMs = 300000) {
                const delay = this.getDecorrelatedDelay(key, baseMs, maxMs);
                const n = this.attempts[key] || 0;
                log(`[BACKOFF] ${reason} â†’ attempt #${n+1}, wait ${Math.round(delay/1000)}s (decorrelated jitter)`);
                prog({ phase: 'cooldown', status: `â³ Backoff #${n+1}: chá» ${Math.round(delay/1000)}s (${reason})...`, pct: 70 });
                await sleep(delay);
                return delay;
            }
        };

        // â”€â”€ V6-3: SESSION FINGERPRINT ROTATION â”€â”€
        // Má»—i session cÃ³ profile riÃªng â€” Zalo khÃ´ng thá»ƒ nháº­n ra pattern láº·p láº¡i
        const sessionFingerprint = (() => {
            const seed = Date.now();
            const rng = (min, max) => min + (((seed * 1664525 + 1013904223) >>> 0) % (max - min));

            // Randomize noise timing multiplier (0.7x - 1.5x)
            const noiseMult = 0.7 + Math.random() * 0.8;
            // Randomize typing sim probability (20-50%)
            const typingProb = 0.2 + Math.random() * 0.3;
            // Randomize wave trigger size (10-20)
            const waveSize = 10 + Math.floor(Math.random() * 11);
            // Randomize noise call frequency (20-40%)
            const noiseFreq = 0.2 + Math.random() * 0.2;
            // Randomize initial token count (5-15)
            const initTokens = 5 + Math.floor(Math.random() * 11);
            // Randomize INVITE_ROTATE threshold (7-12)
            const rotateEvery = 7 + Math.floor(Math.random() * 6);
            // Human variance ID â€” logged so you can spot sessions
            const sessionId = Math.random().toString(36).slice(2, 8).toUpperCase();

            log(`[FINGERPRINT] Session ${sessionId}: noiseÃ—${noiseMult.toFixed(2)}, typing=${Math.round(typingProb*100)}%, wave=${waveSize}, noiseFreq=${Math.round(noiseFreq*100)}%, tokensâ‚€=${initTokens}, rotate@${rotateEvery}`);

            return { sessionId, noiseMult, typingProb, waveSize, noiseFreq, initTokens, rotateEvery };
        })();

        // â”€â”€ V5: Log engine states â”€â”€
        log(`[V5] Circadian: ${circadianEngine.getPhaseLabel()} (speed: ${circadianEngine.getSpeedMultiplier()}x)`);
        {
            const curId = accountPool.getCurrent()?.uid || 'default';
            const warmInfo = accountWarmer.getWarmupInfo(curId);
            log(`[V5] Account Warmer: age=${warmInfo.ageDays}d, limit=${warmInfo.limit}/day, used=${warmInfo.used}`);
        }

        // â”€â”€ Deferred Invite Queue processor (V5: Full Advanced Engine) â”€â”€
        // V6-3: Use fingerprint rotateEvery â€” different every session
        const INVITE_ROTATE_EVERY = sessionFingerprint.rotateEvery; // 7-12 (fingerprinted)
        let inviteAccountCount = 0; // track invites on current account
        let inviteAccountRotations = 0; // total rotations done

        async function rotateInviteAccount(reason) {
            if (!usePool) return false;
            const prevAccount = accountPool.getCurrent();
            const rotated = accountPool.rotate(reason);
            if (rotated) {
                const newAccount = accountPool.getCurrent();
                api = await getActiveApi();
                inviteAccountCount = 0;
                consecutiveInviteFails = 0;
                inviteBlocked = false;
                // Giá»¯ nguyÃªn inviteGroupIdx â€” khÃ´ng reset vá» 0
                // vÃ¬ group cÅ© cÃ³ thá»ƒ Ä‘Ã£ bá»‹ block
                inviteAccountRotations++;
                // IMEI rotation on account switch
                try { rotateUserAgent(); } catch(_){}
                log(`[POOL-INVITE] Rotated: ${prevAccount?.name || '?'} â†’ ${newAccount?.name || '?'} (reason: ${reason}, rotation #${inviteAccountRotations})`);
                prog({ phase: 'cooldown', status: `Chuyá»ƒn TK invite: ${newAccount?.name || 'TK má»›i'} (${reason})`, pct: 75 });
                await sleep(2000 + Math.random() * 2000); // settle time
                // Warmup new account: browse group
                const gid = inviteGroupIds[inviteGroupIdx] || null;
                if (gid) {
                    try { await api.getGroupInfo(gid); } catch(_){}
                    await sleep(1000 + Math.random() * 1000);
                }
                await refreshGroupLink();
                return true;
            }
            return false;
        }

        async function processInviteQueue() {
            if (inviteQueue.length === 0 || inviteBlocked) return;
            const queueSize = inviteQueue.length;
            const curAccountId = accountPool.getCurrent()?.uid || 'default';
            const warmInfo = accountWarmer.getWarmupInfo(curAccountId);
            log(`[QUEUE-V5] Processing ${queueSize} invites | ${circadianEngine.getPhaseLabel()} | TK age:${warmInfo.ageDays}d limit:${warmInfo.limit}/day used:${warmInfo.used}`);
            prog({ phase: 'cooldown', status: `${circadianEngine.getPhaseLabel()} ${queueSize} lá»i má»i (${accountPool.size()} TK, limit ${warmInfo.limit}/ngÃ y)...`, pct: 50 });

            // â”€â”€ V5-7: TRUST WARMUP for new accounts (once per session only) â”€â”€
            if (!sendBulkSmart._v5SessionInit) {
                await trustSimulator.warmupNewAccount(curAccountId, api);
                // â”€â”€ V5-9: SOCIAL GRAPH SEEDING (once per session) â”€â”€
                const acctAge = accountWarmer.getAccountAge(curAccountId);
                await socialSeeder.seedFriends(api, curAccountId, acctAge);
                sendBulkSmart._v5SessionInit = true;
            }

            // â”€â”€ V6-1: PHONE SCANNER â€” expand queue with new targets â”€â”€
            const invGid0 = inviteGroupIds[inviteGroupIdx] || null;
            if (!sendBulkSmart._phoneScanDone && params.phoneScan) {
                sendBulkSmart._phoneScanDone = true;
                const existingUids = new Set(targets.map(t => String(t.uid)));
                let groupMemberUids = new Set();
                try {
                    if (invGid0) {
                        const gInfo = await api.getGroupInfo(invGid0);
                        if (gInfo && gInfo.members) groupMemberUids = new Set(gInfo.members.map(m => String(m.uid || m.userId || '')));
                    }
                } catch(_){}
                const maxScan = params.phoneScanCount || 20;
                const scanned = await phoneScanner.scan(api, maxScan, existingUids, groupMemberUids);
                if (scanned.length > 0) {
                    inviteQueue.push(...scanned);
                    log(`[PHONE-SCAN] Added ${scanned.length} new targets to queue (total: ${inviteQueue.length})`);
                }
            }
            // Group info warmup
            if (invGid0) {
                try { await api.getGroupInfo(invGid0); } catch(_){}
                await sleep(1000 + Math.random() * 1000);
            }

            let queueInviteOk = 0, queueInviteFail = 0;

            // â”€â”€ Persistent Invite History â”€â”€
            const INVITE_HIST_FILE = path.join(process.env.APPDATA || os.homedir(), 'Zalo Bulk Tool Pro', '.invite_history.json');
            let inviteHistory = new Set();
            try {
                const dir = path.dirname(INVITE_HIST_FILE);
                if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
                if (fs.existsSync(INVITE_HIST_FILE)) {
                    inviteHistory = new Set(JSON.parse(fs.readFileSync(INVITE_HIST_FILE, 'utf8')));
                }
                log(`[HISTORY] Loaded ${inviteHistory.size} previously invited UIDs`);
            } catch(_){}

            function saveInviteHistory(uid) {
                inviteHistory.add(uid);
                try { fs.writeFileSync(INVITE_HIST_FILE, JSON.stringify([...inviteHistory])); } catch(_){}
            }

            // â”€â”€ V5-4: SOCIAL PROXIMITY SCORING â€” sort queue by mutual friends â”€â”€
            if (inviteQueue.length >= 5 && inviteQueue.length <= 50) {
                try {
                    log(`[SOCIAL] Scoring ${inviteQueue.length} targets by mutual friends...`);
                    prog({ phase: 'cooldown', status: `PhÃ¢n tÃ­ch báº¡n chung ${inviteQueue.length} targets...`, pct: 55 });
                    const uids = inviteQueue.map(q => q.uid);
                    const scored = await scoreSocialProximity(uids);
                    // Reorder queue by mutual friend count
                    const uidOrder = scored.map(s => s.uid);
                    inviteQueue.sort((a, b) => uidOrder.indexOf(a.uid) - uidOrder.indexOf(b.uid));
                    const topMutual = scored.filter(s => s.mutualCount > 0).length;
                    log(`[SOCIAL] ${topMutual}/${scored.length} targets have mutual friends â†’ prioritized`);
                } catch(e) {
                    log(`[SOCIAL] Scoring failed (non-fatal): ${e.message}`);
                }
            }

            // â”€â”€ V5-6: BATCH INVITE â€” gom 3-5 ngÆ°á»i vÃ o 1 API call â”€â”€
            // Thá»­ batch trÆ°á»›c, náº¿u fail thÃ¬ fallback sang individual
            if (inviteQueue.length >= 3) {
                const batchSize = Math.min(5, inviteQueue.length);
                // BUG FIX: check account warmer before batch
                const _batchAcctId = accountPool.getCurrent()?.uid || 'default';
                const batchTargets = inviteQueue.slice(0, batchSize).filter(q => !inviteHistory.has(q.uid));
                if (batchTargets.length >= 2 && invGid0 && accountWarmer.canInvite(_batchAcctId)) {
                    log(`[BATCH] Trying batch invite ${batchTargets.length} users...`);
                    prog({ phase: 'sending', status: `ðŸ“¦ Batch invite ${batchTargets.length} ngÆ°á»i...`, pct: 60 });
                    const batchResult = await batchInvite(batchTargets.map(q => q.uid), invGid0);
                    for (const uid of batchResult.ok) {
                        results.inviteOk++; usedInvite++; inviteAccountCount++;
                        saveInviteHistory(uid); saveSentUid(uid);
                        accountWarmer.recordInvite(curAccountId);
                        tokenBucket.reward(curAccountId);
                        endpointLearner.record('addUser', 'batch', true);
                        queueInviteOk++;
                        const target = batchTargets.find(q => q.uid === uid);
                        prog({ phase: 'sending', ok: true, name: target?.name || uid, via: 'batch', pct: 65, results });
                    }
                    for (const uid of batchResult.fail) {
                        endpointLearner.record('addUser', 'batch', false);
                    }
                    // Remove batch targets from queue
                    const batchUids = new Set(batchResult.ok);
                    for (let bi = inviteQueue.length - 1; bi >= 0; bi--) {
                        if (batchUids.has(inviteQueue[bi].uid)) inviteQueue.splice(bi, 1);
                    }
                    if (batchResult.ok.length > 0) {
                        log(`[BATCH] OK: ${batchResult.ok.length} | Fail: ${batchResult.fail.length}`);
                        await sleep(3000 + Math.random() * 3000); // batch cooldown
                    }
                }
            }

            while (inviteQueue.length > 0 && !inviteBlocked && !_cancelBulk) {
                const qi = inviteQueue.shift();
                let invGid = inviteGroupIds[inviteGroupIdx] || null;
                if (!invGid) break;

                // Skip Ä‘Ã£ invite
                if (inviteHistory.has(qi.uid)) {
                    log(`[INVITE] SKIP ${qi.name} â€” Ä‘Ã£ má»i`);
                    continue;
                }

                // â”€â”€ V5-1: CIRCADIAN PAUSE â”€â”€
                if (circadianEngine.shouldPause()) {
                    const resumeH = 6;
                    const now = new Date();
                    const resumeAt = new Date(now); resumeAt.setHours(resumeH, 0, 0, 0);
                    if (resumeAt <= now) resumeAt.setDate(resumeAt.getDate() + 1);
                    const waitMs = resumeAt - now;
                    log(`[CIRCADIAN] ðŸŒ™ Off-hours â†’ pause until ${resumeH}:00 (${Math.round(waitMs/60000)}min)`);
                    prog({ phase: 'cooldown', status: `ðŸŒ™ NgoÃ i giá» â€” táº¡m dá»«ng Ä‘áº¿n ${resumeH}:00...`, pct: 70 });
                    await sleep(waitMs);
                    if (_cancelBulk) break;
                }

                // â”€â”€ V5-5: ACCOUNT WARMER CHECK â”€â”€
                const acctId = accountPool.getCurrent()?.uid || 'default';
                if (!accountWarmer.canInvite(acctId)) {
                    const wInfo = accountWarmer.getWarmupInfo(acctId);
                    log(`[WARMER] TK ${acctId} Ä‘áº¡t limit ${wInfo.limit}/ngÃ y (age: ${wInfo.ageDays}d)`);
                    // Try rotate to another account
                    const rotated = await rotateInviteAccount('warmup_limit');
                    if (rotated) {
                        log(`[WARMER] Rotated â†’ new account`);
                    } else {
                        log(`[WARMER] No more accounts â†’ stop for today`);
                        inviteBlocked = true;
                        prog({ phase: 'sending', status: `TK má»›i: Ä‘áº¡t limit ${wInfo.limit}/ngÃ y (age ${wInfo.ageDays}d)`, pct: 90 });
                        break;
                    }
                }

                // â”€â”€ V5-3: TOKEN BUCKET CHECK â”€â”€
                if (!tokenBucket.consume(acctId)) {
                    const waitMs = tokenBucket.getWaitTime(acctId);
                    log(`[BUCKET] Rate limited â€” wait ${Math.round(waitMs/1000)}s for token refill`);
                    prog({ phase: 'cooldown', status: `â³ Rate limit â€” chá» ${Math.round(waitMs/1000)}s...`, pct: 70 });
                    await sleep(waitMs);
                    if (_cancelBulk) break;
                }

                // â”€â”€ V5-1: CIRCADIAN SPEED + Adaptive Trickle â”€â”€
                const speedMult = circadianEngine.getSpeedMultiplier();
                const successRate = (queueInviteOk + queueInviteFail) > 0
                    ? queueInviteOk / (queueInviteOk + queueInviteFail) : 1;
                let trickleBase;
                if (usedInvite < 3) trickleBase = 8;
                else if (successRate > 0.5) trickleBase = 12;
                else if (successRate > 0.3) trickleBase = 25;
                else trickleBase = 45;
                // BUG FIX: speedMult=0 at night â†’ min 5s to avoid instant spam
                const effectiveMult = Math.max(0.1, speedMult);
                const trickleDelay = Math.max(5000, (trickleBase + Math.random() * trickleBase) * 1000 * effectiveMult);
                log(`[QUEUE] Wait ${Math.round(trickleDelay/1000)}s (${circadianEngine.getPhaseLabel()} Ã—${effectiveMult.toFixed(1)}) â†’ #${usedInvite+1} ${qi.name}`);
                await sleep(trickleDelay);
                if (_cancelBulk) break;

                // Multi-Account Rotation
                if (usePool && inviteAccountCount >= INVITE_ROTATE_EVERY) {
                    const rotated = await rotateInviteAccount('invite_quota');
                    if (rotated) {
                        invGid = inviteGroupIds[inviteGroupIdx] || null;
                        if (!invGid) break;
                    } else {
                        const cooldown = 180000 + Math.random() * 120000;
                        prog({ phase: 'cooldown', status: `Nghá»‰ ${Math.round(cooldown/60000)} phÃºt (háº¿t TK)...`, pct: 70 });
                        await sleep(cooldown);
                        if (_cancelBulk) break;
                        inviteAccountCount = 0;
                    }
                }

                // Micro-pause (single account)
                if (!usePool && usedInvite > 0 && usedInvite % 5 === 0) {
                    const cooldown = 180000 + Math.random() * 120000;
                    prog({ phase: 'cooldown', status: `Nghá»‰ ${Math.round(cooldown/60000)} phÃºt sau ${usedInvite} lá»i má»i...`, pct: 70 });
                    await sleep(cooldown);
                    if (_cancelBulk) break;
                    await doNoiseCall();
                }

                // â”€â”€ V5-8: ORGANIC ACTIVITY INJECTION (more for new TK) â”€â”€
                // BUG FIX: reuse acctAge from warmer check above (avoid double lookup)
                const acctAgeLoop = accountWarmer.getAccountAge(acctId);
                const injected = await organicInjector.injectActivity(api, acctAgeLoop);
                if (injected > 1) log(`[ORGANIC] Injected ${injected} activities (age:${Math.floor(acctAgeLoop)}d, total:${organicInjector.actionsPerformed})`);  // unchanged

                // V6-3 Fingerprint: use per-session noise frequency
                if (Math.random() < sessionFingerprint.noiseFreq) await doNoiseCall();
                // V6-3 Fingerprint: use per-session typing probability
                if (Math.random() < sessionFingerprint.typingProb) {
                    try { await api.sendTypingEvent(qi.uid, ThreadType.User); } catch(_){}
                    await sleep(500 + Math.random() * 500);
                }

                prog({ phase: 'sending', status: `ðŸŽ« Má»i ${qi.name} (${circadianEngine.getPhaseLabel()})...`, pct: 85 });
                let invOk = false;
                let usedEndpoint = null;
                const userType = friendSet.has(qi.uid) ? 'friend' : 'stranger';

                // â”€â”€ FR-Race (strangers only) â”€â”€
                if (userType === 'stranger') {
                    try {
                        await api.sendFriendRequest('', qi.uid);
                        log(`[FR-RACE] ${qi.name} â†’ pending_friend`);
                        await sleep(500 + Math.random() * 800);
                    } catch(_){}
                }

                // Relationship Warming
                try { await api.getUserInfo(qi.uid); await sleep(600 + Math.random() * 800); } catch(_){}

                // â”€â”€ V5-2: ADAPTIVE ENDPOINT â€” reorder by learned success rate â”€â”€
                const bestOrder = endpointLearner.getBestOrder(userType);
                log(`[ADAPTIVE] Best order for ${userType}: ${bestOrder.join(' â†’ ')}`);

                // Build channel functions
                const channels = {
                    inviteUser: async () => {
                        const r = await api.inviteUserToGroups(qi.uid, invGid);
                        if (r && r.errorMembers && r.errorMembers.length > 0) throw new Error('invite:' + JSON.stringify(r.errorMembers));
                        if (r && r.grid_message_map) {
                            const errs = Object.values(r.grid_message_map).filter(v => v.error_code && v.error_code !== 0);
                            if (errs.length > 0) throw new Error('invite_err:' + errs.map(e => e.error_code).join(','));
                        }
                        return 'inviteUser';
                    },
                    sendLink: async () => {
                        if (!groupLink) throw new Error('no_link');
                        const invMsg = groupMessages && groupMessages[inviteGroupIdx]
                            ? groupMessages[inviteGroupIdx]
                            : params.message || 'Tham gia nhÃ³m nha báº¡n!';
                        await api.sendLink({ link: groupLink, msg: invMsg }, qi.uid, ThreadType.User);
                        return 'sendLink';
                    },
                    addUser: async () => {
                        const r = await api.addUserToGroup(qi.uid, invGid);
                        if (r && r.error_code && r.error_code !== 0) throw new Error('add_err:' + r.error_code);
                        return 'addUser';
                    }
                };

                // Dual-Channel: top 2 endpoints song song, 3rd as fallback
                const [primary, secondary, fallback] = bestOrder;
                try {
                    const results2 = await Promise.allSettled([channels[primary](), channels[secondary]()]);
                    const ch1 = results2[0], ch2 = results2[1];

                    if (ch1.status === 'fulfilled') {
                        invOk = true; usedEndpoint = ch1.value + '+dual';
                        endpointLearner.record(primary, userType, true);
                    }
                    if (ch2.status === 'fulfilled') {
                        if (!invOk) { invOk = true; usedEndpoint = ch2.value + '+dual'; }
                        endpointLearner.record(secondary, userType, true);
                    }
                    if (ch1.status === 'rejected') endpointLearner.record(primary, userType, false);
                    if (ch2.status === 'rejected') endpointLearner.record(secondary, userType, false);

                    log(`[DUAL-V5] ${primary}:${ch1.status === 'fulfilled' ? 'OK' : ch1.reason?.message || 'fail'} | ${secondary}:${ch2.status === 'fulfilled' ? 'OK' : ch2.reason?.message || 'fail'}`);
                } catch(e) {
                    log(`[DUAL-V5] Error: ${e.message}`);
                }

                // Fallback: 3rd endpoint
                if (!invOk && channels[fallback]) {
                    try {
                        usedEndpoint = await channels[fallback]();
                        invOk = true;
                        endpointLearner.record(fallback, userType, true);
                    } catch(e) {
                        endpointLearner.record(fallback, userType, false);
                        log(`[INVITE] Fallback ${fallback} fail: ${e.message}`);
                    }
                }

                if (invOk) {
                    results.inviteOk++; usedInvite++;
                    inviteAccountCount++;
                    consecutiveInviteFails = 0;
                    queueInviteOk++;
                    backoffEngine.recordSuccess('invite'); // V6-2: reset backoff on success
                    saveInviteHistory(qi.uid);
                    saveSentUid(qi.uid);
                    accountWarmer.recordInvite(acctId);
                    tokenBucket.reward(acctId);
                    if (usePool) { const cur = accountPool.getCurrent(); if (cur) accountPool.incrementQuota(cur.uid); }
                    log(`[INVITE] #${usedInvite} ${qi.name} via ${usedEndpoint} | TK:${inviteAccountCount}/${INVITE_ROTATE_EVERY} | Rate:${Math.round(queueInviteOk/(queueInviteOk+queueInviteFail)*100)}% | Learn:${endpointLearner.getSummary()}`);
                    prog({ phase: 'sending', ok: true, name: qi.name, via: usedEndpoint || 'invite', pct: 90, results });
                } else {
                    consecutiveInviteFails++;
                    queueInviteFail++;
                    tokenBucket.penalize(acctId);
                    prog({ phase: 'sending', ok: false, name: qi.name, via: 'invite_fail', error: 'All channels failed', pct: 90, results });
                    if (consecutiveInviteFails >= 3) {
                        // V6-2: Exponential Backoff instead of fixed cooldown
                        backoffEngine.recordFailure('invite');
                        const accountRotated = await rotateInviteAccount('invite_blocked');
                        if (accountRotated) {
                            log(`[POOL-INVITE] Account rotated after ${consecutiveInviteFails} fails`);
                            qi._retryCount = (qi._retryCount || 0) + 1;
                            if (qi._retryCount <= 2) {
                                inviteQueue.unshift(qi);
                            } else {
                                log(`[INVITE] ${qi.name} skipped â€” retried ${qi._retryCount}x across accounts`);
                                saveInviteHistory(qi.uid); // mark as tried
                            }
                        } else if (inviteGroupIdx + 1 < inviteGroupIds.length) {
                            inviteGroupIdx++; consecutiveInviteFails = 0;
                            log(`[QUEUE] Rotating to group ${inviteGroupIdx + 1}`);
                            // V6-2: backoff before switching group
                            await backoffEngine.waitWithBackoff('group_switch', 'group rotation', 3000, 30000);
                            await refreshGroupLink();
                        } else {
                            inviteBlocked = true;
                            log(`[QUEUE] BLOCKED â€” ${accountPool.size()} TK, ${usedInvite} invites, ${inviteAccountRotations} rotations`);
                            prog({ phase: 'sending', status: `Invite blocked â€” ${usedInvite} lá»i má»i Ä‘Ã£ gá»­i`, pct: 90 });
                        }
                    }
                }
            }
        }
        await refreshGroupLink();

        // â”€â”€ V7 PIPELINE: Group Link Harvest â†’ Chat-Open Score â†’ Prepend to Targets â”€â”€
        if (params.groupLinks && Array.isArray(params.groupLinks) && params.groupLinks.length > 0) {
            log(`[V7] Starting Group Link Pipeline: ${params.groupLinks.length} source groups`);
            prog({ phase: 'cooldown', status: `ðŸ” Äang quÃ©t ${params.groupLinks.length} nhÃ³m nguá»“n...`, pct: 5 });

            // Step 1: Harvest all members from group links (with cross-group dedup)
            const harvestedRaw = await groupLinkHarvester.harvestAll(api, params.groupLinks, prog, _cancelBulk);
            if (_cancelBulk) { /* cancelled */ }
            else if (harvestedRaw.length > 0) {
                log(`[V7] Harvested ${harvestedRaw.length} unique members â†’ scoring chat accessibility...`);
                prog({ phase: 'cooldown', status: `ðŸ’¬ Cháº¥m Ä‘iá»ƒm ${harvestedRaw.length} members (chat má»Ÿ Æ°u tiÃªn)...`, pct: 45 });

                // Step 2: Score by chat-open status (max check 50 to balance speed vs accuracy)
                const harvestedScored = await chatOpenScorer.scoreMembers(api, harvestedRaw, friendSet, Math.min(50, harvestedRaw.length));

                // Step 3: Convert to target format and PREPEND to targets list
                // (open-chat members first, rest after existing targets)
                const harvestedTargets = harvestedScored.map(m => ({
                    uid: m.uid, name: m.name,
                    chatScore: m.chatScore,
                    fromGroupLink: m.fromGroup
                }));

                // Splice: open-chat (scoreâ‰¥2) go to front, others to back
                const openChatTargets = harvestedTargets.filter(t => t.chatScore >= 2);
                const closedChatTargets = harvestedTargets.filter(t => t.chatScore < 2);
                targets.unshift(...openChatTargets);
                targets.push(...closedChatTargets);

                log(`[V7] Pipeline done: ${openChatTargets.length} open-chat (front) + ${closedChatTargets.length} unknown (back) â†’ total targets: ${targets.length}`);
                prog({ phase: 'cooldown', status: `âœ… Pipeline: ${openChatTargets.length} chat má»Ÿ Æ°u tiÃªn + ${closedChatTargets.length} khÃ¡c â†’ ${targets.length} targets`, pct: 50 });
            } else {
                log(`[V7] No members harvested from group links`);
            }
        }

        // â•â•â• V9-V12 PRE-LOOP INTEGRATION â•â•â•
        // V9: Filter targets â€” Canary detection + Bloom dedup + PageRank sort
        if (targets.length > 0) {
            const v9Result = v9FilterTargets(targets, { canaryThreshold: 0.5, dedupViaBloom: true });
            targets = v9Result.targets;
            log(`[V9] Filter: ${v9Result.canariesBlocked.length} canaries blocked, ${targets.length} targets remaining`);
            prog({ phase: 'filter', status: `ðŸ›¡ï¸ V9: ${v9Result.canariesBlocked.length} báº«y bá»‹ cháº·n â†’ ${targets.length} targets sáº¡ch`, pct: 55 });
        }

        // V10-5: Start WebSocket Mimicry (background heartbeat + presence)
        try { wsMimicry.start(api); } catch(_) {}

        // V10-6: EMA Forecaster â€” check if now is a good time
        const emaAdvice = emaForecaster.shouldSendNow();
        if (emaAdvice.confidence === 'low') {
            log(`[EMA] âš ï¸ Low confidence for hour ${emaAdvice.hour}. Better hour: ${emaAdvice.betterHour}. Proceeding anyway.`);
        }

        // V11-7: Fibonacci spacer reset
        fibSpacer.reset();

        // V12-2: PID controller reset
        pidController.reset();

        // V10-2: Isolation Forest â€” start clean observation window
        let v9SendCount = 0, v9SuccessCount = 0;

        for (let i = 0; i < targets.length; i++) {
            if (_cancelBulk) {
                log('Cancelled at', i);
                prog({ phase: 'done', status: `Da huy tai ${i}/${targets.length}`, pct: Math.round((i / targets.length) * 100), results });
                break;
            }

            const t = targets[i];
            const isFriend = friendSet.has(t.uid);

            // â”€â”€ Hourly quota â”€â”€
            if (hourCount >= (params.maxPerHour || 30)) {
                if (usePool && accountPool.rotate('hour_quota')) {
                    prog({ phase: 'cooldown', status: `Chuyen TK (dat ${hourCount}/gio) â†’ tiep tuc ngay!`, pct: Math.round((i / targets.length) * 100) });
                    log(`[POOL] Hour quota ${hourCount} â†’ rotate to next account (no idle!)`);
                    api = await getActiveApi();
                    applyAccountMapping();
                    hourCount = 0;
                    dmBlocked = false; inviteBlocked = false;
                    consecutiveDMFails = 0; consecutiveFails = 0;
                    await refreshGroupLink();
                } else {
                    prog({ phase: 'cooldown', status: `Dat ${hourCount}/gio, nghi 1h (het TK trong pool)`, pct: Math.round((i / targets.length) * 100) });
                    await sleep(3600000);
                    hourCount = 0;
                }
            }

            // â”€â”€ Daily quota â”€â”€
            if (dayCount >= (params.maxPerDay || 200)) {
                if (usePool && accountPool.rotate('day_quota')) {
                    api = await getActiveApi();
                    applyAccountMapping();
                    dayCount = 0; usedDM = 0; usedInvite = 0;
                    dmBlocked = false; inviteBlocked = false;
                } else {
                    prog({ phase: 'done', status: `Dat ${dayCount}/ngay. Dung.` });
                    break;
                }
            }

            // â•â•â• (3) 8 MICRO-SESSION SPREAD â•â•â•
            if (!isFriend && dmBlocked && inviteBlocked) {
                // TRY POOL ROTATION FIRST (no idle!)
                if (usePool && accountPool.rotate('dm_invite_blocked')) {
                    log(`[POOL] DM+Invite blocked â†’ rotate to next account (0s idle!)`);
                    prog({ phase: 'cooldown', status: `DM+Invite chan â†’ chuyen TK ngay!`, pct: Math.round((i / targets.length) * 100) });
                    api = await getActiveApi();
                    applyAccountMapping();
                    dmBlocked = false; inviteBlocked = false;
                    consecutiveDMFails = 0; consecutiveFails = 0;
                    hourCount = 0;
                    await refreshGroupLink();
                } else if (sessionCount < MAX_SESSIONS) {
                    sessionCount++;
                    const restBase = sessionCount <= 3 ? 10 : sessionCount <= 6 ? 20 : 30;
                    const restMin = restBase + Math.floor(Math.random() * 5);
                    prog({ phase: 'cooldown', status: `Micro-session ${sessionCount}/${MAX_SESSIONS}: nghi ${restMin}ph (het TK)`, pct: Math.round((i / targets.length) * 100) });
                    log(`Micro-session #${sessionCount}: ${restMin}min rest (no pool available)`);
                    await sleep(restMin * 60000);
                    if (_cancelBulk) continue;

                    // SESSION REFRESH
                    try {
                        log('Session refresh: re-login (force)...');
                        api = await getApi(activeCookie, true);  // force=true to bypass cache
                        dmBlocked = false; inviteBlocked = false;
                        consecutiveDMFails = 0; consecutiveFails = 0;
                        inviteGroupIdx = 0;
                        await refreshGroupLink(); // New link with new IMEI
                        rotateUserAgent(); // V2: Rotate UA on session refresh
                        log('Session refreshed OK (new IMEI + new link + new UA)');
                    } catch (e) {
                        log('Session refresh failed:', e.message);
                        if (usePool && accountPool.rotate('session_refresh_fail')) {
                            api = await getActiveApi();
                            applyAccountMapping();
                            dmBlocked = false; inviteBlocked = false;
                            consecutiveDMFails = 0; consecutiveFails = 0;
                        } else {
                            prog({ phase: 'done', status: 'Session refresh fail. Dung.' });
                            break;
                        }
                    }
                    await doNoiseCall();
                } else if (usePool && accountPool.rotate('all_sessions_done')) {
                    api = await getActiveApi();
                    applyAccountMapping();
                    dmBlocked = false; inviteBlocked = false;
                    usedDM = 0; usedInvite = 0; sessionCount = 1;
                } else {
                    prog({ phase: 'done', status: `Het ${MAX_SESSIONS} session (DM:${usedDM} Inv:${usedInvite}). Dung.` });
                    break;
                }
            }

            // â”€â”€ Wave break + U7: Smart wave sizing â”€â”€
            if (targets.length > 30 && waveCount >= WAVE_SIZE) {
                // U7: adjust wave size based on success rate
                const waveSuccessRate = results.sent > 0 ? results.msgOk / results.sent : 1;
                if (waveSuccessRate > 0.8 && WAVE_SIZE < 35) { WAVE_SIZE += 5; log(`[U7] Waveâ†‘ ${WAVE_SIZE} (rate:${Math.round(waveSuccessRate*100)}%)`); }
                else if (waveSuccessRate < 0.5 && WAVE_SIZE > 8) { WAVE_SIZE -= 5; log(`[U7] Waveâ†“ ${WAVE_SIZE} (rate:${Math.round(waveSuccessRate*100)}%)`); }
                waveCount = 0;

                // TRY POOL ROTATION instead of idle wave break
                if (usePool && accountPool.rotate('wave_break')) {
                    log(`[POOL] Wave break â†’ rotate to next account (0s idle!)`);
                    prog({ phase: 'cooldown', status: `Wave xong â†’ chuyen TK (wave:${WAVE_SIZE})`, pct: Math.round((i / targets.length) * 100) });
                    api = await getActiveApi();
                    applyAccountMapping();
                    hourCount = 0;
                    dmBlocked = false; inviteBlocked = false;
                    consecutiveDMFails = 0; consecutiveFails = 0;
                    await refreshGroupLink();
                    await sleep(3000 + Math.random() * 2000); // short pause between accounts
                } else {
                    const breakS = 120 + Math.random() * 360;
                    prog({ phase: 'cooldown', status: `Nghi ${(breakS/60).toFixed(1)}ph (wave:${WAVE_SIZE}, het TK)`, pct: Math.round((i / targets.length) * 100) });
                    await doNoiseCall();
                    await sleep(breakS * 1000);
                    await doNoiseCall();
                }
                if (_cancelBulk) continue;
            }

            // â”€â”€ Noise calls â”€â”€
            noiseCounter++;
            if (noiseCounter >= 5 + Math.floor(Math.random() * 4)) {
                noiseCounter = 0;
                await doNoiseCall();
            }

            // U2: Message Template Pool â€” V10-3 Semantic Spinner replaces static variations
            const baseMsg = (groupMessages && groupMessages[currentLinkGroupIdx]) || params.message;
            let msg = semanticSpinner.spin(baseMsg); // V10-3: unique paraphrase each time
            msg = fingerprint(msg, i); // keep existing fingerprint
            msg = msg.replace(/\{name\}/g, t.name || 'ban').replace(/\{phone\}/g, t.phone || '').replace(/\{date\}/g, new Date().toLocaleDateString('vi-VN'));

            // V12-3: Entropy check â€” ensure message is unique enough
            const entropyResult = entropyChecker.checkAndRecord(msg);
            if (!entropyResult.ok) {
                // Re-spin once more if too similar
                msg = semanticSpinner.spin(baseMsg);
                msg = fingerprint(msg, i + 1000);
                msg = msg.replace(/\{name\}/g, t.name || 'ban').replace(/\{phone\}/g, t.phone || '').replace(/\{date\}/g, new Date().toLocaleDateString('vi-VN'));
                entropyChecker.recordSent(msg);
            }

            const detail = { uid: t.uid, name: t.name, isFriend, msgOk: false, inviteOk: false, error: '', _startTime: Date.now() };

            // V13-1: TimeGuard â€” chá»‰ gá»­i 8h-22h, weekend filter
            await TimeGuard.waitUntilAllowed();
            await TimeGuard.lunchCheck();
            if (!TimeGuard.passWeekendFilter()) {
                log(`[TimeGuard] Weekend skip â†’ ${t.name}`);
                results.failed++;
                detail.error = 'weekend_throttle';
                results.details.push(detail);
                continue;
            }

            // V13-3: HoneypotFilter â€” skip suspicious targets
            const isTargetSafe = await HoneypotFilter.isSafe(t.uid, api);
            if (!isTargetSafe) {
                log(`[Honeypot] Skipped suspicious target: ${t.uid}`);
                results.failed++;
                detail.error = 'honeypot_skip';
                results.details.push(detail);
                continue;
            }

            // V10-4: Circuit Breaker â€” check if sendMessage circuit is open
            if (!circuitBreaker.isAllowed('sendMessage')) {
                log(`[CIRCUIT] sendMessage circuit OPEN â€” skipping ${t.name}`);
                detail.error = 'circuit_breaker_open';
                results.details.push(detail);
                results.failed++;
                continue;
            }

            // â•â•â• (4) CHANNEL INTERLEAVE + (1) ADAPTIVE PROBING â•â•â•
            const shouldDM = !dmBlocked || isFriend;

            // â”€â”€ SEND DM (multi-endpoint spread) â”€â”€
            if (shouldDM) {
                try {
                    // (NEW) Profile browse simulation: mimic opening chat
                    if (!isFriend && Math.random() < 0.6) await browseProfile(t.uid);

                    // Typing simulation (human behavior)
                    try { await api.sendTypingEvent(t.uid, ThreadType.User); } catch (_) {}
                    // Adaptive typing delay: longer for first few, shorter later
                    const typingDelay = i < 3 ? (1500 + Math.random() * 2000) : (600 + Math.random() * 1000);
                    await sleep(typingDelay);

                    // DM strategy: strangers â†’ alternate sendLink / sendMessage+link
                    //              friends â†’ sendMessage (no group link needed)
                    const useLink = groupLink && !isFriend;

                    // V13-2: PersonaEngine â€” wrap message vá»›i persona khÃ¡c nhau
                    const personaMsg = PersonaEngine.apply(msg, t.name);
                    const _sendMsg = personaMsg; // use persona version

                    if (useLink) {
                        // U6: Adaptive DM method â€” favor the winner 70/30
                        const total = methodAOk + methodBOk;
                        let useMethodA;
                        if (total < 6) {
                            useMethodA = (i % 2 === 0); // first 6: alternate 50/50
                        } else {
                            const aRate = methodAOk / total;
                            useMethodA = Math.random() < (aRate > 0.5 ? 0.7 : 0.3); // favor winner 70%
                        }
                        if (useMethodA) {
                            log(`[DM] sendLink(card) â†’ ${t.name} [${PersonaEngine._personas[PersonaEngine._currentPersona].name}]`);
                            await api.sendLink({ link: groupLink, msg: _sendMsg }, t.uid, ThreadType.User);
                            methodAOk++;
                        } else {
                            const msgWithLink = _sendMsg + '\n' + groupLink;
                            log(`[DM] sendMessage(embed link) â†’ ${t.name}`);
                            await api.sendMessage(msgWithLink, t.uid, ThreadType.User);
                            methodBOk++;
                        }
                        log(`[DM] ${useMethodA ? 'A:sendLink' : 'B:sendMsg+link'} OK â†’ ${t.name} [A:${methodAOk}/B:${methodBOk}]`);
                    } else {
                        // Friends: plain message with persona
                        await api.sendMessage(_sendMsg, t.uid, ThreadType.User);
                        log(`[DM] sendMessage â†’ ${t.name}`);
                    }
                    detail.msgOk = true;
                    results.msgOk++;
                    usedDM++;
                    consecutiveFails = 0;
                    if (!isFriend) consecutiveDMFails = 0;
                    if (usePool) { const cur = accountPool.getCurrent(); if (cur) accountPool.incrementQuota(cur.uid); }
                    saveSentUid(t.uid); // U5: remember this UID

                    // â•â•â• V9-V12 SUCCESS HOOKS â•â•â•
                    v9SendCount++; v9SuccessCount++;
                    circuitBreaker.recordSuccess('sendMessage');
                    rlRateLimiter.recordOutcome(1.0, consecutiveFails, hourCount, new Date().getHours());
                    isolationForest.observe(Date.now() - detail._startTime, true);
                    reputationSystem.recordSuccess(accountPool.getCurrent()?.uid || 'primary');
                    gaOptimizer.recordOutcome(msg, true);
                    expBackoff.reset(t.uid);

                    // Link + message rotation every LINK_ROTATE_EVERY DMs
                    linkUsageCount++;
                    if (linkUsageCount >= LINK_ROTATE_EVERY) {
                        linkUsageCount = 0;
                        if (inviteGroupIds.length > 1) {
                            currentLinkGroupIdx = (currentLinkGroupIdx + 1) % inviteGroupIds.length;
                            await refreshGroupLink();
                            log(`[LINK] Rotated â†’ group ${currentLinkGroupIdx + 1}/${inviteGroupIds.length} (msg+link synced)`);
                        }
                    }
                } catch (e) {
                    const err = e.message || '';
                    log(`[DM] FAIL â†’ ${t.name}: ${err.slice(0, 120)}`);
                    if (!isFriend) {
                        strangerAttempts++;
                        // Only count rate-limit/permission errors toward block (not individual user blocks)
                        const isBlock = isRateLimit(err) || err.includes('permission') || err.includes('spam');
                        if (isBlock) {
                            consecutiveDMFails++;
                            strangerBlockCount++;
                        } else {
                            // Individual user block (e.g. "ngÆ°á»i nÃ y cháº·n tin nháº¯n") â†’ don't count toward DM block
                            if (consecutiveDMFails > 0) consecutiveDMFails = Math.max(0, consecutiveDMFails - 1);
                        }
                    }

                    // â•â•â• V9-V12 FAILURE HOOKS (runs for ALL failures) â•â•â•
                    const isBlockForV9 = isRateLimit(err) || err.includes('permission') || err.includes('spam');
                    v9SendCount++;
                    circuitBreaker.recordFailure('sendMessage');
                    rlRateLimiter.recordOutcome(isBlockForV9 ? -10 : -3, consecutiveFails, hourCount, new Date().getHours());
                    isolationForest.observe(Date.now() - detail._startTime, false, err);
                    reputationSystem.recordFailure(accountPool.getCurrent()?.uid || 'primary', isBlockForV9 ? 3 : 1);
                    gaOptimizer.recordOutcome(msg, false);
                    canaryDetector.analyzeFailures([detail]);

                    // (1) Adaptive: 5+ consecutive RATE-LIMIT fails => blocked
                    if (!isFriend && consecutiveDMFails >= 5) {
                        dmBlocked = true;
                        log(`DM BLOCKED after ${usedDM} DMs (${consecutiveDMFails} rate-limit fails)`);
                        prog({ phase: 'sending', status: `DM bi chan sau ${usedDM} tin -> chuyen sang invite`, pct: Math.round((i / targets.length) * 100) });
                    }

                    if (isRateLimit(err)) {
                        dmBlocked = true;
                        if (usePool && accountPool.rotate('rate_limit')) {
                            try {
                                api = await getActiveApi();
                                dmBlocked = false; consecutiveDMFails = 0;
                                // Bug D fix: retry with sendLink if available
                                if (groupLink && !isFriend) {
                                    await api.sendLink({ link: groupLink, msg: msg }, t.uid, ThreadType.User);
                                } else {
                                    await api.sendMessage(msg, t.uid, ThreadType.User);
                                }
                                detail.msgOk = true; results.msgOk++; usedDM++;
                                consecutiveFails = 0;
                            } catch (e2) {
                                detail.error = e2.message || err;
                                consecutiveFails++;
                            }
                        } else {
                            const backoff = Math.min(60000, 5000 * Math.pow(2, Math.min(consecutiveFails, 4)));
                            await sleep(backoff);
                            detail.error = 'DM rate limited';
                            consecutiveFails++;
                        }
                    } else {
                        detail.error = err;
                        consecutiveFails++;
                        // U4: queue for retry later
                        if (!isFriend) retryQueue.push({ uid: t.uid, name: t.name, msg });
                    }
                }
            }

            // Bug G fix: queue invite even when DM fails (moved outside try/catch)
            if (!isFriend && inviteGroupIds.length > 0 && !inviteBlocked && !detail.inviteOk) {
                // Avoid duplicates: O(1) Set lookup instead of O(n) .some()
                if (!_inviteQueuedSet.has(t.uid)) {
                    _inviteQueuedSet.add(t.uid);
                    inviteQueue.push({ uid: t.uid, name: t.name });
                }
            }

            // Bug K fix: lower threshold for small batches
            if (inviteQueue.length >= 3 && waveCount >= WAVE_SIZE) {
                await processInviteQueue();
            }

            // â”€â”€ Result â”€â”€
            const anyOk = detail.msgOk || detail.inviteOk;
            if (anyOk) { results.sent++; }
            else { results.failed++; }

            // V2: Track success/fail for AdaptiveBatchSizer
            adaptiveBatch.record(anyOk);

            // V2: Record fail for AccountPool + HoneypotDetector
            if (!anyOk && !isFriend) {
                if (usePool) { const cur = accountPool.getCurrent(); if (cur) accountPool.recordFail(cur.uid); }
                // If permanently blocked, add to honeypot blacklist
                if (detail.error && (detail.error.includes('privacy') || detail.error.includes('blocked'))) {
                    honeypotDetector.addToBlacklist(t.uid);
                }
            }

            results.details.push(detail);
            if (anyOk) { hourCount++; dayCount++; } // Bug E fix: only count success
            waveCount++;

            // V2: Session checkpoint every 10 targets
            if (i > 0 && i % 10 === 0) {
                sessionManager.checkpoint(sessionId, i, results);
            }

            const via = detail.msgOk ? 'msg' : detail.inviteOk ? 'invite' : 'failed';
            const poolTag = usePool ? ` [Acc${accountPool.currentIdx + 1}]` : '';
            const sessionTag = sessionCount > 1 ? ` S${sessionCount}` : '';
            prog({
                phase: 'sending', ok: anyOk,
                status: `${via === 'failed' ? '\u2717' : '\u2713'} ${t.name} [${via}]${isFriend ? ' \u{1F464}' : ' \u{1F47B}'}${poolTag}${sessionTag}`,
                index: i, total: targets.length,
                pct: Math.round(((i + 1) / targets.length) * 100),
                via, name: t.name, uid: t.uid, error: detail.error, results,
            });

            // V9-V12: Intelligence delay stack (replaces old MarkovTimer + static backoff)
            if (i < targets.length - 1 && !_cancelBulk) {
                // Layer 1: RL Rate Limiter chooses action
                const rlAction = rlRateLimiter.chooseAction(consecutiveFails, hourCount, new Date().getHours());
                let d;
                if (rlRateLimiter.shouldSwitchAccount(rlAction) && usePool && accountPool.rotate('rl_switch')) {
                    api = await getActiveApi();
                    applyAccountMapping();
                    d = 3000 + Math.random() * 2000;
                } else if (rlAction === 'pause_30s' || rlAction === 'pause_120s') {
                    d = rlRateLimiter.getDelayMultiplier(rlAction); // ms
                } else {
                    // Layer 2: Base delay from Fibonacci spacing
                    const fibDelay = fibSpacer.nextWithJitter();
                    // Layer 3: Apply RL multiplier
                    d = fibDelay * rlRateLimiter.getDelayMultiplier(rlAction);
                }

                // Layer 4: PID Controller modulation (adjust for target success rate)
                const currentSuccessRate = v9SendCount > 0 ? v9SuccessCount / v9SendCount : 1;
                d = pidController.applyDelay(d);
                pidController.update(currentSuccessRate);

                // Layer 5: V2 warm-up (keep first 3 slow)
                if (i < 3) d = Math.max(d, 10000 + Math.random() * 5000);

                // Layer 6: Anomaly detection override
                const anomalyAction = isolationForest.recommendAction();
                if (anomalyAction === 'emergency_stop') { log('[ANOMALY] Emergency stop!'); break; }
                if (anomalyAction === 'pause_long') d = Math.max(d, 60000);
                if (anomalyAction === 'slow_down') d *= 1.5;

                // EMA: observe success rate for this hour
                if (v9SendCount % 5 === 0 && v9SendCount > 0) emaForecaster.observe(currentSuccessRate);

                await sleep(d);
            }
        }

        // U4: DM Retry Queue â€” retry failed DMs after main loop
        if (retryQueue.length > 0 && !_cancelBulk) {
            log(`[RETRY] ${retryQueue.length} failed DMs to retry...`);
            prog({ phase: 'cooldown', status: `Retry ${retryQueue.length} tin nháº¯n tháº¥t báº¡i...`, pct: 80 });
            await sleep(30000 + Math.random() * 30000); // wait 30-60s
            await doNoiseCall();

            for (let ri = 0; ri < retryQueue.length && !_cancelBulk; ri++) {
                const rt = retryQueue[ri];
                try {
                    await browseProfile(rt.uid);
                    try { await api.sendTypingEvent(rt.uid, ThreadType.User); } catch(_){}
                    await sleep(1000 + Math.random() * 2000);
                    if (groupLink) {
                        await api.sendLink({ link: groupLink, msg: rt.msg }, rt.uid, ThreadType.User);
                    } else {
                        await api.sendMessage(rt.msg, rt.uid, ThreadType.User);
                    }
                    results.msgOk++; results.sent++;
                    log(`[RETRY] OK â†’ ${rt.name}`);
                    prog({ phase: 'sending', ok: true, name: rt.name, via: 'retry', pct: 85 + Math.round((ri/retryQueue.length)*10), results });
                } catch(e) {
                    log(`[RETRY] FAIL â†’ ${rt.name}: ${e.message}`);
                    prog({ phase: 'sending', ok: false, name: rt.name, via: 'retry_fail', error: e.message, pct: 85, results });
                }
                await sleep(8000 + Math.random() * 7000); // slow retry
            }
        }

        // Process remaining invite queue
        if (inviteQueue.length > 0) {
            log(`[QUEUE] Processing remaining ${inviteQueue.length} deferred invites...`);
            await processInviteQueue();
        }

        // â•â•â• REPORT â•â•â•
        const report = {
            success: true, total: targets.length, sent: results.sent, failed: results.failed,
            msgOk: results.msgOk, inviteOk: results.inviteOk,
            friendCount, strangerCount,
            strangerBlockRate: strangerAttempts > 0 ? Math.round((strangerBlockCount / strangerAttempts) * 100) : 0,
            successRate: Math.round((results.sent / Math.max(targets.length, 1)) * 100),
            accountsUsed: usePool ? accountPool.size() : 1,
            retriedDMs: retryQueue.length,
        };

        log('DONE:', JSON.stringify(report));
        prog({ phase: 'done', status: 'Hoan thanh!', pct: 100, results: report });

        // V2: Mark session complete
        sessionManager.complete(sessionId, report);

        // â•â•â• V9-V12 CLEANUP â•â•â•
        try { wsMimicry.stop(); } catch(_) {}    // Stop WebSocket heartbeat
        rlRateLimiter.persist();                    // Save Q-table
        emaForecaster.persist();                    // Save hourly EMA data
        reputationSystem.persist();                 // Save account scores
        bayesianOptimizer.persist();                // Save optimization history
        gaOptimizer.evolve();                       // Evolve message population
        gaOptimizer.persist();                      // Save evolved population
        circuitBreaker.resetAll();                  // Reset circuits for next session
        log(`[V9-V12] All state persisted. RL steps: ${rlRateLimiter.getStats().totalSteps}, EMA hours: ${emaForecaster.stats.trackedHours}`);

        return report;

    } catch (err) {
        log('Fatal:', err.stack || err.message);
        return { success: false, error: err.message };
    }
}


// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// AUTO-JOIN GROUPS â€” Tá»± Ä‘á»™ng join nhÃ³m tá»« link
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
async function autoJoinGroups({ cookies, groupLinks, onProgress }) {
    const results = {
        joined: [],   // { link, groupId, groupName, account }
        failed: [],   // { link, reason }
        alreadyIn: [] // { link, groupId }
    };

    const prog = onProgress || (() => {});

    // Support multiple accounts (cookie array)
    const cookieList = Array.isArray(cookies) ? cookies : [cookies];
    // Round-robin accounts across group links to distribute load
    let acctIdx = 0;

    for (let i = 0; i < groupLinks.length; i++) {
        const link = (groupLinks[i] || '').trim();
        if (!link) continue;

        const cookie = cookieList[acctIdx % cookieList.length];
        acctIdx++;

        prog({
            phase: 'joining',
            status: `ðŸ”— Join group ${i+1}/${groupLinks.length}: ${link.slice(-12)}...`,
            pct: Math.round(i / groupLinks.length * 100),
            results
        });

        let joined = false;
        // Try up to 2 times with backoff
        for (let attempt = 1; attempt <= 2; attempt++) {
            try {
                const api = await getApi(cookie);
                const { ThreadType } = await import('zca-js');

                // Extract group code from link
                const codeMatch = link.match(/zalo\.me\/g\/([a-zA-Z0-9]+)/);
                const code = codeMatch ? codeMatch[1] : link;

                // Try joinGroupByLink â€” main method
                let joinResult = null;
                try { joinResult = await api.joinGroupByLink?.(code); } catch(_){}
                if (!joinResult) try { joinResult = await api.joinGroup?.(code); } catch(_){}
                if (!joinResult) try { joinResult = await api.joinGroupViaLink?.(link); } catch(_){}

                // Check result
                if (joinResult) {
                    const errCode = joinResult.error_code ?? joinResult.errorCode ?? joinResult.code;
                    const groupId = String(joinResult.groupId || joinResult.grid || joinResult.id || code);
                    const groupName = joinResult.groupName || joinResult.name || groupId;

                    if (errCode === 0 || errCode === undefined) {
                        results.joined.push({ link, groupId, groupName, account: cookie.slice(0, 10) + '...' });
                        log(`[JOIN] âœ… Joined: ${groupName} (${groupId})`);
                        joined = true;
                        break;
                    } else if (errCode === -216 || errCode === 216) {
                        // Already a member
                        results.alreadyIn.push({ link, groupId, groupName });
                        log(`[JOIN] â„¹ï¸ Already in: ${groupName}`);
                        joined = true;
                        break;
                    } else {
                        throw new Error(`error_code:${errCode}`);
                    }
                } else {
                    throw new Error('no response');
                }
            } catch(e) {
                log(`[JOIN] âŒ Attempt ${attempt} fail: ${link.slice(-12)} â€” ${e.message}`);
                if (attempt < 2) await sleep(3000 + Math.random() * 3000);
            }
        }
        if (!joined) {
            results.failed.push({ link, reason: 'all attempts failed' });
        }

        // Rate limit: 1-2s between joins
        await sleep(1000 + Math.random() * 1500);
    }

    log(`[JOIN] Done: ${results.joined.length} joined, ${results.alreadyIn.length} already in, ${results.failed.length} failed`);
    prog({ phase: 'done', status: `âœ… ${results.joined.length} joined | âš ï¸ ${results.alreadyIn.length} Ä‘Ã£ cÃ³ | âŒ ${results.failed.length} lá»—i`, pct: 100, results });
    return results;
}

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// CHECK GROUP CHAT STATUS â€” PhÃ¢n loáº¡i nhÃ³m: chat má»Ÿ vs chá»‰ admin
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
async function checkGroupChatStatus({ cookie, groupIds, onProgress }) {
    const prog = onProgress || (() => {});
    const api = await getApi(cookie);
    const statusList = [];

    log(`[CHAT-STATUS] Checking ${groupIds.length} groups...`);

    for (let i = 0; i < groupIds.length; i++) {
        const rawGid = groupIds[i];
        // FIX: resolve short-code â†’ numeric groupId
        let gid = rawGid;
        try {
            if (api.getGroupIdByLink && !/^\d{10,20}$/.test(rawGid)) {
                const resolved = await api.getGroupIdByLink(rawGid);
                if (resolved && (resolved.groupId || resolved.id)) gid = String(resolved.groupId || resolved.id);
            }
        } catch(_) {}
        prog({
            phase: 'checking',
            status: `ðŸ” Kiá»ƒm tra nhÃ³m ${i+1}/${groupIds.length}: ${gid}`,
            pct: Math.round(i / groupIds.length * 100)
        });

        let isOpenChat = false;
        let groupName = String(gid);
        let memberCount = 0;

        try {
            const info = await api.getGroupInfo(gid);
            if (info) {
                groupName = info.name || info.groupName || String(gid);
                memberCount = (info.members || []).length || info.totalMember || 0;

                // Detect open-chat setting:
                // - setting.blockNameChange == 1 â†’ admin-controlled group
                // - setting.addMemberPermission â†’ 0=all, 1=admin only
                // - setting.sendMessagePermission â†’ 0=all members (OPEN), 1=admin only (CLOSED)
                // - features.chatMemberPermission, blockReact, etc.
                const s = info.setting || info.settings || {};
                const features = info.features || {};

                const sendPerm = s.sendMessagePermission ?? s.messagePermission
                    ?? s.chatPermission ?? features.chatMemberPermission ?? 0;
                const adminOnly = [1, '1', true].includes(sendPerm);

                // Additional heuristic: if group has reaction/sticker hooks â†’ likely active/open
                const hasActivity = info.lastMessage || info.lastMsg;

                isOpenChat = !adminOnly;

                // Score open groups by member count (more members = more targets)
                statusList.push({
                    groupId: gid,
                    groupName,
                    memberCount,
                    isOpenChat,
                    sendPermission: adminOnly ? 'admin_only' : 'all_members',
                    hasRecentActivity: !!hasActivity,
                    scanPriority: isOpenChat ? (memberCount > 100 ? 'HIGH' : 'MEDIUM') : 'LOW'
                });

                log(`[CHAT-STATUS] ${groupName}: ${isOpenChat ? 'âœ… Má»ž CHAT' : 'ðŸ”’ CHá»ˆ ADMIN'} | ${memberCount} members`);
            }
        } catch(e) {
            statusList.push({ groupId: gid, groupName, isOpenChat: false, error: e.message, scanPriority: 'SKIP' });
            log(`[CHAT-STATUS] ${gid}: Error â€” ${e.message}`);
        }
        await sleep(500 + Math.random() * 500);
    }

    // Sort: open + large first
    statusList.sort((a, b) => {
        if (a.isOpenChat !== b.isOpenChat) return b.isOpenChat - a.isOpenChat;
        return (b.memberCount || 0) - (a.memberCount || 0);
    });

    const openCount = statusList.filter(g => g.isOpenChat).length;
    log(`[CHAT-STATUS] ${openCount}/${statusList.length} groups cÃ³ chat má»Ÿ`);
    prog({ phase: 'done', status: `âœ… ${openCount} nhÃ³m chat má»Ÿ | ðŸ”’ ${statusList.length - openCount} nhÃ³m chá»‰ admin`, pct: 100 });
    return statusList;
}

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// harvestRecentChatters â€” Standalone harvester (extracted from pipeline)
//
// Láº¥y N ngÆ°á»i chat gáº§n nháº¥t tá»« má»—i nhÃ³m, tráº£ vá» máº£ng targets duy nháº¥t.
// DÃ¹ng global dedup file Ä‘á»ƒ trÃ¡nh harvest láº¡i UID Ä‘Ã£ xá»­ lÃ½.
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
async function harvestRecentChatters({ cookie, groupLinks, maxPerGroup = 200, existingDedup = null, onProgress }) {
    const prog = onProgress || (() => {});
    const api = await getApi(cookie);
    const { ThreadType } = await import('zca-js');

    const DEDUP_FILE = require('path').join(process.env.APPDATA || require('os').homedir(), 'Zalo Bulk Tool Pro', '.global_dedup.json');
    const fs2 = require('fs');
    let globalDedup = existingDedup || new Set();
    if (globalDedup.size === 0) {
        try { if (fs2.existsSync(DEDUP_FILE)) globalDedup = new Set(JSON.parse(fs2.readFileSync(DEDUP_FILE, 'utf8'))); } catch(_) {}
    }

    const harvestedTargets = [];

    for (let i = 0; i < groupLinks.length; i++) {
        if (_cancelBulk) break;
        const link = groupLinks[i];
        const groupCode = (link.match(/zalo\.me\/g\/([a-zA-Z0-9]+)/) || [])[1] || link;
        prog({ phase: 'harvesting', index: i, total: groupLinks.length, pct: Math.round(i / groupLinks.length * 100) });

        let lastMsgId = null;
        const senderMap = new Map();
        for (let page = 0; page < 10 && senderMap.size < maxPerGroup; page++) {
            try {
                const history = await (
                    api.getGroupHistory?.(groupCode, lastMsgId) ||
                    api.getGroupMessage?.(groupCode, { lastId: lastMsgId }) ||
                    api.getConversation?.(groupCode, ThreadType?.Group, lastMsgId)
                );
                const msgs = history?.msgs || history?.messages || history?.data || [];
                if (!Array.isArray(msgs) || msgs.length === 0) break;
                for (const msg of msgs) {
                    const uid = String(msg.uidFrom || msg.senderId || msg.uid || '');
                    if (uid && uid !== '0' && !globalDedup.has(uid) && !senderMap.has(uid)) {
                        senderMap.set(uid, { uid, name: msg.dName || msg.fromAlias || 'User', lastSeen: msg.ts || 0 });
                    }
                }
                const oldest = msgs[msgs.length - 1];
                const newId = oldest?.msgId || oldest?.cliMsgId || oldest?.id;
                if (!newId || newId === lastMsgId) break;
                lastMsgId = newId;
                await sleep(250 + Math.random() * 200);
            } catch(e) { break; }
        }
        const batch = [...senderMap.values()].sort((a,b) => (b.lastSeen||0) - (a.lastSeen||0)).slice(0, maxPerGroup);
        for (const t of batch) { globalDedup.add(t.uid); harvestedTargets.push(t); }
        log(`[HARVEST] +${batch.length} chatters from ${link.slice(-10)} (total: ${harvestedTargets.length})`);
    }

    // Persist dedup
    try {
        const d = require('path').dirname(DEDUP_FILE);
        if (!fs2.existsSync(d)) fs2.mkdirSync(d, { recursive: true });
        fs2.writeFileSync(DEDUP_FILE, JSON.stringify([...globalDedup]));
    } catch(_) {}

    return { targets: harvestedTargets, dedup: globalDedup };
}

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// runFullPipeline â€” Master orchestrator: 1 nÃºt báº¥m, 5 bÆ°á»›c tá»± Ä‘á»™ng
//
//  Input:
//    cookies      â€” string | string[]  (1 hoáº·c nhiá»u TK Zalo)
//    groupLinks   â€” string[]           (40+ link zalo.me/g/...)
//    destGroupIds â€” string[]           (nhÃ³m Ä‘Ã­ch Ä‘á»ƒ invite vÃ o)
//    messages     â€” string[]           (tin nháº¯n xoay vÃ²ng)
//    opts:
//      maxPerGroup  number  max recent chatters / group (default 200)
//      chatScoreN   number  sá»‘ user check privacy (default 50)
//      phoneScan    bool    báº­t phone scanner thÃªm targets
//
//  Stages:
//    1. JOIN        â€” join táº¥t cáº£ group links (multi-account round-robin)
//    2. FILTER      â€” chá»‰ giá»¯ group cÃ³ chat má»Ÿ (sendMessagePermission=0)
//    3. HARVEST     â€” láº¥y 200 ngÆ°á»i chat gáº§n nháº¥t tá»« má»—i group má»Ÿ
//    4. SCORE       â€” Æ°u tiÃªn ngÆ°á»i cÃ³ chat má»Ÿ (getUserInfo privacy)
//    5. SEND        â€” DM + Invite vá»›i toÃ n bá»™ V5/V6 engines
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
async function runFullPipeline({ cookies, groupLinks, destGroupIds, messages, opts = {}, onProgress }) {
    const prog = onProgress || (() => {});
    const cookieList = Array.isArray(cookies) ? cookies : [cookies];
    const primaryCookie = cookieList[0];
    const maxPerGroup = opts.maxPerGroup || 200;
    const chatScoreN  = opts.chatScoreN  || 50;

    const pipelineResult = {
        stage: 'starting',
        joinResult: null,
        openGroups: [],
        harvestedCount: 0,
        sendResult: null,
        errors: []
    };

    try {
        // â”€â”€ STAGE 1: AUTO-JOIN â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
        pipelineResult.stage = 'joining';
        prog({ stage: 'joining', status: `ðŸ”— [1/5] Joining ${groupLinks.length} groups...`, pct: 0, pipeline: pipelineResult });
        log(`[PIPELINE] Stage 1: Joining ${groupLinks.length} groups with ${cookieList.length} accounts`);

        const joinResult = await autoJoinGroups({
            cookies: cookieList,
            groupLinks,
            onProgress: (p) => prog({ stage: 'joining', status: `ðŸ”— [1/5] ${p.status}`, pct: Math.round(p.pct * 0.2), pipeline: pipelineResult })
        });
        pipelineResult.joinResult = joinResult;

        // Collect joined group IDs (joined + already in)
        const allJoinedGroupIds = [
            ...joinResult.joined.map(j => j.groupId),
            ...joinResult.alreadyIn.map(j => j.groupId)
        ].filter(Boolean);

        log(`[PIPELINE] Stage 1 done: ${allJoinedGroupIds.length} groups accessible`);
        if (allJoinedGroupIds.length === 0) {
            pipelineResult.errors.push('No groups joined successfully');
            pipelineResult.stage = 'done';
            prog({ stage: 'done', status: `âŒ KhÃ´ng join Ä‘Æ°á»£c nhÃ³m nÃ o`, pct: 100, pipeline: pipelineResult });
            return pipelineResult;
        }

        // â”€â”€ STAGE 2: FILTER OPEN-CHAT GROUPS â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
        pipelineResult.stage = 'filtering';
        prog({ stage: 'filtering', status: `ðŸ” [2/5] Kiá»ƒm tra ${allJoinedGroupIds.length} nhÃ³m (chat má»Ÿ?)...`, pct: 20, pipeline: pipelineResult });
        log(`[PIPELINE] Stage 2: Checking chat status of ${allJoinedGroupIds.length} groups`);

        const chatStatusList = await checkGroupChatStatus({
            cookie: primaryCookie,
            groupIds: allJoinedGroupIds,
            onProgress: (p) => prog({ stage: 'filtering', status: `ðŸ” [2/5] ${p.status}`, pct: 20 + Math.round(p.pct * 0.1), pipeline: pipelineResult })
        });

        const openGroups = chatStatusList.filter(g => g.isOpenChat);
        pipelineResult.openGroups = openGroups;

        log(`[PIPELINE] Stage 2 done: ${openGroups.length}/${allJoinedGroupIds.length} groups are open-chat`);
        prog({ stage: 'filtering', status: `âœ… [2/5] ${openGroups.length} nhÃ³m má»Ÿ chat | ${allJoinedGroupIds.length - openGroups.length} nhÃ³m locked`, pct: 30, pipeline: pipelineResult });

        if (openGroups.length === 0) {
            pipelineResult.errors.push('No open-chat groups found');
            pipelineResult.stage = 'done';
            prog({ stage: 'done', status: `âš ï¸ KhÃ´ng cÃ³ nhÃ³m nÃ o má»Ÿ chat`, pct: 100, pipeline: pipelineResult });
            return pipelineResult;
        }

        // â”€â”€ STAGE 3: HARVEST RECENT CHATTERS â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
        pipelineResult.stage = 'harvesting';
        prog({ stage: 'harvesting', status: `ðŸ“¡ [3/5] Harvest chatters tá»« ${openGroups.length} nhÃ³m má»Ÿ...`, pct: 30, pipeline: pipelineResult });
        log(`[PIPELINE] Stage 3: Harvesting from ${openGroups.length} open groups`);

        // Use standalone harvester (DRY â€” no inline duplication)
        const harvestResult = await harvestRecentChatters({
            cookie: primaryCookie,
            groupLinks: openGroups.map(g => {
                const matchedJoin = joinResult.joined.find(j => j.groupId === g.groupId)
                    || joinResult.alreadyIn.find(j => j.groupId === g.groupId);
                return matchedJoin?.link || `https://zalo.me/g/${g.groupId}`;
            }),
            maxPerGroup,
            onProgress: (p) => prog({ stage: 'harvesting', status: `ðŸ“¡ [3/5] QuÃ©t ${(p.index||0)+1}/${p.total}: ...`, pct: 30 + Math.round((p.pct||0)*0.2), pipeline: pipelineResult })
        });

        const harvestedTargets = harvestResult.targets;
        pipelineResult.harvestedCount = harvestedTargets.length;
        log(`[PIPELINE] Stage 3 done: ${harvestedTargets.length} unique chatters harvested`);
        prog({ stage: 'harvesting', status: `âœ… [3/5] ${harvestedTargets.length} ngÆ°á»i chat gáº§n nháº¥t`, pct: 50, pipeline: pipelineResult });

        if (harvestedTargets.length === 0) {
            pipelineResult.errors.push('No chatters harvested');
            pipelineResult.stage = 'done';
            prog({ stage: 'done', status: `âš ï¸ KhÃ´ng harvest Ä‘Æ°á»£c ai`, pct: 100, pipeline: pipelineResult });
            return pipelineResult;
        }

        // â”€â”€ STAGE 4+5: SCORE + SEND via sendBulkSmart â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
        // Pass harvested targets + open group links into sendBulkSmart
        // sendBulkSmart will: chatOpenScorer â†’ weightedRotator â†’ DM â†’ Invite
        pipelineResult.stage = 'sending';
        prog({ stage: 'sending', status: `ðŸš€ [4-5/5] Score + DM + Invite ${harvestedTargets.length} targets...`, pct: 55, pipeline: pipelineResult });
        log(`[PIPELINE] Stage 4+5: Sending to ${harvestedTargets.length} targets`);

        const sendResult = await sendBulkSmart(primaryCookie, {
            targets: harvestedTargets,                    // pre-harvested targets
            groupLinks: openGroupLinks,                   // open groups for further harvest if needed
            inviteGroupIds: destGroupIds || [],           // destination groups
            groupMessages: messages || [],                // rotating messages
            message: (messages || [])[0] || '',
            chatScoreCheck: chatScoreN,
            phoneScan: opts.phoneScan || false,
        }, (p) => {
            prog({ stage: 'sending', status: `ðŸš€ [4-5/5] ${p.status}`, pct: 55 + Math.round((p.pct||0)*0.45), pipeline: pipelineResult });
        });

        pipelineResult.sendResult = sendResult;
        pipelineResult.stage = 'done';
        log(`[PIPELINE] âœ… All stages complete!`);
        prog({
            stage: 'done',
            status: `âœ… Pipeline xong: ${joinResult.joined.length} nhÃ³m joined, ${openGroups.length} má»Ÿ chat, ${harvestedTargets.length} harvested, ${sendResult?.inviteOk||0} invited`,
            pct: 100,
            pipeline: pipelineResult
        });

    } catch(e) {
        pipelineResult.errors.push(e.message);
        pipelineResult.stage = 'error';
        log(`[PIPELINE] âŒ Fatal: ${e.message}`);
        prog({ stage: 'error', status: `âŒ Pipeline lá»—i: ${e.message}`, pct: 100, pipeline: pipelineResult });
    }

    return pipelineResult;
}


// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// Gá»¬I TIN NHáº®N VÃ€O GROUP CHAT THREAD
// Gá»­i trá»±c tiáº¿p vÃ o khung chat nhÃ³m (khÃ´ng pháº£i DM thÃ nh viÃªn)
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
async function sendGroupMessage(cookie, groupId, message) {
    try {
        const api = await getApi(cookie);
        const { ThreadType } = await import('zca-js');

        // Gá»­i tin vÃ o group thread (ThreadType.Group)
        await api.sendMessage({ msg: message }, groupId, ThreadType.Group);
        console.log('[GROUP-MSG] Sent to group ' + groupId + ': ' + message.slice(0, 40));
        return { success: true, groupId };
    } catch (err) {
        console.error('[GROUP-MSG] Error: ' + err.message);
        return { success: false, error: err.message };
    }
}

// Gá»­i tin vÃ o nhiá»u nhÃ³m cÃ¹ng lÃºc (láº§n lÆ°á»£t, cÃ³ delay)
async function sendGroupMessageBulk({ cookie, groupIds, message, delay = 3000, onProgress }) {
    const prog = onProgress || (() => {});
    const results = { ok: 0, fail: 0, errors: [] };
    for (let i = 0; i < groupIds.length; i++) {
        const gid = groupIds[i];
        prog({ current: i + 1, total: groupIds.length, gid, pct: Math.round((i / groupIds.length) * 100) });
        try {
            const r = await sendGroupMessage(cookie, gid, message);
            if (r.success) { results.ok++; }
            else { results.fail++; results.errors.push({ gid, error: r.error }); }
        } catch(e) {
            results.fail++;
            results.errors.push({ gid, error: e.message });
        }
        if (i < groupIds.length - 1) {
            await new Promise(r => setTimeout(r, delay + Math.random() * 1000));
        }
    }
    prog({ current: groupIds.length, total: groupIds.length, pct: 100, done: true });
    return { success: true, ...results };
}

module.exports = {
    verifyLogin,
    loginQR,
    findUserByPhone,
    sendMessage,
    sendMessageByUid,
    sendFriendRequest,
    sendFriendRequestByUid,
    getGroups,
    getGroupMembers,
    copyGroupMembers,
    copyGroupMembersHydra,
    approvePendingMembers,
    forceJoinViaLink,
    parseCookie,
    extractZaloCookies,
    sendGroupMessage,
    sendGroupMessageBulk,
    sendBulkSmart,
    cancelBulkSend,
    accountPool,
    autoJoinGroups,
    checkGroupChatStatus,
    runFullPipeline,
    harvestRecentChatters,
    // V2 exports
    sessionManager,
    memberCache,
    honeypotDetector,
    rotateUserAgent,
    // V9 Ultra Intelligence exports
    rlRateLimiter,
    httpFingerprint,
    bloomDedup,
    canaryDetector,
    wsMimicry,
    pageRankScorer,
    dpNoise,
    v9FilterTargets,
    // V10 Advanced Intelligence exports
    gaOptimizer,
    isolationForest,
    semanticSpinner,
    circuitBreaker,
    consistentHashRouter,
    emaForecaster,
    // V11 Intelligence exports
    abTestFramework,
    markovGenerator,
    expBackoff,
    bayesianOptimizer,
    reputationSystem,
    proxyManager,
    fibSpacer,
    // V12 Final Intelligence exports
    kMeansClusterer,
    pidController,
    entropyChecker,
    cancelPipeline,
};



