// 화면에 보이는 문구(기업, 라운드 상황, 선택지 설명). 비용 숫자는 GAME_CONFIG 에서 가져옵니다.
import { GAME_CONFIG as C } from './config.js';
import { josa } from './josa.js';

export const won = (n) => `${String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}원`;

export const COMPANIES = [
  { id: 1, name: '말랑컴퍼니', color: '#F0508A' },
  { id: 2, name: '통통슬라임', color: '#16A36A' },
  { id: 3, name: '몽글기업', color: '#7C5CF2' },
  { id: 4, name: '쫀득상사', color: '#E8860C' },
  { id: 5, name: '젤리팩토리', color: '#2F7BF0' },
];
export const TEAM_IDS = COMPANIES.map((c) => c.id);
export const companyName = (id) => COMPANIES.find((c) => c.id === Number(id))?.name ?? `${id}모둠`;

// 문장: 우리 기업은 [label]으로 결정했습니다. / [label]을 선택했습니다.
const decided = (label) => ({ pre: '우리 기업은 ', strong: label, post: `${josa(label, '으로')} 결정했습니다.` });
const chose = (label) => ({ pre: '우리 기업은 ', strong: label, post: `${josa(label, '을')} 선택했습니다.` });

const PRICE_DESC = {
  5000: '저렴한 가격입니다. 많은 소비자의 관심을 받을 수 있습니다.',
  10000: '비교적 저렴한 가격입니다. 판매량과 이윤을 함께 기대할 수 있습니다.',
  15000: '비교적 높은 가격입니다. 적게 팔더라도 한 개를 팔 때 받는 돈이 많습니다.',
  20000: '높은 가격입니다. 한 개를 팔 때 받는 돈은 크지만 소비자의 선택을 받기 어려울 수 있습니다.',
};

const REASON_HINTS = [
  '○○을 중요하게 생각했기 때문',
  '○○한 결과를 예상했기 때문',
  '다른 기업보다 ○○할 수 있다고 생각했기 때문',
];

export const ROUNDS = {
  1: {
    round: 1,
    key: 'price',
    decisionLabel: '가격',
    title: '가격 결정',
    question: '우리 슬랑이를 얼마에 팔까요?',
    situation: [
      '돌멩민국에 슬랑이 열풍이 불고 있습니다!',
      '우리 기업도 슬랑이를 팔기 시작합니다. 첫 번째 결정은 슬랑이 한 개의 가격입니다.',
      '정한 가격은 앞으로 계속 우리 슬랑이의 가격이 됩니다.',
    ],
    options: C.PRICE_OPTIONS.map((p) => ({
      value: p,
      label: won(p),
      desc: PRICE_DESC[p] ?? '',
      cost: 0,
      sentence: decided(won(p)),
    })),
    hints: REASON_HINTS,
  },
  2: {
    round: 2,
    key: 'ad',
    decisionLabel: '광고',
    title: '광고 방법',
    question: '어떤 광고로 슬랑이를 알릴까요?',
    situation: [
      '슬랑이를 더 많이 팔려면 소비자에게 우리 슬랑이를 알려야 합니다.',
      '광고 비용은 현재 가진 돈에서 바로 나갑니다.',
    ],
    options: [
      { value: 'celebrity', label: '유명인 광고', desc: '유명 연예인이 우리 슬랑이를 광고합니다. 많은 소비자의 관심을 받을 수 있습니다.' },
      { value: 'exaggerated', label: '과장 광고', desc: '슬랑이의 장점을 실제보다 크게 표현합니다. 적은 비용으로 소비자의 관심을 크게 끌 수 있습니다.' },
      { value: 'honest', label: '정직 광고', desc: '슬랑이의 실제 특징과 장점을 정확하게 알려줍니다.' },
    ].map((o) => ({ ...o, cost: C.AD_COSTS[o.value], sentence: chose(o.label) })),
    hints: REASON_HINTS,
  },
  3: {
    round: 3,
    key: 'production',
    decisionLabel: '생산',
    title: '생산 방법',
    question: '슬랑이를 어떤 방법으로 만들까요?',
    situation: [
      '슬랑이를 만드는 방법을 정해야 합니다.',
      '생산 비용은 현재 가진 돈에서 바로 나갑니다.',
    ],
    options: [
      { value: 'eco', label: '친환경 생산', desc: '환경에 미치는 영향을 줄이는 재료와 생산 방법을 사용합니다.' },
      { value: 'normal', label: '일반 생산', desc: '일반적인 재료와 생산 방법을 사용합니다.' },
      { value: 'cheap', label: '비용 절감 생산', desc: '환경에는 좋지 않지만, 생산 비용을 크게 줄일 수 있습니다.' },
    ].map((o) => ({ ...o, cost: C.PRODUCTION_COSTS[o.value], sentence: chose(o.label) })),
    hints: REASON_HINTS,
  },
  4: {
    round: 4,
    key: 'collusion',
    decisionLabel: '공동 제안',
    title: '슬랑이 기업 공동 제안',
    special: true,
    question: '참여하시겠습니까?',
    situation: [
      '최근 슬랑이 가격 경쟁이 심해지고 있습니다.',
      `참여 기업끼리 앞으로 슬랑이 가격을 ${won(C.COLLUSION_PRICE)} 이상으로 유지하려고 합니다.`,
      '함께 참여하는 기업이 많을수록 높은 가격을 유지하기 쉬워집니다.',
    ],
    options: [
      { value: 'join', label: '참여한다', desc: `이번 판매부터 슬랑이를 ${won(C.COLLUSION_PRICE)}에 팝니다.`, sentence: chose('참여') },
      { value: 'no', label: '참여하지 않는다', desc: '처음 정한 가격을 그대로 유지합니다.', sentence: chose('참여하지 않음') },
    ].map((o) => ({ ...o, cost: 0 })),
    prediction: {
      question: '다른 기업들은 어떻게 결정할 것 같나요?',
      options: [
        { value: 'most', label: '대부분 참여할 것 같다' },
        { value: 'half', label: '반반일 것 같다' },
        { value: 'few', label: '대부분 참여하지 않을 것 같다' },
      ],
    },
    hints: REASON_HINTS,
  },
};

