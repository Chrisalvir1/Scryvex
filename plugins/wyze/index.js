const readline = require('readline');

// Plugin Scaffolding for Scryvex 1.0
function log(msg) { console.log(`[Plugin:${msg}]`); }
function sendIPC(type, payload) { console.log(JSON.stringify({ type, payload })); }

const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: false });

rl.on('line', (line) => {
    if (!line) return;
    try {
        const msg = JSON.parse(line);
        log(`Received IPC: ${msg.type}`);
        // Handle login / requests here
    } catch(e) {
        log(`IPC parse error: ${e.message}`);
    }
});

log("Plugin started and awaiting commands.");
