const http = require('http');
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');
const crypto = require('crypto');
const https = require('https');
const { parse } = require('querystring');
const PORT = 3000;

const dbConfig = {
    host: 'localhost',
    user: 'atom',
    password: 'qweqwe123',
    database: 'todolist',
};

const TELEGRAM_BOT_TOKEN = '7704188284:AAG3RXgoWmheQmxuLOGWY-PQzo1wfDlodCw';
const TELEGRAM_CHAT_ID = '-4912608559';

function hashPassword(password) {
    return crypto.createHash('sha256').update(password).digest('hex');
}

function parseCookies(req) {
    const raw = req.headers.cookie || '';
    return Object.fromEntries(raw.split('; ').filter(Boolean).map(c => c.split('=')));
}

async function notifyTelegram(taskText, username = 'Unknown') {
    const message = `📝 ${username} добавил задачу: ${taskText}`;
    const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage?chat_id=${TELEGRAM_CHAT_ID}&text=${encodeURIComponent(message)}`;
    https.get(url, res => res.on('data', () => {})).on('error', err => console.error('Telegram error:', err));
}

async function retrieveListItems(userId) {
    const connection = await mysql.createConnection(dbConfig);
    const [rows] = await connection.execute('SELECT id, text FROM items WHERE user_id = ?', [userId]);
    await connection.end();
    return rows;
}

async function addItemToDatabase(text, userId, username) {
    const connection = await mysql.createConnection(dbConfig);
    await connection.execute('INSERT INTO items (text, user_id) VALUES (?, ?)', [text, userId]);
    await connection.end();
    await notifyTelegram(text, username);
}

async function updateItemInDatabase(id, text) {
    const connection = await mysql.createConnection(dbConfig);
    await connection.execute('UPDATE items SET text = ? WHERE id = ?', [text, id]);
    await connection.end();
}

async function deleteItemFromDatabase(id) {
    const connection = await mysql.createConnection(dbConfig);
    await connection.execute('DELETE FROM items WHERE id = ?', [id]);
    await connection.end();
}

async function getHtmlRows(userId) {
    const todoItems = await retrieveListItems(userId);
    return todoItems.map((item, index) => `
        <tr>
            <td>${index + 1}</td>
            <td>
                <form method="POST" action="/edit" style="display: flex; gap: 5px;">
                    <input type="hidden" name="id" value="${item.id}">
                    <input type="text" name="text" value="${item.text}" style="flex: 1;">
                    <button type="submit">Save</button>
                </form>
            </td>
            <td>
                <form method="POST" action="/delete" onsubmit="return confirm('Delete this item?');">
                    <input type="hidden" name="id" value="${item.id}">
                    <button type="submit">Delete</button>
                </form>
            </td>
        </tr>
    `).join('');
}

async function handleRequest(req, res) {
    const cookies = parseCookies(req);

    if (req.method === 'GET' && req.url === '/') {
        try {
            const html = await fs.promises.readFile(path.join(__dirname, 'index.html'), 'utf8');
            let processedHtml = '';

            if (!cookies.user || !cookies.userId) {
                processedHtml = html.replace('{{rows}}', `
                    <tr><td colspan="3" style="text-align: center; color: grey;">Please log in to view your to-do list.</td></tr>
                `);
            } else {
                processedHtml = html.replace('{{rows}}', await getHtmlRows(cookies.userId));
            }

            res.writeHead(200, { 'Content-Type': 'text/html' });
            res.end(processedHtml);
        } catch (err) {
            console.error(err);
            res.writeHead(500, { 'Content-Type': 'text/plain' });
            res.end('Error loading index.html');
        }

    } else if (req.method === 'POST' && req.url === '/add') {
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', async () => {
            const parsed = parse(body);
            const text = parsed.text?.trim();
            if (text && cookies.userId) {
                try {
                    await addItemToDatabase(text, cookies.userId, cookies.user);
                    res.writeHead(302, { Location: '/' });
                    res.end();
                } catch (err) {
                    res.writeHead(500, { 'Content-Type': 'text/plain' });
                    res.end('Error adding item');
                }
            } else {
                res.writeHead(400, { 'Content-Type': 'text/plain' });
                res.end('Invalid item text or not logged in');
            }
        });

    } else if (req.method === 'POST' && req.url === '/delete') {
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', async () => {
            const parsed = new URLSearchParams(body);
            const id = parseInt(parsed.get('id'), 10);
            if (!isNaN(id)) {
                try {
                    await deleteItemFromDatabase(id);
                    res.writeHead(302, { Location: '/' });
                    res.end();
                } catch (err) {
                    res.writeHead(500, { 'Content-Type': 'text/plain' });
                    res.end('Error deleting item');
                }
            } else {
                res.writeHead(400, { 'Content-Type': 'text/plain' });
                res.end('Invalid ID');
            }
        });

    } else if (req.method === 'POST' && req.url === '/edit') {
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', async () => {
            const parsed = new URLSearchParams(body);
            const id = parseInt(parsed.get('id'), 10);
            const text = parsed.get('text')?.trim();
            if (!isNaN(id) && text) {
                try {
                    await updateItemInDatabase(id, text);
                    res.writeHead(302, { Location: '/' });
                    res.end();
                } catch (err) {
                    res.writeHead(500, { 'Content-Type': 'text/plain' });
                    res.end('Error updating item');
                }
            } else {
                res.writeHead(400, { 'Content-Type': 'text/plain' });
                res.end('Invalid data');
            }
        });

    } else if (req.method === 'POST' && req.url === '/register') {
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', async () => {
            const data = new URLSearchParams(body);
            const username = data.get('username');
            const password = hashPassword(data.get('password'));
            const conn = await mysql.createConnection(dbConfig);
            try {
                await conn.execute('INSERT INTO users (username, password) VALUES (?, ?)', [username, password]);
                const [rows] = await conn.execute('SELECT id FROM users WHERE username = ?', [username]);
                const userId = rows[0].id;
                res.writeHead(302, {
                    'Set-Cookie': [
                        `user=${username}; HttpOnly`,
                        `userId=${userId}; HttpOnly`
                    ],
                    'Location': '/'
                });
                res.end();
            } catch (err) {
                res.writeHead(500, { 'Content-Type': 'text/plain' });
                res.end('User already exists or error');
            } finally {
                await conn.end();
            }
        });

    } else if (req.method === 'POST' && req.url === '/login') {
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', async () => {
            const data = new URLSearchParams(body);
            const username = data.get('username');
            const password = hashPassword(data.get('password'));
            const conn = await mysql.createConnection(dbConfig);
            const [rows] = await conn.execute('SELECT id FROM users WHERE username = ? AND password = ?', [username, password]);
            await conn.end();
            if (rows.length > 0) {
                const userId = rows[0].id;
                res.writeHead(302, {
                    'Set-Cookie': [
                        `user=${username}; HttpOnly`,
                        `userId=${userId}; HttpOnly`
                    ],
                    'Location': '/'
                });
                res.end();
            } else {
                res.writeHead(401, { 'Content-Type': 'text/plain' });
                res.end('Invalid credentials');
            }
        });

    } else if (req.method === 'GET' && req.url.startsWith('/logout')) {
        res.writeHead(302, {
            'Set-Cookie': [
                'user=; Max-Age=0',
                'userId=; Max-Age=0'
            ],
            'Location': '/'
        });
        res.end();

    } else {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Route not found');
    }
}

const server = http.createServer(handleRequest);
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
