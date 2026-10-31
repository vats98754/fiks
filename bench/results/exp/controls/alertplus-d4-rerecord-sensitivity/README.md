# ALERT+ D4: hidden-repro re-recording left in the head (deviation, 2026-10-31)

EXP-PLAN E-A2 says an ALERT+ head keeps no `test/repro/` files. In the three D4 ALERT+ runs the
re-recording step wrote `test/repro/tr_d02358451e.rerecorded.json` (the hidden repro's call,
re-recorded because the fix fetches extra pages). The run only excluded the repro's own test and
trace paths, so this file was committed into the head, as it is for every FIKS and NOHINT D4 head.
The live check uses no fixtures. To measure the effect on the held-out repro, each head was copied
with only that file removed (local refs `refs/fiks-exp/sens-D4-alertplus-r<k>`) and re-evaluated
with `pnpm fiks exp-eval --sandbox docker` (same tools image): `r<k>/record.json` is the run
record with the head replaced, `r<k>/eval.json` the result. In all three, live check and held-out
repro are unchanged (both pass); exp-eval re-records the call itself when the file is absent.
The counted results are the original runs. The tool was fixed afterwards to exclude every
`test/repro/` re-recording from ALERT+ heads.
