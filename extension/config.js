// SafetyWise extension configuration.
// On managed devices these are normally delivered via managed storage policy.
// For testing, edit these defaults or set them from the popup.
const SW_DEFAULTS = {
  serverUrl: 'https://safetywise.pages.dev', // your live SafetyWise console
  studentCode: '',    // enrollment code from the dashboard (Students tab) — links this device to that student
  enrollToken: 'safetywise-demo-enroll', // optional fallback to auto-create a device when no code is set
  studentEmail: '',   // optional
  studentName: ''
};
