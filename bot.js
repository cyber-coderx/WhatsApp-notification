const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require("@whiskeysockets/baileys");
const { Boom } = require("@hapi/boom");
const qrcodeTerminal = require("qrcode-terminal");
const express = require('express');
const fs = require('fs');

const app = express();
app.use(express.json());

// Store data
const orders = [];
let sock = null;

// YOUR WHATSAPP NUMBER (Set this!)
const OWNER_PHONE = process.env.OWNER_PHONE || "15551234567"; // Replace with your number

// Initialize bot
async function startBot() {
    try {
        const { state, saveCreds } = await useMultiFileAuthState('auth_info');

        sock = makeWASocket({
            auth: state,
            printQRInTerminal: true,
            logger: require('@whiskeysockets/baileys/lib/Utils').default({ level: 'silent' })
        });

        sock.ev.on('connection.update', (update) => {
            const { connection, lastDisconnect, qr } = update;

            if (qr) {
                console.log('\n🔐 SCAN QR CODE WITH WHATSAPP:\n');
                qrcodeTerminal.generate(qr, { small: true });
            }

            if (connection === 'open') {
                console.log('\n✅ WhatsApp Bot Connected!\n');
                console.log('🌐 Store URL: http://localhost:3000\n');
            }
        });

        sock.ev.on('creds.update', saveCreds);

    } catch (error) {
        console.error('Bot error:', error);
    }
}

// Send WhatsApp notification to owner
async function sendOwnerNotification(order) {
    if (!sock) {
        console.log('❌ Bot not connected yet');
        return false;
    }

    try {
        const formattedPhone = OWNER_PHONE.includes('@') ? OWNER_PHONE : `${OWNER_PHONE}@s.whatsapp.net`;

        const message = `
🛒 *NEW ORDER RECEIVED!*

📦 Product: ${order.product}
👤 Customer: ${order.customerName}
📞 Phone: ${order.phone}
📊 Quantity: ${order.quantity}
💰 Price Each: $${order.price}
💵 Total: $${order.total}

✅ Order ID: ${order.id}
🕐 Time: ${new Date(order.timestamp).toLocaleString()}

Thank you for your business! 🙏
`;

        await sock.sendMessage(formattedPhone, { text: message });
        console.log(`✅ WhatsApp notification sent to owner for order ${order.id}`);
        return true;

    } catch (error) {
        console.error('Error sending notification:', error);
        return false;
    }
}

// STORE WEBSITE
app.get('/', (req, res) => {
    res.sendFile(__dirname + '/store-website.html', (err) => {
        if (err) {
            res.status(404).send('File not found');
        }
    });
});

// API: Create Order (when customer buys product)
app.post('/api/order', async (req, res) => {
    try {
        const { customerName, phone, product, quantity, price, total } = req.body;

        if (!customerName || !phone || !product || !quantity) {
            return res.status(400).json({
                success: false,
                error: 'Missing required fields'
            });
        }

        const orderId = 'ORD-' + Date.now();

        const order = {
            id: orderId,
            customerName,
            phone,
            product,
            quantity: parseInt(quantity),
            price: parseFloat(price),
            total: parseFloat(total),
            timestamp: new Date(),
            status: 'pending'
        };

        orders.push(order);

        // Send WhatsApp notification to owner
        const notificationSent = await sendOwnerNotification(order);

        res.json({
            success: true,
            orderId,
            message: notificationSent ? 
                '✅ Order received! WhatsApp notification sent to owner.' :
                '⚠️ Order received but WhatsApp notification pending.',
            notificationSent
        });

        console.log(`\n📦 NEW ORDER: ${orderId}`);
        console.log(`   Product: ${product}`);
        console.log(`   Customer: ${customerName}`);
        console.log(`   Amount: $${total}\n`);

    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
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
    const totalRevenue = orders.reduce((sum, o) => sum + o.total, 0).toFixed(2);
    const today = new Date().toDateString();
    const todayRevenue = orders
        .filter(o => new Date(o.timestamp).toDateString() === today)
        .reduce((sum, o) => sum + o.total, 0)
        .toFixed(2);

    res.json({
        success: true,
        totalOrders: orders.length,
        totalRevenue,
        todayRevenue,
        todayOrders: orders.filter(o => new Date(o.timestamp).toDateString() === today).length
    });
});

// HOME PAGE
app.get('/info', (req, res) => {
    res.send(`
        <!DOCTYPE html>
        <html>
        <head>
            <title>WhatsApp Store Bot</title>
            <style>
                body { font-family: Arial; padding: 40px; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); min-height: 100vh; }
                .container { max-width: 600px; margin: 0 auto; background: white; padding: 40px; border-radius: 10px; }
                h1 { color: #667eea; }
                a { display: inline-block; padding: 12px 25px; background: #667eea; color: white; text-decoration: none; border-radius: 5px; margin: 10px 5px 10px 0; }
                a:hover { background: #764ba2; }
            </style>
        </head>
        <body>
            <div class="container">
                <h1>🤖 WhatsApp Store Bot</h1>
                <p>Simple store that sends WhatsApp notifications when customers buy products.</p>
                
                <h2>✨ Features</h2>
                <ul>
                    <li>✅ Beautiful product store</li>
                    <li>✅ Customer purchases products</li>
                    <li>✅ WhatsApp notification sent to owner</li>
                    <li>✅ Revenue tracking</li>
                    <li>✅ Order history</li>
                </ul>

                <h2>🚀 Quick Links</h2>
                <a href="/">🛒 Go to Store</a>
                <a href="/api/orders">📊 View Orders (JSON)</a>
                <a href="/api/stats">📈 View Stats (JSON)</a>
            </div>
        </body>
        </html>
    `);
});

// START SERVER
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
    console.log(`\n✅ Store Server running on port ${PORT}`);
    console.log(`🌐 Store URL: http://localhost:${PORT}`);
    console.log(`\n⏳ Starting WhatsApp Bot...\n`);
});

startBot();