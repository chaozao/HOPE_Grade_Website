const nodemailer = require('nodemailer');

function configurationError() {
  return Object.assign(new Error('Password email configuration is invalid.'), { code: 'MAIL_CONFIG' });
}

function createPasswordMail(env = process.env, createTransport = nodemailer.createTransport) {
  const user = (env.GMAIL_USER || '').trim();
  // Google displays app passwords in groups separated by spaces.
  const pass = (env.GMAIL_APP_PASSWORD || '').replace(/\s/g, '');
  const port = Number(env.GMAIL_SMTP_PORT || 465);
  let frontend;
  try {
    frontend = new URL((env.FRONTEND_URL || '').trim());
    if (!['https:', 'http:'].includes(frontend.protocol) || frontend.username || frontend.password || frontend.search || frontend.hash) throw configurationError();
  } catch {
    throw configurationError();
  }
  if (!user || !pass || ![465, 587].includes(port)) throw configurationError();
  const transport = createTransport({
    host: 'smtp.gmail.com', port, secure: port === 465,
    requireTLS: true,
    auth: { user, pass },
    connectionTimeout: 10000, greetingTimeout: 10000, socketTimeout: 15000
  });
  return {
    verify: () => transport.verify(),
    send(email, token) {
      const link = new URL('reset-password.html', frontend.href.replace(/\/+$/, '') + '/');
      link.searchParams.set('token', token);
      return transport.sendMail({
        from: { name: 'Hope Grade Website', address: user }, to: email,
        subject: 'Reset your password',
        text: 'Reset your password using this link (expires in 15 minutes):\n' + link.href +
          '\nIf you did not request this, you can ignore this email.'
      });
    }
  };
}

function logMailError(error) {
  const allowed = ['MAIL_CONFIG', 'EAUTH', 'ETIMEDOUT', 'ECONNECTION', 'ECONNREFUSED', 'ECONNRESET', 'EDNS', 'ESOCKET', 'ETLS', 'EENVELOPE', 'EMESSAGE'];
  console.error('[password-mail]', allowed.includes(error.code) ? error.code : 'MAIL_FAILED');
}

module.exports = { createPasswordMail, logMailError };
