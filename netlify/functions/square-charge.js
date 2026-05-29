const https = require('https');

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json'
  };

  let body;
  try {
    body = JSON.parse(event.body);
  } catch {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid JSON' }) };
  }

  const { sourceId, amountCents, note, buyerName } = body;

  if (!sourceId || !amountCents) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Missing sourceId or amountCents' }) };
  }

  const environment  = process.env.SQUARE_ENVIRONMENT || 'sandbox';
  const accessToken  = process.env.SQUARE_ACCESS_TOKEN;
  const locationId   = process.env.SQUARE_LOCATION_ID;
  const apiHost      = environment === 'production'
    ? 'connect.squareup.com'
    : 'connect.squareupsandbox.com';

  const payload = JSON.stringify({
    idempotency_key: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    source_id: sourceId,
    amount_money: {
      amount: amountCents,
      currency: 'USD'
    },
    location_id: locationId,
    note: note || 'Wild Nunn Bakery Order',
    buyer_email_address: body.email || undefined
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
          try {
            const parsed = JSON.parse(data);
            if (res.statusCode === 200 && parsed.payment && parsed.payment.status === 'COMPLETED') {
              resolve({
                statusCode: 200,
                headers,
                body: JSON.stringify({
                  success: true,
                  paymentId: parsed.payment.id,
                  receiptUrl: parsed.payment.receipt_url
                })
              });
            } else {
              const errMsg = parsed.errors?.[0]?.detail || 'Payment failed';
              resolve({
                statusCode: 400,
                headers,
                body: JSON.stringify({ success: false, error: errMsg })
              });
            }
          } catch {
            resolve({
              statusCode: 500,
              headers,
              body: JSON.stringify({ success: false, error: 'Failed to parse Square response' })
            });
          }
        });
      }
    );
    req.on('error', (err) => {
      resolve({
        statusCode: 500,
        headers,
        body: JSON.stringify({ success: false, error: err.message })
      });
    });
    req.write(payload);
    req.end();
  });
};
