document.addEventListener('DOMContentLoaded', function () {
    const token = getToken(); // from auth.js — checks sessionStorage AND localStorage

    if (!token) {
        window.location.href = 'index.html';
        return;
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
    document.getElementById('password-form').addEventListener('submit', async function (e) {
        e.preventDefault();

        const currentPassword = document.getElementById('current-password').value;
        const newPassword = document.getElementById('new-password').value;
        const confirmNewPassword = document.getElementById('confirm-new-password').value;

        if (newPassword !== confirmNewPassword) {
            showBanner('New passwords do not match.', 'error');
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