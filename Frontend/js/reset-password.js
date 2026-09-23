document.addEventListener('DOMContentLoaded', function () {
    const form = document.getElementById('reset-form');
    const passwordInput = document.getElementById('password');
    const confirmInput = document.getElementById('confirm-password');
    const submitBtn = document.getElementById('submit-btn');
    const banner = document.getElementById('form-banner');

    const token = new URLSearchParams(window.location.search).get('token');

    function showBanner(message, type) {
        banner.textContent = message;
        banner.className = 'auth-banner ' + (type === 'success' ? 'auth-banner-success' : 'auth-banner-error');
        banner.hidden = false;
    }

    if (!token) {
        form.hidden = true;
        showBanner('This reset link is missing its token. Please request a new one from the forgot password page.');
        return;
    }

    form.addEventListener('submit', async function (event) {
        event.preventDefault();

        const password = passwordInput.value;
        const confirmPassword = confirmInput.value;

        if (password !== confirmPassword) {
            showBanner('Those passwords do not match.');
            return;
        }

        submitBtn.disabled = true;
        submitBtn.textContent = 'Resetting…';

        try {
            const response = await fetch(API_BASE_URL + '/reset-password', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ token, password })
            });

            const data = await response.json();

            if (response.ok) {
                window.location.href = 'index.html?reset=success';
            } else {
                showBanner(data.error || 'This link has expired or is invalid. Please request a new one.');
                submitBtn.disabled = false;
                submitBtn.textContent = 'Reset password';
            }

        } catch (error) {
            console.log('Something went wrong:', error);
            showBanner('Could not reach the server. Please try again.');
            submitBtn.disabled = false;
            submitBtn.textContent = 'Reset password';
        }
    });
});