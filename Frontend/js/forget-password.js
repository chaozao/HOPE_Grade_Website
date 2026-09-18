document.addEventListener('DOMContentLoaded', function () {
    const form = document.getElementById('forgot-form');
    const emailInput = document.getElementById('email');
    const submitBtn = document.getElementById('submit-btn');
    const banner = document.getElementById('form-banner');
    const subtitle = document.getElementById('form-subtitle');

    function showBanner(message, type) {
        banner.textContent = message;
        banner.className = 'auth-banner ' + (type === 'success' ? 'auth-banner-success' : 'auth-banner-error');
        banner.hidden = false;
    }

    form.addEventListener('submit', async function (event) {
        event.preventDefault();

        const email = emailInput.value.trim();

        submitBtn.disabled = true;
        submitBtn.textContent = 'Sending…';

        try {
            await fetch('http://localhost:3000/forget-password', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email })
            });

            // Always show the same message, whether or not that email exists —
            // that's what stops this form from being used to check who has an account.
            form.hidden = true;
            subtitle.hidden = true;
            showBanner('If an account exists for that email, a reset link is on its way. Check your inbox.', 'success');

        } catch (error) {
            console.log('Something went wrong:', error);
            showBanner('Could not reach the server. Please try again.');
            submitBtn.disabled = false;
            submitBtn.textContent = 'Send reset link';
        }
    });
});