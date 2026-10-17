import { Router } from "express";
import { 
  inviteTeamMember, 
  verifyInviteOtp, 
  getTeamMembers, 
  updateTeamMemberRole, 
  deleteTeamMember 
} from "../controllers/team.controller";
import { requireRole } from "../middleware/auth.middleware";

const router = Router();

// ADMIN can invite any role; EXECUTIVE can invite only VIEWER role (enforced in controller)
router.post("/invite", requireRole(["ADMIN", "EXECUTIVE"]), inviteTeamMember);
router.post("/verify-invite", requireRole(["ADMIN", "EXECUTIVE"]), verifyInviteOtp);
router.patch("/:id/role", requireRole(["ADMIN"]), updateTeamMemberRole);
router.delete("/:id", requireRole(["ADMIN"]), deleteTeamMember);

// All team members can view the team roster
router.get("/", getTeamMembers);

export default router;
