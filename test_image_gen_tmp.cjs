require('dotenv').config();
const mysql = require('mysql2/promise');

async function main() {
  // Get a real pending order with an image URL
  const baseUrl = process.env.DATABASE_URL.split('?')[0];
  const conn = await mysql.createConnection({ uri: baseUrl, ssl: { rejectUnauthorized: true } });
  const [rows] = await conn.execute(
    'SELECT id, originalImageUrl, childName, childDescription, userId FROM orders WHERE originalImageUrl IS NOT NULL ORDER BY id DESC LIMIT 1'
  );
  await conn.end();

  if (!rows || rows.length === 0) {
    console.log('No orders with images found');
    process.exit(1);
  }

  const order = rows[0];
  console.log('Testing with order:', order.id, 'childName:', order.childName);
  console.log('originalImageUrl:', order.originalImageUrl?.substring(0, 80) + '...');

  // Test step 1: Can we fetch the image from S3?
  console.log('\n--- Step 1: Fetching image from S3 ---');
  const imgResp = await fetch(order.originalImageUrl);
  console.log('Fetch status:', imgResp.status, imgResp.statusText);
  if (!imgResp.ok) {
    console.error('FAILED to fetch image from S3:', imgResp.status, imgResp.statusText);
    process.exit(1);
  }
  const imgBuf = Buffer.from(await imgResp.arrayBuffer());
  console.log('Image fetched successfully, size:', imgBuf.length, 'bytes');

  // Test step 2: Send to OpenAI edits endpoint
  console.log('\n--- Step 2: Sending to OpenAI images/edits ---');
  const apiKey = process.env.OPENAI_API_KEY;
  const baseApiUrl = (process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/$/, '');
  const endpoint = `${baseApiUrl}/images/edits`;
  console.log('Endpoint:', endpoint);
  console.log('API key starts with:', apiKey?.substring(0, 8));

  const form = new FormData();
  form.append('prompt', 'Transform this child into a Pixar 3D animated character');
  form.append('model', 'gpt-image-1');
  // Do NOT set response_format for gpt-image-1 (it returns url by default)
  const blob = new Blob([new Uint8Array(imgBuf)], { type: 'image/jpeg' });
  form.append('image', blob, 'image.jpg');

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { authorization: `Bearer ${apiKey}` },
    body: form,
  });

  console.log('OpenAI response status:', response.status, response.statusText);
  const responseText = await response.text();
  console.log('OpenAI response body:', responseText.substring(0, 1000));

  process.exit(0);
}

main().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
