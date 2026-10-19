const jwt = require('jsonwebtoken');

// Checks that a request carries a valid "wristband" (JWT) before letting
// it reach a protected route. If it's valid, req.user gets set to whatever
// was signed into the token back in /login: { userId, username, role }.
function verifyToken(req, res, next) {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'No token provided.' });
  }

  const token = authHeader.split(' ')[1];

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded;
    next();
  } catch (error) {
    return res.status(401).json({ error: 'Invalid or expired token.' });
  }
}

// Used AFTER verifyToken on routes that only a specific role should reach,
// e.g. requireRole('admin') or requireRole('teacher').
function requireRole(role) {
  return function (req, res, next) {
    if (!req.user || req.user.role !== role) {
      return res.status(403).json({ error: 'You do not have permission to do this.' });
    }
    next();
  };
}

module.exports = { verifyToken, requireRole };
