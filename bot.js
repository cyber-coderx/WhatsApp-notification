const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require("@whiskeysockets/baileys");
const { Boom } = require("@hapi/boom");
const QRCode = require("qrcode");
const express = require('express');
const fs = require('fs');

const app = express();
app.use(express.json());

// Store data
const orders = [];
let sock = null;
let currentQR = null;
let botStatus = 'disconnected';

// Owner phone loaded from OWNER_PHONE secret (set via Replit Secrets)
let OWNER_PHONE = process.env.OWNER_PHONE || '';

// Initialize bot
async function startBot() {
    try {
        const { state, saveCreds } = await useMultiFileAuthState('auth_info');

        sock = makeWASocket({ auth: state });

        sock.ev.on('connection.update', async (update) => {
            const { connection, lastDisconnect, qr } = update;

            if (qr) {
                currentQR = qr;
                botStatus = 'waiting_qr';
                console.log('\n🔐 QR Code ready — visit /qr in your browser to scan it\n');
            }

            if (connection === 'open') {
                currentQR = null;
                botStatus = 'connected';
                console.log('\n✅ WhatsApp Bot Connected!\n');
            }

            if (connection === 'close') {
                const reason = new Boom(lastDisconnect?.error)?.output?.statusCode;
                botStatus = 'disconnected';

                if (reason === DisconnectReason.loggedOut) {
                    console.log('❌ Logged out. Deleting session and restarting...');
                    fs.rmSync('auth_info', { recursive: true, force: true });
                    startBot();
                } else {
                    console.log('🔄 Connection closed, reconnecting...');
                    setTimeout(startBot, 5000);
                }
            }
        });

        sock.ev.on('creds.update', saveCreds);

    } catch (error) {
        console.error('Bot error:', error);
        setTimeout(startBot, 5000);
    }
}

// QR Code page
app.get('/qr', async (req, res) => {
    if (botStatus === 'connected') {
        return res.send(`
            <!DOCTYPE html><html><head><title>WhatsApp Bot - Connected</title>
            <meta http-equiv="refresh" content="5">
            <style>body{font-family:Arial;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;background:linear-gradient(135deg,#667eea,#764ba2);}
            .box{background:white;padding:40px;border-radius:15px;text-align:center;max-width:400px;}
            h2{color:#25D366;}p{color:#666;}</style></head>
            <body><div class="box"><h2>✅ WhatsApp Connected!</h2><p>Your bot is linked and running. You can close this page.</p>
            <a href="/" style="display:inline-block;margin-top:20px;padding:12px 25px;background:#667eea;color:white;text-decoration:none;border-radius:8px;">Go to Store</a>
            </div></body></html>
        `);
    }

    if (!currentQR) {
        return res.send(`
            <!DOCTYPE html><html><head><title>WhatsApp Bot - Waiting</title>
            <meta http-equiv="refresh" content="3">
            <style>body{font-family:Arial;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;background:linear-gradient(135deg,#667eea,#764ba2);}
            .box{background:white;padding:40px;border-radius:15px;text-align:center;max-width:400px;}
            h2{color:#667eea;}p{color:#666;}.spinner{width:40px;height:40px;border:4px solid #f3f3f3;border-top:4px solid #667eea;border-radius:50%;animation:spin 1s linear infinite;margin:20px auto;}
            @keyframes spin{to{transform:rotate(360deg);}}</style></head>
            <body><div class="box"><h2>⏳ Connecting to WhatsApp...</h2>
            <div class="spinner"></div>
            <p>QR code will appear here automatically. This page refreshes every 3 seconds.</p>
            </div></body></html>
        `);
    }

    try {
        const qrDataURL = await QRCode.toDataURL(currentQR, { width: 300, margin: 2 });
        res.send(`
            <!DOCTYPE html><html><head><title>Scan QR - WhatsApp Bot</title>
            <meta http-equiv="refresh" content="30">
            <style>body{font-family:Arial;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;background:linear-gradient(135deg,#667eea,#764ba2);}
            .box{background:white;padding:40px;border-radius:15px;text-align:center;max-width:420px;}
            h2{color:#333;}p{color:#666;font-size:14px;}img{border:8px solid white;border-radius:10px;box-shadow:0 4px 15px rgba(0,0,0,0.1);}
            .steps{text-align:left;margin:20px 0;padding:0 10px;}
            .steps li{margin-bottom:8px;color:#555;font-size:14px;}
            .badge{background:#25D366;color:white;padding:6px 14px;border-radius:20px;font-size:13px;display:inline-block;margin-bottom:15px;}
            </style></head>
            <body><div class="box">
            <div class="badge">📱 Scan with WhatsApp</div>
            <h2>Link Your WhatsApp</h2>
            <img src="${qrDataURL}" alt="QR Code" width="300">
            <ol class="steps">
                <li>Open <strong>WhatsApp</strong> on your phone</li>
                <li>Tap <strong>⋮ Menu</strong> → <strong>Linked Devices</strong></li>
                <li>Tap <strong>Link a Device</strong></li>
                <li>Scan this QR code</li>
            </ol>
            <p>⏱ QR code expires in ~30 seconds. Page auto-refreshes.</p>
            </div></body></html>
        `);
    } catch (err) {
        res.status(500).send('Error generating QR code: ' + err.message);
    }
});

