# Auth + BFF

Public application service for authentication, session management and access to
the internal Profile Service.

## Public routes

```text
POST /auth/register
POST /auth/login
POST /auth/logout
GET  /profile/:userId
PUT  /profile/:userId
GET  /health/live
GET  /health/ready
```

The Profile Service remains internal. Auth+BFF calls its existing routes:

```text
POST   /user
GET    /user/:userId
PUT    /user/:userId
DELETE /user/:userId  # registration compensation only
```

## Environment

```text
PORT=8001
PROFILE_SERVICE_URL=http://health-service
PROFILE_SERVICE_TIMEOUT_MS=3000
SESSION_TTL_SECONDS=86400
COOKIE_SECURE=false
DB_HOST=users-db-postgresql
DB_PORT=5432
DB_NAME=users
DB_USER=users
DB_PASSWORD=password
```

Run `npm run migrate` before `npm start`.
