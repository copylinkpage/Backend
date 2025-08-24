// api/usage.js
// เก็บ/อ่านยอดรวมตัวอักษรที่ถูกแปล (ทุกคนเห็นเหมือนกัน) ผ่าน Upstash REST
// CORS ครอบให้เรียบร้อย (ข้ามโดเมนได้)

export default async function handler(req, res) {
  const origin = req.headers.origin || '*';
  const cors = {
    'Access-Control-Allow-Origin': origin, // โปรดล็อกโดเมน production จริงในภายหลัง
    'Vary': 'Origin',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': req.headers['access-control-request-headers'] || 'Content-Type',
    'Access-Control-Max-Age': '86400',
  };

  if (req.method === 'OPTIONS') {
    Object.entries(cors).forEach(([k, v]) => res.setHeader(k, v));
    return res.status(200).end();
  }

  try {
    if (req.method === 'POST') {
      // เพิ่ม usage ตามจำนวนตัวอักษร
      const chunks = [];
      for await (const c of req) chunks.push(c);
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
      const count = Number(body?.count || 0);
      if (!count || count < 0) {
        Object.entries(cors).forEach(([k, v]) => res.setHeader(k, v));
        return res.status(400).json({ error: 'invalid count' });
      }

      const url = process.env.UPSTASH_REDIS_REST_URL + '/incrby/usage/' + count;
      const r = await fetch(url, {
        method: 'POST',
        headers: { Authorization: `Bearer ${process.env.UPSTASH_REDIS_REST_TOKEN}` }
      });
      const j = await r.json().catch(() => ({}));

      Object.entries(cors).forEach(([k, v]) => res.setHeader(k, v));
      if (!r.ok) return res.status(502).json({ error: 'redis error', detail: j });

      return res.status(200).json({ ok: true });
    }

    if (req.method === 'GET') {
      // อ่าน usage รวม
      const url = process.env.UPSTASH_REDIS_REST_URL + '/get/usage';
      const r = await fetch(url, {
        headers: { Authorization: `Bearer ${process.env.UPSTASH_REDIS_REST_TOKEN}` }
      });
      const j = await r.json().catch(() => ({}));
      const usage = parseInt(j?.result || '0', 10) || 0;

      Object.entries(cors).forEach(([k, v]) => res.setHeader(k, v));
      return res.status(200).json({ usage, limit: 2000000 });
    }

    Object.entries(cors).forEach(([k, v]) => res.setHeader(k, v));
    return res.status(405).json({ error: 'Method not allowed' });
  } catch (e) {
    Object.entries(cors).forEach(([k, v]) => res.setHeader(k, v));
    return res.status(500).json({ error: 'server error', message: e?.message || String(e) });
  }
}
