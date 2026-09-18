// Shared by every page that needs to know if the user is logged in.
// Load this BEFORE signin.js / dashboard.js / etc:
//   <script src="js/auth.js"></script>
//   <script src="js/signin.js"></script>

function getToken() {
  // sessionStorage first (unchecked "remember me"), then localStorage (checked).
  return sessionStorage.getItem('token') || localStorage.getItem('token');
}

function saveToken(token, remember) {
  // Only ever keep the token in ONE place at a time.
  localStorage.removeItem('token');
  sessionStorage.removeItem('token');

  if (remember) {
    localStorage.setItem('token', token);   // survives closing the browser
  } else {
    sessionStorage.setItem('token', token); // cleared when the tab/browser closes
  }
}

function clearToken() {
  localStorage.removeItem('token');
  sessionStorage.removeItem('token');
}

function getPayload(token) {
  try {
    return JSON.parse(atob(token.split('.')[1]));
  } catch (e) {
    return null;
  }
}