# Valet Ticket System - Testing Guide

## Testing URLs
- **Cloud Run Backend**: https://valet-backend-3sgcnsqvtq-uc.a.run.app
- **Custom Domain** (if configured): https://valet-ticket-system.ansssol.com

## Step-by-Step Testing Instructions

### Prerequisites
1. Open Chrome browser
2. Have 2 sample car images ready (front and back view)
   - You can use your phone to take photos of any car
   - Or download sample images from: https://unsplash.com/s/photos/car-front

### STEP 1: Access the Application
1. Open Chrome and navigate to: `https://valet-backend-3sgcnsqvtq-uc.a.run.app`
2. You should see the Valet Ticket System interface
3. Check the top-right corner - you should see "AI LIVE" pill (green) indicating Gemini is active

### STEP 2: Create an Account (First Time Only)
1. If redirected to login, click "Sign up"
2. Enter:
   - **Email**: test@example.com
   - **Password**: password123
   - **Name**: Test Valet Operator
3. Click "Sign up" - the first account is automatically admin

### STEP 3: Create an Event
1. Click "Events" button in the top-right
2. In the "Create New Event" section:
   - Enter event name: "Wedding Reception Test"
   - Click "Create Event"
3. Click "Select" next to your newly created event
4. Close the modal
5. Verify the event name appears in the top bar

### STEP 4: Test Photo Upload & AI Analysis
1. In the "New car" section, enter owner phone number:
   - Phone: `555-123-4567`

2. Make sure "📷 Scan photos" tab is selected

3. Click the "Front" photo slot and select a car front view image

4. Click the "Back" photo slot and select a car back view image

5. Click "Analyze with AI" button
   - Watch for the loading indicator
   - The AI (Gemini) will analyze both images

6. **Expected Result**: After 2-5 seconds, the form fields should auto-populate:
   - License plate: e.g., "ABC1234"
   - Make & model: e.g., "Toyota Camry"
   - Color: e.g., "Silver"

### STEP 5: Create the Ticket
1. Review the auto-filled information
2. (Optional) Add notes: "VIP guest" or "Scratch on rear bumper"
3. Click "Create ticket" button
4. **Expected Result**:
   - Success message appears
   - Ticket appears in the right panel with:
     - Ticket number (e.g., #1)
     - License plate
     - Make/model
     - Status badge: "PARKED"
     - Share link icon

### STEP 6: Test Ticket Sharing (Customer View)
1. In the ticket list, click the "Share" icon (📋) on your ticket
2. A link will be copied to clipboard (e.g., `https://valet-backend-3sgcnsqvtq-uc.a.run.app/ticket.html?t=abc123...`)
3. Open a new **Incognito window** in Chrome
4. Paste and open the ticket link
5. **Expected Result**:
   - You see the customer view with:
     - Car photos
     - License plate
     - Make/model/color
     - Status: "PARKED"
     - "Request my car" button (blue)

### STEP 7: Test "Request My Car" Feature
1. In the **Incognito window** (customer view), click "Request my car" button
2. **Expected Result**:
   - Button becomes disabled
   - Status changes to "REQUESTED" (yellow badge)
   - Message shows: "We'll bring your car shortly!"

3. Switch back to the **operator dashboard** (main window)
4. **Expected Result**:
   - The ticket automatically updates to show "REQUESTED" status (yellow badge)
   - A notification dot appears
   - "Mark ready" button is available

### STEP 8: Test Valet Workflow
1. In the operator dashboard, click "Mark ready" on the requested ticket
2. **Expected Result**:
   - Status changes to "READY" (green badge)
   - Customer view (if refreshed) shows "Ready! Head to valet stand"

3. Click "Mark delivered" on the ready ticket
4. **Expected Result**:
   - Status changes to "DELIVERED" (gray badge)
   - Ticket moves to completed state

### STEP 9: Test Filters
1. Create multiple tickets with different statuses
2. Click filter chips at the top of the ticket list:
   - "All" - shows all tickets
   - "🔔 Requested" - shows only requested tickets
   - "Parked" - shows only parked tickets
   - "Ready" - shows only ready tickets
   - "Delivered" - shows only delivered tickets

### STEP 10: Verify Live AI Integration
1. Check Cloud Run logs to see Gemini API calls:
   ```bash
   gcloud logging read "resource.type=cloud_run_revision AND resource.labels.service_name=valet-backend" --limit 50 --format="table(timestamp,textPayload)"
   ```

2. Look for log entries showing:
   - "🚗 Analyzing 2 photos with Gemini..."
   - Vision API response with extracted data

## Troubleshooting

### AI Analysis Fails
- Check logs for API errors
- Verify GEMINI_API_KEY is set correctly
- Ensure images are clear and show the car/license plate

### "Request My Car" Doesn't Work
- Check browser console for errors
- Verify the ticket status is "parked" before requesting
- Check network tab to see if the POST request succeeds

### Ticket Not Updating in Real-Time
- The operator dashboard uses Server-Sent Events (SSE)
- Check browser console for SSE connection
- Refresh the page if updates stop coming

## Sample Car Images
You can use these free stock photo sites:
- https://unsplash.com/s/photos/car-license-plate
- https://www.pexels.com/search/car%20front/
- Take photos of your own car!

## API Endpoints for Manual Testing

### Create Ticket (Manual Mode)
```bash
curl -X POST https://valet-backend-3sgcnsqvtq-uc.a.run.app/api/tickets \
  -H "Content-Type: application/json" \
  -H "Cookie: YOUR_SESSION_COOKIE" \
  -d '{
    "phone": "5551234567",
    "plate": "ABC1234",
    "make_model": "Honda Civic",
    "color": "Blue"
  }'
```

### Request Car (Customer)
```bash
curl -X POST https://valet-backend-3sgcnsqvtq-uc.a.run.app/api/t/TOKEN/request
```

## Expected Behavior Summary

| Action | Expected Result |
|--------|----------------|
| Upload 2 photos → Analyze | Fields auto-fill with plate, make/model, color |
| Create ticket | Ticket appears with #1, status "PARKED" |
| Customer clicks "Request my car" | Status → "REQUESTED", operator sees update |
| Operator clicks "Mark ready" | Status → "READY", customer sees update |
| Operator clicks "Mark delivered" | Status → "DELIVERED", workflow complete |

## Success Criteria
✅ AI correctly extracts license plate from photos
✅ AI correctly identifies make/model
✅ AI correctly identifies color
✅ Customer can request car via shared link
✅ Operator dashboard updates in real-time
✅ Status transitions work correctly (parked → requested → ready → delivered)
✅ Event selection works and displays in top bar

---

**Current Configuration:**
- Model: `gemini-flash-latest` (resolves to gemini-3.8-flash)
- API Key: Paid tier (standard)
- Service Tier: Standard (confirmed working)
