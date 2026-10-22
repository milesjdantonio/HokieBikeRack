# Team contribution workflow

This repository is split into component areas so teammates can work in parallel.

## Ownership suggestion
- Firmware: `firmware/**`
- Backend/API/database: `backend/**`, schema migrations under backend resources
- Admin UI: `frontend/**`
- Cross-component contracts and decisions: `docs/**`

Owners are suggestions; coordinate before changing shared API or schema contracts.

## Workflow
1. Create a focused branch from `refine-esp32-pn532-plan` (or the agreed integration branch).
2. Keep commits small and describe the behavior/change.
3. Add tests for policy, validation, and API behavior where applicable.
4. Update `docs/API.md` when request/response contracts change; coordinate schema changes with backend contributors.
5. Never commit Wi-Fi passwords, device keys, database passwords, real credential IDs, or personal data.
6. Open a pull request and ask the relevant component owner to review it before merging.
7. Do not merge hardware control code until the board, wiring, driver, and fail-safe behavior have been reviewed.

## Cross-component change checklist
- [ ] API contract updated
- [ ] Database migration reviewed, if needed
- [ ] Firmware compatibility considered
- [ ] Tests and local setup notes updated
- [ ] No secrets or real access data included
- [ ] Offline and failure behavior documented
