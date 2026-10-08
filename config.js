// Public configuration — none of this is secret.
// The OAuth client ID is meant to be public, and the API URL is useless without a Google sign-in
// for the allowed account (checked server-side in the Apps Script).
window.PORTAL_CONFIG = {
  GOOGLE_CLIENT_ID: '315126548851-jg3io3f8n9tj8qpmu6bcj6ue89ajonje.apps.googleusercontent.com',
  API_URL: 'https://script.google.com/macros/s/AKfycbyT8l8RRa2e0ZUcRZZbLWTIVWceU4qjGWWEepABS6jwrG_Z7wl23xYkiPjIey5oL0t0/exec',
  REFRESH_MINUTES: 5
};
