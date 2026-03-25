const { app, BrowserWindow, Tray, Menu, ipcMain, nativeImage, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const zaloApi = require('./zalo-api');


// â”€â”€â”€ Keep refs alive â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
let mainWindow = null;
let tray = null;
let isQuiting = false;

// â”€â”€â”€ Store (simple JSON) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const dataPath = path.join(app.getPath('userData'), 'data.json');
function readData() {
    try { if (fs.existsSync(dataPath)) return JSON.parse(fs.readFileSync(dataPath, 'utf8')); } catch { }
    return {};
}
// Bug4 fix: write queue trÃ¡nh race condition khi nhiá»u IPC ghi cÃ¹ng lÃºc
let _writeQueue = Promise.resolve();
function writeData(obj) {
    _writeQueue = _writeQueue.then(() => {
        try { fs.writeFileSync(dataPath, JSON.stringify(obj, null, 2)); } catch { }
    });
    return _writeQueue;
}

// â”€â”€â”€ Create Window â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1180,
        height: 760,
        minWidth: 900,
        minHeight: 600,
        frame: false,          // frameless â€“ we draw our own title bar
        transparent: false,
        backgroundColor: '#f2f4f8',
        titleBarStyle: 'hidden',
        icon: path.join(__dirname, 'assets', 'icon.png'),
        show: false,
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false,
        },
    });

    mainWindow.loadFile('renderer/index.html');

    // Show when ready (prevents white flash)
    mainWindow.once('ready-to-show', () => {
        mainWindow.show();
        // DevTools only via --dev flag (see L75-77)
    });


    // Hide instead of close (run in background)
    mainWindow.on('close', (e) => {
        if (!isQuiting) {
            e.preventDefault();
            mainWindow.hide();
            // displayBalloon only works on Windows
            if (process.platform === 'win32' && tray.displayBalloon) {
                try {
                    tray.displayBalloon({
                        title: 'Zalo Bulk Tool Pro',
                        content: 'á»¨ng dá»¥ng Ä‘ang cháº¡y ngáº§m. Nháº¥p vÃ o biá»ƒu tÆ°á»£ng khay Ä‘á»ƒ má»Ÿ láº¡i.',
                        iconType: 'none',
                    });
                } catch (_) { }
            }
        }
    });

    // Open external links in browser
    mainWindow.webContents.setWindowOpenHandler(({ url }) => {
        shell.openExternal(url);
        return { action: 'deny' };
    });

    if (process.argv.includes('--dev')) {
        mainWindow.webContents.openDevTools({ mode: 'detach' });
    }
}

// â”€â”€â”€ Tray Setup â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function createTray() {
    const iconPath = path.join(__dirname, 'assets', 'tray.png');
    const icon = fs.existsSync(iconPath) ? nativeImage.createFromPath(iconPath) : nativeImage.createEmpty();

    tray = new Tray(icon.resize({ width: 16, height: 16 }));
    tray.setToolTip('Zalo Bulk Tool Pro');

    const contextMenu = Menu.buildFromTemplate([
        {
            label: 'ðŸ“± Má»Ÿ Zalo Bulk Tool',
            click: () => { mainWindow.show(); mainWindow.focus(); },
        },
        { type: 'separator' },
        {
            label: 'ðŸ“¤ Gá»­i tin hÃ ng loáº¡t',
            click: () => { mainWindow.show(); mainWindow.webContents.send('navigate', 'bulk-send'); },
        },
        {
            label: 'ðŸ‘¥ Tá»± Ä‘á»™ng káº¿t báº¡n',
            click: () => { mainWindow.show(); mainWindow.webContents.send('navigate', 'auto-friend'); },
        },
        { type: 'separator' },
        {
            label: 'âŒ ThoÃ¡t',
            click: () => { isQuiting = true; app.quit(); },
        },
    ]);

    tray.setContextMenu(contextMenu);
    tray.on('click', () => {
        if (mainWindow.isVisible()) {
            mainWindow.focus();
        } else {
            mainWindow.show();
        }
    });
    tray.on('double-click', () => { mainWindow.show(); mainWindow.focus(); });
}

// â”€â”€â”€ App ready â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
app.whenReady().then(() => {
    // Create assets dir if not exists
    const assetsDir = path.join(__dirname, 'assets');
    if (!fs.existsSync(assetsDir)) fs.mkdirSync(assetsDir);

    // Generate a simple PNG icon if none exists
    generateDefaultIcon(assetsDir);

    createWindow();
    createTray();

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        // Don't quit â€“ just hide 
    }
});

