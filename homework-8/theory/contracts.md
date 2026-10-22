
## Публичное API

| Метод | Передаём | Отвечаем |
|---|---|---|
| POST /auth/register | username, password, firstName, lastName, email | 201: профиль; billing-аккаунт создан |
| POST /auth/login | username, password | 200: userId, expiresAt; cookie session_id |
| GET /billing/account | — | 200: accountId, userId, balance |
| POST /billing/deposits | amount | 201: operationId, balance |
| POST /orders | price | 201: orderId, status, reason |
| GET /orders/{orderId} | orderId | 200: orderId, price, status, reason |
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
| Billing | POST /internal/withdrawals | userId, orderId, amount | 200: withdrawalId, balance; отказ — 409: INSUFFICIENT_FUNDS |
| Order | POST /internal/orders | userId, email, price | 201: orderId, status, reason |
| Order | GET /internal/orders/{orderId} | orderId в пути, userId в query | 200: orderId, price, status, reason |
| Notification | POST /internal/notifications | userId, orderId, email, amount, result, reason | 201: notificationId; повтор — 200 |
| Notification | GET /internal/notifications | userId; orderId необязателен | 200: items[{orderId, email, result, body}] |

PAID: reason=null. REJECTED: reason=INSUFFICIENT_FUNDS. Пустой список: items=[].
400 — неверные данные; 401 — нет сессии; 403 — чужой ресурс; 404 — ресурс не найден; 409 — недостаток средств или конфликт.
Внутренний отказ Billing превращается в созданный заказ REJECTED: публичный ответ — 201.

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

Для реализации выбран HTTP: один получатель уведомлений, письмо сохраняется в БД, сбои исключены условием. Ответ создания заказа возвращаем после сохранения сообщения.

IDL: [contracts.proto](contracts.proto). Типы запросов, ответов и событий описаны в Proto3; HTTP-методы — в таблицах выше.
