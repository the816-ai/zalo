const fs = require('fs');

try {
    let code = fs.readFileSync('d:/zalo app/renderer/renderer.js', 'utf8');

    // Mẫu loadRealGroups cũ
    const loadRealGroupsRegex = /async function loadRealGroups\(\) \{[\s\S]*?catch \(e\) \{[\s\S]*?\}\s*\}/;

    const newLoadRealGroups = `async function loadRealGroups() {
    if (!S.loggedIn) return;
    log('info', '📋 Đang quét toàn bộ danh sách nhóm hệ sinh thái Zalo...', 'send');
    
    try {
        let allGroups = [];
        let seenIds = new Set();
        
        // Quét Nick Chính
        const mainCookie = S.cookie;
        const mainResult = await el.zalo.getGroups(mainCookie);
        if (mainResult && mainResult.success && mainResult.groups) {
            mainResult.groups.forEach(g => {
                if (!seenIds.has(g.id)) {
                    seenIds.add(g.id);
                    allGroups.push({ ...g, _belongToCookie: mainCookie, _belongToName: 'NICK CHÍNH' });
                }
            });
        }
        
        // Quét Account Pool (TK Phụ)
        const pool = (await el.store.get('settingsPool')) || [];
        for (let i = 0; i < pool.length; i++) {
            const tk = pool[i];
            if (tk.status === 'dead') continue;
            
            log('info', \`⏳ Quét nhóm của acc phụ: \${tk.name || '#' + (i+1)}\`, 'send');
            const res = await el.zalo.getGroups(tk.cookie);
            if (res && res.success && res.groups) {
                res.groups.forEach(g => {
                    if (!seenIds.has(g.id)) {
                        seenIds.add(g.id);
                        allGroups.push({ ...g, _belongToCookie: tk.cookie, _belongToName: tk.name || 'Acc Phụ' });
                    }
                });
            }
        }
        
        if (allGroups.length > 0) {
            S.groups = allGroups;
            renderGroups();
            log('success', \`📋 Càn quét thành công \${allGroups.length} nhóm từ mọi Nick!\`, 'send');
            toast(\`✅ Tải được \${allGroups.length} nhóm trên toàn hệ thống\`, 'success');
        } else {
            log('error', \`❌ Không có nhóm nào được tìm thấy trên mọi tài khoản\`, 'send');
        }
    } catch (e) {
        log('error', '❌ Lỗi hệ thống khi tải nhóm: ' + e.message, 'send');
    }
}`;

    if (loadRealGroupsRegex.test(code)) {
        code = code.replace(loadRealGroupsRegex, newLoadRealGroups);
        
        // Cập nhật renderGroups một chút để hiển thị tên nick sỡ hữu
        // Đoạn này: <div class="gc-name">${g.name}</div>
        // Sửa thành tên có Tag Nhóm
        // Do có thể khó match chính xác HTML template string, ta cẩn thận thay thế chuỗi nhỏ
        const gcNameRegex = /<div class="gc-name">\$\{(.*?)\}<\/div>/g;
        if (gcNameRegex.test(code)) {
            code = code.replace(gcNameRegex, \`<div class="gc-name">\${\\$1}</div>\n        <div style="font-size:10px;color:#10b981;margin-bottom:4px">👤 \${g._belongToName || 'Ẩn Danh'}</div>\`);
        }
        
        fs.writeFileSync('d:/zalo app/renderer/renderer.js', code);
        console.log('PATCHED loadRealGroups SUCCESSFULLY!');
    } else {
        console.error('NOT FOUND loadRealGroups');
    }
} catch(err) {
    console.error('Lỗi chạy patch:', err.message);
}
