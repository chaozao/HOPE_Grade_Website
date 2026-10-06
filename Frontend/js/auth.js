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

// Checks a new password against the site's rules before it's even sent to
// the server - the server enforces the same rule independently and is the
// real authority, but this gives the person a faster, friendlier answer.
// Returns an error message to display, or null if everything looks fine.
function validateNewPassword(newPassword, confirmNewPassword) {
  if (newPassword.length < 8) {
    return 'New password must be at least 8 characters.';
  }
  if (newPassword.length > 72) {
    return 'New password must be 72 characters or fewer.';
  }
  if (!/[A-Za-z]/.test(newPassword) || !/[0-9]/.test(newPassword)) {
    return 'New password must include at least one letter and one number.';
  }
  if (newPassword !== confirmNewPassword) {
    return 'New passwords do not match.';
  }
  return null;
}

function getPayload(token) {
  try {
    return JSON.parse(atob(token.split('.')[1]));
  } catch (e) {
    return null;
  }
}

// Shows an "Are you sure?" popup before logging out. Every page's logout
// button calls this instead of signing out straight away.
function confirmLogout() {
  let overlay = document.getElementById('logout-confirm-overlay');

  // Build the popup the first time it's needed, then just re-show it after that.
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'logout-confirm-overlay';
    overlay.className = 'confirm-overlay';
    overlay.innerHTML =
      '<div class="confirm-modal" role="dialog" aria-modal="true" aria-labelledby="logout-confirm-text">' +
        '<p id="logout-confirm-text">Are you sure you want to log out?</p>' +
        '<div class="confirm-actions">' +
          '<button type="button" class="confirm-btn confirm-btn-yes" id="logout-confirm-yes">Yes</button>' +
          '<button type="button" class="confirm-btn confirm-btn-no" id="logout-confirm-no">No</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(overlay);

    const closePopup = function () {
      overlay.classList.remove('open');
    };

    // "No", tapping the dimmed area outside the box, or pressing Escape all just close it.
    overlay.querySelector('#logout-confirm-no').addEventListener('click', closePopup);
    overlay.addEventListener('click', function (event) {
      if (event.target === overlay) closePopup();
    });
    document.addEventListener('keydown', function (event) {
      if (event.key === 'Escape') closePopup();
    });

    // "Yes" is the only path that actually signs you out.
    overlay.querySelector('#logout-confirm-yes').addEventListener('click', function () {
      clearToken();
      window.location.href = 'index.html';
    });
  }

  overlay.classList.add('open');
}