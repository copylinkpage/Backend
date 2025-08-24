// api/translate.js
// - CORS (รองรับ preflight)
// - อ่าน body เอง (Vercel Node Functions ไม่มี body-parser อัตโนมัติ)
// - เรียก Azure Translator (auto-detect ภาษาเมื่อ from='auto' หรือไม่ได้ส่งมา)
// - บันทึกสถิติลง Upstash Redis (ปล่อยผ่านถ้า Redis ล้ม เพื่อไม่ให้การแปลล้ม)

const { redisCmd } = require('./_redis');

module.exports = async (req, res) => {
  // ---------- CORS ----------
  const origin = req.headers.origin || '*';
  const acrh = req.headers['access-control-request-headers'] || '';
  const cors = {
    'Access-Control-Allow-Origin': origin, // โปรดล็อกโดเมนจริงในโปรดักชัน
    'Vary': 'Origin',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': acrh || 'Content-Type, Authorization, Accept',
    'Access-Control-Max-Age': '86400',
    'Content-Type': 'application/json; charset=utf-8'
  };
  const setCors = () => Object.entries(cors).forEach(([k, v]) => res.setHeader(k, v));

  if (req.method === 'OPTIONS') {
    setCors();
    return res.status(204).end();
  }
  if (req.method !== 'POST') {
    setCors();
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // ---------- ENV ----------
  // ใช้ชื่อแนะนำ: AZURE_TRANSLATOR_ENDPOINT (optional), AZURE_TRANSLATOR_KEY, AZURE_TRANSLATOR_REGION
  const EP = (process.env.AZURE_TRANSLATOR_ENDPOINT || 'https://api.cognitive.microsofttranslator.com').replace(/\/+$/, '');
  const KEY = process.env.AZURE_TRANSLATOR_KEY || process.env.AZURE_API_KEY; // เผื่อคุณใช้ชื่อเก่า
  const REGION = process.env.AZURE_TRANSLATOR_REGION || process.env.AZURE_REGION;

  if (!KEY || !REGION) {
    setCors();
    return res.status(500).json({
      error: 'missing env',
      detail: ['AZURE_TRANSLATOR_KEY (or AZURE_API_KEY)', 'AZURE_TRANSLATOR_REGION (or AZURE_REGION)']
    });
  }

  // ---------- READ BODY ----------
  try {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const raw = Buffer.concat(chunks).toString('utf8');
    const payload = raw ? JSON.parse(raw) : {};

    const text = typeof payload?.text === 'string' ? payload.text : '';
    const to = typeof payload?.to === 'string' ? payload.to : 'th';
    const from = typeof payload?.from === 'string' ? payload.from : 'auto';

    if (!text || !to) {
      setCors();
      return res.status(400).json({ error: 'Missing required fields: text, to' });
    }

    // ---------- CALL AZURE ----------
    const qs = new URLSearchParams({ 'api-version': '3.0', to });
    if (from && from !== 'auto') qs.set('from', from);

    const azureRes = await fetch(`${EP}/translate?${qs.toString()}`, {
      method: 'POST',
      headers: {
        'Ocp-Apim-Subscription-Key': KEY,
        'Ocp-Apim-Subscription-Region': REGION,
        'Content-Type': 'application/json; charset=UTF-8'
      },
      // สำคัญ: Azure ต้องใช้ key "Text" ตัว T ใหญ่
      body: JSON.stringify([{ Text: text }])
    });

    const resultText = await azureRes.text();
    let result;
    try { result = JSON.parse(resultText); } catch { result = resultText; }

    setCors();

    if (!azureRes.ok) {
      return res.status(502).json({
        error: 'Azure error',
        status: azureRes.status,
        detail: result
      });
    }

    // รูปแบบผลลัพธ์ปกติ:
    // [ { detectedLanguage: { language: 'xx' }, translations: [ { text: '...', to: 'yy' } ] } ]
    const translatedText =
      Array.isArray(result) && result[0]?.translations?.[0]?.text
        ? result[0].translations[0].text
        : '';

    const detectedLanguage =
      (Array.isArray(result) && result[0]?.detectedLanguage?.language) ||
      (from !== 'auto' ? from : null);

    // ---------- LOG TO REDIS (best-effort) ----------
    try {
      const chars = [...text].length; // นับ Unicode ได้ดีกว่า .length เฉย ๆ
      const now = new Date();
      const ym = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;

      await redisCmd('INCRBY', `usage:month:${ym}`, String(chars));

      const logItem = {
        ts: now.toISOString(),
        from: detectedLanguage || (from === 'auto' ? 'auto' : from),
        to,
        chars,
        preview: text.slice(0, 100)
      };
      await redisCmd('LPUSH', 'usage:recent', JSON.stringify(logItem));
      await redisCmd('LTRIM', 'usage:recent', '0', '49');
    } catch (e) {
      console.error('Redis log error:', e?.message || e);
      // ไม่ throw ต่อ เพื่อไม่ให้การแปลพัง
    }

    return res.status(200).json({ translatedText, detectedLanguage });
  } catch (err) {
    setCors();
    return res.status(400).json({ error: 'Invalid JSON body', message: err?.message || String(err) });
  }
};
