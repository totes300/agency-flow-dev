# Shared-worktree Git safety and recovery

The repository may be used concurrently by the user and multiple agents. A dirty
working tree is normal and must not be "cleaned up" for convenience.

## Safe inspection

Use read-only commands to understand repository state:

```bash
git status --short
git diff -- path/to/file
git diff HEAD -- path/to/file
git show HEAD:path/to/file
git log -p -- path/to/file
git blame path/to/file
```

If a tool must inspect a historical file, write `git show` output to a temporary
location rather than restoring it over the working copy.

## Prohibited cleanup shortcuts

Do not use these commands to create a clean baseline or hide concurrent work:

- `git stash` in any form;
- `git clean`;
- `git restore` or `git checkout --` on working files;
- destructive reset commands;
- temporary worktree and file-copy schemes that obscure ownership of changes.

If discarding work is genuinely required, first inspect the exact diff and obtain
explicit user approval.

## If a stash was accidentally created

1. Stop mutating the repository. Do not pop, drop, or clear the stash repeatedly.
2. Record `git status --short` and `git stash list`.
3. Save an insurance copy of the stash patch to a unique path under `/tmp`:

   ```bash
   git stash show -p stash@{0} > /tmp/agency-flow-stash-recovery.patch
   ```

4. Tell the user exactly what command ran, which changes disappeared from the
   working tree, and where the recovery patch is stored.
5. Let the user choose the recovery strategy. Generated files can cause conflicts,
   but do not discard them or other changes without approval.

## If a destructive command was accidentally run

1. Stop further writes, builds, generators, and Git cleanup commands.
2. Capture current status, reflog, and relevant diffs using read-only commands.
3. Report the affected paths and the exact command immediately.
4. Preserve recoverable objects and temporary files. Do not attempt an improvised
   cleanup that could overwrite remaining evidence.

The priority is preserving all recoverable user and agent work, not returning the
repository to a visually clean state.
