First launch of the E-A batch (2026-10-30 20:3x local). The Docker VM disk filled ("no space left on device")
and D1-alert-r0 ended in infraError after 3 retries; the batch was stopped, D1-fiks-r0 and D1-nohint-r0 were
killed mid-run. Stale fiks images/volumes were removed and the batch restarted from scratch with a
free-space guard. These three runs are kept here and are not counted (host infrastructure failure).