app.on('before-quit', () => { isQuiting = true; });

// â”€â”€â”€ IPC Handlers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
ipcMain.handle('app:minimize', () => mainWindow.minimize());
ipcMain.handle('app:maximize', () => {
    if (mainWindow.isMaximized()) mainWindow.unmaximize();
    else mainWindow.maximize();
});
ipcMain.handle('app:close', () => mainWindow.close());
ipcMain.handle('app:hide', () => mainWindow.hide());

ipcMain.handle('store:get', (_e, key) => readData()[key]);
ipcMain.handle('store:set', (_e, key, value) => {
    const data = readData();
    data[key] = value;
    writeData(data);
});
ipcMain.handle('store:getAll', () => readData());

// â”€â”€â”€ Zalo API IPC Handlers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
ipcMain.handle('zalo:verify', async (_e, cookie) => {
    try { return await zaloApi.verifyLogin(cookie); }
    catch (err) { return { success: false, error: err.message }; }
});

ipcMain.handle('zalo:getGroups', async (_e, cookie) => {
    try {
        console.log('[GROUPS] Loading groups...');
        const result = await zaloApi.getGroups(cookie);
        console.log('[GROUPS] Result:', result.success, 'count:', result.groups?.length, result.error || '');
        return result;
    } catch (err) {
        console.error('[GROUPS] Error:', err.message);
        return { success: false, groups: [], error: err.message };
    }
});

ipcMain.handle('zalo:sendMessage', async (_e, cookie, phone, message) => {
    try {
        console.log('[SEND] calling sendMessage for', phone);
        const result = await zaloApi.sendMessage(cookie, phone, message);
        console.log('[SEND] result: success=', result.success);
        return result;
    } catch (err) {
        console.error('[SEND] EXCEPTION:', err.message, err.stack?.slice(0, 300));
        return { success: false, error: err.message };
    }
});

ipcMain.handle('zalo:sendFriendRequest', async (_e, cookie, phone, msg) => {
    try { return await zaloApi.sendFriendRequest(cookie, phone, msg); }
    catch (err) { return { success: false, error: err.message }; }
});

