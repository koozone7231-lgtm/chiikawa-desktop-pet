// 펫 한 마리의 상태 기계·물리·말풍선·수치를 담당한다.
const GRAVITY = 2200;

const rand = (a, b) => a + Math.random() * (b - a);
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

// 상태 → 보여 줄 그림(상황). 그 상황 그림이 없는 캐릭터는 SPRITE_FALLBACK을 거쳐 '기본'으로.
const STATE_SPRITE = {
  eat: 'eat',
  sleep: 'sleep',
  happy: 'happy',
  meet: 'greet',
  peek: 'focus',
  dance: 'dance',
  cheer: 'cheer',
  work: 'work',
  sing: 'special',
};
const SPRITE_FALLBACK = { greet: 'happy', cheer: 'happy' };

class Pet {
  constructor(id, def, stage, saved) {
    this.id = id;
    this.def = def;
    this.h = def.height;
    this.w = def.height; // 이미지가 로드되면 비율대로 갱신
    this.stats = Object.assign({ hunger: 80, mood: 80, energy: 90, affinity: 0 }, saved && saved.stats);
    this.x = saved && Number.isFinite(saved.x) ? saved.x : rand(50, window.innerWidth - 200);
    this.y = -this.h; // 위에서 떨어지며 등장
    this.vx = 0;
    this.vy = 0;
    this.dir = Math.random() < 0.5 ? -1 : 1;
    this.grounded = false;
    this.state = 'fall';
    this.stateLeft = 0;
    this.targetX = null;
    this.enabled = true;
    this.lastPetAt = 0;
    this.lastClickRewardAt = 0;
    this.bubbleTimer = null;

    this.el = document.createElement('div');
    this.el.className = 'pet';
    this.el.dataset.id = id;
    this.el.innerHTML = `
      <div class="bubble hidden"></div>
      <div class="fx"></div>
      <div class="prop hidden"></div>
      <div class="body"><img draggable="false" alt="${def.name}"></div>`;
    this.bubbleEl = this.el.querySelector('.bubble');
    this.fxEl = this.el.querySelector('.fx');
    this.propEl = this.el.querySelector('.prop');
    this.bodyEl = this.el.querySelector('.body');
    this.imgEl = this.el.querySelector('img');
    this.imgEl.style.height = `${this.h}px`;
    this.imgEl.onload = () => {
      // 그림마다 가로 폭이 달라서, 바꿀 때 몸 가운데가 제자리에 있도록 x를 맞춘다
      const oldW = this.w;
      this.w = Math.round((this.h * this.imgEl.naturalWidth) / this.imgEl.naturalHeight);
      this.el.style.width = `${this.w}px`;
      if (this.spriteLoadedOnce && this.state !== 'peek') this.x += (oldW - this.w) / 2;
      this.spriteLoadedOnce = true;
    };
    this.sprites = (typeof SPRITE_SETS !== 'undefined' && SPRITE_SETS[id]) || {};
    this.spriteKey = null;
    this.showSprite('default');
    stage.appendChild(this.el);
  }

  // 상황 그림으로 바꾼다 (없으면 대체 상황 → 기본). 같은 상황이면 그대로 둔다.
  showSprite(key) {
    let k = key;
    while (k && !this.sprites[k]) k = SPRITE_FALLBACK[k];
    if (!k) k = 'default';
    if (k === this.spriteKey) return;
    const list = this.sprites[k];
    if (!list || !list.length) return;
    this.spriteKey = k;
    this.imgEl.src = pick(list);
  }

  hasSprite(key) {
    return !!this.sprites[key];
  }

  get ground() {
    return window.innerHeight - 2;
  }

  get busy() {
    return ['held', 'fall', 'eat', 'happy', 'meet'].includes(this.state);
  }

  // ---- 상태 전환 ----
  setState(state, seconds = 0) {
    this.state = state;
    this.stateLeft = seconds;
    this.bodyEl.className = `body s-${state}`;
    this.el.classList.toggle('peeking', state === 'peek');
    this.propEl.classList.add('hidden');
    this.showSprite(this.nextSpriteKey || STATE_SPRITE[state] || 'default');
    this.nextSpriteKey = null;
    if (state === 'sleep') this.say(this.line('sleepy'), 1800, true);
  }

