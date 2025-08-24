// api/translate.js
// - รองรับ CORS (preflight/OPTIONS)
// - อ่าน body เอง (สไตล์ Vercel Serverless Functions)
// - เรียก Azure Translator (auto-detect = ไม่ส่ง from)
// - บันทึกสถิติลง Upstash Redis: ยอดรวมรายเดือน + รายการล่าสุด (50 รายการ)

const { redisCmd } = require('./_redis');

module.exports = async (req, res) => {
  // ----- CORS -----
  const origin = req.headers.origin || '*';
  const acrh = req.headers['access-control-request-headers'] || '';
  const corsBase = {
    'Access-Control-Allow-Origin': origin,                  // โปรดล็อกโดเมนจริงในโปรดักชัน
    'Vary': 'Origin',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': acrh || 'Content-Type, Authorization, Accept',
    'Access-Control-Max-Age': '86400',
  };

  if (req.method === 'OPTIONS') {
    Object.entries(corsBase).forEach(([k, v]) => res.setHeader(k, v));
    return res.status(200).end();
  }
  if (req.method !== 'POST') {
    Object.entries(corsBase).forEach(([k, v]) => res.setHeader(k, v));
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // ----- อ่าน JSON body -----
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const raw = Buffer.concat(chunks).toString('utf8');

    let payload = {};
    try {
      payload = JSON.parse(raw || '{}');
    } catch {
      Object.entries(corsBase).forEach(([k, v]) => res.setHeader(k, v));
      return res.status(400).json({ error: 'Invalid JSON body' });
    }

    const { text, from = 'auto', to = 'th' } = payload || {};
    if (!text || !to) {
      Object.entries(corsBase).forEach(([k, v]) => res.setHeader(k, v));
      return res.status(400).json({ error: 'Missing required fields: text, to' });
    }

    // ----- เรียก Azure Translator -----
    const params = new URLSearchParams({ 'api-version': '3.0', to });
    // auto-detect = ไม่ส่ง from
    if (from && from !== 'auto') params.set('from', from);

    const endpoint =
      'https://api.cognitive.microsofttranslator.com/translate?' + params.toString();

    const azureRes = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Ocp-Apim-Subscription-Key': process.env.AZURE_API_KEY,
        'Ocp-Apim-Subscription-Region': process.env.AZURE_REGION, // ต้องมี
        'Content-Type': 'application/json; charset=UTF-8',
      },
      // สำคัญ: ใช้ "Text" ตัว T ใหญ่ ตามสเปก Azure
      body: JSON.stringify([{ Text: text }]),
    });

    const resultText = await azureRes.text();
    let result;
    try { result = JSON.parse(resultText); } catch { result = resultText; }

    Object.entries(corsBase).forEach(([k, v]) => res.setHeader(k, v));

    if (!azureRes.ok) {
      // ส่งรายละเอียด error จาก Azure กลับไปเพื่อดีบักง่าย
      return res.status(502).json({
        error: 'Azure error',
        status: azureRes.status,
        detail: result
      });
    }

    // โครงสร้างผลลัพธ์ปกติ:
    // [ { detectedLanguage: { language: 'th', score: ... }, translations: [ { text: '...', to:'en' } ] } ]
    const translatedText =
      Array.isArray(result) && result[0]?.translations?.[0]?.text
        ? result[0].translations[0].text
        : '';

    const detectedLanguage =
      (Array.isArray(result) && result[0]?.detectedLanguage?.language) ||
      (from !== 'auto' ? from : null);

    // ----- บันทึกสถิติลง Upstash Redis -----
    // (ถ้า env ของ Upstash ไม่ครบ/มีปัญหา ฟังก์ชันส่วนนี้จะ throw → เราจับและข้ามเพื่อไม่ให้การแปลล้ม)
    try {
      const chars = text.length;
      const now = new Date();
      const ym = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;

      // เพิ่มยอดรวมประจำเดือน
      await redisCmd('INCRBY', `usage:month:${ym}`, String(chars));

      // เก็บ 50 รายการล่าสุด (public log)
      const logItem = {
        ts: now.toISOString(),
        from: detectedLanguage || (from === 'auto' ? 'auto' : from),
        to,
        chars,
        // เพื่อความเป็นส่วนตัว เก็บแค่พรีวิว 100 ตัวอักษร
        preview: text.slice(0, 100)
      };
      await redisCmd('LPUSH', 'usage:recent', JSON.stringify(logItem));
      await redisCmd('LTRIM', 'usage:recent', '0', '49');
    } catch (e) {
      // แค่ log ฝั่งเซิร์ฟเวอร์ ไม่ให้กระทบการตอบกลับ
      console.error('Redis log error:', e?.message || e);
    }

    // ----- ตอบกลับสำเร็จ -----
    return res.status(200).json({ translatedText, detectedLanguage });
  } catch (err) {
    Object.entries(corsBase).forEach(([k, v]) => res.setHeader(k, v));
    return res.status(500).json({
      error: 'Server error',
      message: err?.message || String(err)
    });
  }
};