ipcMain.handle('zalo:loginQR', async () => {
    try {
        const qrPath = path.join(app.getPath('temp'), 'zalo_qr.png');
        // Start QR login async (don't await - it blocks until user scans)
        zaloApi.loginQR(qrPath, (imgPath, event) => {
            try {
                // zca-js v2: QR lÃ  base64 PNG trong event.data.image
                const imgBase64 = event?.data?.image;
                const qrUrl = event?.data?.qrUrl;
                console.log('[QR] data keys:', Object.keys(event?.data || {}));

                if (imgBase64) {
                    // Raw base64 PNG â†’ thÃªm data URI prefix
                    const dataUrl = imgBase64.startsWith('data:')
                        ? imgBase64
                        : `data:image/png;base64,${imgBase64}`;
                    console.log('[QR] Sending image base64, length:', imgBase64.length);
                    mainWindow.webContents.send('zalo:qrReady', dataUrl);
                } else if (qrUrl) {
                    if (!qrUrl.startsWith('data:') && (qrUrl.startsWith('http://') || qrUrl.startsWith('https://'))) {
                        const fetcher = qrUrl.startsWith('https') ? require('https') : require('http');
                        fetcher.get(qrUrl, (res) => {
                            const chunks = [];
                            res.on('data', c => chunks.push(c));
                            res.on('end', () => {
                                const b64 = Buffer.concat(chunks).toString('base64');
                                mainWindow.webContents.send('zalo:qrReady', `data:image/png;base64,${b64}`);
                            });
                        }).on('error', e => console.error('[QR] fetch error:', e.message));
                    } else {
                        mainWindow.webContents.send('zalo:qrReady', qrUrl);
                    }
                } else if (fs.existsSync(imgPath)) {
                    const b64 = fs.readFileSync(imgPath).toString('base64');
                    mainWindow.webContents.send('zalo:qrReady', `data:image/png;base64,${b64}`);
                } else {
                    console.error('[QR] KhÃ´ng cÃ³ image/qrUrl vÃ  file khÃ´ng tá»“n táº¡i');
                    mainWindow.webContents.send('zalo:loginError', 'KhÃ´ng láº¥y Ä‘Æ°á»£c QR tá»« zca-js');
                }
            } catch (e) {
                console.error('[QR] Error:', e.message);
            }

        }).then(async () => {
            try {
                // Láº¥y cookie tháº­t sau QR scan
                // getCookies khÃ´ng tá»“n táº¡i â€” láº¥y cookie tá»« lastQRCookie Ä‘Æ°á»£c lÆ°u bá»Ÿi loginQR
                const cookieData = zaloApi.lastQRCookie || (zaloApi.getCookies ? zaloApi.getCookies() : null);
                const cookieStr = cookieData
                    ? (typeof cookieData === 'string' ? cookieData : JSON.stringify(cookieData))
                    : null;

                let uid = '', name = 'Tài khoản Zalo (QR)';
                if (cookieStr && cookieStr !== 'null') {
                    try {
                        const info = await zaloApi.getUserInfo(cookieStr);
                        if (info && info.uid) { uid = String(info.uid); name = info.name || info.displayName || name; }
                    } catch (_) {}
                }
                // FIX: Luôn lưu loggedIn + connectedAccount dù cookie null (QR session cached)
                const store = readData();
                if (cookieStr && cookieStr !== 'null') store.cookie = cookieStr;
                store.loggedIn = true;
                store.connectedAccount = { uid, name, ts: Date.now() };
                writeData(store);


                mainWindow.webContents.send('zalo:loginSuccess', {
                    success: true,
                    cookie: cookieStr || null, // KhÃ´ng gá»­i 'QR_SESSION' string â€” renderer sáº½ check null
                    uid,
                    name
                });
            } catch (e) {
                console.error('[QR] post-login:', e.message);
                mainWindow.webContents.send('zalo:loginSuccess', { success: true });
            }
        }).catch(err => {
            console.error('[QR] login failed:', err.message);
            mainWindow.webContents.send('zalo:loginError', err.message);
        });
        return { success: true, message: 'Äang táº¡o mÃ£ QR...' };
    } catch (err) {
        return { success: false, error: err.message };
    }
});

ipcMain.handle('zalo:findUser', async (_e, cookie, phone) => {
    try { return await zaloApi.findUserByPhone(cookie, phone); }
    catch (err) { return { success: false, error: err.message }; }
});

ipcMain.handle('zalo:getGroupMembers', async (_e, cookie, groupId) => {
    try { return await zaloApi.getGroupMembers(cookie, groupId); }
    catch (err) { return { success: false, error: err.message }; }
});

ipcMain.handle('zalo:sendMessageByUid', async (_e, cookie, uid, message) => {
    try {
        const r = await zaloApi.sendMessageByUid(cookie, uid, message);
        console.log(`[SEND_UID] uid=${uid} success=${r.success}`);
        return r;
    } catch (err) {
        return { success: false, uid, error: err.message };
    }
});

ipcMain.handle('zalo:sendBulkSmart', async (_e, cookie, params) => {
    try {
        console.log(`[BULK_SMART] inputType=${params.inputType} targets=${params.phones?.length || params.groupId} inviteGroupIds=${JSON.stringify(params.inviteGroupIds || 'none')}`);
        const result = await zaloApi.sendBulkSmart(cookie, params, (progress) => {
            try { mainWindow?.webContents?.send('zalo:bulkSmartProgress', progress); } catch (_) {}
        });
        return result;
    } catch (err) {
        return { success: false, error: err.message };
    }
});

// Cancel bulk send
ipcMain.handle('zalo:cancelBulkSend', async () => {
    zaloApi.cancelBulkSend();
    return { success: true };
});


// â”€â”€ Full Pipeline (1 click) â”€â”€
ipcMain.handle('zalo:runFullPipeline', async (_e, params) => {
    try {
        return await zaloApi.runFullPipeline({
            ...params,
            onProgress: (p) => {
                if (mainWindow && !mainWindow.isDestroyed())
                    mainWindow.webContents.send('pipeline-progress', p);
            }
        });
    } catch(e) {
        return { stage: 'error', errors: [e.message] };
    }
});

ipcMain.handle('zalo:cancelPipeline', async () => {
    // Bug6 fix: cancel cáº£ bulkSend láº«n pipeline
    zaloApi.cancelBulkSend();
    if (typeof zaloApi.cancelPipeline === 'function') zaloApi.cancelPipeline();
    return { success: true };
});

