# BFF

Общий BFF для приложения. При регистрации создаёт профиль, credentials и
billing-аккаунт. Принимает публичные запросы Profile, Billing, Order и Notification.
`userId` получает от Gateway после проверки сессии, email для заказа — из Profile.

```text
POST /auth/register
POST /auth/login
POST /auth/logout
GET  /profile/:userId
PUT  /profile/:userId
GET  /billing/account
POST /billing/deposits
POST /orders
GET  /orders/:orderId
GET  /notifications
GET  /health/live
GET  /health/ready
```

Запуск приложения и контракты: [Stream Processing](../../homework-8/README.md).
