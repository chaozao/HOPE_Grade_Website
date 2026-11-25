// Only explicitly local pages use a development server.
// Hosted pages use the Node application mounted on the same domain.
const API_BASE_URL =
  window.location.protocol === 'file:'
    ? 'http://localhost:3000'
    : ['localhost', '127.0.0.1', '[::1]'].includes(window.location.hostname)
      ? window.location.protocol + '//' + window.location.hostname + ':3000'
      : window.location.protocol + '//' + window.location.host + '/grading-api';
