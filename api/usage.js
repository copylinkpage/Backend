// api/usage.js
// เก็บ/อ่านยอดรวมตัวอักษรที่ถูกแปลผ่าน Upstash REST (ค่า usage เป็น global)
// ใช้รูปแบบ CommonJS ให้ตรงกับ hello.js

module.exports = async (req, res) => {
  const origin = req.headers.origin || '*';
  const cors = {
    'Access-Control-Allow-Origin': origin, // โปรดล็อกโดเมนจริงในโปรดักชัน
    'Vary': 'Origin',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': req.headers['access-control-request-headers'] || 'Content-Type',
    'Access-Control-Max-Age': '86400',
    'Content-Type': 'application/json; charset=utf-8'
  };

  const setCors = () => Object.entries(cors).forEach(([k, v]) => res.setHeader(k, v));

  if (req.method === 'OPTIONS') {
    setCors();
    return res.status(204).end();
  }

  // เช็ก env ก่อน
  const BASE = process.env.UPSTASH_REDIS_REST_URL;
  const TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!BASE || !TOKEN) {
    setCors();
    return res.status(500).json({ error: 'missing env', detail: ['UPSTASH_REDIS_REST_URL','UPSTASH_REDIS_REST_TOKEN'] });
  }

  try {
    if (req.method === 'POST') {
      // อ่าน body เอง (Vercel ไม่มี body parser อัตโนมัติสำหรับ Node functions)
      const chunks = [];
      for await (const c of req) chunks.push(c);
      const raw = Buffer.concat(chunks).toString('utf8');
      const body = raw ? JSON.parse(raw) : {};
      const count = Number(body?.count || 0);

      setCors();
      if (!Number.isFinite(count) || count <= 0) {
        return res.status(400).json({ error: 'invalid count' });
      }

      const url = `${BASE}/incrby/usage/${count}`;
      const r = await fetch(url, {
        method: 'POST',
        headers: { Authorization: `Bearer ${TOKEN}` }
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) return res.status(502).json({ error: 'redis error', detail: j });

      return res.status(200).json({ ok: true });
    }

    if (req.method === 'GET') {
      setCors();
      const url = `${BASE}/get/usage`;
      const r = await fetch(url, { headers: { Authorization: `Bearer ${TOKEN}` } });
      const j = await r.json().catch(() => ({}));
      const usage = parseInt(j?.result || '0', 10) || 0;
      return res.status(200).json({ usage, limit: 2000000 });
    }

    setCors();
    return res.status(405).json({ error: 'Method not allowed' });
  } catch (e) {
    setCors();
    return res.status(500).json({ error: 'server error', message: e?.message || String(e) });
  }
};
