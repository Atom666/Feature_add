const http = require('http');
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');
const crypto = require('crypto');
const { parse } = require('querystring');
const PORT = 3000;

const dbConfig = {
    host: 'localhost',
    user: 'atom',
    password: 'qweqwe123',
    database: 'todolist',
};

function hashPassword(password) {
    return crypto.createHash('sha256').update(password).digest('hex');
}

function parseCookies(req) {
    const raw = req.headers.cookie || '';
    return Object.fromEntries(raw.split('; ').filter(Boolean).map(c => c.split('=')));
}

async function retrieveListItems() {
    const connection = await mysql.createConnection(dbConfig);
    const [rows] = await connection.execute('SELECT id, text FROM items');
    await connection.end();
    return rows;
}

async function addItemToDatabase(text) {
    const connection = await mysql.createConnection(dbConfig);
    await connection.execute('INSERT INTO items (text) VALUES (?)', [text]);
    await connection.end();
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

async function getHtmlRows() {
    const todoItems = await retrieveListItems();
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

            if (!cookies.user) {
                processedHtml = html.replace('{{rows}}', `
                    <tr><td colspan="3" style="text-align: center; color: grey;">Please log in to view your to-do list.</td></tr>
                `);
            } else {
                processedHtml = html.replace('{{rows}}', await getHtmlRows());
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
            if (text) {
                try {
                    await addItemToDatabase(text);
                    res.writeHead(302, { Location: '/' });
                    res.end();
                } catch (err) {
                    res.writeHead(500, { 'Content-Type': 'text/plain' });
                    res.end('Error adding item');
                }
            } else {
                res.writeHead(400, { 'Content-Type': 'text/plain' });
                res.end('Invalid item text');
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
                res.writeHead(302, {
                    'Set-Cookie': `user=${username}; HttpOnly`,
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
            const [rows] = await conn.execute('SELECT * FROM users WHERE username = ? AND password = ?', [username, password]);
            await conn.end();
            if (rows.length > 0) {
                res.writeHead(302, {
                    'Set-Cookie': `user=${username}; HttpOnly`,
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
            'Set-Cookie': 'user=; Max-Age=0',
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