// â”€â”€ Auto-Join Groups â”€â”€
ipcMain.handle('zalo:autoJoinGroups', async (_e, cookies, groupLinks) => {
    try {
        return await zaloApi.autoJoinGroups({
            cookies,
            groupLinks,
            onProgress: (p) => {
                if (mainWindow && !mainWindow.isDestroyed())
                    mainWindow.webContents.send('autoJoin-progress', p);
            }
        });
    } catch(e) {
        return { error: e.message, joined: [], failed: groupLinks.map(l => ({ link: l, reason: e.message })), alreadyIn: [] };
    }
});

// â”€â”€ Check Group Chat Status â”€â”€
ipcMain.handle('zalo:checkGroupChatStatus', async (_e, cookie, groupIds) => {
    try {
        return await zaloApi.checkGroupChatStatus({
            cookie,
            groupIds,
            onProgress: (p) => {
                if (mainWindow && !mainWindow.isDestroyed())
                    mainWindow.webContents.send('chat-status-progress', p);
            }
        });
    } catch(e) {
        return { error: e.message, statusList: [] };
    }
});


ipcMain.handle('zalo:accountPool:add', async (_e, cookie, name, uid) => {
    zaloApi.accountPool.add(cookie, name, uid);
    console.log(`[POOL] Added account: ${name} (${uid}), total: ${zaloApi.accountPool.size()}`);
    return { success: true, total: zaloApi.accountPool.size() };
});

ipcMain.handle('zalo:accountPool:getAll', async () => {
    return zaloApi.accountPool.getAll();
});

ipcMain.handle('zalo:accountPool:remove', async (_e, uid) => {
    zaloApi.accountPool.remove(uid);
    return { success: true, total: zaloApi.accountPool.size() };
});

ipcMain.handle('zalo:accountPool:setGroupMapping', async (_e, uid, sourceGroupId, destGroupIds) => {
    zaloApi.accountPool.setGroupMapping(uid, sourceGroupId, destGroupIds);
    return { success: true };
});

ipcMain.handle('zalo:getGroupsForAccount', async (_e, cookie) => {
    try {
        const result = await zaloApi.getGroups(cookie);
        return result;
    } catch (err) {
        return { success: false, groups: [], error: err.message };
    }
});

ipcMain.handle('zalo:copyGroupMembers', async (_e, cookie, srcId, tgtId, opts = {}) => {
    try {
        console.log(`[COPY_MEMBERS] src=${srcId} â†’ tgt=${tgtId || 'new'} opts=`, JSON.stringify(opts));
        const result = await zaloApi.copyGroupMembers(cookie, srcId, tgtId, {
            ...opts,
            onProgress: (done, total) => {
                // Gá»­i progress vá» renderer qua webContents
                try { mainWindow?.webContents?.send('zalo:copyProgress', { done, total }); } catch (_) { }
            },
        });
        console.log('[COPY_MEMBERS] Done:', JSON.stringify(result));
        return result;
    } catch (err) {
        console.error('[COPY_MEMBERS] Error:', err.message);
        return { success: false, error: err.message };
    }
});

ipcMain.handle('zalo:approvePending', async (_e, cookie, groupId) => {
    try {
        console.log(`[APPROVE_PENDING] groupId=${groupId}`);
        const result = await zaloApi.approvePendingMembers(cookie, groupId);
        console.log('[APPROVE_PENDING] Done:', JSON.stringify(result));
        return result;
    } catch (err) {
        console.error('[APPROVE_PENDING] Error:', err.message);
        return { success: false, error: err.message };
    }
});

ipcMain.handle('zalo:forceJoinViaLink', async (_e, cookie, groupId, uids, opts = {}) => {
    try {
        console.log(`[FORCE_JOIN_LINK] groupId=${groupId} uids=${uids?.length}`);
        const result = await zaloApi.forceJoinViaLink(cookie, groupId, uids, {
            ...opts,
            onProgress: (done, total) => {
                try { mainWindow?.webContents?.send('zalo:copyProgress', { done, total }); } catch (_) { }
            },
        });
        console.log('[FORCE_JOIN_LINK] Done:', JSON.stringify(result));
        return result;
    } catch (err) {
        console.error('[FORCE_JOIN_LINK] Error:', err.message);
        return { success: false, error: err.message };
    }
});

