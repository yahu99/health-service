
## Публичное API

| Метод | Передаём | Отвечаем |
|---|---|---|
| POST /auth/register | username, password, firstName, lastName, email | 201: профиль; billing-аккаунт создан |
| POST /auth/login | username, password | 200: userId, expiresAt; cookie session_id |
| GET /billing/account | — | 200: accountId, userId, balance |
| POST /billing/deposits | amount | 201: operationId, balance |
| GET /products | — | 200: items[{productId, name, unitPrice}] |
| GET /delivery/slots | — | 200: items[{deliverySlotId, startsAt, endsAt, availableCouriers}] |
| POST /orders | productId, quantity (по умолчанию 1), deliverySlotId; заголовок Idempotency-Key | 202: заказ принят; 200: повтор завершённого заказа |
| GET /orders/{orderId} | orderId | 200: orderId, productId, quantity, unitPrice, price, deliverySlotId, status, reason, steps |
| GET /notifications | orderId необязателен | 200: items[{orderId, email, result, body}] |

## Внутреннее API

| Сервис | Метод | Передаём | Отвечаем |
|---|---|---|---|
| Profile | POST /user | username, firstName, lastName, email | 201: профиль с id |
| Profile | GET /user/{userId} | userId | 200: профиль с email |
| Auth | POST /internal/credentials | userId, username, password | 201: userId, username |
| Billing | POST /internal/accounts | userId | 201: accountId, userId, balance=0; повтор — 200 с текущим балансом |
| Billing | GET /internal/accounts/by-user/{userId} | userId | 200: accountId, userId, balance |
| Billing | POST /internal/deposits | userId, amount | 201: operationId, balance |
| Billing | POST /internal/withdrawals | userId, orderId, amount | 200: операция; сохранённый отказ — 409 |
| Billing | POST /internal/refunds | orderId | 200: операция COMPENSATED; повтор без нового возврата |
| Billing | GET /internal/operations/{orderId} | orderId | 200: сохранённый результат |
| Order | GET /internal/products | — | 200: items[{productId, name, unitPrice}] |
| Order | POST /internal/orders | userId, email, productId, quantity, deliverySlotId; Idempotency-Key | 202: заказ принят; 200: повтор завершённого заказа |
| Order | GET /internal/orders/{orderId} | orderId в пути, userId в query | 200: orderId, productId, quantity, unitPrice, price, deliverySlotId, status, reason, steps |
| Notification | POST /internal/notifications | userId, orderId, email, amount, result, reason | 201: notificationId; повтор — 200 |
| Notification | GET /internal/notifications | userId; orderId необязателен | 200: items[{orderId, email, result, body}] |

Цена определяется Order по каталогу; клиентская цена отклоняется. В заказе сохраняется снимок цены. У исторических заказов productId, quantity и unitPrice равны null. Каталог требует авторизации, как и заказы.

Новые заказы: PROCESSING → CONFIRMED либо PROCESSING → COMPENSATING → CANCELLED.
Заказ сохраняется вместе с тремя шагами саги до ответа 202. Результат читается
через GET; повтор POST с тем же ключом не запускает новый заказ. Ключ уникален
в пределах пользователя, допустимы 1–128 символов A–Z, a–z, 0–9, `.`, `_`, `:`, `-`.
Другие параметры с тем же ключом — 409 IDEMPOTENCY_CONFLICT.
У старых записей сохраняются PENDING/PAID/REJECTED; сага для них не запускается.

400 — неверные данные; 401 — нет сессии; 403 — чужой ресурс; 404 — ресурс не найден.
Бизнес-отказ участника приводит к компенсациям, а таймаут оставляет результат
неизвестным и вызывает повтор той же идемпотентной команды. Отказы Billing
(INSUFFICIENT_FUNDS, ACCOUNT_NOT_FOUND) сохраняются и повторно не переоцениваются.

Notification обслуживает существующие уведомления и не входит в новую сагу.
Новые заказы этой саги пока не создают уведомлений. Приведённые ниже событийные
варианты описывают предыдущее задание, а не текущую реализацию саги.

## Событийные варианты: контракты сообщений

Общие поля: orderId, userId, amount, email. Название определяет тип события.

| Событие | Кто → кому | Дополнительные поля |
|---|---|---|
| OrderCreated | Order → Billing | — |
| PaymentSucceeded | Billing → Order | withdrawalId |
| PaymentFailed | Billing → Order | reason=INSUFFICIENT_FUNDS |
| OrderPaid | Order → Notification | — |
| OrderRejected | Order → Notification | reason=INSUFFICIENT_FUNDS |

Hybrid: HTTP-оплата, события OrderPaid/OrderRejected; создание заказа — 201, уведомление может появиться позже.
Event Collaboration: вся цепочка заказа через события; создание заказа — 202: orderId, status=PENDING. Итог читаем через GET.
Регистрация и пополнение во всех вариантах — HTTP.

В предыдущем задании был выбран синхронный HTTP-вариант с сохранением уведомления до ответа. Новая сага возвращает 202 до обработки участниками.

IDL: [contracts.proto](contracts.proto). Типы запросов, ответов и событий описаны в Proto3; HTTP-методы — в таблицах выше.
