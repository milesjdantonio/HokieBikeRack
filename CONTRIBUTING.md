# Team contribution workflow

The default branch is `main`. It should contain the complete shared project scaffold, current hardware decisions, API/architecture notes, implementation plan, and setup guidance. Contributors should decide the branch strategy together when implementation starts; no component-specific branches are required in advance.

## Suggested ownership
- Firmware: `firmware/**`
- Backend/API/database: `backend/**`, schema migrations under backend resources
- Admin UI: `frontend/**`
- Cross-component contracts and decisions: `docs/**`

Ownership is a coordination aid, not a restriction. Agree before changing shared API or schema contracts.

## Workflow
1. Start from the latest `main` and create a focused branch if the team agrees a branch is useful for the task. Choose names and branch structure as a team.
2. Keep commits small and describe the behavior/change.
3. Add tests for policy, validation, and API behavior where applicable.
4. Update `docs/API.md` when request/response contracts change; coordinate schema changes with backend contributors.
5. Never commit Wi-Fi passwords, device keys, database passwords, real credential IDs, or personal data.
6. Use pull requests and relevant peer review if the team adopts that workflow.
7. Do not merge hardware control code until the board, wiring, driver, and fail-safe behavior have been reviewed.

## Cross-component change checklist
- [ ] API contract updated
- [ ] Database migration reviewed, if needed
- [ ] Firmware compatibility considered
- [ ] Tests and local setup notes updated
- [ ] No secrets or real access data included
- [ ] Offline and failure behavior documented
