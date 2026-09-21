# NOCTRA — Personal Safety & Emergency Response Platform

NOCTRA is a full-stack academic project demonstrating a complete emergency lifecycle: SOS activation, location capture, responder notification, acknowledgement, response, resolution, and an auditable incident timeline.

## Technology stack
- React + Vite — frontend
- Node.js + Express — REST API backend
- MongoDB Atlas — persistent database
- JWT + bcrypt — authentication and role-based access
- Browser Geolocation API — demo location capture
- Lucide React — interface icons

## Roles
- **User:** manages trusted contacts, triggers SOS, views incidents and notifications.
- **Responder:** receives active alerts and records response actions.
- **Admin:** monitors all incidents and reviews/updates incident status.

## Emergency demo workflow
1. User logs in.
2. User holds **HOLD SOS** for 3 seconds.
3. Browser location is captured when permission is available.
4. Backend creates an incident in MongoDB.
5. Responder receives an alert.
6. Responder selects the incident and clicks **Acknowledge alert & start responding**.
7. User receives a status notification: **Responding**.
8. Responder clicks **Help arrived — resolve incident**.
9. User receives a **Resolved** notification.
10. The incident timeline records each activity.

## Local setup
### Backend
```bash
cd backend
npm install
```
Create `.env` from `.env.example` and add your MongoDB Atlas connection string and JWT secret.

Then:
```bash
npm run seed
npm run dev
```

### Frontend
Open a second terminal:
```bash
cd frontend
npm install
npm run dev
```
Open `http://localhost:5173`.

## Demo accounts
Created by `npm run seed`:
- Admin: `admin@noctra.demo` / `Admin@12345`
- Responder: `responder@noctra.demo` / `Responder@12345`

Create a normal user through the registration screen.

## UI/UX design rationale
NOCTRA uses a **Night Operations** visual system: near-black surfaces create focus and reduce visual noise, while semantic colors communicate state rather than decoration.

- Red = emergency / critical action
- Blue = responding / information
- Amber = attention
- Green = resolved / success
- White = primary content
- Dark surfaces = structure and hierarchy

The SOS interaction uses press-and-hold to reduce accidental activation, with a progress ring and immediate feedback. Status is communicated through both color and text for accessibility. User and responder experiences are role-specific, and the incident timeline provides clear situational awareness.

## Academic note
This is a simulated emergency-response workflow for demonstration. It does not contact real emergency services or send real SMS messages unless an external notification provider is separately integrated.


## Multi-contact emergency workflow
A user can maintain up to five trusted contacts. An SOS creates **one incident**, attaches all trusted contacts to that incident in priority order, and records how each contact was notified. If a trusted contact is also a registered NOCTRA user with the same phone number, that person receives an in-app `contact_alert`; otherwise the prototype records the contact as `simulated`. Responders still receive the responder alert and manage the central incident lifecycle.

### Demo with multiple contacts
1. Register a normal user.
2. Add 2–3 trusted contacts with priorities 1–3.
3. Trigger SOS.
4. Open the incident detail to show the **Emergency contacts notified** panel.
5. Use a registered responder account in a second browser to acknowledge and resolve the same incident.

The prototype does not send real SMS or make emergency-service calls.
