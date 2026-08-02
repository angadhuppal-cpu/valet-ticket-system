// SMS service backed by Twilio's REST API.
//
// If Twilio credentials are not configured the service runs in "mock" mode:
// outgoing messages are recorded (and returned to the UI) instead of being
// sent, so the whole flow can be demoed without an account. Inbound replies
// can be simulated from the dashboard in that case.

const SID = process.env.TWILIO_ACCOUNT_SID;
const TOKEN = process.env.TWILIO_AUTH_TOKEN;
const FROM = process.env.TWILIO_FROM_NUMBER;

export const smsEnabled = Boolean(SID && TOKEN && FROM);

// Returns { delivered: boolean, provider: 'twilio'|'mock', error?: string }
export async function sendSms(to, body) {
  if (!smsEnabled) {
    return { delivered: false, provider: 'mock' };
  }

  const url = `https://api.twilio.com/2010-04-01/Accounts/${SID}/Messages.json`;
  const params = new URLSearchParams({ To: to, From: FROM, Body: body });

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      authorization: 'Basic ' + Buffer.from(`${SID}:${TOKEN}`).toString('base64'),
    },
    body: params.toString(),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    return { delivered: false, provider: 'twilio', error: `${res.status}: ${detail.slice(0, 200)}` };
  }
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
