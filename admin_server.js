const http = require('http');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const url = require('url');
const crypto = require('crypto');

const PORT = 3000;
const SESSION_TIMEOUT = 3600 * 1000 * 24; // 24 hours

// Paths
const BASE_DIR = __dirname;
const DB_FILE = path.join(BASE_DIR, 'articles.db');
const GENERATE_SCRIPT = path.join(BASE_DIR, 'generate_from_db.js');
const TEMP_SQL_FILE = path.join(BASE_DIR, 'temp_op.sql');

// In-memory session store
const sessions = {};

// MIME Types
const MIME_TYPES = {
    '.html': 'text/html',
    '.css': 'text/css',
    '.js': 'text/javascript',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.svg': 'image/svg+xml',
    '.mp3': 'audio/mpeg'
};

// --- Helpers ---

function escapeSql(str) {
    if (!str) return "''";
    return "'" + str.replace(/'/g, "''") + "'";
}

function hashPassword(password) {
    const salt = crypto.randomBytes(16).toString('hex');
    const hash = crypto.pbkdf2Sync(password, salt, 1000, 64, 'sha512').toString('hex');
    return { salt, hash };
}

function verifyPassword(password, salt, originalHash) {
    const hash = crypto.pbkdf2Sync(password, salt, 1000, 64, 'sha512').toString('hex');
    return hash === originalHash;
}

function getBody(req) {
    return new Promise((resolve, reject) => {
        let body = '';
        req.on('data', chunk => body += chunk.toString());
        req.on('end', () => resolve(new URLSearchParams(body)));
        req.on('error', reject);
    });
}

function getSession(req) {
    const cookie = req.headers.cookie;
    if (!cookie) return null;
    const match = cookie.match(/sessionId=([a-zA-Z0-9]+)/);
    if (!match) return null;
    const sessionId = match[1];
    if (sessions[sessionId] && sessions[sessionId].expires > Date.now()) {
        return sessions[sessionId];
    }
    delete sessions[sessionId];
    return null;
}

function setSession(res, username) {
    const sessionId = crypto.randomBytes(16).toString('hex');
    sessions[sessionId] = { username, expires: Date.now() + SESSION_TIMEOUT };
    res.setHeader('Set-Cookie', `sessionId=${sessionId}; HttpOnly; Path=/; Max-Age=86400`);
}

function generateSlug(pubDate, title) {
    const d = new Date(pubDate);
    const datePrefix = `${d.getFullYear()}${String(d.getMonth()+1).padStart(2,'0')}${String(d.getDate()).padStart(2,'0')}`;
    let hash = 0;
    for (let i = 0; i < title.length; i++) {
        hash = ((hash << 5) - hash) + title.charCodeAt(i);
        hash |= 0;
    }
    return `article_${datePrefix}_${Math.abs(hash)}`;
}

function getExcerpt(content, length = 100) {
    let text = content || "";
    text = text.replace(/<[^>]+>/g, ''); 
    text = text.replace(/\s+/g, ' ').trim();
    if (text.length <= length) return text;
    return text.substring(0, length) + '...';
}

function renderAuthPage(title, bodyContent) {
    return `
    <!DOCTYPE html>
    <html>
    <head>
        <title>${title} - 天空之城后台</title>
        <meta charset="utf-8">
        <style>
            body { font-family: -apple-system, sans-serif; background: #f0ebe2; display: flex; justify-content: center; padding-top: 40px; min-height: 100vh; margin:0; color: #2c2420; }
            .container { width: 100%; max-width: 800px; padding: 0 20px; }
            .card { background: rgba(255,255,255,0.95); padding: 30px; border-radius: 4px; box-shadow: 0 4px 20px rgba(44,36,32,0.08); border: 1px solid rgba(44,36,32,0.1); margin-bottom: 20px; }
            h1 { margin-top: 0; color: #2c2420; font-weight: normal; letter-spacing: 0.1em; border-bottom: 1px solid #eee; padding-bottom: 15px; }
            input, textarea { width: 100%; padding: 10px; margin: 8px 0 15px; border: 1px solid #dcd3c1; border-radius: 3px; box-sizing: border-box; font-family: inherit; }
            button { background: #4a7c6f; color: white; padding: 10px 20px; border: none; border-radius: 3px; font-size: 14px; cursor: pointer; transition: background 0.3s; }
            button:hover { background: #3a6358; }
            .link { color: #6b5f52; text-decoration: none; font-size: 14px; margin-right: 15px; }
            .link:hover { color: #b06840; }
            .error { background: #ffebee; color: #c62828; padding: 10px; border-radius: 4px; margin-bottom: 20px; text-align: center; }
            .success { background: #e8f5e9; color: #2e7d32; padding: 10px; border-radius: 4px; margin-bottom: 20px; text-align: center; }
            label { font-size: 0.9em; color: #6b5f52; font-weight: bold; }
            table { width: 100%; border-collapse: collapse; margin-top: 10px; }
            th, td { text-align: left; padding: 12px; border-bottom: 1px solid #eee; font-size: 0.9rem; }
            .actions { text-align: right; }
            .nav { display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px; }
        </style>
    </head>
    <body>
        <div class="container">
            ${bodyContent}
        </div>
    </body>
    </html>`;
}

function serveStatic(res, filePath, session) {
    fs.readFile(filePath, (err, data) => {
        if (err) {
            res.writeHead(404);
            res.end('File not found');
            return;
        }

        const ext = path.extname(filePath);
        const contentType = MIME_TYPES[ext] || 'text/plain';
        
        // Inject Auth Links ONLY for HTML files
        if (ext === '.html') {
            let html = data.toString('utf8');
            let authHtml = '';
            
            // Only inject if placeholder exists (it might not exist in index.html now)
            if (html.includes('{{AUTH_LINKS}}')) {
                if (session) {
                    authHtml = `
                        <span class="auth-user">Hi, ${session.username}</span>
                        <a href="/admin" class="auth-link">⚙️ 管理后台</a>
                        <a href="/logout" class="auth-link">退出</a>
                    `;
                } else {
                    authHtml = `
                        <a href="/login" class="auth-link">登录</a>
                        <a href="/register" class="auth-link">注册</a>
                    `;
                }
                html = html.replace('{{AUTH_LINKS}}', authHtml);
            }
            
            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
            res.end(html);
        } else {
            res.writeHead(200, { 'Content-Type': contentType });
            res.end(data);
        }
    });
}

const server = http.createServer(async (req, res) => {
    const parsedUrl = url.parse(req.url, true);
    const pathname = parsedUrl.pathname;
    const session = getSession(req);
    const method = req.method;

    // 1. Static Files
    if (pathname === '/' || pathname === '/index.html') {
        // Landing page (Clean, no auth links)
        serveStatic(res, path.join(BASE_DIR, 'index.html'), null); 
        return;
    }

    if (pathname === '/home' || pathname === '/home.html') {
        // Diary list page (Inject auth links)
        serveStatic(res, path.join(BASE_DIR, 'home.html'), session);
        return;
    }
    
    // Assets (images, css, js, mp3, articles)
    if (pathname.startsWith('/articles/') || pathname.match(/\.(png|jpg|css|js|mp3)$/)) {
        const safePath = path.normalize(pathname).replace(/^(\.\.[\/\\])+/, '');
        const fullPath = path.join(BASE_DIR, safePath);
        
        // Inject session only if it's an HTML article
        const injectSession = pathname.endsWith('.html') ? session : null;
        
        if (fs.existsSync(fullPath)) {
            serveStatic(res, fullPath, injectSession);
            return;
        }
    }

    // 2. Auth Routes
    if (pathname === '/login') {
        if (method === 'GET') {
            const error = parsedUrl.query.error ? `<div class="error">${parsedUrl.query.error}</div>` : '';
            res.end(renderAuthPage('登录', `
                <div class="card" style="max-width:400px; margin:0 auto;">
                    <h1>登录</h1>
                    ${error}
                    <form action="/login" method="POST">
                        <label>用户名</label>
                        <input type="text" name="username" required>
                        <label>密码</label>
                        <input type="password" name="password" required>
                        <button type="submit" style="width:100%">登 录</button>
                    </form>
                    <div style="text-align:center; margin-top:15px;">
                        <a href="/register" class="link">注册账号</a>
                        <a href="/home" class="link">返回日记</a>
                    </div>
                </div>
            `));
        } else if (method === 'POST') {
            const params = await getBody(req);
            const username = params.get('username');
            const password = params.get('password');

            try {
                const query = `SELECT * FROM users WHERE username = ${escapeSql(username)}`;
                const result = execSync(`sqlite3 -json "${DB_FILE}" "${query}"`).toString();
                const users = JSON.parse(result || '[]');

                if (users.length > 0) {
                    const user = users[0];
                    if (verifyPassword(password, user.salt, user.password)) {
                        setSession(res, username);
                        res.writeHead(302, { 'Location': '/home' }); // Redirect to diary list
                        res.end();
                        return;
                    }
                }
                res.writeHead(302, { 'Location': '/login?error=' + encodeURIComponent('用户名或密码错误') });
                res.end();
            } catch (e) {
                res.end('Error: ' + e.message);
            }
        }
        return;
    }

    if (pathname === '/register') {
        if (method === 'GET') {
            const error = parsedUrl.query.error ? `<div class="error">${parsedUrl.query.error}</div>` : '';
            res.end(renderAuthPage('注册', `
                <div class="card" style="max-width:400px; margin:0 auto;">
                    <h1>注册管理员</h1>
                    ${error}
                    <form action="/register" method="POST">
                        <label>设置用户名</label>
                        <input type="text" name="username" required>
                        <label>设置密码</label>
                        <input type="password" name="password" required>
                        <button type="submit" style="width:100%">注 册</button>
                    </form>
                    <div style="text-align:center; margin-top:15px;">
                        <a href="/login" class="link">已有账号？去登录</a>
                    </div>
                </div>
            `));
        } else if (method === 'POST') {
            const params = await getBody(req);
            const username = params.get('username');
            const password = params.get('password');

            if (!username || !password) return res.end('Invalid input');

            try {
                const { salt, hash } = hashPassword(password);
                const sql = `INSERT INTO users (username, password, salt) VALUES (${escapeSql(username)}, '${hash}', '${salt}');`;
                fs.writeFileSync(TEMP_SQL_FILE, sql);
                execSync(`sqlite3 "${DB_FILE}" < "${TEMP_SQL_FILE}"`);
                fs.unlinkSync(TEMP_SQL_FILE);
                res.writeHead(302, { 'Location': '/login?error=' + encodeURIComponent('注册成功，请登录') });
                res.end();
            } catch (e) {
                res.writeHead(302, { 'Location': '/register?error=' + encodeURIComponent('注册失败') });
                res.end();
            }
        }
        return;
    }

    if (pathname === '/logout') {
        res.setHeader('Set-Cookie', 'sessionId=; HttpOnly; Path=/; Max-Age=0');
        res.writeHead(302, { 'Location': '/home' });
        res.end();
        return;
    }

    // 3. Admin Dashboard
    if (pathname === '/admin') {
        if (!session) { res.writeHead(302, { 'Location': '/login' }); res.end(); return; }

        const success = parsedUrl.query.status === 'success' ? `<div class="success">操作成功！<a href="/home" target="_blank">查看日记</a></div>` : '';
        const deleted = parsedUrl.query.status === 'deleted' ? `<div class="success">文章已删除。</div>` : '';

        // Fetch articles list
        let articles = [];
        try {
            const query = `SELECT id, title, pub_date FROM articles ORDER BY pub_date DESC LIMIT 50`; 
            const result = execSync(`sqlite3 -json "${DB_FILE}" "${query}"`).toString();
            articles = JSON.parse(result || '[]');
        } catch (e) { console.error(e); }

        let rows = articles.map(a => `
            <tr>
                <td>${new Date(a.pub_date).toISOString().split('T')[0]}</td>
                <td>${a.title}</td>
                <td class="actions">
                    <a href="/edit?id=${a.id}" class="link" style="margin:0;">编辑</a>
                    <a href="/delete?id=${a.id}" onclick="return confirm('确定要删除吗？')" class="link" style="margin:0; color:#c62828;">删除</a>
                </td>
            </tr>
        `).join('');

        res.end(renderAuthPage('后台管理', `
            <div class="nav">
                <span style="color:#666;">👋 Hi, ${session.username}</span>
                <div>
                    <a href="/home" class="link">🏠 返回日记</a>
                    <a href="/logout" class="link">🚪 退出</a>
                </div>
            </div>

            ${success} ${deleted}

            <div class="card">
                <h1>✍️ 发布新文章</h1>
                <form action="/publish" method="POST">
                    <input type="text" name="title" required placeholder="标题">
                    <input type="date" name="pub_date" value="${new Date().toISOString().split('T')[0]}" required>
                    <textarea name="content" style="height:150px;" required placeholder="内容..."></textarea>
                    <button type="submit">发布</button>
                </form>
            </div>

            <div class="card">
                <h1>📚 文章管理 (最近50篇)</h1>
                <table>
                    <thead><tr><th width="120">日期</th><th>标题</th><th width="100" style="text-align:right">操作</th></tr></thead>
                    <tbody>${rows}</tbody>
                </table>
            </div>
        `));
        return;
    }

    // 4. Edit Page
    if (pathname === '/edit') {
        if (!session) { res.writeHead(302, { 'Location': '/login' }); res.end(); return; }
        
        const id = parsedUrl.query.id;
        if (!id) { res.end('Missing ID'); return; }

        let article = null;
        try {
            const query = `SELECT * FROM articles WHERE id = ${parseInt(id)}`;
            const result = execSync(`sqlite3 -json "${DB_FILE}" "${query}"`).toString();
            const rows = JSON.parse(result || '[]');
            if (rows.length > 0) article = rows[0];
        } catch (e) { console.error(e); }

        if (!article) { res.end('Article not found'); return; }

        res.end(renderAuthPage('编辑文章', `
            <div class="card">
                <h1>📝 编辑文章</h1>
                <form action="/update" method="POST">
                    <input type="hidden" name="id" value="${article.id}">
                    <label>标题</label>
                    <input type="text" name="title" value="${article.title}" required>
                    <label>日期</label>
                    <input type="date" name="pub_date" value="${new Date(article.pub_date).toISOString().split('T')[0]}" required>
                    <label>内容</label>
                    <textarea name="content" style="height:300px;" required>${article.content}</textarea>
                    <button type="submit">保存修改</button>
                </form>
                <div style="text-align:center; margin-top:15px;">
                    <a href="/admin" class="link">取消</a>
                </div>
            </div>
        `));
        return;
    }

    // 5. Update Action
    if (pathname === '/update' && method === 'POST') {
        if (!session) return res.end('Unauthorized');
        const params = await getBody(req);
        const id = params.get('id');
        const title = params.get('title');
        const pub_date = params.get('pub_date');
        const content = params.get('content');

        try {
            const fullDate = new Date(pub_date).toISOString();
            const slug = generateSlug(pub_date, title);
            const excerpt = getExcerpt(content);

            const sql = `UPDATE articles SET title=${escapeSql(title)}, content=${escapeSql(content)}, pub_date=${escapeSql(fullDate)}, slug=${escapeSql(slug)}, excerpt=${escapeSql(excerpt)} WHERE id=${parseInt(id)};`;

            fs.writeFileSync(TEMP_SQL_FILE, sql);
            execSync(`sqlite3 "${DB_FILE}" < "${TEMP_SQL_FILE}"`);
            fs.unlinkSync(TEMP_SQL_FILE);

            execSync(`node "${GENERATE_SCRIPT}"`);

            res.writeHead(302, { 'Location': '/admin?status=success' });
            res.end();
        } catch (e) {
            res.end('Error: ' + e.message);
        }
        return;
    }

    // 6. Delete Action
    if (pathname === '/delete') {
        if (!session) { res.writeHead(302, { 'Location': '/login' }); res.end(); return; }
        const id = parsedUrl.query.id;
        
        if (id) {
            try {
                // Delete file (optional, skipped for simplicity as generator overwrites)
                const sql = `DELETE FROM articles WHERE id=${parseInt(id)};`;
                fs.writeFileSync(TEMP_SQL_FILE, sql);
                execSync(`sqlite3 "${DB_FILE}" < "${TEMP_SQL_FILE}"`);
                fs.unlinkSync(TEMP_SQL_FILE);

                execSync(`node "${GENERATE_SCRIPT}"`);
                res.writeHead(302, { 'Location': '/admin?status=deleted' });
                res.end();
                return;
            } catch (e) {
                res.end('Error: ' + e.message);
            }
        }
    }

    // 7. Publish Action
    if (pathname === '/publish' && method === 'POST') {
        if (!session) return res.end('Unauthorized');
        const params = await getBody(req);
        const title = params.get('title');
        const pub_date = params.get('pub_date');
        const content = params.get('content');

        try {
            const fullDate = new Date(pub_date).toISOString();
            const slug = generateSlug(pub_date, title);
            const excerpt = getExcerpt(content);

            const sql = `INSERT INTO articles (title, content, pub_date, slug, excerpt) VALUES (${escapeSql(title)}, ${escapeSql(content)}, ${escapeSql(fullDate)}, ${escapeSql(slug)}, ${escapeSql(excerpt)});`;

            fs.writeFileSync(TEMP_SQL_FILE, sql);
            execSync(`sqlite3 "${DB_FILE}" < "${TEMP_SQL_FILE}"`);
            fs.unlinkSync(TEMP_SQL_FILE);

            execSync(`node "${GENERATE_SCRIPT}"`);

            res.writeHead(302, { 'Location': '/admin?status=success' });
            res.end();
        } catch (e) {
            res.end('Error: ' + e.message);
        }
        return;
    }

    // 404 Fallback
    res.writeHead(404);
    res.end('Not Found');
});

server.listen(PORT, () => {
    console.log(`天空之城网站已启动: http://localhost:${PORT}`);
});
