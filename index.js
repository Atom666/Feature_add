const http = require('http');
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');

const PORT = 3000;

// Database connection settings
const dbConfig = {
    host: 'localhost',
    user: 'atom',
    password: 'qweqwe123',
    database: 'todolist',
  };


  async function retrieveListItems() {
    try {
      // Create a connection to the database
      const connection = await mysql.createConnection(dbConfig);
      
      // Query to select all items from the database
      const query = 'SELECT id, text FROM items';
      
      // Execute the query
      const [rows] = await connection.execute(query);
      
      // Close the connection
      await connection.end();
      
      // Return the retrieved items as a JSON array
      return rows;
    } catch (error) {
      console.error('Error retrieving list items:', error);
      throw error; // Re-throw the error
    }
  }

// Stub function for generating HTML rows
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

// Modified request handler with template replacement
async function handleRequest(req, res) {
    if (req.url === '/') {
        try {
            const html = await fs.promises.readFile(
                path.join(__dirname, 'index.html'), 
                'utf8'
            );
            
            // Replace template placeholder with actual content
            const processedHtml = html.replace('{{rows}}', await getHtmlRows());
            
            res.writeHead(200, { 'Content-Type': 'text/html' });
            res.end(processedHtml);
        } catch (err) {
            console.error(err);
            res.writeHead(500, { 'Content-Type': 'text/plain' });
            res.end('Error loading index.html');
        }
    } else {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Route not found');
    }
}

// Вверху файла подключите body-parser для обработки JSON тела
const { parse } = require('querystring');

// Функция добавления в базу данных
async function addItemToDatabase(text) {
    const connection = await mysql.createConnection(dbConfig);
    const query = 'INSERT INTO items (text) VALUES (?)';
    await connection.execute(query, [text]);
    await connection.end();
}

// Обновлённый обработчик запросов
async function handleRequest(req, res) {
    if (req.method === 'GET' && req.url === '/') {
        try {
            const html = await fs.promises.readFile(path.join(__dirname, 'index.html'), 'utf8');
            const processedHtml = html.replace('{{rows}}', await getHtmlRows());
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
                    console.error(err);
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
                        console.error(err);
                        res.writeHead(500, { 'Content-Type': 'text/plain' });
                        res.end('Error updating item');
                    }
                } else {
                    res.writeHead(400, { 'Content-Type': 'text/plain' });
                    res.end('Invalid data');
                }
            });
        }
    else {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Route not found');
    }
}

async function updateItemInDatabase(id, text) {
    const connection = await mysql.createConnection(dbConfig);
    await connection.execute('UPDATE items SET text = ? WHERE id = ?', [text, id]);
    await connection.end();
}

async function deleteItemFromDatabase(id) {
    const connection = await mysql.createConnection(dbConfig);
    const query = 'DELETE FROM items WHERE id = ?';
    await connection.execute(query, [id]);
    await connection.end();
}


// Create and start server
const server = http.createServer(handleRequest);
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
