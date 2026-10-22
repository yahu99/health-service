import { createApi } from './api.js';

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const number = value => new Intl.NumberFormat('ru-RU').format(value);
const money = value => value == null ? '—' : `${number(value / 100)} ₽`;
const date = value => new Date(value).toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
const icons = {
  grid: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
  box: '<path d="m12 3 9 5v9l-9 5-9-5V8l9-5Zm0 10 9-5M12 13 3 8m9 5v9M7.5 5.5l9 5"/>',
  bag: '<path d="M5 7h14l2 14H3L5 7Zm3 0V6a4 4 0 0 1 8 0v1"/>',
  wallet: '<path d="M20 8V5H4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h16V8H4a1 1 0 0 1 0-2m16 7h-6v4h6m-3-2h.1"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21v-2a8 8 0 0 1 16 0v2"/>',
  terminal: '<rect x="2" y="4" width="20" height="16" rx="3"/><path d="m6 9 3 3-3 3m6 0h5"/>',
  refresh: '<path d="M20 7v5h-5M4 17v-5h5m10-4a8 8 0 0 0-13-3L4 8m16 8-2 3a8 8 0 0 1-13-3"/>',
  truck: '<path d="M1 5h13v12H1zm13 5h5l4 4v3h-9"/><circle cx="5" cy="18" r="3"/><circle cx="18" cy="18" r="3"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  arrow: '<path d="M4 12h16m-6-6 6 6-6 6"/>',
};
const icon = name => `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[name] || icons.box}</svg>`;
$$('[data-icon]').forEach(el => el.innerHTML = icon(el.dataset.icon));
const labels = { overview: 'Обзор', catalog: 'Каталог', orders: 'Заказы', billing: 'Баланс', profile: 'Профиль', requests: 'Журнал запросов' };
const state = { page: 'overview', user: null, products: [], slots: [], stocks: {}, balance: null, orders: [], requests: [], health: null, apiBaseUrl: '', selectedProduct: null, lastRequest: null };
let epoch = 0, authMode = 'login', toastTimer;
const polling = new Map();
function toast(message, error = false) {
  const element = $('#toast');
  element.textContent = message; element.className = error ? 'error' : ''; element.hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => element.hidden = true, error ? 9000 : 4000);
}
const api = createApi(entry => {
  state.requests.unshift(entry); state.requests = state.requests.slice(0, 100);
  updateRequestFeed();
}, () => { if (state.user) { clearUser(); render(); toast('Сессия истекла. Войдите снова.', true); } });

