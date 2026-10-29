// 일정 계산 도우미. 펫 창·설정 창(<script>)과 메인 프로세스(require)가 같이 쓴다.
// 일정 하나: { id, title, date: 'YYYY-MM-DD', time: 'HH:MM' | '', repeat, doneOn: ['YYYY-MM-DD', …] }
(function (root) {
  const REPEAT_LABELS = { none: '한 번', daily: '매일', weekdays: '평일', weekly: '매주' };
  const DAY_NAMES = ['일', '월', '화', '수', '목', '금', '토'];

  const pad = (n) => String(n).padStart(2, '0');

  function dateStr(d = new Date()) {
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }

  function parseDate(s) {
    const [y, m, d] = s.split('-').map(Number);
    return new Date(y, m - 1, d);
  }

  function addDays(s, n) {
    const d = parseDate(s);
    d.setDate(d.getDate() + n);
    return dateStr(d);
  }

  // 그 날짜에 이 일정이 있는지 (반복 일정은 시작일부터)
  function occursOn(item, day) {
    if (!item || !item.date || day < item.date) return false;
    const dow = parseDate(day).getDay();
    switch (item.repeat) {
      case 'daily':
        return true;
      case 'weekdays':
        return dow >= 1 && dow <= 5;
      case 'weekly':
        return dow === parseDate(item.date).getDay();
      default:
        return day === item.date;
    }
  }

  function isDone(item, day) {
    return Array.isArray(item.doneOn) && item.doneOn.includes(day);
  }

  // 그날 일정: 시간 없는(하루 종일) 일정 먼저, 그다음 시간순
  function itemsOn(list, day) {
    return list
      .filter((it) => occursOn(it, day))
      .sort((a, b) => (a.time || '').localeCompare(b.time || '') || a.title.localeCompare(b.title));
  }

  // 오늘 다음 날부터 days일 동안의 일정 [{ day, item }]
  // 매일·평일 반복은 '오늘'에 늘 보이니 다가오는 목록을 채우지 않게 뺀다
  function upcoming(list, fromDay, days) {
    const out = [];
    for (let i = 1; i <= days; i++) {
      const day = addDays(fromDay, i);
      for (const item of itemsOn(list, day)) {
        if (item.repeat === 'daily' || item.repeat === 'weekdays') continue;
        out.push({ day, item });
      }
    }
    return out;
  }

  function dayLabel(day, today = dateStr()) {
    if (day === today) return '오늘';
    if (day === addDays(today, 1)) return '내일';
    const d = parseDate(day);
    return `${d.getMonth() + 1}/${d.getDate()}(${DAY_NAMES[d.getDay()]})`;
  }

  const api = { REPEAT_LABELS, dateStr, addDays, occursOn, isDone, itemsOn, upcoming, dayLabel };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.ScheduleUtils = api;
})(this);