// Bot status API
app.get('/api/bot-status', (req, res) => {
    res.json({ status: botStatus, hasQR: !!currentQR });
});

// Settings: get/update owner phone
app.get('/api/settings', (req, res) => {
    res.json({ success: true, ownerPhone: OWNER_PHONE, botStatus });
});

app.post('/api/settings', (req, res) => {
    if (botStatus === 'connected') {
        return res.status(403).json({ success: false, error: 'WhatsApp is currently connected. Reset first to change the number.' });
    }
    const { ownerPhone } = req.body;
    const cleaned = (ownerPhone || '').trim().replace(/^\+/, '').replace(/\s+/g, '');

    if (!cleaned || cleaned.length < 7) {
        return res.status(400).json({ success: false, error: 'Please enter a valid phone number.' });
    }
    if (cleaned.startsWith('0')) {
        return res.status(400).json({ success: false, error: 'Number must be in international format — remove the leading 0 and add your country code. Example: 233509632197 for Ghana.' });
    }
    if (cleaned.length < 10) {
        return res.status(400).json({ success: false, error: 'Number looks too short. Make sure to include your country code (e.g. 233 for Ghana).' });
    }

    OWNER_PHONE = cleaned;
    console.log(`✅ Owner phone updated to: ${OWNER_PHONE}`);
    res.json({ success: true, ownerPhone: OWNER_PHONE });
});

// Reset: disconnect WhatsApp session and start fresh
app.post('/api/reset', async (req, res) => {
    console.log('🔄 Resetting WhatsApp session...');
    try {
        if (sock) {
            sock.ev.removeAllListeners();
            await sock.logout().catch(() => {});
            sock = null;
        }
    } catch (e) {}

    currentQR = null;
    botStatus = 'disconnected';
    OWNER_PHONE = '';

    fs.rmSync('auth_info', { recursive: true, force: true });
    console.log('🗑️ Session cleared. Restarting bot for fresh QR...');
    setTimeout(startBot, 1000);
    res.json({ success: true, message: 'Session reset. Enter a new number and scan the QR code.' });
});

