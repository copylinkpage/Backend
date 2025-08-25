// api/translate.js
module.exports = async (req, res) => {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*'); // TODO: โปรดเปลี่ยนเป็นโดเมนจริงของคุณตอนขึ้นโปรดักชัน
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // อ่าน body เอง (เพราะนี่คือ Vercel Serverless Function ไม่ใช่ Next.js API)
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const raw = Buffer.concat(chunks).toString('utf8');

    let payload = {};
    try {
      payload = JSON.parse(raw || '{}');
    } catch {
      return res.status(400).json({ error: 'Invalid JSON body' });
    }

    const { text, from = 'auto', to = 'th' } = payload || {};
    if (!text || !to) {
      return res.status(400).json({ error: 'Missing required fields: text, to' });
    }

    // สร้างพารามิเตอร์
    const params = new URLSearchParams({ 'api-version': '3.0', to });
    // ถ้าอยากให้ Auto Detect → อย่าใส่ from
    if (from && from !== 'auto') params.set('from', from);

    const endpoint = 'https://api.cognitive.microsofttranslator.com/translate?' + params.toString();

    const azureRes = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Ocp-Apim-Subscription-Key': process.env.AZURE_API_KEY,      // คุณตั้ง env key ชื่อนี้ถูกแล้ว
        'Ocp-Apim-Subscription-Region': process.env.AZURE_REGION,     // และชื่อนี้ถูกแล้ว
        'Content-Type': 'application/json; charset=UTF-8',
      },
      body: JSON.stringify([{ Text: text }]), // <- "Text" ต้อง T ใหญ่ตามสเปก
    });

    const resultText = await azureRes.text();
    let result;
    try { result = JSON.parse(resultText); } catch { result = resultText; }

    if (!azureRes.ok) {
      return res.status(502).json({
        error: 'Azure error',
        status: azureRes.status,
        detail: result
      });
    }

    // โครงสร้างผลลัพธ์ปกติของ Azure:
    // [
    //   {
    //     "detectedLanguage": { "language": "th", "score": 1.0 },
    //     "translations": [ { "text": "...", "to": "en" } ]
    //   }
    // ]
    const translatedText = Array.isArray(result) && result[0]?.translations?.[0]?.text
      ? result[0].translations[0].text
      : '';

    const detectedLanguage =
      (Array.isArray(result) && result[0]?.detectedLanguage?.language) ||
      (from !== 'auto' ? from : undefined) ||
      null;

    return res.status(200).json({ translatedText, detectedLanguage });
  } catch (err) {
    return res.status(500).json({
      error: 'Server error',
      message: err?.message || String(err)
    });
  }
};
