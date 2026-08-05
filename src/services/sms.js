// SMS service backed by Sinch, Bandwidth, or Twilio's REST API.
//
// If credentials are not configured the service runs in "mock" mode:
// outgoing messages are recorded (and returned to the UI) instead of being
// sent, so the whole flow can be demoed without an account. Inbound replies
// can be simulated from the dashboard in that case.

// Sinch credentials (preferred - free $2 credit, ~200-250 SMS)
const SINCH_SERVICE_PLAN_ID = process.env.SINCH_SERVICE_PLAN_ID;
const SINCH_API_TOKEN = process.env.SINCH_API_TOKEN;
const SINCH_FROM_NUMBER = process.env.SINCH_FROM_NUMBER;

// Bandwidth.com credentials (free $5 credit, no trial restrictions)
const BW_ACCOUNT_ID = process.env.BANDWIDTH_ACCOUNT_ID;
const BW_API_TOKEN = process.env.BANDWIDTH_API_TOKEN;
const BW_API_SECRET = process.env.BANDWIDTH_API_SECRET;
const BW_FROM_NUMBER = process.env.BANDWIDTH_FROM_NUMBER;

// Twilio credentials (fallback)
const TWILIO_SID = process.env.TWILIO_ACCOUNT_SID;
const TWILIO_TOKEN = process.env.TWILIO_AUTH_TOKEN;
const TWILIO_FROM = process.env.TWILIO_FROM_NUMBER;

const useSinch = Boolean(SINCH_SERVICE_PLAN_ID && SINCH_API_TOKEN && SINCH_FROM_NUMBER);
const useBandwidth = Boolean(BW_ACCOUNT_ID && BW_API_TOKEN && BW_API_SECRET && BW_FROM_NUMBER);
const useTwilio = Boolean(TWILIO_SID && TWILIO_TOKEN && TWILIO_FROM);

console.log('SMS Provider Config:');
if (useSinch) {
  console.log('  Provider: Sinch');
  console.log('  Service Plan:', SINCH_SERVICE_PLAN_ID ? `${SINCH_SERVICE_PLAN_ID.substring(0, 10)}...` : 'NOT SET');
  console.log('  Token:', SINCH_API_TOKEN ? `${SINCH_API_TOKEN.substring(0, 10)}...` : 'NOT SET');
  console.log('  From:', SINCH_FROM_NUMBER || 'NOT SET');
} else if (useBandwidth) {
  console.log('  Provider: Bandwidth.com');
  console.log('  Account:', BW_ACCOUNT_ID ? `${BW_ACCOUNT_ID.substring(0, 10)}...` : 'NOT SET');
  console.log('  Token:', BW_API_TOKEN ? `${BW_API_TOKEN.substring(0, 10)}...` : 'NOT SET');
  console.log('  From:', BW_FROM_NUMBER || 'NOT SET');
} else if (useTwilio) {
  console.log('  Provider: Twilio');
  console.log('  SID:', TWILIO_SID ? `${TWILIO_SID.substring(0, 10)}...` : 'NOT SET');
  console.log('  Token:', TWILIO_TOKEN ? `${TWILIO_TOKEN.substring(0, 10)}...` : 'NOT SET');
  console.log('  From:', TWILIO_FROM || 'NOT SET');
} else {
  console.log('  Provider: MOCK (no credentials configured)');
}

export const smsEnabled = useSinch || useBandwidth || useTwilio;

// Returns { delivered: boolean, provider: 'sinch'|'bandwidth'|'twilio'|'mock', error?: string }
export async function sendSms(to, body) {
  console.log(`sendSms called: to=${to}, smsEnabled=${smsEnabled}`);
  if (!smsEnabled) {
    console.log('SMS not enabled, returning mock');
    return { delivered: false, provider: 'mock' };
  }

  if (useSinch) {
    return sendViaSinch(to, body);
  } else if (useBandwidth) {
    return sendViaBandwidth(to, body);
  } else if (useTwilio) {
    return sendViaTwilio(to, body);
  }
}

async function sendViaSinch(to, body) {
  console.log('Attempting to send via Sinch...');
  const url = `https://us.sms.api.sinch.com/xms/v1/${SINCH_SERVICE_PLAN_ID}/batches`;

  // Try Basic auth with Service Plan ID as username and API Token as password
  const auth = Buffer.from(`${SINCH_SERVICE_PLAN_ID}:${SINCH_API_TOKEN}`).toString('base64');

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Basic ${auth}`,
    },
    body: JSON.stringify({
      from: SINCH_FROM_NUMBER,
      to: [to],
      body: body,
    }),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    console.log(`Sinch API error: ${res.status}`, detail.slice(0, 200));
    return { delivered: false, provider: 'sinch', error: `${res.status}: ${detail.slice(0, 200)}` };
  }
  console.log('SMS sent successfully via Sinch!');
  return { delivered: true, provider: 'sinch' };
}

async function sendViaBandwidth(to, body) {
  console.log('Attempting to send via Bandwidth...');
  const url = `https://messaging.bandwidth.com/api/v2/users/${BW_ACCOUNT_ID}/messages`;

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: 'Basic ' + Buffer.from(`${BW_API_TOKEN}:${BW_API_SECRET}`).toString('base64'),
    },
    body: JSON.stringify({
      to: [to],
      from: BW_FROM_NUMBER,
      text: body,
    }),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    console.log(`Bandwidth API error: ${res.status}`, detail.slice(0, 200));
    return { delivered: false, provider: 'bandwidth', error: `${res.status}: ${detail.slice(0, 200)}` };
  }
  console.log('SMS sent successfully via Bandwidth!');
  return { delivered: true, provider: 'bandwidth' };
}

async function sendViaTwilio(to, body) {
  console.log('Attempting to send via Twilio...');
  const url = `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_SID}/Messages.json`;
  const params = new URLSearchParams({ To: to, From: TWILIO_FROM, Body: body });

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      authorization: 'Basic ' + Buffer.from(`${TWILIO_SID}:${TWILIO_TOKEN}`).toString('base64'),
    },
    body: params.toString(),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    console.log(`Twilio API error: ${res.status}`, detail.slice(0, 200));
    return { delivered: false, provider: 'twilio', error: `${res.status}: ${detail.slice(0, 200)}` };
  }
  console.log('SMS sent successfully via Twilio!');
  return { delivered: true, provider: 'twilio' };
}

// Compose the ticket confirmation message sent to an owner.
export function ticketMessage(ticket, eventName, link) {
  const lines = [
    `${eventName}: your car is parked with the valet.`,
    `Ticket #${ticket.ticket_number}`,
  ];
  const car = [ticket.color, ticket.make_model].filter(Boolean).join(' ');
  if (car) lines.push(`Vehicle: ${car}`);
  if (ticket.plate) lines.push(`Plate: ${ticket.plate}`);
  lines.push('');
  lines.push('Reply with your ticket number when you are ready and we will have it waiting.');
  if (link) {
    lines.push('');
    lines.push(`Or tap to request it: ${link}`);
  }
  return lines.join('\n');
}