export function optionOf(round, value) {
  const r = ROUNDS[round];
  if (!r) return null;
  return r.options.find((o) => String(o.value) === String(value)) ?? null;
}
export const optionLabel = (round, value) => optionOf(round, value)?.label ?? '-';

export const REFLECTION = {
  title: '다시 경영한다면?',
  question: '우리 기업의 선택 중 하나를 바꾼다면?',
  hints: [
    '사회에 미치는 영향을 생각했기 때문',
    '소비자에게 ○○한 영향을 줄 수 있기 때문',
    '환경에 ○○한 영향을 줄 수 있기 때문',
    '다른 기업과의 경쟁을 생각했기 때문',
    '이윤과 사회에 미치는 영향을 함께 생각했기 때문',
  ],
};

// 최종 사회점수 장면의 발문 (정답·정의는 보여주지 않음 — 학생 발표와 교사 발문용 정지 화면)
export const SCORE_QUESTIONS = {
  main: '우리 기업들은 이윤을 높이기 위해 선택했는데, 왜 돌멩민국의 사회점수는 낮아졌을까요?',
  sub: '기업의 선택은 누구에게 어떤 영향을 주었나요?',
};

export const CLOSING_TEXT =['기업은 자유롭게 경제활동을 하지만,', '사회에 미치는 영향도 생각해야 합니다.'];

