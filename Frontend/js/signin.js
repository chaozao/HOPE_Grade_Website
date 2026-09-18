document.addEventListener('DOMContentLoaded', function () {
    const form = document.getElementById('login-form');
    const emailInput = document.getElementById('email');
    const passwordInput = document.getElementById('password');
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
    const taglineFull = 'Everything your team is working on, in one place.';
    let charIndex = 0;

    function typeTagline() {
    if (charIndex < taglineFull.length) {
        typingText.textContent += taglineFull.charAt(charIndex);
        charIndex++;
        setTimeout(typeTagline, 45);
    } else {
        // Typing is done - let the cursor fade away
        const cursor = document.querySelector('.typing-cursor');
        if (cursor) {
            setTimeout(function () {
                cursor.classList.add('typing-done');
            }, 500); // small pause after the last letter, feels more natural
        }
    }
}

if (typingText) {
    typeTagline();
}

    function showBanner(message) {
        banner.textContent = message;
        banner.className = 'auth-banner auth-banner-error';
        banner.hidden = false;
    }

    function hideBanner() {
        banner.hidden = true;
    }

    form.addEventListener('submit', async function (event) {
        event.preventDefault();
        hideBanner();

        const email = emailInput.value.trim();
        const password = passwordInput.value;

        submitBtn.disabled = true;
        submitBtn.textContent = 'Signing in…';

        try {
            const response = await fetch('http://localhost:3000/login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email, password })
            });

            const data = await response.json();

        if (response.ok) {
            localStorage.setItem('token', data.token);

            // Peek inside the token to check the role
            const payload = JSON.parse(atob(data.token.split('.')[1]));

            if (payload.role === 'admin') {
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