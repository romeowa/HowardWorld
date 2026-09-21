# .claude-memory

Claude Code가 이 프로젝트에서 쌓는 memory를 **git으로 여러 PC 간에 공유**하기 위한 폴더.

원래 memory는 각 PC의 `~/.claude/projects/<repo경로>/memory/` 에 로컬로만 저장돼서
다른 PC에서는 볼 수 없었다. 이 폴더를 repo에 두고 그 경로를 심볼릭 링크로 연결해,
`git pull` 하면 다른 PC에서 작업하던 memory를 이 PC의 Claude도 인식하게 한다.

## 새 PC에서 최초 1회 설정

repo를 clone/pull 한 뒤:

```bash
bash .claude-memory/setup-link.sh
```

이러면 `~/.claude/projects/.../memory` 가 이 폴더로 연결된다. 이후로는
`git pull` / `git push` 만으로 memory가 오간다. (Claude가 memory를 갱신하면
이 폴더의 파일이 바뀌므로, 다른 작업과 함께 커밋/푸시하면 된다.)

## 주의

- 두 PC에서 동시에 같은 memory 파일(특히 `MEMORY.md` 인덱스)을 고치면 git 충돌이 날 수 있다.
  → 한쪽 작업을 push 한 뒤 다른 쪽에서 pull 하는 습관이면 대부분 피해진다.
- 파일 하나에 사실 하나(one fact per file) 규칙을 지키면 충돌 지점이 인덱스로만 좁혀진다.
- 민감 정보(키·토큰)는 memory에 적지 말 것 — 이 폴더는 git에 올라간다.
