const router = require('express').Router();
const { verifyToken, requireRole } = require('../middleware/auth');
const { clearData } = require('../services/clear-data');
router.post('/:kind', verifyToken, requireRole('admin'), async (req, res) => {
  try {
    res.json(await clearData(req.user, req.params.kind, req.body));
  } catch (error) {
    res.status(error.status || 500).json({
      error: error.status
        ? error.message
        : 'Could not clear data. No changes were committed. Please try again.'
    });
  }
});
module.exports = router;
