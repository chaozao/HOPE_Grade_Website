const express = require('express');
const { verifyToken, requireRole } = require('../middleware/auth');
const { assignTeacherRoles } = require('../services/teacher-roles');
const router = express.Router();

router.put('/:id/roles', verifyToken, requireRole('admin'), async (req, res) => {
  try {
    await assignTeacherRoles(req.params.id, req.body, req.user);
    res.json({ message: 'Roles and assignments saved successfully.' });
  } catch (error) {
    res.status(error.status || 500).json({
      error: error.status
        ? error.message
        : 'Could not save roles. Please reload assignments before trying again.'
    });
  }
});

module.exports = router;
