const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electron', {
    // ── Window controls ──────────────────────────────
    minimize: () => ipcRenderer.invoke('app:minimize'),
    maximize: () => ipcRenderer.invoke('app:maximize'),
    close: () => ipcRenderer.invoke('app:close'),
    hideToTray: () => ipcRenderer.invoke('app:hide'),

    // ── Persistent storage ───────────────────────────
    store: {
        get: (key) => ipcRenderer.invoke('store:get', key),
        set: (key, value) => ipcRenderer.invoke('store:set', key, value),
        getAll: () => ipcRenderer.invoke('store:getAll'),
    },

    // ── Real Zalo API ────────────────────────────────
    zalo: {
        verify: (cookie) => ipcRenderer.invoke('zalo:verify', cookie),
        loginQR: () => ipcRenderer.invoke('zalo:loginQR'),
        poolLoginQR: () => ipcRenderer.invoke('zalo:poolLoginQR'),
        getGroups: (cookie) => ipcRenderer.invoke('zalo:getGroups', cookie),
        getGroupMembers: (cookie, groupId) => ipcRenderer.invoke('zalo:getGroupMembers', cookie, groupId),
        sendMessage: (cookie, phone, msg) => ipcRenderer.invoke('zalo:sendMessage', cookie, phone, msg),
        sendGroupMessage: (cookie, groupId, message) => ipcRenderer.invoke('zalo:sendGroupMessage', cookie, groupId, message),
        sendGroupMessageBulk: (cookie, groupIds, message, delay) => ipcRenderer.invoke('zalo:sendGroupMessageBulk', cookie, groupIds, message, delay),
        sendMessageByUid: (cookie, uid, msg) => ipcRenderer.invoke('zalo:sendMessageByUid', cookie, uid, msg),
        sendFriendRequest: (cookie, phone, msg) => ipcRenderer.invoke('zalo:sendFriendRequest', cookie, phone, msg),
        sendFriendRequestByUid: (cookie, uid, msg) => ipcRenderer.invoke('zalo:sendFriendRequestByUid', cookie, uid, msg),
        findUser: (cookie, phone) => ipcRenderer.invoke('zalo:findUser', cookie, phone),
        copyGroupMembers: (cookie, srcId, tgtId, opts) => ipcRenderer.invoke('zalo:copyGroupMembers', cookie, srcId, tgtId, opts),
        copyHydra: (cookie, srcId, tgtId, opts) => ipcRenderer.invoke('zalo:copyHydra', cookie, srcId, tgtId, opts),
        approvePending: (cookie, groupId) => ipcRenderer.invoke('zalo:approvePending', cookie, groupId),
        forceJoinViaLink: (cookie, groupId, uids, opts) => ipcRenderer.invoke('zalo:forceJoinViaLink', cookie, groupId, uids, opts),
        sendBulkSmart: (cookie, params) => ipcRenderer.invoke('zalo:sendBulkSmart', cookie, params),
        cancelBulkSend: () => ipcRenderer.invoke('zalo:cancelBulkSend'),
        // ── Account Pool ──
        poolAdd: (cookie, name, uid) => ipcRenderer.invoke('zalo:accountPool:add', cookie, name, uid),
        poolGetAll: () => ipcRenderer.invoke('zalo:accountPool:getAll'),
        poolGetCookie: (uid) => ipcRenderer.invoke('zalo:accountPool:getCookie', uid),
        poolRemove: (uid) => ipcRenderer.invoke('zalo:accountPool:remove', uid),
        poolSetGroupMapping: (uid, sourceGroupId, destGroupIds) => ipcRenderer.invoke('zalo:accountPool:setGroupMapping', uid, sourceGroupId, destGroupIds),
        getGroupsForAccount: (cookie) => ipcRenderer.invoke('zalo:getGroupsForAccount', cookie),
        // ── V2: Session Manager ──
        getIncompleteSessions: () => ipcRenderer.invoke('zalo:v2:getIncompleteSessions'),
        resumeSession: (sessionId, cookie) => ipcRenderer.invoke('zalo:v2:resumeSession', sessionId, cookie),
        // ── V2: Pool Health Check ──
        poolHealthCheck: () => ipcRenderer.invoke('zalo:v2:poolHealthCheck'),
        // ── V2: Member Cache ──
        clearMemberCache: () => ipcRenderer.invoke('zalo:v2:clearMemberCache'),
        // ── V2: Honeypot ──
        getHoneypotBlacklist: () => ipcRenderer.invoke('zalo:v2:getHoneypotBlacklist'),
        // ── V7/V8: Pipeline ──
        autoJoinGroups: (cookies, groupLinks) => ipcRenderer.invoke('zalo:autoJoinGroups', cookies, groupLinks),
        scanGroupLinks: (cookies, links) => ipcRenderer.invoke('zalo:scanGroupLinks', cookies, links),
        checkGroupChatStatus: (cookie, groupIds) => ipcRenderer.invoke('zalo:checkGroupChatStatus', cookie, groupIds),
        runFullPipeline: (params) => ipcRenderer.invoke('zalo:runFullPipeline', params),
        cancelPipeline: () => ipcRenderer.invoke('zalo:cancelPipeline'),
    },

    // ── Events từ main process ───────────────────────
    // Bug10 fix: onLoginSuccess/Error dùng once() tránh memory leak
    onQRReady: (cb) => ipcRenderer.on('zalo:qrReady', (_e, dataUrl) => cb(dataUrl)),
    onLoginSuccess: (cb) => ipcRenderer.once('zalo:loginSuccess', (_e, data) => cb(data)),
    onLoginError: (cb) => ipcRenderer.once('zalo:loginError', (_e, msg) => cb(msg)),

    // ── Tray navigation events ───────────────────────
    onNavigate: (callback) => ipcRenderer.on('navigate', (_e, page) => callback(page)),
    onCopyProgress: (cb) => ipcRenderer.on('zalo:copyProgress', (_e, data) => cb(data)),
    onHydraLog: (cb) => ipcRenderer.on('zalo:hydraLog', (_e, msg) => cb(msg)),
    onBulkSmartProgress: (cb) => ipcRenderer.on('zalo:bulkSmartProgress', (_e, data) => cb(data)),
    // ── Pipeline events ──────────────────────────────
    onPipelineProgress: (cb) => ipcRenderer.on('pipeline-progress', (_e, data) => cb(data)),
    onAutoJoinProgress: (cb) => ipcRenderer.on('autoJoin-progress', (_e, data) => cb(data)),

    // ── Raw IPC passthrough (Bug13 fix: restricted allowlist) ──
    ipcRenderer: {
        invoke: (channel, ...args) => {
            const allowed = ['zalo:runFullPipeline', 'zalo:cancelPipeline', 'zalo:autoJoinGroups',
                'zalo:checkGroupChatStatus', 'zalo:accountPool:getAll', 'zalo:sendBulkSmart',
                'zalo:cancelBulkSend', 'store:get', 'store:getAll', 'store:set',
                'zalo:sendGroupMessage', 'zalo:sendGroupMessageBulk'];
            if (!allowed.includes(channel)) {
                console.warn('[SECURITY] Blocked raw invoke:', channel);
                return Promise.resolve({ error: 'Channel not allowed' });
            }
            return ipcRenderer.invoke(channel, ...args);
        },
        on: (channel, cb) => ipcRenderer.on(channel, cb),
    },
});

// ── electronAPI alias cho code mới (initSettingsV2, initPipelineSync, initPoolQR) ──
contextBridge.exposeInMainWorld('electronAPI', {
    invoke: (channel, ...args) => ipcRenderer.invoke(channel, ...args),
    on: (channel, cb) => ipcRenderer.on(channel, cb),
});
