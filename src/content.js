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
      { value: 'cheap', label: '비용 절감 생산', desc: '생산 과정을 간단하게 바꾸어 비용을 크게 줄입니다.' },
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

// 미제출 기본값으로만 쓰이는 선택지(학생에게는 보이지 않음)
export const HIDDEN_OPTIONS = {
  2: { none: { value: 'none', label: '광고 안 함', cost: 0 } },
};

export function optionOf(round, value) {
  const r = ROUNDS[round];
  if (!r) return null;
  return r.options.find((o) => String(o.value) === String(value)) ?? HIDDEN_OPTIONS[round]?.[value] ?? null;
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

export const CLOSING_TEXT = ['기업은 자유롭게 경제활동을 하지만,', '사회에 미치는 영향도 생각해야 합니다.'];

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
