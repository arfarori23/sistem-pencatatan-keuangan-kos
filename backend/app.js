const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');

const FRONTEND_DIR = path.resolve(__dirname, '..', 'frontend');
const PORT = Number(process.env.PORT || 3000);
const contentTypes = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
};

function sendJson(response, status, payload) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  response.end(JSON.stringify(payload));
}

async function serveStatic(request, response, pathname) {
  if (!['GET', 'HEAD'].includes(request.method)) {
    sendJson(response, 405, { error: 'Metode tidak didukung.' });
    return;
  }
  let decoded;
  try { decoded = decodeURIComponent(pathname); } catch {
    sendJson(response, 400, { error: 'Path tidak valid.' });
    return;
  }
  const relativePath = decoded === '/' ? 'index.html' : decoded.replace(/^\/+/, '');
  const filePath = path.resolve(FRONTEND_DIR, relativePath);
  const relative = path.relative(FRONTEND_DIR, filePath);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    sendJson(response, 403, { error: 'Akses ditolak.' });
    return;
  }
  try {
    const file = await fs.readFile(filePath);
    response.writeHead(200, {
      'Content-Type': contentTypes[path.extname(filePath).toLowerCase()] || 'application/octet-stream',
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'no-cache',
    });
    response.end(request.method === 'HEAD' ? undefined : file);
  } catch (error) {
    if (error.code === 'ENOENT' || error.code === 'EISDIR') sendJson(response, 404, { error: 'Halaman tidak ditemukan.' });
    else sendJson(response, 500, { error: 'Gagal membaca file frontend.' });
  }
}

async function handleRequest(request, response) {
  const requestUrl = new URL(request.url, 'http://localhost');
  if (requestUrl.pathname === '/api/health') {
    sendJson(response, 200, { ok: true });
    return;
  }
  if (requestUrl.pathname.startsWith('/api/')) {
    sendJson(response, 404, { error: 'Endpoint API tidak tersedia.' });
    return;
  }
  await serveStatic(request, response, requestUrl.pathname);
}

const server = http.createServer((request, response) => {
  handleRequest(request, response).catch(() => sendJson(response, 500, { error: 'Terjadi kesalahan pada server.' }));
});

server.listen(PORT, () => {
  console.log(`Arus Kos berjalan di http://localhost:${PORT}`);
});
