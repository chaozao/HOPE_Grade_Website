document.addEventListener('DOMContentLoaded', function () {
    const form = document.getElementById('signup-form');
    const usernameInput = document.getElementById('username');
    const emailInput = document.getElementById('email');
    const passwordInput = document.getElementById('password');

    const usernameError = document.getElementById('username-error');
    const emailError = document.getElementById('email-error');
    const passwordError = document.getElementById('password-error');

    const toggleBtn = document.getElementById('toggle-password');
    const submitBtn = document.getElementById('submit-btn');
    const banner = document.getElementById('form-banner');

    const usernamePattern = /^[a-zA-Z0-9.]+$/;
    const emailPattern = /^[a-zA-Z0-9._]+@gmail\.com$/;
    const passwordPattern = /^(?=.*[A-Z])(?=.*\d)(?=.*[!@#$%^&*(),.?":{}|<>]).{8,}$/;

    const toggleIcon = toggleBtn.querySelector('i');
    toggleBtn.addEventListener('click', function () {
        const isHidden = passwordInput.type === 'password';
        passwordInput.type = isHidden ? 'text' : 'password';

        toggleIcon.classList.toggle('bi-eye-slash-fill', !isHidden);
        toggleIcon.classList.toggle('bi-eye-fill', isHidden);
        toggleBtn.setAttribute('aria-label', isHidden ? 'Hide password' : 'Show password');
    });

    const typingText = document.getElementById('typing-text');
    const taglineFull = 'Start organizing your academic progress today.';
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

    function showFieldError(input, errorEl, message) {
        errorEl.textContent = message;
        input.classList.add('input-error');
    }

    function clearFieldError(input, errorEl) {
        errorEl.textContent = '';
        input.classList.remove('input-error');
    }

    function showBanner(message, type) {
        banner.textContent = message;
        banner.className = 'auth-banner auth-banner-' + type;
        banner.hidden = false;
    }

    function hideBanner() {
        banner.hidden = true;
    }

    function validateUsername() {
        const value = usernameInput.value.trim();
        if (value === '') {
            showFieldError(usernameInput, usernameError, 'Username is required.');
            return false;
        }
        if (!usernamePattern.test(value)) {
            showFieldError(usernameInput, usernameError, 'Only letters, numbers, and dots are allowed.');
            return false;
        }
        clearFieldError(usernameInput, usernameError);
        return true;
    }

    function validateEmail() {
        const value = emailInput.value.trim();
        if (value === '') {
            showFieldError(emailInput, emailError, 'Email is required.');
            return false;
        }
        if (!emailPattern.test(value)) {
            showFieldError(emailInput, emailError, 'Must be letters, numbers, dots, or underscores, ending in @gmail.com.');
            return false;
        }
        clearFieldError(emailInput, emailError);
        return true;
    }

    function validatePassword() {
        const value = passwordInput.value;
        if (value === '') {
            showFieldError(passwordInput, passwordError, 'Password is required.');
            return false;
        }
        if (!passwordPattern.test(value)) {
            showFieldError(passwordInput, passwordError, '8+ characters, 1 uppercase letter, 1 number, 1 special character.');
            return false;
        }
        clearFieldError(passwordInput, passwordError);
        return true;
    }

    usernameInput.addEventListener('input', validateUsername);
    emailInput.addEventListener('input', validateEmail);
    passwordInput.addEventListener('input', validatePassword);

    form.addEventListener('submit', async function (event) {
        event.preventDefault();
        hideBanner();

        const isUsernameValid = validateUsername();
        const isEmailValid = validateEmail();
        const isPasswordValid = validatePassword();

        if (!isUsernameValid || !isEmailValid || !isPasswordValid) {
            return;
        }

        const username = usernameInput.value.trim();
        const email = emailInput.value.trim();
        const password = passwordInput.value;

        submitBtn.disabled = true;
        submitBtn.textContent = 'Creating account…';

        try {
            const response = await fetch('http://localhost:3000/signup', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username, email, password })
            });

            const data = await response.json();

            if (response.ok) {
                showBanner(data.message + ' Redirecting to sign in…', 'success');
                form.reset();
                setTimeout(function () {
                    window.location.href = 'index.html';
                }, 1500);
            } else {
                showBanner(data.error || 'Something went wrong. Please try again.', 'error');
                submitBtn.disabled = false;
                submitBtn.textContent = 'Create account';
            }

        } catch (error) {
            console.log('Something went wrong:', error);
            showBanner('Could not reach the server. Make sure it is running.', 'error');
            submitBtn.disabled = false;
            submitBtn.textContent = 'Create account';
        }
    });
});