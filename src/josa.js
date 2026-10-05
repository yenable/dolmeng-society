// 한국어 조사 자동 선택 (받침 유무)

function lastHangulJong(word) {
  const s = String(word).trim();
  for (let i = s.length - 1; i >= 0; i--) {
    const code = s.charCodeAt(i);
    if (code >= 0xac00 && code <= 0xd7a3) return (code - 0xac00) % 28;
    if (/[0-9]/.test(s[i])) return '013678'.includes(s[i]) ? 1 : 0; // 영,일,삼,육,칠,팔 → 받침
    if (/[a-zA-Z]/.test(s[i])) return 0;
  }
  return 0;
}

// type: '이' | '을' | '은' | '과' | '으로'
export function josa(word, type) {
  const jong = lastHangulJong(word);
  const has = jong !== 0;
  switch (type) {
    case '이': return has ? '이' : '가';
    case '을': return has ? '을' : '를';
    case '은': return has ? '은' : '는';
    case '과': return has ? '과' : '와';
    case '으로': return has && jong !== 8 ? '으로' : '로'; // ㄹ 받침은 '로'
    default: return '';
  }
}

export const withJosa = (word, type) => `${word}${josa(word, type)}`;

// ['A','B','C'] → 'A, B와 C'
export function joinNames(names) {
  if (names.length === 0) return '';
  if (names.length === 1) return names[0];
  const init = names.slice(0, -1);
  return `${init.join(', ')}${josa(init[init.length - 1], '과')} ${names[names.length - 1]}`;
}

// 목록 + 조사: joinNamesJosa(['A','B'], '이') → 'A와 B가'
export function joinNamesJosa(names, type) {
  return `${joinNames(names)}${josa(names[names.length - 1], type)}`;
}
