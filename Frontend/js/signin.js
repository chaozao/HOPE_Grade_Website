document.addEventListener('DOMContentLoaded', function () {
    const form = document.getElementById('login-form');
    const emailInput = document.getElementById('email');
    const passwordInput = document.getElementById('password');
    const rememberInput = document.getElementById('remember-me');
    const toggleBtn = document.getElementById('toggle-password');
    const submitBtn = document.getElementById('submit-btn');
    const banner = document.getElementById('form-banner');

    // Show/Hide password
    const toggleIcon = toggleBtn.querySelector('i');

    toggleBtn.addEventListener('click', function () {
        const isHidden = passwordInput.type === 'password';
        passwordInput.type = isHidden ? 'text' : 'password';

        toggleIcon.classList.toggle('bi-eye-slash-fill', !isHidden);
        toggleIcon.classList.toggle('bi-eye-fill', isHidden);
        toggleBtn.setAttribute('aria-label', isHidden ? 'Hide password' : 'Show password');
    });

    const typingText = document.getElementById('typing-text');
    const taglineFull = 'Manage your grades and monitor effortlessly.';
    let charIndex = 0;

    function typeTagline() {
        if (charIndex < taglineFull.length) {
            typingText.textContent += taglineFull.charAt(charIndex);
            charIndex++;
            setTimeout(typeTagline, 45);
        } else {
            const cursor = document.querySelector('.typing-cursor');
            if (cursor) {
                setTimeout(function () {
                    cursor.classList.add('typing-done');
                }, 500);
            }
        }
    }

    if (typingText) {
        typeTagline();
    }

    function showBanner(message, type) {
        banner.textContent = message;
        banner.className = 'auth-banner ' + (type === 'success' ? 'auth-banner-success' : 'auth-banner-error');
        banner.hidden = false;
    }

    function hideBanner() {
        banner.hidden = true;
    }

    // Coming back from a successful password reset? Say so.
    const params = new URLSearchParams(window.location.search);
    if (params.get('reset') === 'success') {
        showBanner('Your password has been updated. Please sign in.', 'success');
    }

    form.addEventListener('submit', async function (event) {
        event.preventDefault();
        hideBanner();

        const email = emailInput.value.trim();
        const password = passwordInput.value;
        const remember = rememberInput.checked;

        submitBtn.disabled = true;
        submitBtn.textContent = 'Signing in…';

        try {
            const response = await fetch(API_BASE_URL + '/login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email, password, remember })
            });

            const data = await response.json();

            if (response.ok) {
                saveToken(data.token, remember); // from auth.js — picks localStorage vs sessionStorage

                const payload = getPayload(data.token); // from auth.js

                if (payload && payload.role === 'admin') {
                    window.location.href = 'admin-dashboard.html';
                } else {
                    window.location.href = 'dashboard.html';
                }
            } else {
                showBanner(data.error || 'Invalid email or password.');
                submitBtn.disabled = false;
                submitBtn.textContent = 'Sign in';
            }

        } catch (error) {
            console.log('Something went wrong:', error);
            showBanner('Could not reach the server.');
            submitBtn.disabled = false;
            submitBtn.textContent = 'Sign in';
        }
    });
});