const fs = require('fs');

try {
    let code = fs.readFileSync('d:/zalo app/zalo-api.js', 'utf8');
    const regex = /\/\/ Store api for subsequent calls\s+_api = api;\s+_cookieHash = 'QR_LOGIN';\s+return\s+\{\s*success:\s*true\s*\};/;
    
    const replacement = `    // Store api for subsequent calls
    _api = api;
    _cookieHash = 'QR_LOGIN';
    
    // Xuất Cookie lưu trữ vòng ngoài cho main.js thu hồi sau khi quét QR Phụ
    try {
        const cks = typeof api.getCookies === 'function' ? api.getCookies() : null;
        module.exports.lastQRCookie = typeof cks === 'string' ? cks : JSON.stringify(cks);
    } catch(e) {}
    
    return { success: true };`;

    if (regex.test(code)) {
        fs.writeFileSync('d:/zalo app/zalo-api.js', code.replace(regex, replacement));
        console.log('PATCHED USING REGEX!');
    } else {
        console.error('NOT FOUND. ALREADY PATCHED?');
    }
} catch(err) {
    console.error('Lỗi chạy patch:', err.message);
}

process.exit(0);
