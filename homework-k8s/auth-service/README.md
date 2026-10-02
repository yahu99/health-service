# Auth Service

Internal service responsible for credentials and server-side sessions.

```text
POST /internal/credentials
POST /auth/login
POST /auth/logout
GET  /auth/verify
GET  /health/live
GET  /health/ready
```

`/auth/verify` is called by NGINX Ingress as a `forward-auth` subrequest. On a
valid session it returns `200` and the trusted `X-User-Id` header.