function stored(key, fallback) { try { return JSON.parse(sessionStorage.getItem(key)) ?? fallback; } catch { return fallback; } }
function save(key, value) { try { sessionStorage.setItem(key, JSON.stringify(value)); } catch { /* Storage can be unavailable in private mode. */ } }
function orderStorage() { return `saga-orders:${state.apiBaseUrl}:${state.user?.id}`; }
function clearUser() {
  epoch++; polling.forEach(clearTimeout); polling.clear();
  Object.assign(state, { user: null, products: [], slots: [], stocks: {}, balance: null, orders: [], lastRequest: null });
  save('saga-session', null); updateUser();
}
function setUser(user) {
  clearUser(); state.user = user;
  save('saga-session', { id: user.id, username: user.username, apiBaseUrl: state.apiBaseUrl });
  state.orders = stored(orderStorage(), []);
  updateUser(); render();
}
function updateUser() {
  $('#user-label').textContent = state.user?.username || 'Войти в аккаунт';
  $('#avatar').textContent = (state.user?.firstName || state.user?.username || '?').slice(0, 1).toUpperCase();
  $('#order-count').textContent = state.orders.length;
}
async function work(task, button) {
  if (button?.disabled) return;
  if (button) { button.disabled = true; button.setAttribute('aria-busy', 'true'); }
  try { await task(); } catch (error) { if (error.name !== 'AbortError') toast(error.message, true); }
  finally { if (button) { button.disabled = false; button.removeAttribute('aria-busy'); } }
}
async function checkHealth() {
  try { const response = await api('/health/ready'); state.health = response.status === 200; }
  catch { state.health = false; }
  $('#connection').innerHTML = `<span class="live-dot ${state.health ? '' : 'offline'}"></span><span>${state.health ? 'API подключён' : 'API недоступен'}</span>`;
  $('#connection').title = `${state.apiBaseUrl} · нажмите для повторной проверки`;
  if (state.page === 'requests') updateRequestFeed();
}
async function loadData() {
  if (!state.user) return;
  const current = epoch;
  const results = await Promise.allSettled([
    api('/products'), api('/delivery/slots'), api('/billing/account'),
  ]);
  if (current !== epoch) return;
  const properties = ['products', 'slots', 'balance'];
  results.forEach((result, i) => {
    if (result.status === 'fulfilled') state[properties[i]] = i === 2 ? result.value.data.balance : result.value.data.items;
  });
  const failed = results.find(result => result.status === 'rejected');
  if (failed) toast(failed.reason.message, true);
  render();
  await Promise.allSettled(state.products.map(product => fetchStock(product.productId)));
  state.orders.filter(order => ['PROCESSING', 'COMPENSATING'].includes(order.status)).forEach(order => pollOrder(order.orderId));
}
async function fetchStock(id) {
  const current = epoch;
  const { data } = await api(`/products/${id}/stock`);
  if (current !== epoch) return;
  state.stocks[id] = data.available;
  $$(`[data-stock="${id}"]`).forEach(el => el.textContent = `${number(data.available)} шт. доступно`);
}
async function updateBalance() {
  const current = epoch;
  const { data } = await api('/billing/account');
  if (current !== epoch) return;
  state.balance = data.balance;
  $$('[data-balance]').forEach(el => el.textContent = money(state.balance));
}
function upsertOrder(order, request) {
  const previous = state.orders.find(item => item.orderId === order.orderId);
  const merged = { ...previous, ...order, ...(request ? { request } : {}) };
  state.orders = [merged, ...state.orders.filter(item => item.orderId !== order.orderId)].slice(0, 30);
  if (request) state.lastRequest = request;
  save(orderStorage(), state.orders); updateUser(); updateOrderFeed();
}
async function fetchOrder(id) {
  const current = epoch;
  const { data } = await api(`/orders/${id}`);
  if (current === epoch) upsertOrder(data);
  return data;
}
function pollOrder(id, attempt = 0) {
  if (!state.user || polling.has(id)) return;
  const current = epoch;
  const timer = setTimeout(async () => {
    polling.delete(id);
    if (epoch !== current || !state.user) return;
    try {
      const order = await fetchOrder(id);
      if (epoch !== current) return;
      if (['PROCESSING', 'COMPENSATING'].includes(order.status)) {
        if (attempt < 119) pollOrder(id, attempt + 1);
        else toast(`Заказ №${id} ещё обрабатывается. Продолжить проверку можно кнопкой обновления.`, true);
      } else {
        await Promise.allSettled([updateBalance(), fetchStock(order.productId)]);
      }
    } catch (error) { toast(error.message, true); }
  }, 1000);
  polling.set(id, timer);
}

