Second launch (2026-10-30 20:4x local): the run worktree had no .env, so the runner had no Claude credential
("Not logged in"); D1-alert-r0 ended as infra_error after its first try and the batch was stopped, the other
two D1 runs were killed. Kept here, not counted (operator setup error). Fixed by linking the main checkout .env.
