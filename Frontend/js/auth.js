// Shared by every page that needs to know if the user is logged in.
// Load this BEFORE signin.js / dashboard.js / etc:
//   <script src="js/auth.js"></script>
//   <script src="js/signin.js"></script>

function getToken() {
  // sessionStorage first (unchecked "remember me"), then localStorage (checked).
  return sessionStorage.getItem('token') || localStorage.getItem('token');
}

function saveToken(token, remember) {
  sessionStorage.removeItem('workspace-hint');
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
  sessionStorage.removeItem('workspace-hint');
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

// Advisory is an assignment, not a separate account role. Always check the
// server so changes made by the super admin are reflected on the next visit.
async function fetchTeacherData(token, path, allowNotFound = false) {
  const response = await fetch(API_BASE_URL + path, {
    headers: { 'Authorization': 'Bearer ' + token }
  });
  if (response.status === 401) {
    clearToken();
    window.location.href = 'index.html';
    throw new Error('Your session has expired. Please sign in again.');
  }
  if (allowNotFound && response.status === 404) return null;
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Could not load your assignments.');
  return data;
}

function workspaceHint(token) {
  try {
    const cached = JSON.parse(sessionStorage.getItem('workspace-hint'));
    if (cached?.token === token) return cached;
  } catch (_) { /* Use the signed login snapshot when no cached assignment exists. */ }
  const payload = getPayload(token);
  return typeof payload?.isAdviser === 'boolean' ? { adviser: payload.isAdviser, teaching: false } : null;
}
function rememberWorkspace(token, adviser, teaching = workspaceHint(token)?.teaching || false) {
  sessionStorage.setItem('workspace-hint', JSON.stringify({ token, adviser, teaching }));
}
function revealWorkspace() { document.documentElement.classList.remove('workspace-pending'); }
async function getAdvisorClass(token) {
  const advisory = await fetchTeacherData(token, '/adviser/my-class', true);
  rememberWorkspace(token, Boolean(advisory));
  return advisory;
}

// Keep the advisor menu when opening the existing teacher tools or profile.
async function configureAdvisorNavigation(token, subjects) {
  const originalNav = document.querySelector('.sidebar-nav').cloneNode(true);
  const originalRole = document.querySelector('.user-role').textContent;
  const hint = workspaceHint(token);
  if (hint?.adviser) renderAdvisorNavigation(hint.teaching);
  try {
    const advisory = await getAdvisorClass(token);
    if (!advisory) {
      if (hint?.adviser) {
        document.querySelector('.sidebar-nav').replaceChildren(...originalNav.childNodes);
        document.querySelector('.user-role').textContent = originalRole;
      }
      revealWorkspace(); return;
    }
    // Establish the adviser menu even if teaching assignments cannot load.
    renderAdvisorNavigation(hint?.teaching || false);
    if (!subjects) subjects = await fetchTeacherData(token, '/teacher/my-subjects');
    rememberWorkspace(token, true, subjects.length > 0);
    renderAdvisorNavigation(subjects.length > 0);
  } catch (error) {
    // A network failure is not a role change: keep the last confirmed adviser menu.
    if (workspaceHint(token)?.adviser) renderAdvisorNavigation(workspaceHint(token).teaching);
    throw error;
  }
}
function renderAdvisorNavigation(teaching) {
  const nav = document.querySelector('.sidebar-nav');
  nav.replaceChildren();
  const items = [
    ['dashboard', 'bi-speedometer2', 'Dashboard'],
    ['homeroom', 'bi-house-door', 'Homeroom']
  ];
  if (teaching) items.push(['class', 'bi-journal-bookmark', 'Class']);
  items.push(['requests', 'bi-arrow-repeat', 'Grade Edit Request'], ['reports', 'bi-file-earmark-text', 'Final Grade Reports']);
  items.forEach(function (item) {
    const link = document.createElement('a');
    link.href = 'class-advisor.html#' + item[0];
    link.className = 'nav-item';
    if (item[0] === 'class' && /\/(grade-entry|student-insights)\.html$/.test(window.location.pathname)) {
      link.classList.add('active');
    }
    const icon = document.createElement('i');
    icon.className = 'bi ' + item[1];
    const label = document.createElement('span');
    label.textContent = item[2];
    link.append(icon, label);
    nav.appendChild(link);
  });
  document.querySelector('.user-role').textContent = 'Class Advisor';
  revealWorkspace();
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
          '<button type="button" class="confirm-btn confirm-btn-no" id="logout-confirm-no">No</button>' +
          '<button type="button" class="confirm-btn confirm-btn-yes" id="logout-confirm-yes">Yes</button>' +
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
