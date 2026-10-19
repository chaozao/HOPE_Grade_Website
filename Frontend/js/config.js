// The frontend and Node backend run on the same computer. Use the host used
// to open this website, so localhost and LAN access both survive Wi-Fi changes.
// The backend listens on port 3000; the frontend can use XAMPP or Live Server.
const API_BASE_URL =
  window.location.protocol === 'file:'
    ? 'http://localhost:3000'
    : window.location.protocol + '//' + window.location.hostname + ':3000';
