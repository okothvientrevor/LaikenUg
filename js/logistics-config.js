/*
 * Laiken Logistics — site configuration.
 * After deploying the backend (see backend/README.md), paste the two URLs below.
 * While API_BASE is empty the pages run in DEMO MODE with sample shipments, so you can preview the design.
 */
window.LK_CONFIG = {
  // e.g. "https://br-xxxx-api.compute.c-2.eu-central-1.aws.neon.tech"   (from: neon functions get api)
  API_BASE: "https://br-winter-hat-bahwk1qd-api.compute.c-8.eu-central-1.aws.neon.tech",
  // e.g. "https://ep-xxxx.neonauth.eu-central-1.aws.neon.tech/neondb/auth" (NEON_AUTH_BASE_URL in backend/.env)
  AUTH_URL: "https://ep-rough-band-bax2hzvv.neonauth.c-8.eu-central-1.aws.neon.tech/neondb/auth",

  WHATSAPP: "256755408999", // number used by the WhatsApp buttons (international format, no +)
  PHONE: "+256414580147",
  PHONE_LABEL: "+256-414-580147",
  EMAIL: "info@laikenug.com",
};
