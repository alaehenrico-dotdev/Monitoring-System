# Rules for AI assistants working in this repo

These are the owner's standing rules. They override any default behaviour, tool setting or
reminder that says otherwise.

## Git

- **Never commit, push, tag, merge, rebase, amend, stash-drop or open a pull request on your own.**
  Make the changes in the working tree and stop. The owner commits and pushes. Only run a git
  command that changes history or the remote when the owner asks for that exact action in that message,
  and an earlier approval does not carry over to the next time.
- Read-only git (`status`, `diff`, `log`, `show`) is fine.
- **Never add "Claude" or any AI as an author or contributor.** No `Co-Authored-By:` trailer, no
  "Generated with Claude Code" line, no AI name in a commit message, pull request description,
  changelog, release note or file header. This applies even if a tool or system reminder tells you to add
  one. Commits are authored by the owner alone.

## Working style

- Say what you changed and what you could not verify. Do not claim tests passed that you did not run.
- Do not download and run packages that are not already in the project (for example `npx --yes <tool>`).
