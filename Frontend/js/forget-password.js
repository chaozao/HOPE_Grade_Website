document.addEventListener('DOMContentLoaded', function () {
  const form = document.getElementById('forgot-form');
  const emailInput = document.getElementById('email');
  const submitBtn = document.getElementById('submit-btn');
  const banner = document.getElementById('form-banner');
  const subtitle = document.getElementById('form-subtitle');

  function showBanner(message, type) {
    banner.textContent = message;
    banner.className =
      'auth-banner ' + (type === 'success' ? 'auth-banner-success' : 'auth-banner-error');
    banner.hidden = false;
  }

  form.addEventListener('submit', async function (event) {
    event.preventDefault();

    const email = emailInput.value.trim();

    submitBtn.disabled = true;
    submitBtn.textContent = 'Sending…';

    try {
      const response = await fetch(API_BASE_URL + '/forget-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email })
      });

      const data = await response.json().catch(() => null);
      if (!response.ok || !data) {
        throw new Error(data?.error || 'The email service did not respond correctly. Please try again later.');
      }

      // Always show the same message, whether or not that email exists —
      // that's what stops this form from being used to check who has an account.
      form.hidden = true;
      subtitle.hidden = true;
      showBanner(
        data.message,
        'success'
      );
    } catch (error) {
      showBanner(error.message || 'Could not reach the server. Please try again.', 'error');
      submitBtn.disabled = false;
      submitBtn.textContent = 'Send reset link';
    }
  });
});