function heading(title, description, action = '') { return `<div class="page-heading"><div><div class="eyebrow">SAGA STORE / ${escape(labels[state.page].toUpperCase())}</div><h1>${title}</h1><p>${description}</p></div>${action}</div>`; }
const button = (text, action, kind = 'secondary', glyph = '') => `<button class="button ${kind}" data-action="${action}">${glyph ? icon(glyph) : ''}${text}</button>`;
function empty(title, description, glyph = 'box', action = '') { return `<div class="empty-state"><div class="empty-icon">${icon(glyph)}</div><h3>${title}</h3><p>${description}</p>${action}</div>`; }
function gate() { return empty('Магазин начинается с вашего аккаунта', 'Войдите или зарегистрируйтесь, чтобы загрузить данные с сервера.', 'user', button('Войти в аккаунт', 'auth', 'primary', 'arrow')); }
function stats() {
  return `<div class="stats-grid"><div class="stat-card"><div class="stat-label">Баланс аккаунта ${icon('wallet')}</div><div class="stat-value" data-balance>${money(state.balance)}</div><div class="stat-foot">${state.user ? 'Доступно для покупок' : 'После входа в аккаунт'}</div></div><div class="stat-card"><div class="stat-label">Товары в каталоге ${icon('box')}</div><div class="stat-value">${state.products.length ? String(state.products.length).padStart(2, '0') : '—'}</div><div class="stat-foot">Цены из Order Service</div></div><div class="stat-card"><div class="stat-label">Заказы в этой сессии ${icon('bag')}</div><div class="stat-value" id="stat-orders">${String(state.orders.length).padStart(2, '0')}</div><div class="stat-foot"><span class="mini-dot"></span><span id="stat-confirmed">${state.orders.filter(o => o.status === 'CONFIRMED').length}</span> подтверждено</div></div><div class="stat-card"><div class="stat-label">Распределённая транзакция ${icon('grid')}</div><div class="stat-value saga-value">Saga <span>HTTP</span></div><div class="stat-foot">Billing → Warehouse → Delivery</div></div></div>`;
}
function productArt(index) {
  const drawings = [
    '<path d="M43 29 82 20l26 15v62L70 110 43 94Z" fill="#3e6662"/><path d="m49 29 29-7 25 14-33 10Z" fill="#fbf8e9"/><path d="m70 46 33-10v59l-33 11Z" fill="#d9edc5"/><path d="m43 31 27 15v62L43 93Z" fill="#739d86"/><path d="m81 54 13-4m-13 10 13-4m-13 10 8-3" stroke="#61816d" stroke-width="2"/><path d="m58 40 5 3v29l-5-3Z" fill="#eaf8ab"/>',
    '<path d="M99 51h8c24 0 23 35 0 35H96" fill="none" stroke="#a0774e" stroke-width="10"/><path d="M43 46h58v41c0 28-58 28-58 0Z" fill="#c29b70"/><ellipse cx="72" cy="46" rx="29" ry="10" fill="#ecdbc2"/><ellipse cx="72" cy="46" rx="22" ry="6" fill="#735640"/><path d="M48 59v26c0 8 6 12 11 14" stroke="#ddbb91" stroke-width="5" fill="none" stroke-linecap="round"/><path d="M63 22q-7-9 0-16m16 16q-7-9 0-16" stroke="#c9b79d" stroke-width="2" fill="none"/>',
    '<path d="M60 38v-9c0-20 34-20 34 0v9" stroke="#776e98" stroke-width="7" fill="none"/><path d="M42 50c0-26 67-26 67 0l7 45c4 25-83 25-80 0Z" fill="#a099b9"/><path d="M51 54c0-19 49-19 49 0v40H51Z" fill="#bbb2cc"/><rect x="48" y="72" width="56" height="30" rx="9" fill="#827697"/><path d="M53 79h46" stroke="#d7ccdf" stroke-width="2"/><rect x="69" y="47" width="15" height="8" rx="2" fill="#ddd8e5"/>',
  ];
  return `<svg class="product-art" viewBox="0 0 150 135" aria-hidden="true"><ellipse cx="76" cy="117" rx="48" ry="7" fill="currentColor" opacity=".07"/>${drawings[index % 3]}</svg>`;
}
function catalog() {
  if (!state.user) return gate();
  if (!state.products.length) return empty('Каталог пока не загружен', 'Обновите данные, чтобы получить товары из API.', 'box', button('Обновить данные', 'refresh'));
  return `<div class="product-grid">${state.products.map((product, i) => `<article class="product-card"><div class="product-image tone-${i % 3}"><span class="product-tag">ID ${escape(product.productId)}</span>${productArt(i)}<span class="image-arrow">↗</span></div><div class="product-meta"><div><h3>${escape(product.name)}</h3><span class="stock" data-stock="${escape(product.productId)}">${state.stocks[product.productId] == null ? 'Остаток не загружен' : `${number(state.stocks[product.productId])} шт. доступно`}</span></div><strong>${money(product.unitPrice)}</strong></div><button class="product-button" data-buy="${escape(product.productId)}">Выбрать товар <span>+</span></button></article>`).join('')}</div>`;
}
function orderForm() {
  if (!state.user) return gate();
  const product = state.products.find(p => p.productId === state.selectedProduct) || state.products[0];
  return `<form id="order-form"><label>Товар<select name="productId" required ${!state.products.length ? 'disabled' : ''}>${state.products.length ? state.products.map(p => `<option value="${escape(p.productId)}" ${p.productId === product?.productId ? 'selected' : ''}>${escape(p.name)} · ${money(p.unitPrice)}</option>`).join('') : '<option value="">Сначала загрузите каталог</option>'}</select></label><div class="form-row"><label>Количество<input name="quantity" type="number" value="1" min="1" max="9007199254740991" step="1" required></label><label>Сумма заказа<output id="order-total">${money(product?.unitPrice)}</output></label></div><label>Слот доставки<select name="deliverySlotId" required><option value="">Выберите время доставки</option>${state.slots.map(s => `<option value="${escape(s.deliverySlotId)}">${escape(date(s.startsAt))} — ${escape(new Date(s.endsAt).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }))} · ${number(s.availableCouriers)} кур.</option>`).join('')}</select></label><div class="label-with-action"><span>Idempotency-Key</span><button type="button" class="text-button" data-action="new-key">Новый ключ ↻</button></div><input aria-label="Idempotency-Key" name="key" class="mono-input" value="${crypto.randomUUID()}" pattern="[A-Za-z0-9._:\-]{1,128}" maxlength="128" required><p class="field-hint">При повторе сохраните ключ и тело запроса. Итоговую цену рассчитывает сервер.</p><button class="button primary full-width" type="submit" ${!state.products.length ? 'disabled' : ''}>Оформить заказ ${icon('arrow')}</button></form>`;
}
const statusNames = { PROCESSING: 'В обработке', COMPENSATING: 'Компенсация', CONFIRMED: 'Подтверждён', CANCELLED: 'Отменён', REJECTED: 'Отказ', SUCCEEDED: 'Выполнен', COMPENSATED: 'Возвращено', NOT_STARTED: 'Ожидание', IN_PROGRESS: 'В работе', PENDING: 'Ожидание' };
function badge(status) { return `<span class="badge ${['CONFIRMED', 'SUCCEEDED', 'COMPENSATED'].includes(status) ? 'success' : ['CANCELLED', 'REJECTED'].includes(status) ? 'danger' : 'pending'}"><span></span>${escape(statusNames[status] || status)}</span>`; }
function saga(order) {
  if (!order) return empty('Здесь появится ваш первый заказ', 'Оформите заказ и наблюдайте за каждым шагом транзакции.', 'bag');
  return `<div class="order-top"><div><span class="eyebrow">ПОСЛЕДНИЙ ЗАКАЗ</span><h3>Заказ #${escape(order.orderId)}</h3></div>${badge(order.status)}</div><div class="saga-steps">${['BILLING', 'WAREHOUSE', 'DELIVERY'].map((name, i) => {
    const step = order.steps?.find(s => s.step === name);
    return `<div class="saga-step"><div class="step-icon ${escape((step?.status || '').toLowerCase())}">${icon(['wallet', 'box', 'truck'][i])}</div><div><h4>${['Оплата', 'Резерв товара', 'Доставка'][i]}</h4><span>${name[0] + name.slice(1).toLowerCase()} Service</span>${step?.lastError ? `<p class="step-error">${escape(step.lastError)}</p>` : ''}</div><span class="step-status">${escape(statusNames[step?.status] || 'Ожидание')}${step?.attempts ? `<small>попыток: ${escape(step.attempts)}</small>` : ''}</span></div>`;
  }).join('')}</div>${order.reason ? `<div class="reason">${escape(order.reason)}</div>` : ''}<div class="order-bottom"><span>Стоимость заказа <strong>${money(order.price)}</strong></span><button class="text-button" data-refresh-order="${escape(order.orderId)}">Обновить ↻</button></div>`;
}
function orderList() {
  if (!state.orders.length) return empty('История заказов пуста', 'Здесь сохраняются заказы, открытые в этом браузере для текущего пользователя.', 'bag');
  return `<div class="orders-list">${state.orders.map(order => `<article class="order-list-item"><div class="list-item-header"><strong>#${escape(order.orderId)}</strong>${badge(order.status)}<strong class="order-price">${money(order.price)}</strong></div><p>Товар #${escape(order.productId)} · ${escape(order.quantity)} шт. · Слот #${escape(order.deliverySlotId)}</p><details><summary>Шаги Saga и повтор запроса</summary>${saga(order)}${order.request ? `<div class="replay-actions"><button class="button secondary" data-replay="${escape(order.orderId)}">Повторить с тем же ключом</button><button class="text-button" data-conflict="${escape(order.orderId)}">Изменить количество → 409</button><code>${escape(order.request.key)}</code></div>` : '<p class="field-hint">Тело исходного запроса неизвестно: повтор недоступен.</p>'}</details></article>`).join('')}</div>`;
}
function updateOrderFeed() {
  if ($('#saga-content')) $('#saga-content').innerHTML = saga(state.orders[0]);
  if ($('#orders-content')) $('#orders-content').innerHTML = orderList();
  if ($('#stat-orders')) $('#stat-orders').textContent = String(state.orders.length).padStart(2, '0');
  if ($('#stat-confirmed')) $('#stat-confirmed').textContent = state.orders.filter(o => o.status === 'CONFIRMED').length;
}
function requestList(compact = false) {
  const entries = state.requests.slice(0, compact ? 4 : 100);
  if (!entries.length) return '<p class="muted-text">Здесь появятся HTTP-запросы и ответы сервера.</p>';
  return entries.map(entry => `<details class="request-row"><summary><span class="method ${entry.method.toLowerCase()}">${escape(entry.method)}</span><code>${escape(entry.path)}</code><span class="http-status ${entry.status >= 200 && entry.status < 400 ? 'ok' : 'bad'}">${entry.status || 'ERR'}</span><span class="request-duration">${entry.duration} мс</span></summary><div class="request-detail"><p>${escape(date(entry.time))}${entry.key ? ` · Idempotency-Key: ${escape(entry.key)}` : ''}</p>${entry.body ? `<h4>Запрос</h4><pre>${escape(JSON.stringify(entry.body, null, 2))}</pre>` : ''}<h4>Ответ</h4><pre>${escape(JSON.stringify(entry.data, null, 2))}</pre></div></details>`).join('');
}
function updateRequestFeed() {
  if ($('#request-feed')) $('#request-feed').innerHTML = requestList(state.page !== 'requests');
  if ($('#request-total')) $('#request-total').textContent = state.requests.length;
}
function sectionTitle(title, side = '') { return `<div class="section-title"><h2>${title}</h2>${side}</div>`; }
function render() {
  const page = labels[state.page] ? state.page : 'overview'; state.page = page;
  $$('.sidebar [data-page]').forEach(link => { const active = link.dataset.page === page; link.classList.toggle('active', active); if (active) link.setAttribute('aria-current', 'page'); else link.removeAttribute('aria-current'); });
  $('#breadcrumb').textContent = labels[page];
  const refresh = button('Обновить', 'refresh', 'secondary', 'refresh');
  let html;
  if (page === 'overview') html = `${heading('Панель магазина', 'Всё для покупки. Каждый шаг — под контролем.', refresh)}<section class="hero"><div class="hero-copy"><div class="hero-label"><span></span> МИКРОСЕРВИСЫ В ДЕЙСТВИИ</div><h2>Один заказ.<br>Три сервиса. <em>Одна Saga.</em></h2><p>От оплаты до доставки — наблюдайте, как сервисы<br class="desktop-break"> работают вместе и возвращают изменения при отказе.</p><div class="hero-actions"><a class="button lime" href="#orders">Создать заказ ${icon('arrow')}</a><a class="hero-link" href="#catalog">Выбрать товар <span>↗</span></a></div></div><div class="hero-diagram" aria-label="Billing, Warehouse и Delivery объединены в Saga"><div class="diagram-orbit"></div><div class="diagram-center">${icon('box')}<span>SAGA</span></div><div class="diagram-node node-billing">${icon('wallet')}<span>Billing</span><i>✓</i></div><div class="diagram-node node-warehouse">${icon('box')}<span>Warehouse</span><i>✓</i></div><div class="diagram-node node-delivery">${icon('truck')}<span>Delivery</span><i>✓</i></div><div class="diagram-caption">ORCHESTRATED WITH HTTP</div></div></section>${stats()}${sectionTitle('Каталог товаров', '<a class="text-link" href="#catalog">Весь каталог ↗</a>')}${catalog()}<div class="workspace-grid"><section class="panel">${sectionTitle('Новый заказ', '<span class="small-label">POST /orders</span>')}${orderForm()}</section><section class="panel">${sectionTitle('Ход транзакции', '<span class="live-label"><span></span>LIVE</span>')}<div id="saga-content">${saga(state.orders[0])}</div></section></div><section class="panel request-panel">${sectionTitle('Последние запросы', '<a class="text-link" href="#requests">Открыть журнал ↗</a>')}<div id="request-feed">${requestList(true)}</div></section>`;
  if (page === 'catalog') html = `${heading('Каталог товаров', 'Актуальные цены с сервера и доступные остатки на складе.', refresh)}${catalog()}<div class="info-strip">${icon('box')} Цены отображаются в рублях; API передаёт суммы в копейках. Остатки обновляются отдельным запросом.</div>`;
  if (page === 'orders') html = `${heading('Заказы и транзакции', 'Оформляйте заказ и проверяйте выполнение каждого шага Saga.', refresh)}<div class="workspace-grid orders-workspace"><section class="panel">${sectionTitle('Новый заказ', '<span class="small-label">POST /orders</span>')}${orderForm()}</section><section class="panel">${sectionTitle('Найти заказ')}<form id="find-order-form" class="inline-form"><input name="orderId" type="number" min="1" step="1" required placeholder="ID заказа" aria-label="ID заказа"><button class="button secondary" type="submit">Найти</button></form><div id="saga-content">${saga(state.orders[0])}</div></section></div><section class="panel">${sectionTitle('Заказы текущего пользователя', '<span class="small-label">История этого браузера</span>')}<div id="orders-content">${state.user ? orderList() : gate()}</div></section>`;
  if (page === 'billing') html = `${heading('Баланс аккаунта', 'Пополнение, списание и возврат при компенсации заказа.', refresh)}${state.user ? `<div class="workspace-grid"><section class="balance-panel"><span class="eyebrow">ДОСТУПНЫЙ БАЛАНС</span><div class="balance-amount" data-balance>${money(state.balance)}</div><div class="balance-owner">${icon('wallet')} Аккаунт пользователя #${escape(state.user.id)}</div><div class="balance-decoration">↗</div></section><section class="panel">${sectionTitle('Пополнить баланс')}<form id="deposit-form"><label>Сумма в рублях<input name="amount" type="number" min="0.01" max="90071992547409.90" step="0.01" value="500" required></label><p class="field-hint">500 ₽ = 50 000 минимальных единиц в API. Пополнение выполняет реальный запрос к Billing Service.</p><button type="submit" class="button primary full-width">Пополнить баланс ${icon('arrow')}</button></form></section></div><div class="info-strip">${icon('wallet')} При отказе склада или доставки Saga возвращает списание. Обновите баланс, чтобы проверить компенсацию.</div>` : `<section class="panel">${gate()}</section>`}`;
  if (page === 'profile') html = `${heading('Мой профиль', 'Данные пользователя из Profile Service.', refresh)}<section class="panel narrow-panel">${state.user ? `${sectionTitle(`Пользователь #${escape(state.user.id)}`, badge('CONFIRMED'))}<form id="profile-form"><label>Логин<input value="${escape(state.user.username)}" disabled></label><div class="form-row"><label>Имя<input name="firstName" value="${escape(state.user.firstName)}" required maxlength="256"></label><label>Фамилия<input name="lastName" value="${escape(state.user.lastName)}" required maxlength="256"></label></div><label>Email<input name="email" type="email" value="${escape(state.user.email)}" required maxlength="320"></label><label>Телефон<input name="phone" type="tel" value="${escape(state.user.phone)}" maxlength="32" placeholder="Не указан"></label><button type="submit" class="button primary">Сохранить изменения ${icon('check')}</button><button type="button" class="button secondary" data-action="logout">Выйти</button></form>` : gate()}</section>`;
  if (page === 'requests') html = `${heading('Журнал запросов', 'Методы, тела запросов, HTTP-статусы и ответы вашего API.', `<div class="heading-actions">${button('Liveness', 'check-live')}${button('Readiness', 'check-ready')}${button('Очистить', 'clear-requests')}</div>`)}<div class="info-strip">${icon('terminal')} Gateway: <code>${escape(state.apiBaseUrl)}</code><span>·</span><span id="request-total">${state.requests.length}</span> / 100 запросов · пароли скрыты</div><section class="panel request-panel"><div id="request-feed">${requestList()}</div></section>`;
  $('#main').innerHTML = html;
  updateUser();
}
function openAuth(mode = 'login') {
  authMode = mode;
  $$('[data-auth-mode]').forEach(button => button.classList.toggle('active', button.dataset.authMode === mode));
  $('#auth-fields').innerHTML = `<label>Логин<input name="username" autocomplete="username" required maxlength="256" placeholder="Ваш логин"></label>${mode === 'register' ? '<div class="form-row"><label>Имя<input name="firstName" autocomplete="given-name" required maxlength="256" placeholder="Иван"></label><label>Фамилия<input name="lastName" autocomplete="family-name" required maxlength="256" placeholder="Иванов"></label></div><label>Email<input name="email" type="email" autocomplete="email" required maxlength="320" placeholder="you@example.com"></label>' : ''}<label>Пароль<input name="password" type="password" autocomplete="${mode === 'register' ? 'new-password' : 'current-password'}" required minlength="${mode === 'register' ? 12 : 1}" maxlength="128" placeholder="${mode === 'register' ? 'Не менее 12 символов' : 'Ваш пароль'}"></label>`;
  $('#auth-submit').innerHTML = `${mode === 'login' ? 'Войти' : 'Создать аккаунт и войти'} ${icon('arrow')}`;
  $('#auth-error').textContent = '';
  if (!$('#auth-dialog').open) $('#auth-dialog').showModal();
}
document.addEventListener('click', event => {
  const target = event.target.closest('button, [data-buy]');
  if (!target) return;
  if (target.dataset.authMode) { openAuth(target.dataset.authMode); return; }
  if (target.dataset.buy) { state.selectedProduct = Number(target.dataset.buy); if (state.page === 'orders') render(); else location.hash = 'orders'; return; }
  if (target.dataset.refreshOrder) { work(async () => { const order = await fetchOrder(Number(target.dataset.refreshOrder)); if (['PROCESSING', 'COMPENSATING'].includes(order.status)) pollOrder(order.orderId); }, target); return; }
  if (target.dataset.replay || target.dataset.conflict) {
    const conflict = Boolean(target.dataset.conflict);
    const order = state.orders.find(o => o.orderId === Number(target.dataset.replay || target.dataset.conflict));
    work(async () => {
      const result = await api('/orders', { method: 'POST', key: order.request.key, body: { ...order.request.body, ...(conflict ? { quantity: order.request.body.quantity + 1 } : {}) }, expected: conflict ? [409] : [] });
      if (conflict) {
        if (result.status !== 409 || result.data?.code !== 'IDEMPOTENCY_CONFLICT') throw new Error('API не вернул ожидаемый IDEMPOTENCY_CONFLICT');
        toast('409 IDEMPOTENCY_CONFLICT — изменённый повтор отклонён');
      } else { upsertOrder(result.data); pollOrder(result.data.orderId); toast(`Повтор вернул заказ #${result.data.orderId} · HTTP ${result.status}`); }
    }, target); return;
  }
  const action = target.dataset.action;
  if (action === 'auth') openAuth();
  if (action === 'refresh') work(async () => { await checkHealth(); if (state.user) { if (state.page === 'profile') { const { data } = await api(`/profile/${state.user.id}`); state.user = data; } await loadData(); } }, target);
  if (action === 'new-key') $('#order-form [name=key]').value = crypto.randomUUID();
  if (action === 'clear-requests') { state.requests = []; updateRequestFeed(); }
  if (action === 'check-live') work(async () => { await api('/health/live'); toast('Liveness: HTTP 200'); }, target);
  if (action === 'check-ready') work(checkHealth, target);
  if (action === 'logout') work(async () => { await api('/auth/logout', { method: 'POST' }); clearUser(); render(); toast('Вы вышли из аккаунта'); }, target);
});
$('#connection').addEventListener('click', () => work(checkHealth, $('#connection')));
$('#user-control').addEventListener('click', () => { if (state.user) location.hash = 'profile'; else openAuth(); });
$('#close-auth').addEventListener('click', () => $('#auth-dialog').close());
$('#auth-dialog').addEventListener('click', event => { if (event.target === $('#auth-dialog')) { const rect = event.target.getBoundingClientRect(); if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) event.target.close(); } });
document.addEventListener('input', event => {
  if (event.target.closest('#order-form') && ['quantity', 'productId'].includes(event.target.name)) {
    const form = $('#order-form'); const product = state.products.find(p => p.productId === Number(form.elements.productId.value));
    $('#order-total').textContent = money(product ? product.unitPrice * Number(form.elements.quantity.value) : null);
  }
});
document.addEventListener('submit', event => {
  event.preventDefault();
  const form = event.target, body = Object.fromEntries(new FormData(form)), submit = $('[type=submit]', form);
  if (form.id === 'auth-form') {
    work(async () => {
      try {
        let user;
        if (authMode === 'register') { const response = await api('/auth/register', { method: 'POST', body }); user = response.data; authMode = 'login'; $('#auth-error').textContent = 'Аккаунт создан. Выполняется вход…'; }
        const { data } = await api('/auth/login', { method: 'POST', body: { username: body.username, password: body.password } });
        const profile = await api(`/profile/${data.userId}`);
        setUser(profile.data || user); $('#auth-dialog').close(); form.reset();
        toast('Вы вошли в аккаунт'); await loadData();
      } catch (error) { $('#auth-error').textContent = error.message; }
    }, submit); return;
  }
  if (!state.user) { openAuth(); return; }
  work(async () => {
    if (form.id === 'order-form') {
      const payload = { productId: Number(body.productId), quantity: Number(body.quantity), deliverySlotId: Number(body.deliverySlotId) };
      if (!Object.values(payload).every(v => Number.isSafeInteger(v) && v > 0)) throw new Error('Выберите товар, количество и слот доставки');
      const request = { key: body.key, body: payload };
      const { data, status } = await api('/orders', { method: 'POST', body: payload, key: body.key });
      upsertOrder(data, request); pollOrder(data.orderId);
      toast(`Заказ #${data.orderId} · HTTP ${status}. Ключ сохранён для повтора.`);
    }
    if (form.id === 'find-order-form') { const order = await fetchOrder(Number(body.orderId)); pollOrder(order.orderId); }
    if (form.id === 'deposit-form') {
      const amount = Math.round(Number(body.amount) * 100);
      if (!Number.isSafeInteger(amount) || amount <= 0) throw new Error('Укажите положительную сумму в пределах безопасного целого числа');
      const { data } = await api('/billing/deposits', { method: 'POST', body: { amount } });
      state.balance = data.balance; $$('[data-balance]').forEach(el => el.textContent = money(data.balance)); toast('Баланс пополнен');
    }
    if (form.id === 'profile-form') {
      if (!body.phone.trim()) delete body.phone;
      const { data } = await api(`/profile/${state.user.id}`, { method: 'PUT', body }); state.user = data; updateUser(); toast('Профиль сохранён');
    }

  }, submit);
});
window.addEventListener('hashchange', () => { state.page = location.hash.slice(1) || 'overview'; render(); window.scrollTo(0, 0); });
async function init() {
  state.page = location.hash.slice(1) || 'overview'; render();
  try { const response = await fetch('/config'); const config = await response.json(); state.apiBaseUrl = config.apiBaseUrl; } catch { toast('Не удалось прочитать конфигурацию сервера', true); }
  await checkHealth();
  const user = stored('saga-session', null);
  if (user?.id && user.apiBaseUrl === state.apiBaseUrl) {
    try { const { data } = await api(`/profile/${user.id}`); setUser(data); await loadData(); } catch { clearUser(); render(); }
  } else render();
}
init();
