# 🅿️ Valet Ticket System

A fast, mobile-first web app that makes valet ticketing hassle-free. Take the
owner's phone number, capture the car (by **photo** with AI recognition or by
**typing** the details), auto-assign a ticket number, and text everyone their
ticket info. Owners can **text back to request their car early**, and the board
lights up so you can have it ready before they reach the stand.

## How the flow works

1. **Phone first.** Enter the car owner's phone number.
2. **Capture the car — two ways:**
   - **📷 Scan photos** — snap the front and/or back of the car. The AI reads the
     **license plate**, **make & model**, and **color** and fills them in for you.
   - **⌨️ Type details** — enter them by hand.
3. **Create the ticket.** A number is assigned automatically (1 → N for the event).
4. **Text everyone.** Send each owner an SMS with their car details and ticket
   number in one tap ("Text everyone their ticket").
5. **Early pickup.** The owner replies to the same number (e.g. *"Ready for
   ticket 3"*). Their ticket flips to **🔔 Requested** on the board so you can
   pull the car and mark it **Ready**, then **Delivered**.

## Quick start

```bash
npm install
npm start
# open http://localhost:3000
```

The app works **immediately in demo mode** with no API keys:

- **AI** returns realistic sample vehicle data so you can try the photo flow.
- **SMS** is simulated — messages are recorded, and a **💬 Simulate reply**
  button lets you test the text-back / early-pickup flow end to end.

## Going live

Copy `.env.example` to `.env` and fill in credentials:

| Feature | Variable(s) | Notes |
|---|---|---|
| AI recognition | `ANTHROPIC_API_KEY` | Uses Claude vision to read plate/model/color from photos. |
| SMS | `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM_NUMBER` | Sends real texts. |
| Inbound texts | Twilio number webhook | Point the number's inbound message webhook (POST) at `/api/sms/inbound`. |

The status pills in the top bar show whether **AI** and **SMS** are running in
**live** or **demo** mode.

## Tech

- **Backend:** Node.js + Express, persistence via the built-in `node:sqlite`
  (no native build step).
- **Frontend:** dependency-free HTML/CSS/JS, mobile-first, works great on a phone
  or tablet at the valet stand.
- **AI:** Anthropic Claude vision API. **SMS:** Twilio REST API. Both degrade
  gracefully to demo mode when unconfigured.

## API overview

| Method & path | Purpose |
|---|---|
| `GET /api/config` | Feature flags + current event. |
| `POST /api/events` | Start a new event (resets ticket numbers). |
| `POST /api/analyze` | Analyze car photos → `{ plate, make_model, color }`. |
| `GET /api/tickets` | List tickets for the active event. |
| `POST /api/tickets` | Create a ticket (auto-assigns number). |
| `PATCH /api/tickets/:id` | Edit details or update status. |
| `DELETE /api/tickets/:id` | Remove a ticket. |
| `POST /api/tickets/:id/notify` | Text one owner their ticket. |
| `POST /api/tickets/notify-all` | Text all owners (`?all=1` to resend to everyone). |
| `POST /api/sms/inbound` | Twilio inbound webhook (owner replies → early pickup). |
| `POST /api/sms/simulate-inbound` | Simulate an inbound reply (demo mode). |
| `GET /api/messages` | Message log for the active event. |

## Data & privacy

Everything is stored locally in a SQLite file (`./data/valet.db`, git-ignored).
Phone numbers are normalized to E.164 (US assumed for 10-digit input). Start a
**New event** between shifts to reset ticket numbering while keeping history.
