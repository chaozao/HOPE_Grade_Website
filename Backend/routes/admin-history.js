const router = require('express').Router();
const { verifyToken, requireRole } = require('../middleware/auth');
const history = require('../services/admin-history');
router.use(verifyToken, requireRole('admin'));
const handle = fn => async (req, res) => {
  try { res.json(await fn(req)); }
  catch (error) {
    res.status(error.status || 500).json({ error: error.status ? error.message : 'Could not load or undo history. Please retry.' });
  }
};
router.get('/', handle(req => history.list(req.user, req.query.before)));
router.post('/:id/undo', handle(req => history.undo(req.user, req.params.id)));
module.exports = router;