  chooseNext(world) {
    const s = this.stats;
    if (world.focus) {
      this.enterPeek(world);
      return;
    }
    if (s.energy < 18 || (world.isNight && s.energy < 45 && Math.random() < 0.3)) {
      this.setState('sleep', 9999);
      return;
    }
    if (s.hunger < 25 && Math.random() < 0.5) {
      this.setState('hungry', rand(5, 9));
      this.say(this.line('hungry'));
      return;
    }
    if (s.mood < 30 && Math.random() < 0.4) {
      this.setState('sad', rand(5, 9));
      this.say('시무룩…');
      return;
    }
    // 음악이 나오면 춤 (설정에서 끌 수 있음)
    if (world.music && world.music.playing && settings.danceToMusic && Math.random() < 0.5) {
      this.setState('dance', rand(5, 10));
      if (Math.random() < 0.3) this.burst('♪', 2, 1000);
      return;
    }
    // 청소 같은 '가끔 하는 일' 그림이 있는 캐릭터
    if (this.hasSprite('work') && Math.random() < 0.08) {
      this.setState('work', rand(5, 8));
      return;
    }
    const r = Math.random();
    if (r < this.def.specialChance) {
      this.doSpecial(world);
    } else if (r < 0.55) {
      this.targetX = null;
      this.dir = Math.random() < 0.5 ? -1 : 1;
      this.setState('walk', rand(3, 9));
    } else if (r < 0.78) {
      this.setState('idle', rand(2, 5));
      if (Math.random() < 0.25) this.say(this.line('idle'));
    } else {
      this.setState('sit', rand(4, 9));
    }
  }

  doSpecial(world) {
    const lines = this.def.lines.special;
    switch (this.def.special) {
      case 'cry': // 치이카와: 깜짝 놀라 울기
        this.setState('cry', 3.2);
        this.say(pick(lines), 2800);
        this.burst('💧', 4, 900);
        if (world.onCry) world.onCry(this);
        break;
      case 'sing': // 하치와레: 노래 부르기
        this.setState('sing', 5);
        this.say(pick(lines), 3000);
        this.burst('♪', 5, 1000);
        break;
      case 'emote': // 모몽가·시사·헌책방·쿠리만쥬: 제자리에서 자기다운 행동
        this.nextSpriteKey = this.def.emoteSprite || 'special';
        this.setState(this.def.emoteState || 'happy', 4);
        if (this.def.emoteProp) this.showProp(this.def.emoteProp);
        if (this.def.emoteFx) this.burst(this.def.emoteFx, 3, 1000);
        this.say(pick(lines), 2600);
        break;
      case 'dash': // 우사기·랏코: 화면 끝까지 질주
        this.dir = this.x > world.width / 2 ? -1 : 1;
        this.targetX = this.dir > 0 ? world.width - this.w - 4 : 4;
        this.setState('dash', 12);
        this.say(pick(lines), 1600);
        break;
    }
  }

  // ---- 매 프레임 ----
  update(dt, world) {
    if (!this.enabled) return;

    if (this.state === 'held') {
      this.render();
      return;
    }

    if (this.state === 'peek') {
      if (!world.focus) {
        this.leavePeek();
      } else {
        // 화면 아래에서 자기 자리로 스르륵 올라온다
        const spot = world.peekSpot(this);
        const k = 1 - Math.exp(-dt * 3);
        this.x += (spot.x - this.x) * k;
        this.y += (spot.y - this.y) * k;
      }
      this.render();
      return;
    }

    if (!this.grounded) {
      this.vy += GRAVITY * dt;
      this.y += this.vy * dt;
      this.x += this.vx * dt;
      this.vx *= 0.995;
      if (this.x < 0 || this.x > world.width - this.w) {
        this.x = clamp(this.x, 0, world.width - this.w);
        this.vx *= -0.5;
      }
      if (this.y >= this.ground && this.vy >= 0) {
        this.y = this.ground;
        this.vy = 0;
        this.vx = 0;
        this.grounded = true;
        this.setState('land', 0.35);
      }
      this.render();
      return;
    }
    this.y = this.ground;

    if (this.state === 'walk' || this.state === 'dash' || this.state === 'chase') {
      const speed =
        (this.state === 'dash' ? this.def.runSpeed :
        this.state === 'chase' ? this.def.walkSpeed * 3.2 : this.def.walkSpeed) * settings.speed;
      if (this.targetX !== null) this.dir = this.targetX > this.x ? 1 : -1;
      else if (this.state === 'walk' && world.blocked(this)) {
        this.dir *= -1;
        // 양쪽이 다 막혀 있으면 제자리에서 잠깐 쉰다 (좌우로 떨지 않게)
        if (world.blocked(this)) this.setState('idle', rand(1.5, 3));
      }
      this.x += this.dir * speed * dt;
      const maxX = world.width - this.w;
      if (this.x <= 0 || this.x >= maxX) {
        this.x = clamp(this.x, 0, maxX);
        this.dir *= -1;
        if (this.state === 'dash') this.stateLeft = 0.01;
      }
      if (this.targetX !== null && Math.abs(this.x - this.targetX) < speed * dt + 1) {
        this.x = this.targetX;
        this.targetX = null;
        this.stateLeft = 0.01; // 다음 프레임에 다음 행동 고르기
        if (this.state === 'dash') this.say('하아…하아…', 1500);
        if (this.state === 'chase' && this.onArrive) {
          const done = this.onArrive;
          this.onArrive = null;
          done();
        }
      }
    }

    if (this.state === 'sleep') {
      if (Math.random() < dt * 0.6) this.burst('Z', 1, 1600);
      if (this.stats.energy >= 98) this.wake();
    } else if (this.state === 'sing' && Math.random() < dt * 2) {
      this.burst('♪', 1, 1000);
    }

    if (this.stateLeft > 0) {
      this.stateLeft -= dt;
      if (this.stateLeft <= 0) this.chooseNext(world);
    }
    this.render();
  }

