// api/translate.js
module.exports = async (req, res) => {
  // ---- CORS helpers ----
  const origin = req.headers.origin || '*';
  const acrh = req.headers['access-control-request-headers'] || ''; // headers ที่เบราว์เซอร์จะส่งจริงในคำขอถัดไป
  const corsBase = {
    'Access-Control-Allow-Origin': origin,           // โปรดล็อกเป็นโดเมนของคุณเมื่อขึ้นโปรดักชัน
    'Vary': 'Origin',                                // ให้ CDN แคชตาม origin
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    // สะท้อน headers ที่ browser ขอมา (ถ้าไม่มี ให้ครอบคลุมทั่วไป)
    'Access-Control-Allow-Headers': acrh || 'Content-Type, Authorization, Accept',
    'Access-Control-Max-Age': '86400',
  };

  // ---- OPTIONS (preflight) ----
  if (req.method === 'OPTIONS') {
    Object.entries(corsBase).forEach(([k, v]) => res.setHeader(k, v));
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    Object.entries(corsBase).forEach(([k, v]) => res.setHeader(k, v));
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // อ่าน body เอง (Vercel Serverless style)
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

    // สร้าง query สำหรับ Azure
    const params = new URLSearchParams({ 'api-version': '3.0', to });
    // ถ้าอยาก auto-detect ต้อง "ไม่ใส่" from
    if (from && from !== 'auto') params.set('from', from);

    const endpoint = 'https://api.cognitive.microsofttranslator.com/translate?' + params.toString();

    const azureRes = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Ocp-Apim-Subscription-Key': process.env.AZURE_API_KEY,
        'Ocp-Apim-Subscription-Region': process.env.AZURE_REGION,
        'Content-Type': 'application/json; charset=UTF-8',
      },
      // สำคัญ: ต้องใช้ "Text" (T ใหญ่) ตามสเปก Azure
      body: JSON.stringify([{ Text: text }]),
    });

    const resultText = await azureRes.text();
    let result;
    try { result = JSON.parse(resultText); } catch { result = resultText; }

    Object.entries(corsBase).forEach(([k, v]) => res.setHeader(k, v));

    if (!azureRes.ok) {
      return res.status(502).json({
        error: 'Azure error',
        status: azureRes.status,
        detail: result
      });
    }

    const translatedText =
      Array.isArray(result) && result[0]?.translations?.[0]?.text
        ? result[0].translations[0].text
        : '';

    const detectedLanguage =
      (Array.isArray(result) && result[0]?.detectedLanguage?.language) ||
      (from !== 'auto' ? from : null);

    return res.status(200).json({ translatedText, detectedLanguage });
  } catch (err) {
    Object.entries(corsBase).forEach(([k, v]) => res.setHeader(k, v));
    return res.status(500).json({
      error: 'Server error',
      message: err?.message || String(err)
    });
  }
};
