import { Router } from "express";
import { inviteTeamMember, verifyInviteOtp, getTeamMembers } from "../controllers/team.controller";

const router = Router();

router.post("/invite", inviteTeamMember);
router.post("/verify-invite", verifyInviteOtp);
router.get("/", getTeamMembers);

export default router;