  render() {
    this.el.style.transform = `translate(${Math.round(this.x)}px, ${Math.round(this.y - this.h)}px)`;
    this.imgEl.style.transform = this.dir < 0 ? 'scaleX(-1)' : '';
  }

  // ---- 수치 (분 단위 변화량) ----
  tickStats(minutes, world) {
    const s = this.stats;
    const sleeping = this.state === 'sleep';
    s.hunger -= 0.4 * minutes;
    s.mood -= 0.25 * minutes;
    s.energy += (sleeping ? 4 : -(world.isNight ? 0.6 : 0.3)) * minutes;
    for (const k of ['hunger', 'mood', 'energy']) s[k] = clamp(s[k], 0, 100);
  }

  // ---- 집중 모드: 화면 아래에서 얼굴만 내밀기 ----
  enterPeek(world) {
    if (this.state !== 'peek') {
      const spot = world.peekSpot(this);
      this.x = spot.x;
      this.y = window.innerHeight + this.h + 4; // 화면 밖 아래에서 시작
      this.vx = 0;
      this.vy = 0;
    }
    this.grounded = true;
    this.targetX = null;
    this.setState('peek', 9999);
  }

  leavePeek() {
    this.release(rand(-120, 120), -820); // 아래에서 폴짝 튀어나옴
  }

  // ---- 사용자 상호작용 ----
  onClick() {
    if (this.state === 'peek') {
      this.say(this.line('click'), 1600, true);
      this.burst('!', 1, 800);
      return;
    }
    if (this.state === 'sleep') {
      this.wake();
      this.say('!? …깼다', 1500, true);
      return;
    }
    this.jump();
    this.say(this.line('click'), 1600, true);
    const now = Date.now();
    if (now - this.lastClickRewardAt > 30000) {
      this.lastClickRewardAt = now;
      this.stats.mood = clamp(this.stats.mood + 3, 0, 100);
      this.stats.affinity += 1;
    }
  }

  onPet() {
    const now = Date.now();
    if (now - this.lastPetAt < 2500) return;
    this.lastPetAt = now;
    if (this.state === 'sleep' || this.state === 'peek') {
      this.burst('♥', 2, 1200);
      this.stats.mood = clamp(this.stats.mood + (this.state === 'peek' ? 10 : 5), 0, 100);
      return;
    }
    this.stats.mood = clamp(this.stats.mood + 15, 0, 100);
    this.stats.affinity += 2;
    this.setState('happy', 1.8);
    this.say(this.line('pet'), 1800, true);
    this.burst('♥', 4, 1200);
  }

