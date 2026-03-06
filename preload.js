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
        getGroups: (cookie) => ipcRenderer.invoke('zalo:getGroups', cookie),
        getGroupMembers: (cookie, groupId) => ipcRenderer.invoke('zalo:getGroupMembers', cookie, groupId),
        sendMessage: (cookie, phone, msg) => ipcRenderer.invoke('zalo:sendMessage', cookie, phone, msg),
        sendMessageByUid: (cookie, uid, msg) => ipcRenderer.invoke('zalo:sendMessageByUid', cookie, uid, msg),
        sendFriendRequest: (cookie, phone, msg) => ipcRenderer.invoke('zalo:sendFriendRequest', cookie, phone, msg),
        findUser: (cookie, phone) => ipcRenderer.invoke('zalo:findUser', cookie, phone),
        copyGroupMembers: (cookie, srcId, tgtId, opts) => ipcRenderer.invoke('zalo:copyGroupMembers', cookie, srcId, tgtId, opts),
        copyHydra: (cookie, srcId, tgtId, opts) => ipcRenderer.invoke('zalo:copyHydra', cookie, srcId, tgtId, opts),
        approvePending: (cookie, groupId) => ipcRenderer.invoke('zalo:approvePending', cookie, groupId),
        forceJoinViaLink: (cookie, groupId, uids, opts) => ipcRenderer.invoke('zalo:forceJoinViaLink', cookie, groupId, uids, opts),
    },



    // ── Events từ main process ───────────────────────
    onQRReady: (cb) => ipcRenderer.on('zalo:qrReady', (_e, dataUrl) => cb(dataUrl)),
    onLoginSuccess: (cb) => ipcRenderer.on('zalo:loginSuccess', (_e, data) => cb(data)),
    onLoginError: (cb) => ipcRenderer.on('zalo:loginError', (_e, msg) => cb(msg)),

    // ── Tray navigation events ───────────────────────
    onNavigate: (callback) => ipcRenderer.on('navigate', (_e, page) => callback(page)),
    onCopyProgress: (cb) => ipcRenderer.on('zalo:copyProgress', (_e, data) => cb(data)),
    onHydraLog: (cb) => ipcRenderer.on('zalo:hydraLog', (_e, msg) => cb(msg)),
});