// â”€â”€ HYDRA: 7-layer ultra bypass ï¿½ 100% member copy â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
ipcMain.handle('zalo:copyHydra', async (_e, cookie, srcId, tgtId, opts = {}) => {
    try {
        console.log(`[HYDRA] src=${srcId} â†’ tgt=${tgtId || 'new'} opts=`, JSON.stringify(opts));
        const result = await zaloApi.copyGroupMembersHydra(cookie, srcId, tgtId, {
            ...opts,
            onProgress: (done, total) => {
                try { mainWindow?.webContents?.send('zalo:copyProgress', { done, total }); } catch (_) { }
            },
            onLog: (msg) => {
                try { mainWindow?.webContents?.send('zalo:hydraLog', msg); } catch (_) { }
            },
        });
        console.log('[HYDRA] Done:', JSON.stringify(result));
        return result;
    } catch (err) {
        console.error('[HYDRA] Error:', err.message);
        return { success: false, error: err.message };
    }
});


// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// V2 IPC HANDLERS ï¿½ Session Manager, Pool Health, Cache, Honeypot
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
ipcMain.handle('zalo:v2:getIncompleteSessions', async () => {
    try { return zaloApi.sessionManager.getIncomplete(); }
    catch (e) { return []; }
});

ipcMain.handle('zalo:v2:resumeSession', async (_e, sessionId, cookie) => {
    try {
        const session = zaloApi.sessionManager.getSession(sessionId);
        if (!session) return { success: false, error: 'Session not found' };
        // Resume by calling sendBulkSmart with the remaining targets
        const remainingTargets = session.targets.slice(session.cursor);
        if (remainingTargets.length === 0) return { success: true, message: 'Session already complete' };
        console.log(`[V2] Resuming session ${sessionId} from cursor ${session.cursor} (${remainingTargets.length} remaining)`);

        const result = await zaloApi.sendBulkSmart(cookie, {
            ...session.params,
            inputType: 'uids',
            uids: remainingTargets.map(t => t.uid),
        }, (data) => {
            try { mainWindow?.webContents?.send('zalo:bulkSmartProgress', data); } catch (_) {}
        });
        return result;
    } catch (e) {
        return { success: false, error: e.message };
    }
});

ipcMain.handle('zalo:v2:poolHealthCheck', async () => {
    try { return await zaloApi.accountPool.healthCheck(zaloApi.verifyLogin ? async (c) => { const r = await zaloApi.verifyLogin(c); return r; } : null); }
    catch (e) { return { error: e.message }; }
});

ipcMain.handle('zalo:v2:clearMemberCache', async () => {
    try { zaloApi.memberCache.clear(); return { success: true }; }
    catch (e) { return { success: false, error: e.message }; }
});

ipcMain.handle('zalo:v2:getHoneypotBlacklist', async () => {
    try { return [...zaloApi.honeypotDetector._blacklist]; }
    catch (e) { return []; }
});



// â”€â”€â”€ Generate Default Icon (16x16 purple "Z") â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function generateDefaultIcon(dir) {
    // Write a tiny 1x1 PNG as placeholder if icon.png doesn't exist
    const iconPath = path.join(dir, 'icon.png');
    const trayPath = path.join(dir, 'tray.png');
    // 1x1 transparent PNG bytes
    const tiny = Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
        'base64'
    );
    if (!fs.existsSync(iconPath)) fs.writeFileSync(iconPath, tiny);
    if (!fs.existsSync(trayPath)) fs.writeFileSync(trayPath, tiny);
}

// Gá»­i tin vÃ o group chat thread
ipcMain.handle('zalo:sendGroupMessage', async (_e, cookie, groupId, message) => {
    try {
        return await zaloApi.sendGroupMessage(cookie, groupId, message);
    } catch (err) {
        return { success: false, error: err.message };
    }
});

// Gá»­i tin vÃ o nhiá»u nhÃ³m
ipcMain.handle('zalo:sendGroupMessageBulk', async (_e, cookie, groupIds, message, delay) => {
    const win = BrowserWindow.getAllWindows()[0];
    return zaloApi.sendGroupMessageBulk({
        cookie, groupIds, message, delay: delay || 3000,
        onProgress: (data) => { if (win) win.webContents.send('zalo:groupMsgProgress', data); }
    });
});