  feed(snack) {
    if (this.state === 'sleep') this.wake();
    this.stats.hunger = clamp(this.stats.hunger + snack.hunger, 0, 100);
    this.stats.mood = clamp(this.stats.mood + snack.mood, 0, 100);
    this.stats.affinity += 1;
    if (this.state === 'peek') {
      // 내민 채로 받아먹는다
      this.showProp(snack.icon);
      this.say(this.line('eat'), 2200, true);
      setTimeout(() => this.state === 'peek' && this.propEl.classList.add('hidden'), 2600);
      return;
    }
    this.grounded = true;
    this.setState('eat', 2.6);
    this.showProp(snack.icon);
    this.say(this.line('eat'), 2200, true);
  }

  // 메뉴가 열려 있는 동안 제자리에 세워 둔다
  pause() {
    if (!this.grounded || ['peek', 'sleep', 'held', 'eat', 'chase'].includes(this.state)) return;
    this.paused = true;
    this.targetX = null;
    this.setState('idle', 9999);
  }

  unpause() {
    if (this.paused && this.state === 'idle') this.stateLeft = 0.4;
    this.paused = false;
  }

  chase(x, onArrive) {
    if (this.state === 'sleep') this.wake();
    this.grounded = true;
    this.targetX = x;
    this.onArrive = onArrive;
    this.setState('chase', 20);
  }

  sleep() {
    if (this.state === 'peek') return; // 집중 모드 중엔 벽에 붙은 채로 둔다
    this.setState('sleep', 9999);
  }

  wake() {
    this.setState('idle', rand(1, 2));
  }

  jump() {
    if (!this.grounded) return;
    this.grounded = false;
    this.vy = -520;
    this.setState('fall');
  }

  grab() {
    this.grounded = false;
    this.vx = 0;
    this.vy = 0;
    this.setState('held');
    this.say(this.line('grab'), 1200, true);
  }

  release(vx, vy) {
    this.grounded = false;
    this.vx = clamp(vx, -1500, 1500);
    this.vy = clamp(vy, -1500, 1500);
    this.setState('fall');
  }

  // 상황별 대사 하나 (그 상황 대사가 없는 캐릭터는 클릭 대사로)
  line(key) {
    return pick(this.def.lines[key] || this.def.lines.click);
  }

  // 알림·응원할 때: 말하면서 응원 그림(없으면 행복 그림)으로 잠깐 바뀐다
  cheer(text, ms = 5000) {
    this.say(text, ms, true);
    if (this.grounded && !['peek', 'held', 'fall', 'eat', 'sleep', 'chase'].includes(this.state)) {
      this.setState('cheer', 3);
    }
  }

  meet(other) {
    this.dir = other.x > this.x ? 1 : -1;
    this.setState('meet', 3);
    const special = this.def.lines.meetWith && this.def.lines.meetWith[other.id];
    this.say(special ? pick(special) : this.line('meet'), 2200);
    this.burst('♥', 2, 1100);
  }

  // ---- 표시 ----
  say(text, ms = 2600, force = false) {
    // 혼잣말은 설정의 말풍선 빈도만큼만 (클릭·간식 같은 반응은 force로 항상 말함)
    if (!force && (this.quiet || Math.random() >= CHATTER_RATE[settings.chatter])) return;
    this.bubbleEl.textContent = text;
    this.bubbleEl.classList.remove('hidden');
    clearTimeout(this.bubbleTimer);
    this.bubbleTimer = setTimeout(() => this.bubbleEl.classList.add('hidden'), ms);
  }

  showProp(icon) {
    this.propEl.textContent = icon;
    this.propEl.classList.remove('hidden');
  }

  burst(symbol, count, ms) {
    for (let i = 0; i < count; i++) {
      const p = document.createElement('span');
      p.className = 'particle';
      p.textContent = symbol;
      p.style.left = `${rand(15, 85)}%`;
      p.style.animationDuration = `${ms}ms`;
      p.style.animationDelay = `${i * 120}ms`;
      p.addEventListener('animationend', () => p.remove());
      this.fxEl.appendChild(p);
    }
  }

  setSize(h) {
    if (h === this.h) return;
    this.h = h;
    this.imgEl.style.height = `${h}px`;
    if (this.imgEl.naturalHeight) {
      this.w = Math.round((h * this.imgEl.naturalWidth) / this.imgEl.naturalHeight);
      this.el.style.width = `${this.w}px`;
    }
  }

  setEnabled(on) {
    this.enabled = on;
    this.el.style.display = on ? '' : 'none';
    if (on) {
      this.y = -this.h;
      this.grounded = false;
      this.setState('fall');
    }
  }

  toJSON() {
    return { stats: this.stats, x: Math.round(this.x) };
  }
}