// ── 도입 슬라이드 (전시학습 상기 → 동기유발 → 배움주제 → 활동 안내) ─────────────────
//  TV 에서 PPT 처럼 → ← 로 넘김. 퀴즈의 초성 힌트·정답은 공개 단계가 되기 전에는 TV 로 보내지 않음.
//  빈칸 문장: 줄마다 [문자열 | { blank: 번호 }] 조각 목록
export const LESSON = {
  wait: {
    title: '오늘은 기업을 직접 경영해봅니다',
    foot: '모둠별로 앉아 수업을 준비해주세요.',
  },
  testStart: {
    title: '기업 경영자 자격 TEST',
    lines: ['오늘 여러분은 기업의 대표가 되어', '직접 기업을 운영해볼 것입니다.', '우선 기업 경영자가 될 준비가 되었는지', '간단한 테스트를 해봅시다.'],
    foot: '총 3문제',
  },
  q1: {
    type: 'choice',
    no: 'Q1',
    question: '‘이윤’의 뜻으로 알맞은 것은 무엇일까요?',
    choices: [
      '물건을 팔아 얻은 돈 전체',
      '물건을 만드는 데 사용한 돈',
      '물건이나 서비스를 팔아 얻은 수입에서 생산에 들어간 비용을 뺀 금액',
      '기업이 가지고 있는 돈 전체',
    ],
    answer: 3, // ③
    formula: '이윤 = 수입 - 비용',
  },
  q2: {
    type: 'blank',
    no: 'Q2',
    question: '기업은 어떤 일을 할까요?',
    lines: [
      ['기업은 물건이나 서비스를'],
      [{ blank: 0 }, ' · ', { blank: 1 }, '하고,'],
      ['가계에 ', { blank: 2 }, '를 제공합니다.'],
    ],
    hints: ['ㅅㅅ', 'ㅍㅁ', 'ㅇㅈㄹ'],
    answers: ['생산', '판매', '일자리'],
  },
  q3: {
    type: 'blank',
    no: 'Q3',
    question: '가계는 어떤 일을 할까요?',
    lines: [
      ['가계는 기업의 생산 활동에 참여하여'],
      [{ blank: 0 }, '을 얻고,'],
      ['물건이나 서비스를 ', { blank: 1 }, '합니다.'],
    ],
    hints: ['ㅅㄷ', 'ㅅㅂ'],
    answers: ['소득', '소비'],
  },
  pass: {
    title: '기업 경영자 자격 TEST',
    big: '통과!',
    lines: ['이제 직접 기업을 경영해봅시다.'],
  },
  country: {
    title: '여기는 돌멩민국입니다.',
    lines: ['최근 돌멩민국에서는', '새로운 장난감 ‘슬랑이’가', '큰 인기를 얻고 있습니다.'],
    note: '슬랑이 = 슬라임 + 말랑이 피젯토이',
  },
  companies: {
    title: '그런데 슬랑이를 파는 기업이 5곳이나 생겼습니다.',
    ask: '같은 종류의 슬랑이를 파는 기업이 여러 곳이면 어떤 일이 생길까요?',
  },
  mission: {
    eyebrow: '오늘의 미션',
    title: '우리 기업을 직접 경영하라!',
    lines: ['모둠별로 하나의 슬랑이 기업을 맡습니다.', '여러분의 선택에 따라', '판매량 · 이윤 · 순위가 달라집니다.'],
    foot: '어떤 기업이 가장 좋은 결과를 얻을지 확인해봅시다.',
  },
  topic: {
    eyebrow: '오늘의 배움',
    lines: ['기업 경영 시뮬레이션을 통해', '기업의 자유와 사회적 책임을 알아봅시다.'],
  },
  activities: {
    title: '오늘의 활동',
    items: [
      { no: '활동 1', title: '우리 기업, 어떻게 운영할까?', desc: '모둠별로 기업의 경영 방법을 선택해보기' },
      { no: '활동 2', title: '우리 기업, 정말 잘 운영한 걸까?', desc: '기업의 선택이 사회에 미친 영향 살펴보기' },
    ],
  },
  act1Title: { eyebrow: '활동 1', title: '우리 기업, 어떻게 운영할까?' },
  act1Ask: { lines: ['기업을 운영할 때', '무엇을 중요하게 생각해야 할까요?'] },
  howto: {
    title: '기업 경영 시뮬레이션은 이렇게 진행합니다',
    flow: [
      { icon: '🔍', label: '상황 확인' },
      { icon: '💬', label: '모둠 토의' },
      { icon: '👆', label: '선택' },
      { icon: '✏️', label: '이유 입력' },
      { icon: '⚖️', label: '다른 기업과 비교' },
      { icon: '📊', label: '시장 결과 확인' },
    ],
    foot: ['각 라운드에서 모둠원과 의논하여', '우리 기업의 선택을 결정하세요.'],
  },
};

export const CATEGORY_LABELS = {
  consumer: '소비자 보호',
  environment: '환경',
  fairness: '공정 경쟁',
};

// 테스트 패널 자동 입력용 이유
export const SAMPLE_REASONS = {
  1: ['많은 친구들이 살 수 있을 것 같기', '한 개를 팔 때 돈을 많이 벌 수 있기', '다른 기업보다 싸게 팔 수 있다고 생각했기', '판매량과 이윤을 함께 생각했기'],
  2: ['적은 돈으로 많이 팔 수 있을 것 같기', '많은 사람이 관심을 가질 것 같기', '소비자에게 정확한 정보를 주고 싶었기'],
  3: ['돈을 아껴서 이윤을 높이고 싶었기', '보통 방법이 가장 무난하다고 생각했기', '환경을 생각했기'],
  4: ['다 같이 비싸게 팔면 돈을 많이 벌 것 같기', '우리만 싸게 팔면 더 많이 팔릴 것 같기', '소비자에게 불공평하다고 생각했기'],
  reflection: ['환경에 나쁜 영향을 줄 수 있기', '소비자에게 피해를 줄 수 있기', '이윤과 사회에 미치는 영향을 함께 생각했기'],
};
