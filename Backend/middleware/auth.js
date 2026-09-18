const jwt = require('jsonwebtoken');

// 1. Checks: "Is there a valid wristband at all?"
function verifyToken(req, res, next) {
  // The frontend will send the token like: Authorization: Bearer eyJhbGc...
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'No token provided. Please log in.' });
  }

  const token = authHeader.split(' ')[1]; // grabs just the token part, after "Bearer "

  try {
    // Unstamp the wristband using our secret - throws an error if it's fake or expired
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    // Attach the decoded info (userId, username, role) onto the request
    req.user = decoded;

    next(); // let the request continue to the actual route
  } catch (error) {
    return res.status(403).json({ error: 'Invalid or expired token. Please log in again.' });
  }
}

// 2. Checks: "Does this wristband have the right color for this ride?"
function requireRole(...allowedRoles) {
  return function (req, res, next) {
    if (!allowedRoles.includes(req.user.role)) {
      return res.status(403).json({ error: 'You do not have permission to access this.' });
    }
    next();
  };
}

module.exports = { verifyToken, requireRole };