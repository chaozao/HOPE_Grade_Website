const router = require('express').Router();
const { verifyToken } = require('../middleware/auth');
const service = require('../services/section-subjects');
router.use(verifyToken);
function route(handler) {
  return async (req, res) => {
    try {
      res.json(await handler(req));
    } catch (error) {
      res.status(error.status || 500).json({
        error: error.status
          ? error.message
          : 'Could not save or load section subjects. Please try again.'
      });
    }
  };
}
router.get(
  '/:classId',
  route((req) => service.list(req.user, req.params.classId))
);
router.post(
  '/:classId/subjects',
  route((req) => service.save(req.user, req.params.classId, null, req.body))
);
router.put(
  '/:classId/subjects/:subjectId',
  route((req) => service.save(req.user, req.params.classId, req.params.subjectId, req.body))
);
module.exports = router;