// QR code as data URL (for embedding in dashboard)
app.get('/api/qr-image', async (req, res) => {
    if (!currentQR) {
        return res.json({ success: false, status: botStatus });
    }
    try {
        const QRCode = require("qrcode");
        const dataURL = await QRCode.toDataURL(currentQR, { width: 260, margin: 2 });
        res.json({ success: true, dataURL, status: botStatus });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// STORE WEBSITE
app.get('/', (req, res) => {
    res.sendFile(__dirname + '/store-website.html', (err) => {
        if (err) res.status(404).send('File not found');
    });
});

// API: Create Order
app.post('/api/order', async (req, res) => {
    try {
        const { customerName, phone, product, quantity, price, total } = req.body;

        if (!customerName || !phone || !product || !quantity) {
            return res.status(400).json({ success: false, error: 'Missing required fields' });
        }

        const orderId = 'ORD-' + Date.now();
        const order = {
            id: orderId,
            customerName, phone, product,
            quantity: parseInt(quantity),
            price: parseFloat(price),
            total: parseFloat(total),
            timestamp: new Date(),
            status: 'pending'
        };

        orders.push(order);
        const notificationSent = await sendOwnerNotification(order);

        res.json({
            success: true,
            orderId,
            message: notificationSent
                ? '✅ Order received! WhatsApp notification sent to owner.'
                : '⚠️ Order received but WhatsApp notification pending (bot not connected).',
            notificationSent
        });

        console.log(`\n📦 NEW ORDER: ${orderId} | ${product} | ${customerName} | $${total}\n`);

    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// API: Get all orders
app.get('/api/orders', (req, res) => {
    res.json({
        success: true,
        count: orders.length,
        totalRevenue: orders.reduce((sum, o) => sum + o.total, 0).toFixed(2),
        orders: orders.sort((a, b) => b.timestamp - a.timestamp)
    });
});

// API: Get stats
app.get('/api/stats', (req, res) => {
    const today = new Date().toDateString();
    res.json({
        success: true,
        totalOrders: orders.length,
        totalRevenue: orders.reduce((sum, o) => sum + o.total, 0).toFixed(2),
        todayRevenue: orders.filter(o => new Date(o.timestamp).toDateString() === today).reduce((sum, o) => sum + o.total, 0).toFixed(2),
        todayOrders: orders.filter(o => new Date(o.timestamp).toDateString() === today).length
    });
});

// Send WhatsApp notification to owner
async function sendOwnerNotification(order) {
    if (!sock || botStatus !== 'connected') {
        console.log('⚠️ Bot not connected — skipping WhatsApp notification');
        return false;
    }

    if (!OWNER_PHONE) {
        console.log('⚠️ OWNER_PHONE is not set — cannot send notification. Set it in the Owner Dashboard.');
        return false;
    }

    if (OWNER_PHONE.startsWith('0')) {
        console.log(`❌ OWNER_PHONE "${OWNER_PHONE}" starts with 0 — must be international format (e.g. 233509632197)`);
        return false;
    }

    try {
        const formattedPhone = OWNER_PHONE.includes('@') ? OWNER_PHONE : `${OWNER_PHONE}@s.whatsapp.net`;
        console.log(`📤 Sending notification to: ${formattedPhone}`);
        const message = `🛒 *NEW ORDER RECEIVED!*\n\n📦 Product: ${order.product}\n👤 Customer: ${order.customerName}\n📞 Phone: ${order.phone}\n📊 Quantity: ${order.quantity}\n💰 Price Each: $${order.price}\n💵 Total: $${order.total}\n\n✅ Order ID: ${order.id}\n🕐 Time: ${new Date(order.timestamp).toLocaleString()}\n\nThank you for your business! 🙏`;

        await sock.sendMessage(formattedPhone, { text: message });
        console.log(`✅ WhatsApp notification sent for order ${order.id}`);
        return true;
    } catch (error) {
        console.error('Error sending notification:', error);
        return false;
    }
}

// INFO PAGE
app.get('/info', (req, res) => {
    res.send(`<!DOCTYPE html><html><head><title>WhatsApp Store Bot</title>
        <style>body{font-family:Arial;padding:40px;background:linear-gradient(135deg,#667eea,#764ba2);min-height:100vh;}
        .container{max-width:600px;margin:0 auto;background:white;padding:40px;border-radius:10px;}
        h1{color:#667eea;}a{display:inline-block;padding:12px 25px;background:#667eea;color:white;text-decoration:none;border-radius:5px;margin:10px 5px 10px 0;}
        a:hover{background:#764ba2;}.wa{background:#25D366;}a.wa:hover{background:#20BA5A;}</style></head>
        <body><div class="container"><h1>🤖 WhatsApp Store Bot</h1>
        <p>Bot Status: <strong>${botStatus}</strong></p>
        <h2>🚀 Quick Links</h2>
        <a href="/">🛒 Store</a>
        <a class="wa" href="/qr">📱 Link WhatsApp</a>
        <a href="/api/orders">📊 Orders</a>
        <a href="/api/stats">📈 Stats</a>
        </div></body></html>`);
});

// START SERVER
const PORT = process.env.PORT || 5000;

app.listen(PORT, '0.0.0.0', () => {
    console.log(`\n✅ Store Server running on port ${PORT}`);
    console.log(`🌐 Store: http://localhost:${PORT}`);
    console.log(`📱 Link WhatsApp: http://localhost:${PORT}/qr\n`);
    console.log(`⏳ Starting WhatsApp Bot...\n`);
});

startBot();
