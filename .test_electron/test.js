const e = require("electron"); console.log("type:", typeof e, "has_app:", !!e.app); if (e.app) { e.app.whenReady().then(() => { console.log("READY!"); e.app.quit(); }); } else { process.exit(1); }
