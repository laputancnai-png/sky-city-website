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
// Script is now in the same directory
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
    '.svg': 'image/svg+xml'
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

function renderAuthPage(title, bodyContent) {
    return `
    <!DOCTYPE html>
    <html>
    <head>
        <title>${title} - 天空之城</title>
        <meta charset="utf-8">
        <style>
            body { font-family: -apple-system, sans-serif; background: #f0ebe2; display: flex; justify-content: center; padding-top: 80px; min-height: 100vh; margin:0; color: #2c2420; }
            .card { background: rgba(255,255,255,0.9); padding: 40px; border-radius: 4px; box-shadow: 0 4px 20px rgba(44,36,32,0.08); width: 100%; max-width: 400px; border: 1px solid rgba(44,36,32,0.1); }
            h1 { margin-top: 0; color: #2c2420; text-align: center; font-weight: normal; letter-spacing: 0.1em; }
            input, textarea { width: 100%; padding: 12px; margin: 8px 0 20px; border: 1px solid #dcd3c1; border-radius: 3px; box-sizing: border-box; background: #faf9f6; }
            button { width: 100%; background: #4a7c6f; color: white; padding: 12px; border: none; border-radius: 3px; font-size: 16px; cursor: pointer; letter-spacing: 0.1em; transition: background 0.3s; }
            button:hover { background: #3a6358; }
            .link { text-align: center; display: block; margin-top: 15px; color: #6b5f52; text-decoration: none; font-size: 14px; }
            .link:hover { color: #b06840; }
            .error { background: #ffebee; color: #c62828; padding: 10px; border-radius: 4px; margin-bottom: 20px; text-align: center; font-size: 0.9em; }
            .success { background: #e8f5e9; color: #2e7d32; padding: 10px; border-radius: 4px; margin-bottom: 20px; text-align: center; font-size: 0.9em; }
            label { font-size: 0.9em; color: #6b5f52; }
        </style>
    </head>
    <body>
        <div class="card">
            ${bodyContent}
        </div>
    </body>
    </html>`;
}

// Function to serve static files with Injection
function serveStatic(res, filePath, session) {
    fs.readFile(filePath, (err, data) => {
        if (err) {
            res.writeHead(404);
            res.end('File not found');
            return;
        }

        const ext = path.extname(filePath);
        const contentType = MIME_TYPES[ext] || 'text/plain';
        
        // Inject Auth Links for HTML files
        if (ext === '.html') {
            let html = data.toString('utf8');
            let authHtml = '';
            
            if (session) {
                authHtml = `
                    <span class="auth-user">Hi, ${session.username}</span>
                    <a href="/admin" class="auth-link">✍️ 写日记</a>
                    <a href="/logout" class="auth-link">退出</a>
                `;
            } else {
                authHtml = `
                    <a href="/login" class="auth-link">登录</a>
                    <a href="/register" class="auth-link">注册</a>
                `;
            }
            
            // Replace placeholder
            html = html.replace('{{AUTH_LINKS}}', authHtml);
            
            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
            res.end(html);
        } else {
            // Binary files (images)
            res.writeHead(200, { 'Content-Type': contentType });
            res.end(data);
        }
    });
}

// --- Server Logic ---

