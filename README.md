# 돌멩민국 슬랑이 시장

초등 6학년 사회 공개수업용 실시간 기업 경영 시뮬레이션.
**Vercel(정적 화면 + 서버 함수) + Supabase(상태 저장·Realtime)** 로 동작합니다. 서버를 계속 켜 둘 필요가 없습니다.

> 예전 `node server.js` 버전(노트북 한 대로 돌리는 비상용)은 **`legacy-node` 브랜치**에 그대로 보존되어 있습니다.
> `git checkout legacy-node && node server.js` 로 언제든 다시 쓸 수 있습니다. main 의 코드와 섞지 마세요.

## 주소

| 누가 | 주소 | 설명 |
|---|---|---|
| 학생 | `https://<도메인>/` | 들어가면 곧바로 **기업 선택**. QR 로 이 주소 하나만 공유 (`/play` 도 같은 화면) |
| 교사 | `https://<도메인>/admin` | 교사 PIN 로그인 → 진행 콘솔 |
| 교실 TV | `https://<도메인>/display` | 교사 콘솔 진행에 따라 자동으로 바뀜. **키보드·PPT 리모컨으로도 앞뒤 진행** (처음 한 번 교사 PIN 확인) |

> 예전 주소 `/display?presenter=1` 도 그대로 동작합니다(처음부터 PIN 입력 창). `/display?preview=1` 은 교사 콘솔 미리보기용으로 키 입력을 받지 않습니다.

## 처음 배포하기 (한 번만)

