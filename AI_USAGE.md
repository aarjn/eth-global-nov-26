# AI usage

ETHGlobal's rules ask every team to say where and how AI tools were used. This file is kept up to date during the build.

- **Team:** one human (aarjn). The human chose the product, the sponsors and the trade-offs (see `DECISIONS.md`), tested every milestone on a phone, visited the sponsor booths and wrote the feedback notes.
- **Planning:** the build plan (`PLAN.md`) was drafted by an AI planning agent from research the human asked for, then reviewed and approved by the human.
- **Code:** written by AI coding agents (Claude) working from the specs and prompts in `docs/specs/` and `docs/prompts/`. Each workstream's prompt is saved there unchanged.
- **Tests, verification and docs:** drafted by AI agents and checked against the live chain.
- **Video:** screen recording scripted by AI; the narration is the human's own voice (no text-to-speech).

A per-file list is added below as files land.

## Files and who wrote them

| Path | Written by | Notes |
|---|---|---|
| `PLAN.md` | AI planning agent, approved by the human | |
| `package.json`, `.gitignore`, `.env.example`, `scripts/load-env.sh` | AI coordinator | |