const server = http.createServer(async (req, res) => {
    const parsedUrl = url.parse(req.url, true);
    const pathname = parsedUrl.pathname;
    const session = getSession(req);
    const method = req.method;

    // 1. Static Files Routing
    if (pathname === '/' || pathname === '/index.html') {
        serveStatic(res, path.join(BASE_DIR, 'index.html'), session);
        return;
    }
    
    // Serve Articles or Assets
    if (pathname.startsWith('/articles/') || pathname.endsWith('.png') || pathname.endsWith('.css') || pathname.endsWith('.js')) {
        // Security check: prevent directory traversal
        const safePath = path.normalize(pathname).replace(/^(\.\.[\/\\])+/, '');
        const fullPath = path.join(BASE_DIR, safePath);
        
        if (fs.existsSync(fullPath)) {
            serveStatic(res, fullPath, session);
            return;
        }
    }

    // 2. Auth Routes
    if (pathname === '/login') {
        if (method === 'GET') {
            const error = parsedUrl.query.error ? `<div class="error">${parsedUrl.query.error}</div>` : '';
            res.end(renderAuthPage('登录', `
                <h1>登录天空之城</h1>
                ${error}
                <form action="/login" method="POST">
                    <label>用户名</label>
                    <input type="text" name="username" required>
                    <label>密码</label>
                    <input type="password" name="password" required>
                    <button type="submit">登 录</button>
                </form>
                <a href="/register" class="link">注册账号</a>
                <a href="/" class="link">返回首页</a>
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
                        res.writeHead(302, { 'Location': '/' }); // Redirect to home
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
                <h1>注册管理员</h1>
                ${error}
                <form action="/register" method="POST">
                    <label>设置用户名</label>
                    <input type="text" name="username" required>
                    <label>设置密码</label>
                    <input type="password" name="password" required>
                    <button type="submit">注 册</button>
                </form>
                <a href="/login" class="link">已有账号？去登录</a>
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
                res.writeHead(302, { 'Location': '/register?error=' + encodeURIComponent('注册失败，用户名可能已存在') });
                res.end();
            }
        }
        return;
    }

    if (pathname === '/logout') {
        res.setHeader('Set-Cookie', 'sessionId=; HttpOnly; Path=/; Max-Age=0');
        res.writeHead(302, { 'Location': '/' });
        res.end();
        return;
    }

    // 3. Admin Dashboard (Publish) - PROTECTED
    if (pathname === '/admin') {
        if (!session) {
            res.writeHead(302, { 'Location': '/login' });
            res.end();
            return;
        }

        const success = parsedUrl.query.status === 'success' ? `<div class="success">发布成功！<a href="/" target="_blank">查看首页</a></div>` : '';

        res.end(renderAuthPage('写日记', `
            <h1>✍️ 写日记</h1>
            ${success}
            <form action="/publish" method="POST">
                <label>标题</label>
                <input type="text" name="title" required placeholder="今天的日记标题...">
                <label>日期</label>
                <input type="date" name="pub_date" value="${new Date().toISOString().split('T')[0]}" required>
                <label>内容 (支持 HTML)</label>
                <textarea name="content" style="height:200px;" required placeholder="写下今天的想法..."></textarea>
                <button type="submit">发布</button>
            </form>
            <a href="/" class="link">返回首页</a>
        `));
        return;
    }

    // 4. Publish Action
    if (pathname === '/publish' && method === 'POST') {
        if (!session) return res.end('Unauthorized');

        const params = await getBody(req);
        const title = params.get('title');
        const pub_date = params.get('pub_date');
        const content = params.get('content');

        try {
            function generateSlug(d, t) {
                let hash = 0; for(let i=0;i<t.length;i++) hash = ((hash<<5)-hash)+t.charCodeAt(i)|0;
                return `article_${d.replace(/-/g,'')}_${Math.abs(hash)}`;
            }
            function getExcerpt(c) {
                return c.replace(/<[^>]+>/g,'').replace(/\s+/g,' ').trim().substring(0,100)+'...';
            }

            const fullDate = new Date(pub_date).toISOString();
            const slug = generateSlug(pub_date, title);
            const excerpt = getExcerpt(content);

            const sql = `INSERT INTO articles (title, content, pub_date, slug, excerpt) VALUES (${escapeSql(title)}, ${escapeSql(content)}, ${escapeSql(fullDate)}, ${escapeSql(slug)}, ${escapeSql(excerpt)});`;

            fs.writeFileSync(TEMP_SQL_FILE, sql);
            execSync(`sqlite3 "${DB_FILE}" < "${TEMP_SQL_FILE}"`);
            fs.unlinkSync(TEMP_SQL_FILE);

            // Re-run static generator
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