### 1) Supabase
1. [supabase.com](https://supabase.com) 에서 새 프로젝트 생성 (Region: Northeast Asia (Seoul) 권장)
2. 왼쪽 **SQL Editor → New query** 에 **`supabase/schema.sql` 파일 전체를 붙여 넣고 Run** 하세요.
   (여러 번 실행해도 안전합니다. 테이블·제약·RLS·RPC·Realtime 설정이 모두 들어 있습니다.)
3. **Project Settings → API** 에서 세 값을 복사해 둡니다.
   - Project URL → `SUPABASE_URL`
   - `anon` `public` 키 → `SUPABASE_ANON_KEY` (Legacy API keys 탭의 anon 키 권장)
   - `service_role` `secret` 키 → `SUPABASE_SERVICE_ROLE_KEY` (Legacy 탭의 service_role 키 권장)
4. (확인) **Database → Publications → supabase_realtime** 에 `session_pulse` 테이블이 켜져 있어야 합니다. SQL 이 자동으로 켜 줍니다.

### 2) Vercel
1. Vercel → **Add New → Project** → GitHub `dolmeng-society` 저장소 Import
2. Framework Preset: **Other** (빌드 명령 없음. `vercel.json` 이 알아서 설정)
3. **Settings → Environment Variables** 에 4개 입력 (Production, Preview 모두 체크)

   | 이름 | 값 | 공개 여부 |
   |---|---|---|
   | `SUPABASE_URL` | Project URL | 브라우저에 전달됨 (공개 가능) |
   | `SUPABASE_ANON_KEY` | anon 키 | 브라우저에 전달됨 (공개 가능 — RLS 로 `session_pulse` 읽기만 허용) |
   | `SUPABASE_SERVICE_ROLE_KEY` | service_role 키 | **서버 전용. 절대 공개 금지.** 브라우저 코드에 들어가지 않음 |
   | `ADMIN_PIN` | 교사 PIN (예: 6자리 이상) | 서버 전용. 비우면 기본값 `2580` |

4. **Deploy**. 환경변수를 바꾼 뒤에는 **Redeploy** 해야 반영됩니다.
5. `https://<도메인>/admin` 에 PIN 으로 로그인되면 끝 (첫 로그인 때 게임 세션이 만들어집니다).

## 수업 당일

### 준비 (수업 10분 전)
1. 교사 노트북: `/admin` 로그인 → 리허설 데이터가 있으면 **전체 초기화** ('모둠 접속은 유지' 체크 해제 권장)
2. 교실 TV 컴퓨터: `/display` 를 열고 **화면을 한 번 클릭** (전체화면 + 효과음 허용). 오른쪽 아래 **⛶ 전체화면** 버튼으로도 켜고 끌 수 있습니다.
   - 리모컨·키보드로 처음 `→` 를 누르면 교사 PIN 을 한 번 묻습니다. 이 컴퓨터에 기억되므로 다음부터는 묻지 않습니다
     (같은 컴퓨터에서 `/admin` 에 로그인해 두었다면 묻지 않음).
   - 왼쪽 아래 작은 `리모컨 진행 ●` 이 보이면 준비 완료 (초록=대기, 주황=처리 중, 빨강=넘길 수 없음)
3. 모둠 노트북 5대: 사이트 주소(`/`) 접속 → 각자 기업 선택 → 교사 콘솔·TV 에서 5개 '접속' 확인

### 진행
- 교사 콘솔 **[다음]** 또는 TV 키보드·리모컨으로 진행 (둘 다 같은 서버 명령·같은 단계를 씀)
- **도입** (전체 초기화하면 여기서 시작 — 수업 전부터 TV 에 띄워 두기): 수업 대기 화면 → 기업 경영자 자격 TEST
  → Q1 이윤(객관식: → 한 번 더 = 정답 ③ + `이윤 = 수입 - 비용`) → Q2 기업의 역할 · Q3 가계의 역할(빈칸: 필요할 때만 `H`/힌트 버튼으로 초성 힌트 → `→` 정답)
  → 통과 → 돌멩민국 → 슬랑이 기업 5곳 → 오늘의 미션 → 배움주제 → 오늘의 활동 → 활동 1 → 도입 발문 → 진행 방법 → 기업 선택 확인 → 1라운드
  - 퀴즈 `←` 는 한 단계씩 되돌림 (정답 → 힌트 → 문제 → 이전 슬라이드). 교사 콘솔에 `문제만 › 초성 힌트 공개 › 정답 공개` 중 현재 단계 표시
  - 문구는 `src/content.js` 의 `LESSON`. 학생 노트북은 도입 동안 기업 선택·환영 화면
- 라운드마다: 상황 → 회의 시작 → 선택과 이유 공개 → 시장 결과 → 이윤 순위
- 4라운드 후: **최종 순위**(빈 무대 → 두구두구 → 3위 → 2위 → 두구두구 → 1위 → 4·5위 자동 공개, 약 5초)
  → **하지만…(검정 화면)**
  → 뉴스 한 기사당 한 클릭(소비자·환경·공정 경쟁: 속보음 → 제목 타이핑 → 약 1초 뒤 기사 내용·관련 기업 **자동** 등장)
  → **돌멩일보 사회면**(오늘의 주요 기사 제목이 차례로 타이핑)
  → **사회점수**: 시작 100 → 클릭마다 범주 하나씩 합계 공개(소비자 보호 → 환경 → 공정 경쟁, 감점 없는 범주는 건너뜀)
    → 한 번 더 누르면 최종 점수가 화면 가운데로 커지며 빨간색 + 발문(자동으로 넘어가지 않음)
  → 우리 기업의 선택 다시 생각하기(정리 활동) → 바꾼 선택 공개 → 마무리 문장
- 실제 학생 선택 때문에 생기지 않은 뉴스·감점 범주는 자동으로 건너뜁니다.

### TV 키보드·프레젠터 리모컨
| 키 | 동작 |
|---|---|
| `→` `PageDown` `Enter` `Space` | 다음 장면 |
| `←` `PageUp` `Backspace` | 이전 장면 |
| `H` | 도입 Q2·Q3 초성 힌트 보이기/숨기기 (교사 콘솔에서도 `H`) |

- 한 번 누르면 한 장면만 넘어갑니다 (0.6초 입력 잠금, 키를 누르고 있어도 반복되지 않음).
- **학생이 결정 중인 회의 단계(제출 미완료)와 정리 활동 작성 중에는 리모컨으로 넘어가지 않습니다.**
  TV 에 "아직 결정 중인 기업이 있습니다. 강제 진행은 교사 화면에서 할 수 있습니다." 가 잠깐 뜹니다. 강제 진행은 `/admin` 에서만.
- 최종 순위 이후(검정 화면·뉴스·사회면·사회점수·정리 결과·마무리)는 PPT 처럼 자유롭게 앞뒤로 넘길 수 있습니다.

### 문제 상황
| 상황 | 해결 |
|---|---|
| 학생 노트북 새로고침·탭 닫힘·절전·와이파이 끊김 | 다시 `/` 접속하면 **같은 기업으로 자동 복귀**. 쓰던 이유도 그대로 복구 |
| 화면 오른쪽 아래 "연결이 잠시 끊겼어요" | 기다리면 자동 재연결 → "✓ 다시 연결되었습니다." (기업 선택은 지워지지 않음) |
| 미제출 모둠 | **자동 기본값은 없습니다.** 결과 계산 단계로 넘어갈 때 미제출 기업이 있으면 교사 콘솔이 "○○기업이 아직 광고 방법을 선택하지 않았습니다" 창을 띄우고, 교사가 그 기업의 선택을 직접 지정해야 진행됩니다. 미리 [대신 제출]로 지정해도 됩니다 |
| 잘못 제출 | [제출 초기화] (비용 환불, 학생이 다시 제출) |
| 노트북 교체/고장 | [연결 해제] 후 새 노트북에서 같은 기업 선택 (기록 유지) |
| 교사 콘솔·TV 새로고침 | 현재 단계 그대로 복귀 |

## 게임 밸런스 — `src/config.js` 의 `GAME_CONFIG`
모든 경제 규칙과 사회점수 규칙은 이 한 객체에 있습니다. 바꾼 뒤 `npm run simulate` 로 결과 분포를 확인하고 다시 배포하세요.
화면 문구(상황 설명, 선택지 설명)는 `src/content.js`, 뉴스 문장은 `src/news.js` 에 있습니다.
계산은 모두 서버 함수에서만 하며, 숨은 값(광고 배수, 시장 변동, 사회점수 규칙 등)은 학생·TV 브라우저로 보내지 않습니다.

## 구조

```
public/                     화면 (정적 파일)
  index.html                학생 화면 ( / 와 /play )
  admin.html, display.html  교사 콘솔, 교실 TV (키보드·리모컨 진행)
  js/common.js              Realtime 신호 + 주기적 확인, 연결 상태 표시
  js/sfx.js                 효과음: 뉴스 시그널·타자·두구두구·팡파르 (Web Audio 합성, 파일 없음)
api/                        Vercel 서버 함수 (실제 처리는 src/api.js)
  state.js                  GET  /api/state?role=play|display|admin   역할별 화면 데이터
  play/[action].js          POST /api/play/claim|leave|submit|reflect
  admin/[action].js         POST /api/admin/login|action  (교사 PIN 필요)
  config.js                 GET  /api/config  (Supabase URL·anon 키만)
src/
  config.js                 ★ GAME_CONFIG (밸런스), SERVER_CONFIG
  engine.js                 진행 단계, 시장 계산(라운드당 1회), 사회점수, 역할별 화면 데이터
  api.js                    API 라우팅, 낙관적 잠금(revision) 저장, PIN 확인
  store.js                  Supabase(PostgREST RPC) / 메모리 저장소
  projection.js             엔진 상태 → 정규화 테이블 행
supabase/schema.sql         ★ Supabase SQL Editor 에서 실행할 스키마
scripts/                    로컬 서버, 테스트, 시뮬레이션
```

### 데이터 흐름
- 진짜 기준은 `game_sessions.state` (엔진 상태 JSON). 모든 변경은 서버 함수가 **최신 상태 읽기 → 규칙 적용 → `revision` 이 그대로일 때만 저장**(`slangi_save` RPC, 한 트랜잭션). 누가 먼저 바꿨으면 최신 상태로 다시 시도합니다.
- 같은 트랜잭션에서 `teams / responses / round_results / social_events / reflections` 도 함께 기록됩니다 (기록 확인용 + UNIQUE 제약 이중 안전장치).
- `round_results` 는 한 번 기록되면 바뀌거나 지워질 수 없습니다(DB 가 거부). 라운드 결과·돈 지급은 정확히 한 번.
- 브라우저는 `session_pulse`(세션 id·revision·현재 단계만)를 Realtime 으로 구독하고, 신호가 오면 `/api/state` 로 자기 역할 화면만 받아 갑니다. Realtime 이 막혀도 2~5초마다 확인하므로 화면이 어긋나지 않습니다.
- 전체 초기화 = 새 세션 생성. 이전 세션은 `archived` 로 보관되어 수업 데이터와 섞이지 않습니다.

## 로컬에서 실행 / 테스트

```bash
npm install                 # 테스트 도구(PGlite, puppeteer-core)만 설치됨. 운영에는 의존성 없음
npm run dev                 # .env 에 Supabase 값이 있으면 Supabase, 없으면 메모리 저장소 (http://localhost:3000)
npm run dev:memory          # 항상 메모리 저장소 (끄면 초기화, Realtime 없이 polling)
npm test                    # 엔진 단위 + HTTP 통합(메모리) + Supabase 스키마 통합(PGlite 에서 schema.sql 실제 실행)
npm run test:browser        # 실제 브라우저(Edge/Chrome): 재접속·draft 복구·네트워크 끊김·TV 키보드 진행·연출
npm run simulate            # 밸런스 시뮬레이션 (무작위 5,000판; 판 수 지정: npm run simulate -- 20000)
```
