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

// Only strictly ADMIN / OWNER can invite, change roles, or remove team members
router.post("/invite", requireRole(["ADMIN"]), inviteTeamMember);
router.post("/verify-invite", requireRole(["ADMIN"]), verifyInviteOtp);
router.patch("/:id/role", requireRole(["ADMIN"]), updateTeamMemberRole);
router.delete("/:id", requireRole(["ADMIN"]), deleteTeamMember);

// All team members can view the team roster
router.get("/", getTeamMembers);

export default router;
