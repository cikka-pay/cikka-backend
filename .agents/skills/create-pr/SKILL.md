---
name: create-pr
description: Creates a GitHub Pull Request from current uncommitted changes. Stashes, branches, commits, pushes, and uses the GitHub CLI to open a PR automatically. Trigger when asked to "create a PR" or "open a pull request".
---

# Create Pull Request Skill

Use this skill to package current working directory changes into a Pull Request seamlessly.

## Step 1: Analyze the Changes
1. Run `git status` and `git diff` (and `git diff --staged` if necessary) to understand what files were modified or added.
2. Based on the changes, generate:
   - A short, descriptive branch name (e.g., `feat/add-user-auth`, `fix/login-bug`, `docs/update-api-spec`).
   - A concise, conventional commit message (e.g., `feat: Add user authentication endpoints`).
   - A Pull Request title and body summarizing the implementation details.

## Step 2: Checkout Branch
1. Run `git checkout -b <generated-branch-name>` to create and switch to the new branch.

## Step 3: Stage and Commit
1. Run `git add .` to stage all modifications and new files.
2. Run `git commit -m "<generated-commit-message>"` to commit the changes.

## Step 4: Push to Remote
1. Run `git push -u origin <generated-branch-name>`.

## Step 5: Open the Pull Request
1. Ensure the GitHub CLI is available by running `gh --version`. 
2. If available, run:
   ```bash
   gh pr create --title "<Generated PR Title>" --body "<Generated PR Body>"
   ```
3. If `gh` is not authenticated or fails, politely inform the user that the branch was pushed and they can open the PR manually via the GitHub UI.

## Step 6: Finalize
Report success to the user, providing the PR link (if created successfully via `gh`), and summarize what branch was pushed.
