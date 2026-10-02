# BFF

The public Backend for Frontend. It orchestrates registration through Auth and
Profile services, proxies login/logout to Auth Service, and adapts protected
profile requests.

```text
POST /auth/register
POST /auth/login
POST /auth/logout
GET  /profile/:userId
PUT  /profile/:userId
GET  /health/live
GET  /health/ready
```

For `/profile/*`, the BFF trusts `X-User-Id` only because the service is internal
and ingress-nginx overwrites this header with the Auth Service verification result.
