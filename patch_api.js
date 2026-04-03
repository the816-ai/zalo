const fs = require('fs');
let code = fs.readFileSync('d:/zalo app/zalo-api.js', 'utf8');

if (!code.includes('massSendGroupMsgs')) {
    const fnCode = `
async function massSendGroupMsgs(params) {
    try {
        const { cookie, groupId, content } = params;
        const api = await getApi(cookie);
        if (!api) return { success: false, error: 'Không tải được API' };

        await api.sendMessage({ msg: content, quote: null }, groupId, 1); // 1 = ThreadType.Group
        return { success: true };
    } catch(err) {
        return { success: false, error: err.message || String(err) };
    }
}
`;
    code = code.replace('async function sendFriendRequestByUid', fnCode + '\nasync function sendFriendRequestByUid');
    
    // Add to exports
    code = code.replace('sendMessageByUid,', 'sendMessageByUid,\n    massSendGroupMsgs,');
    fs.writeFileSync('d:/zalo app/zalo-api.js', code);
    console.log('Injected massSendGroupMsgs to zalo-api.js');
} else {
    console.log('Already exists in zalo-api.js');
}

// UPDATE main.js
let mainCode = fs.readFileSync('d:/zalo app/main.js', 'utf8');
if (!mainCode.includes("ipcMain.handle('zalo:massSendGroupMsgs'")) {
    const mainApiCode = `
    ipcMain.handle('zalo:massSendGroupMsgs', async (event, params) => {
        return await zaloApi.massSendGroupMsgs(params);
    });
`;
    // Find somewhere to insert. For example, before sendMessageByUid
    mainCode = mainCode.replace("ipcMain.handle('zalo:sendMessageByUid',", mainApiCode + "    ipcMain.handle('zalo:sendMessageByUid',");
    fs.writeFileSync('d:/zalo app/main.js', mainCode);
    console.log('Injected to main.js');
} else {
    console.log('Already exists in main.js');
}

// UPDATE preload.js
let preloadCode = fs.readFileSync('d:/zalo app/preload.js', 'utf8');
if (!preloadCode.includes('massSendGroupMsgs:')) {
    const preloadApiCode = `
        massSendGroupMsgs: (params) => ipcRenderer.invoke('zalo:massSendGroupMsgs', params),
`;
    preloadCode = preloadCode.replace("sendMessageByUid: (cookie, uid, message) => ipcRenderer.invoke('zalo:sendMessageByUid', { cookie, uid, message }),", 
                                       preloadApiCode + "        sendMessageByUid: (cookie, uid, message) => ipcRenderer.invoke('zalo:sendMessageByUid', { cookie, uid, message }),");
    fs.writeFileSync('d:/zalo app/preload.js', preloadCode);
    console.log('Injected to preload.js');
} else {
    console.log('Already exists in preload.js');
}

process.exit(0);
