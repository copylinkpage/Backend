// api/_redis.js
const REST_URL = process.env.UPSTASH_REDIS_REST_URL;
const REST_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;

// ฟังก์ชันเรียก Redis ผ่าน REST API
async function redisCmd(command, ...args) {
  if (!REST_URL || !REST_TOKEN) throw new Error('Redis env vars missing');
  const body = { command, args };
  const res = await fetch(REST_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${REST_TOKEN}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Redis error ${res.status}: ${text}`);
  }
  const json = await res.json();
  return json.result;
}

module.exports = { redisCmd };