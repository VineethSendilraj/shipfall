# Stages only the chosen hunks (1-based, in `git diff -- <path>` order) of one file.
# Usage: python3 explore-stage-hunks.py <path> <n,n,...>   (run from the repo root)
import subprocess, sys

path, picks = sys.argv[1], {int(a) for a in sys.argv[2].split(',')}
diff = subprocess.run(['git', 'diff', '--', path], capture_output=True, text=True, check=True).stdout
head, hunks = [], []
for line in diff.splitlines(keepends=True):
    if line.startswith('@@'):
        hunks.append([line])
    elif hunks:
        hunks[-1].append(line)
    else:
        head.append(line)
patch = ''.join(head) + ''.join(''.join(h) for i, h in enumerate(hunks, 1) if i in picks)
subprocess.run(['git', 'apply', '--cached', '-'], input=patch, text=True, check=True)
print(f'staged hunks {sorted(picks)} of {len(hunks)} in {path}')
