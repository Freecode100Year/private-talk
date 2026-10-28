// Card-table UI receives only this seat's server projection. It never owns
// the deck, other hands, or chat text, and renders all text with textContent.
export function cardLabel(kind, id) {
  if (kind === 'mj') {
    const tile = Math.floor(id / 4);
    return `${tile % 9 + 1}${['萬', '筒', '條'][Math.floor(tile / 9)]}`;
  }
  const card = id % 54;
  if (card >= 52) return card === 52 ? '☆' : '★';
  const rank = card % 13 + 2;
  return `${['♣', '♦', '♥', '♠'][Math.floor(card / 13)]}${({ 11: 'J', 12: 'Q', 13: 'K', 14: 'A' })[rank] || rank}`;
}

export function createCardTable(host, { t, send, me }) {
  const selected = new Set();
  let current = null, lastKey = '', shape = '';
  const el = (tag, text = '', cls = '') => {
    const node = document.createElement(tag);
    node.textContent = text;
    if (cls) node.className = cls;
    return node;
  };
  const action = (k, extra = {}) => {
    if (!current) return;
    send({ gid: current.gid, revision: current.revision, k, ...extra });
  };
  function clock() {
    const label = host.querySelector('.card-turn');
    if (label && current && ['over', 'end'].includes(current.phase)) { label.textContent = t('cards.over'); return; }
    if (label && current && ['suit', 'response'].includes(current.phase)) { label.textContent = `${t(`cards.phase.${current.phase}`)} · ${Math.max(0, Math.ceil((current.deadline - Date.now()) / 1000))}s`; return; }
    if (label && current) label.textContent = t('cards.turn', { n: current.turn, s: Math.max(0, Math.ceil((current.deadline - Date.now()) / 1000)) });
  }
  function render(state) {
    const previous = current;
    current = state;
    const key = `${state.gid}|${state.revision}|${state.round ?? ''}|${t('cards.hand')}`;
    if (key === lastKey) { clock(); return; }
    if (!lastKey.startsWith(`${state.gid}|`) || previous?.round !== state.round) { selected.clear(); shape = ''; }
    lastKey = key;
    for (const id of selected) if (!state.hand.includes(id)) selected.delete(id);
    host.id = 'cardTable'; host.dataset.revision = String(state.revision);
    host.replaceChildren();
    host.append(el('h3', t(`mode.name.${state.type}`)), el('p', t('cards.privacy'), 'card-privacy'));
    const info = el('div', '', 'card-table-status');
    info.append(el('strong', t(`cards.phase.${state.phase}`)), el('span', '', 'card-turn'));
    if (state.type === 'gd') info.append(el('span', `${t('cards.level', { n: state.level })} · ${t('cards.round', { n: state.round })}`));
    if (state.type === 'mj') info.append(el('span', t('cards.wall', { n: state.wallCount })));
    host.append(info);
    const seats = el('div', '', 'card-table-seats');
    for (const n of state.players) seats.append(el('span', `#${n}${n === me() ? ' ●' : ''} · ${state.counts[n]}${state.type === 'mj' && state.missingSuits[n] !== null ? ` · ${t(`cards.suit${state.missingSuits[n]}`)}` : ''}`, n === state.turn ? 'card-seat active' : 'card-seat'));
    host.append(seats);
    const publicCards = el('div', '', 'card-public');
    if (state.lastPlay) publicCards.append(el('p', `${t('cards.last')} · #${state.lastPlay.player}: ${state.lastPlay.cards.map(id => cardLabel('gd', id)).join(' ')}`));
    if (state.type === 'gd') for (const ex of state.exchanges || []) {
      if (ex.given !== undefined) publicCards.append(el('p', t('cards.exchange', { from: ex.from, to: ex.to, card: cardLabel('gd', ex.given) })));
      if (ex.returned !== undefined) publicCards.append(el('p', t('cards.exchange', { from: ex.to, to: ex.from, card: cardLabel('gd', ex.returned) })));
    }
    if (state.type === 'mj') {
      if (state.pending) publicCards.append(el('strong', t('cards.pending', { n: state.pending.from, card: cardLabel('mj', state.pending.card) })));
      publicCards.append(el('p', `${t('cards.discards')}: ${state.discards.map(d => typeof d === 'number' ? cardLabel('mj', d) : `#${d.from ?? d.n ?? d.player ?? ''} ${cardLabel('mj', d.card)}`).join(' · ')}`));
      for (const n of state.players) {
        const melds = state.melds[n] || [];
        if (melds.length) publicCards.append(el('p', `#${n} ${t('cards.melds')}: ${melds.map(m => m.cards.map(id => id === null ? '▣' : cardLabel('mj', id)).join(' ')).join(' / ')}`));
      }
    }
    const finished = state.finished || state.winners || [];
    if (finished.length) publicCards.append(el('p', t('cards.finished', { list: finished.map(n => `#${n}`).join(' → ') })));
    publicCards.append(el('p', t('cards.scores', { list: state.players.map(n => `#${n} ${state.scores[n]}`).join(' · ') })));
    host.append(publicCards);
    const rules = el('details');
    rules.append(el('summary', t('cards.rules')), el('p', t(state.type === 'gd' ? 'cards.gdRules' : 'cards.mjRules')));
    host.append(rules);
    const error = el('p', '', 'card-error'); error.id = 'cardError'; error.setAttribute('role', 'status');
    host.append(error, el('h4', t('cards.hand')));
    const hand = el('div', '', 'card-hand'); hand.id = 'cardHand';
    const count = el('span', '', 'card-selection');
    const update = () => {
      count.textContent = t('cards.selected', { n: selected.size });
      for (const button of hand.children) {
        const on = selected.has(Number(button.dataset.card));
        button.classList.toggle('selected', on); button.setAttribute('aria-pressed', String(on));
      }
    };
    const sorted = state.hand.slice().sort((a, b) => {
      if (state.type === 'mj') return a - b;
      const rank = id => { const x = id % 54, r = x < 52 ? x % 13 + 2 : x === 52 ? 15 : 16; return r >= 15 ? r + 3 : r === state.level ? 17 : r; };
      return rank(a) - rank(b) || (a % 54) - (b % 54) || a - b;
    });
    for (const id of sorted) {
      const button = el('button', cardLabel(state.type, id), 'table-card');
      button.type = 'button'; button.dataset.card = String(id);
      if (state.type === 'mj' && state.can.includes('kong') && state.choices.some(c => Math.floor(c / 4) === Math.floor(id / 4))) button.classList.add('kong-choice');
      if (state.type === 'gd' && [1, 2].includes(Math.floor(id % 54 / 13))) button.classList.add('red');
      button.addEventListener('click', () => {
        if (selected.has(id)) selected.delete(id);
        else { if (state.type === 'mj') selected.clear(); selected.add(id); }
        update();
      });
      hand.append(button);
    }
    const hint = state.can.includes('tribute') ? 'cards.tributeHint' : state.can.includes('return') ? 'cards.returnHint' : state.can.includes('kong') && state.phase === 'play' ? 'cards.kongHint' : 'cards.select';
    host.append(hand, count, el('p', state.players.includes(me()) ? t(hint) : t('cards.spectator')));
    const actions = el('div', '', 'card-table-actions');
    for (const k of state.can) {
      if (k === 'suit') {
        for (const suit of state.choices) {
          const button = el('button', t(`cards.suit${suit}`), 'secondary-button');
          button.type = 'button'; button.dataset.cardSuit = String(suit);
          button.addEventListener('click', () => action('suit', { suit })); actions.append(button);
        }
        continue;
      }
      const button = el('button', t(`cards.${k}`), 'primary-button');
      button.type = 'button'; button.dataset.cardAction = k;
      button.addEventListener('click', () => {
        const cards = [...selected];
        if ((k === 'play' && !cards.length) || (['tribute', 'return', 'discard'].includes(k) && cards.length !== 1)) {
          error.textContent = t('cards.select'); return;
        }
        if (k === 'play') action(k, { cards, ...(shape ? { kind: shape } : {}) });
        else if (['tribute', 'return', 'discard'].includes(k)) action(k, { card: cards[0] });
        else if (k === 'kong' && state.phase === 'play') {
          const choice = cards.length === 1 ? state.choices.find(id => Math.floor(id / 4) === Math.floor(cards[0] / 4)) : undefined;
          if (choice === undefined) { error.textContent = t('cards.select'); return; }
          action(k, { card: choice });
        } else action(k);
      });
      actions.append(button);
    }
    if (state.type === 'gd' && state.can.includes('play')) {
      const pick = el('select'); pick.setAttribute('aria-label', t('cards.shape'));
      for (const [value, text] of [['', t('cards.auto')], ['threepairs', t('cards.threepairs')], ['twotriples', t('cards.twotriples')]]) {
        const option = el('option', text); option.value = value; option.selected = value === shape; pick.append(option);
      }
      pick.addEventListener('change', () => { shape = pick.value; }); actions.append(pick);
    }
    host.append(actions); update(); clock();
  }
  return {
    render,
    clear() { current = null; lastKey = ''; selected.clear(); shape = ''; host.replaceChildren(); },
    error() { const node = host.querySelector('#cardError'); if (node) node.textContent = t('cards.illegal'); }
  };
}
