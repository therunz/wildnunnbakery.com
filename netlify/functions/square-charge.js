const https = require('https');

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json'
};

exports.handler = async (event) => {
  // Handle CORS preflight
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: CORS_HEADERS, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: CORS_HEADERS, body: 'Method Not Allowed' };
  }

  let body;
  try {
    body = JSON.parse(event.body);
  } catch {
    return { statusCode: 400, headers: CORS_HEADERS, body: JSON.stringify({ error: 'Invalid JSON' }) };
  }

  const { sourceId, amountCents, note, email } = body;

  if (!sourceId || !amountCents) {
    return { statusCode: 400, headers: CORS_HEADERS, body: JSON.stringify({ error: 'Missing sourceId or amountCents' }) };
  }

  const environment = process.env.SQUARE_ENVIRONMENT || 'sandbox';
  const accessToken = process.env.SQUARE_ACCESS_TOKEN;
  const locationId  = process.env.SQUARE_LOCATION_ID;
  const apiHost     = environment === 'production'
    ? 'connect.squareup.com'
    : 'connect.squareupsandbox.com';

  // Log for Netlify function debug tab
  console.log('Charging:', { amountCents, environment, locationId: locationId ? 'set' : 'MISSING', token: accessToken ? 'set' : 'MISSING' });

  const payload = JSON.stringify({
    idempotency_key: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    source_id: sourceId,
    amount_money: { amount: amountCents, currency: 'USD' },
    location_id: locationId,
    note: note || 'Wild Nunn Bakery Order',
    ...(email && { buyer_email_address: email })
  });

  return new Promise((resolve) => {
    const req = https.request(
      {
        hostname: apiHost,
        path: '/v2/payments',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${accessToken}`,
          'Square-Version': '2024-01-18',
          'Content-Length': Buffer.byteLength(payload)
        }
      },
      (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          console.log('Square response status:', res.statusCode);
          console.log('Square response body:', data);
          try {
            const parsed = JSON.parse(data);
            if (res.statusCode === 200 && parsed.payment?.status === 'COMPLETED') {
              resolve({
                statusCode: 200,
                headers: CORS_HEADERS,
                body: JSON.stringify({
                  success: true,
                  paymentId: parsed.payment.id,
                  receiptUrl: parsed.payment.receipt_url
                })
              });
            } else {
              const errMsg = parsed.errors?.[0]?.detail || `Square error ${res.statusCode}`;
              console.error('Square charge failed:', errMsg);
              resolve({
                statusCode: 400,
                headers: CORS_HEADERS,
                body: JSON.stringify({ success: false, error: errMsg })
              });
            }
          } catch(e) {
            console.error('Parse error:', e.message, 'Raw:', data);
            resolve({
              statusCode: 500,
              headers: CORS_HEADERS,
              body: JSON.stringify({ success: false, error: 'Failed to parse Square response' })
            });
          }
        });
      }
    );
    req.on('error', (err) => {
      console.error('HTTPS request error:', err.message);
      resolve({
        statusCode: 500,
        headers: CORS_HEADERS,
        body: JSON.stringify({ success: false, error: err.message })
      });
    });
    req.write(payload);
    req.end();
  });
};
