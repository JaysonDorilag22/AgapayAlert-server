const express = require("express");
const router = express.Router();
const { protect } = require("../middlewares/authMiddleware");
const authorizeRoles = require("../middlewares/roleMiddleware");
const feedbackController = require("../controllers/feedbackController");

// Public routes
router.get("/stats", feedbackController.getFeedbackStats);

// Protected routes
router.use(protect);

router
  .route("/")
  .post(feedbackController.createFeedback)
  .get(feedbackController.getFeedbacks);
router.get("/my-feedbacks", protect, feedbackController.getMyFeedback);
router
  .route("/:id")
  .get(feedbackController.getFeedback)
  .patch(feedbackController.updateFeedback)
  .delete(feedbackController.deleteFeedback);

// Admin routes
router.patch(
  "/:id/respond",
  protect,
  authorizeRoles("police_admin", "city_admin", "super_admin"),
  feedbackController.respondToFeedback
);

module.exports = router;
