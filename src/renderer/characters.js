// 캐릭터별 성격·속도·대사. 그림은 '캐릭터 디자인' 폴더 → tools/make_sprites.py → sprite-manifest.js 로 들어온다.
const CHARACTERS = {
  chiikawa: {
    name: '치이카와',
    height: 104,
    walkSpeed: 38,
    special: 'cry',
    specialChance: 0.12,
    lines: {
      // 와…! 기쁠 때 · 후에…/흐에… 곤란할 때 · 히익…! 무서울 때 · 응…! 용기 낼 때 · 야하… 수줍게 기분 좋을 때
      click: ['와...!', '응...!', '후에...?'],
      pet: ['야하...', '와...!'],
      idle: ['응...!', '와...!', '야하...'],
      special: ['히익...!', '후에...', '흐에...'],
      hungry: ['흐에...', '후에...'],
      eat: ['와...!', '야하...'],
      sleepy: ['후에...'],
      meet: ['와...!', '야하...'],
      play: ['와...!', '응...!'],
      grab: ['히익...!', '흐에...!?'],
    },
  },
  hachiware: {
    name: '하치와레',
    height: 104,
    walkSpeed: 48,
    special: 'sing',
    specialChance: 0.15,
    lines: {
      click: ['뭐가 어떻게 된 거지...?', '아마도... 그런 느낌이겠지?', '내가 어떻게든 해볼게!'],
      pet: ['아마도... 그런 느낌이겠지?', '음~ 역시 맛있어!'],
      idle: ['아마도... 그런 느낌이겠지?', '뭐가 어떻게 된 거지...?'],
      special: ['♪', '♪ ♪', '♪~'], // 노래 부르기 (대사 없이 음표만)
      hungry: ['뭐가 어떻게 된 거지...?'],
      eat: ['음~ 역시 맛있어!'],
      sleepy: ['아마도... 그런 느낌이겠지?'],
      meet: ['이거... 너랑 똑같은 거다!', '내가 어떻게든 해볼게!'],
      play: ['이거... 너랑 똑같은 거다!', '내가 어떻게든 해볼게!'],
      cheer: ['내가 어떻게든 해볼게!'],
      grab: ['뭐가 어떻게 된 거지...?'],
      comfort: ['울어버렸다...!'], // 치이카와가 울 때 옆에서
    },
  },
  usagi: {
    name: '우사기',
    height: 104,
    walkSpeed: 60,
    runSpeed: 380,
    special: 'dash',
    specialChance: 0.22,
    lines: {
      click: ['우라!', '야하!', '하아?'],
      pet: ['야하!', '우라!'],
      idle: ['하아?', '푸루루루루... 하아~!'],
      special: ['이하~!', '우라!', '푸루루루루... 하아~!'],
      hungry: ['하아?'],
      eat: ['우라!', '야하!'],
      sleepy: ['하아?'],
      meet: ['야하!', '이하~!'],
      play: ['우라!', '이하~!'],
      grab: ['하아?'],
    },
  },
  rakko: {
    name: '랏코',
    height: 104,
    walkSpeed: 55,
    runSpeed: 320,
    special: 'dash', // 스승님답게 앞장서서 질주
    specialChance: 0.12,
    lines: {
      click: ['따라와라!', '강해져라.'],
      pet: ['…음.', '강해져라.'],
      idle: ['강해져라.', '자신의 몸은 스스로 지키는 것이다.'],
      special: ['따라와라!'],
      hungry: ['스위츠…!'],
      eat: ['스위츠…!', '단것은 배가 따로 있다.'],
      sleepy: ['…'],
      meet: ['따라와라!', '강해져라.'],
      play: ['강해져라.'],
      grab: ['…!'],
    },
  },
  momonga: {
    name: '모몽가',
    height: 104,
    walkSpeed: 50,
    special: 'emote', // 귀여움 뽐내기
    emoteFx: '✨',
    specialChance: 0.2,
    lines: {
      click: ['칭찬해라!', '귀엽다고 말해!', '나를 더 우러러봐라!'],
      pet: ['후후… 보라구, 이 귀여움을!', '칭찬해라!'],
      idle: ['귀엽다고 말해!', '혼내줘!', '칭찬해라!'],
      special: ['후후… 보라구, 이 귀여움을!'],
      hungry: ['나를 더 우러러봐라!'],
      eat: ['칭찬해라!', '후후…'],
      sleepy: ['혼내줘!'],
      meet: ['나를 더 우러러봐라!', '귀엽다고 말해!'],
      play: ['칭찬해라!'],
      grab: ['혼내줘!'],
    },
  },
  shisa: {
    name: '시사',
    height: 104,
    walkSpeed: 52,
    special: 'emote', // 열심히 일하기
    emoteFx: '💦',
    specialChance: 0.15,
    lines: {
      click: ['열심히 하겠습니다!', '너무 기뻐요~!'],
      pet: ['너무 기뻐요~!'],
      idle: ['열심히 하겠습니다!', '수고하셨습니다~!'],
      special: ['슈퍼 알바이트 자격증, 땄습니다!', '열심히 하겠습니다!'],
      hungry: ['수고하셨습니다~!'],
      eat: ['너무 기뻐요~!'],
      sleepy: ['수고하셨습니다~!'],
      meet: ['마시자! 자!', '수고하셨습니다~!'],
      play: ['너무 기뻐요~!'],
      grab: ['너무 기뻐요~!?'],
      cheer: ['수고하셨습니다~!'],
    },
  },
  kani: {
    name: '헌책방',
    height: 104,
    walkSpeed: 34,
    special: 'emote', // 앉아서 책 읽기 (집중 그림)
    emoteState: 'sit',
    emoteSprite: 'focus',
    specialChance: 0.18,
    lines: {
      click: ['헌책… 보시겠어요…?', '괜찮아…?'],
      pet: ['에헤헤… 고마워'],
      idle: ['헌책… 보시겠어요…?', '이거, 읽어본 적 있어…?'],
      special: ['이거, 읽어본 적 있어…?'],
      hungry: ['괜찮아…?'],
      eat: ['에헤헤… 고마워'],
      sleepy: ['괜찮아…?'],
      meet: ['에헤헤… 고마워', '이거, 읽어본 적 있어…?'],
      meetWith: { momonga: ['모몽가, 같이 가자'] },
      play: ['에헤헤… 고마워'],
      grab: ['괜찮아…?'],
      comfort: ['괜찮아…?'], // 치이카와가 울 때 옆에서
    },
  },
  kurimanju: {
    name: '쿠리만쥬',
    height: 104,
    walkSpeed: 30,
    special: 'emote', // 한잔 즐기기
    emoteState: 'sit',
    emoteProp: '🍶',
    specialChance: 0.15,
    lines: {
      click: ['음…', '응? 마실래?'],
      pet: ['하아-…'],
      idle: ['하아-…', '음…', '이거랑… 이걸로…'],
      special: ['푸하-!'],
      hungry: ['이거랑… 이걸로…'],
      eat: ['푸하-!', '음…'],
      sleepy: ['하아-…'],
      meet: ['응? 마실래?'],
      play: ['음…'],
      grab: ['음…?'],
    },
  },
};

// 처음 설치했을 때 바탕화면에 나오는 친구들 (나머지는 설정에서 켬)
const DEFAULT_ON = ['chiikawa', 'hachiware', 'usagi'];
const MAX_ON_DESKTOP = 5;

const SNACKS = [
  { id: 'onigiri', name: '주먹밥', icon: '🍙', price: 5, hunger: 30, mood: 5 },
  { id: 'pudding', name: '푸딩', icon: '🍮', price: 8, hunger: 20, mood: 20 },
  { id: 'ramen', name: '라면', icon: '🍜', price: 12, hunger: 60, mood: 10 },
];
