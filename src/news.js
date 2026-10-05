// 실제 학생 선택(사회 이벤트)을 바탕으로 돌멩민국 경제뉴스를 만듭니다.
import { GAME_CONFIG as C } from './config.js';
import { COMPANIES, TEAM_IDS, companyName, won } from './content.js';
import { joinNames, joinNamesJosa } from './josa.js';

const chip = (id, note) => ({ id, name: companyName(id), color: COMPANIES.find((c) => c.id === id)?.color, note });

export function buildNews(state) {
  const out = { consumer: null, environment: null, fairness: null };
  const total = TEAM_IDS.length;

  if (state.rounds[2]?.computed) {
    const ids = TEAM_IDS.filter((id) => state.teams[id].choices.ad === 'exaggerated');
    if (ids.length) {
      const names = ids.map(companyName);
      out.consumer = {
        key: 'consumer',
        tag: '돌멩민국 경제속보',
        category: '소비자 보호',
        headline: ids.length === total ? '슬랑이 광고 믿을 수 없다… 소비자 불만 폭발' : '슬랑이 소비자 불만 급증',
        lines: [
          ids.length === total
            ? '돌멩민국의 슬랑이 기업 5곳이 모두 슬랑이의 특징을 실제보다 크게 광고하면서 소비자의 불만이 쏟아지고 있습니다.'
            : `${joinNamesJosa(names, '이')} 슬랑이의 특징을 실제보다 크게 광고하면서 소비자의 불만이 이어지고 있습니다.`,
          '“광고를 보고 샀는데, 생각했던 것과 너무 달라요.” 소비자들은 이제 슬랑이 광고를 믿기 어렵다고 말합니다.',
        ],
        companies: ids.map((id) => chip(id, '과장 광고')),
      };
    }
  }

  if (state.rounds[3]?.computed) {
    const by = (v) => TEAM_IDS.filter((id) => state.teams[id].choices.production === v);
    const cheap = by('cheap');
    const normal = by('normal');
    const eco = by('eco');
    if (cheap.length || normal.length) {
      const lines = [];
      if (cheap.length) {
        lines.push(`${joinNamesJosa(cheap.map(companyName), '이')} 생산 과정을 지나치게 간단하게 바꾸면서 폐기물이 제대로 처리되지 않아, 공장 주변 하천이 오염되었습니다.`);
      }
      if (normal.length) {
        lines.push(`${joinNames(normal.map(companyName))}의 공장에서${cheap.length ? '도' : ''} 슬랑이를 만들며 나온 쓰레기와 오염 물질이 늘어나고 있습니다.`);
      }
      if (eco.length) {
        lines.push(`한편 ${joinNamesJosa(eco.map(companyName), '은')} 친환경 생산 방법을 선택했습니다.`);
      }
      out.environment = {
        key: 'environment',
        tag: '돌멩민국 경제속보',
        category: '환경',
        headline: cheap.length ? '슬랑이 공장 주변 하천 오염' : '슬랑이 생산 쓰레기 증가',
        lines,
        companies: [...cheap.map((id) => chip(id, '비용 절감 생산')), ...normal.map((id) => chip(id, '일반 생산'))],
      };
    }
  }

  const col = state.rounds[4]?.collusion;
  if (col && col.count >= 2) {
    const price = won(C.COLLUSION_PRICE);
    out.fairness = {
      key: 'fairness',
      tag: '돌멩민국 경제속보',
      category: '공정 경쟁',
      headline: col.count === total ? '슬랑이 가격 모두 올라… 싼 슬랑이 사라져' : '슬랑이 가격 일제히 상승',
      lines: [
        col.count === total
          ? `돌멩민국의 슬랑이 기업 5곳이 모두 가격을 ${price} 이상으로 맞추면서, 소비자는 비싼 슬랑이밖에 살 수 없게 되었습니다.`
          : `돌멩민국 ${total}개 슬랑이 기업 가운데 ${col.count}개 기업이 ${price} 이상의 가격을 유지하면서 소비자가 저렴한 제품을 선택하기 어려워졌습니다.`,
        '“용돈으로 슬랑이를 사기가 너무 어려워졌어요.” 기업끼리 가격을 함께 정하면서 경쟁이 사라졌다는 지적이 나옵니다.',
      ],
      companies: col.members.map((id) => chip(id, '공동 가격 참여')),
    };
  }
  return out;
}
