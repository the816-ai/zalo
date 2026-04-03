const fs = require('fs');

let zaloApi = fs.readFileSync('d:/zalo app/zalo-api.js', 'utf8');
if (!zaloApi.includes('leaveGroup(')) {
    const fnCode = `
async function leaveGroup(cookie, groupId) {
    try {
        const api = await getApi(cookie);
        if (!api) return { success: false, error: 'Không tải được API' };
        
        // Use zca-js api to leave group: api.leaveGroup(groupId) is typical, or removeUserFromGroup.
        // I will just call api.leaveGroup(groupId)
        const result = await api.leaveGroup(groupId);
        return { success: true, result };
    } catch(err) {
        return { success: false, error: err.message || String(err) };
    }
}
`;
    zaloApi = zaloApi.replace('async function sendFriendRequestByUid', fnCode + '\nasync function sendFriendRequestByUid');
    zaloApi = zaloApi.replace('massSendGroupMsgs,', 'massSendGroupMsgs,\n    leaveGroup,');
    fs.writeFileSync('d:/zalo app/zalo-api.js', zaloApi);
    console.log('zalo-api patched');
} else {
    console.log('zalo-api already patched');
}

let main = fs.readFileSync('d:/zalo app/main.js', 'utf8');
if (!main.includes("handle('zalo:leaveGroup'")) {
    const mainCode = `
    ipcMain.handle('zalo:leaveGroup', async (event, { cookie, groupId }) => {
        return await zaloApi.leaveGroup(cookie, groupId);
    });
`;
    main = main.replace("ipcMain.handle('zalo:massSendGroupMsgs',", mainCode + "    ipcMain.handle('zalo:massSendGroupMsgs',");
    fs.writeFileSync('d:/zalo app/main.js', main);
    console.log('main patched');
} else {
    console.log('main already patched');
}

let preload = fs.readFileSync('d:/zalo app/preload.js', 'utf8');
if (!preload.includes('leaveGroup:')) {
    const preloadCode = `
        leaveGroup: (cookie, groupId) => ipcRenderer.invoke('zalo:leaveGroup', { cookie, groupId }),`;
    preload = preload.replace("massSendGroupMsgs:", preloadCode + "\n        massSendGroupMsgs:");
    fs.writeFileSync('d:/zalo app/preload.js', preload);
    console.log('preload patched');
} else {
    console.log('preload already patched');
}

process.exit(0);
