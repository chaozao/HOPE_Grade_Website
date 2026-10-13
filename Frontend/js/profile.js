document.addEventListener('DOMContentLoaded', function () {
    const token = getToken(); // from auth.js — checks sessionStorage AND localStorage

    if (!token) {
        window.location.href = 'index.html';
        return;
    }

    // This page is shared by teachers and admins. profile.html contains the
    // TEACHER sidebar, so if an admin is signed in, swap in the admin menu
    // (these links go back to the matching tab on the admin page).
    const payload = getPayload(token); // from auth.js
    if (payload && payload.role === 'admin') {
        document.querySelector('.sidebar-nav').innerHTML =
            '<a href="admin-dashboard.html#teachers" class="nav-item"><i class="bi bi-people-fill"></i><span>Teachers</span></a>' +
            '<a href="admin-dashboard.html#classes" class="nav-item"><i class="bi bi-diagram-3-fill"></i><span>Classes</span></a>' +
            '<a href="admin-dashboard.html#subjects" class="nav-item"><i class="bi bi-journal-bookmark-fill"></i><span>Subjects</span></a>';
        document.querySelector('.user-role').textContent = 'Super Admin';
        document.querySelector('.user-avatar').innerHTML = '<i class="bi bi-shield-lock-fill"></i>';
    }

    document.getElementById('logout-btn').addEventListener('click', function () {
        confirmLogout(); // from auth.js — asks "Are you sure?" first, then signs out
    });

    async function authFetch(url, options = {}) {
        options.headers = Object.assign({}, options.headers, {
            'Authorization': 'Bearer ' + token
        });
        const response = await fetch(url, options);

        let data;
        try {
            data = await response.json();
        } catch (e) {
            // The server answered with something that isn't JSON (for example an
            // HTML "Cannot GET" page) - usually means the backend isn't running
            // the latest server.js yet.
            throw new Error('The server did not answer correctly (status ' + response.status + '). Make sure the backend is running the latest server.js.');
        }

        if (!response.ok) throw new Error(data.error || 'Something went wrong.');
        return data;
    }

    const banner = document.getElementById('form-banner');

    function showBanner(message, type) {
        banner.textContent = message;
        banner.className = 'settings-banner ' + (type === 'success' ? 'settings-banner-success' : 'settings-banner-error');
        banner.hidden = false;
    }

    const avatarPreview = document.getElementById('avatar-preview');

    function renderAvatar(photoPath) {
        if (photoPath) {
            avatarPreview.innerHTML = '<img src="' + API_BASE_URL + photoPath + '" alt="Profile photo">';
        } else {
            avatarPreview.innerHTML = '<i class="bi bi-person-fill"></i>';
        }
    }

    async function loadProfile() {
        try {
            const user = await authFetch(API_BASE_URL + '/me');
            document.getElementById('user-name').textContent = user.username;
            document.getElementById('username').value = user.username;
            renderAvatar(user.photo);
        } catch (err) {
            // Show the problem on the page instead of failing silently
            showBanner('Could not load your profile: ' + err.message, 'error');
        }
    }

    loadProfile();
    if (payload && payload.role === 'teacher') {
        configureAdvisorNavigation(token).catch(function (error) {
            showBanner('Could not load your navigation: ' + error.message, 'error');
        });
    } else { revealWorkspace(); }

    // ---------- Tab switching ----------
    const tabs = document.querySelectorAll('.settings-tab');
    const panels = document.querySelectorAll('.settings-panel');

    tabs.forEach(function (tab) {
        tab.addEventListener('click', function () {
            tabs.forEach(function (t) { t.classList.remove('active'); });
            tab.classList.add('active');

            panels.forEach(function (p) { p.classList.add('hidden'); });
            document.getElementById('tab-' + tab.dataset.tab).classList.remove('hidden');
        });
    });

    // ---------- Photo upload ----------
    document.getElementById('photo-input').addEventListener('change', async function () {
        const file = this.files[0];
        if (!file) return;

        const formData = new FormData();
        formData.append('photo', file);

        try {
            const user = await authFetch(API_BASE_URL + '/me/photo', {
                method: 'POST',
                body: formData
                // No Content-Type header here on purpose - the browser sets the
                // correct multipart boundary automatically for FormData uploads.
            });
            renderAvatar(user.photo);
            showBanner('Profile photo updated.', 'success');
        } catch (err) {
            showBanner(err.message, 'error');
        }
    });

    // ---------- Name form ----------
    document.getElementById('name-form').addEventListener('submit', async function (e) {
        e.preventDefault();
        const username = document.getElementById('username').value.trim();

        try {
            const user = await authFetch(API_BASE_URL + '/me', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username })
            });
            document.getElementById('user-name').textContent = user.username;
            showBanner('Name updated. Other pages will show it after you next sign in.', 'success');
        } catch (err) {
            showBanner(err.message, 'error');
        }
    });

    // ---------- Password form ----------
    const passwordToggles = document.querySelectorAll('[data-password-target]');
    function setPasswordVisible(button, visible) {
        document.getElementById(button.dataset.passwordTarget).type = visible ? 'text' : 'password';
        button.setAttribute('aria-label', (visible ? 'Hide ' : 'Show ') + button.dataset.passwordLabel);
        button.setAttribute('aria-pressed', String(visible));
        button.querySelector('i').className = visible ? 'bi bi-eye-fill' : 'bi bi-eye-slash-fill';
    }
    passwordToggles.forEach(function (button) {
        button.addEventListener('click', function () {
            setPasswordVisible(button, document.getElementById(button.dataset.passwordTarget).type === 'password');
        });
    });
    document.getElementById('password-form').addEventListener('reset', function () {
        passwordToggles.forEach(button => setPasswordVisible(button, false));
    });
    document.getElementById('password-form').addEventListener('submit', async function (e) {
        e.preventDefault();

        const currentPassword = document.getElementById('current-password').value;
        const newPassword = document.getElementById('new-password').value.trim();
        const confirmNewPassword = document.getElementById('confirm-new-password').value.trim();

        const validationError = validateNewPassword(newPassword, confirmNewPassword); // from auth.js
        if (validationError) {
            showBanner(validationError, 'error');
            return;
        }

        try {
            await authFetch(API_BASE_URL + '/me/password', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ currentPassword, newPassword })
            });
            showBanner('Password changed successfully.', 'success');
            e.target.reset();
        } catch (err) {
            showBanner(err.message, 'error');
        }
    });
});
