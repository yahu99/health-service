# Централизованное логирование (EFK)

CRUD-сервис (Node.js/Koa) со структурными логами (pino), сбор в Kubernetes через
Elasticsearch + Fluent Bit + Kibana. Namespace — `yahu`.

## Требования

Docker, kubectl, Helm 3, Minikube (EFK не помещается в дефолтные 4 ГБ):

```bash
minikube start --memory=8192 --cpus=4
```

## Установка

```bash
# 1. namespace
kubectl create namespace yahu --dry-run=client -o yaml | kubectl apply -f -

# 2. PostgreSQL
kubectl apply -f homework-k8s/k8s/secret.yaml
helm upgrade --install users-db \
  oci://registry-1.docker.io/bitnamicharts/postgresql \
  --version 18.8.0 --namespace yahu \
  --values homework-k8s/helm/postgresql/values.yaml --wait

# 3. миграция
kubectl apply -f homework-k8s/k8s/configmap.yaml
kubectl delete job health-service-migration -n yahu --ignore-not-found
kubectl apply -f homework-k8s/k8s/migration-job.yaml
kubectl wait --for=condition=complete job/health-service-migration -n yahu --timeout=180s

# 4. приложение
kubectl apply -f homework-k8s/k8s/deployment.yaml -f homework-k8s/k8s/service.yaml -f homework-k8s/k8s/ingress.yaml
kubectl rollout status deployment/health-service -n yahu --timeout=180s

# 5. Elasticsearch
kubectl apply -f homework-k8s/logging/elasticsearch-headless-service.yaml \
  -f homework-k8s/logging/elasticsearch-service.yaml \
  -f homework-k8s/logging/elasticsearch-statefulset.yaml
kubectl rollout status statefulset/elasticsearch -n yahu --timeout=300s

# 6. Kibana
kubectl apply -f homework-k8s/logging/kibana.yaml
kubectl rollout status deployment/kibana -n yahu --timeout=300s

# 7. Fluent Bit
kubectl apply -f homework-k8s/logging/fluent-bit.yaml
kubectl rollout status daemonset/fluent-bit -n yahu --timeout=120s
```

Проверка: `kubectl get pods,svc,pvc -n yahu`

## Манифесты

```
k8s/          secret, configmap, migration-job, deployment, service, ingress (образ 4.0.0)
helm/postgresql/values.yaml
logging/
  elasticsearch-headless-service.yaml   Headless Service — DNS-имена узлов для StatefulSet
  elasticsearch-service.yaml            ClusterIP elasticsearch:9200 для Kibana и Fluent Bit
  elasticsearch-statefulset.yaml        1 реплика, PVC 5Gi, single-node, heap 512m
  kibana.yaml                           Deployment + NodePort 30601
  fluent-bit.yaml                       RBAC + ConfigMap + DaemonSet
```

Fluent Bit — DaemonSet, читает `/var/log/containers/*.log` со всех подов ноды,
парсит Docker-формат, добавляет метаданные Kubernetes, фильтрует по метке
`app=health-service`, шлёт в индекс `fluent-bit-logs-YYYY.MM.DD`.
Встраивать его в под приложения не нужно.

## Что логируется

| Событие | Уровень | `event` |
|---|---|---|
| Старт/остановка приложения | INFO | `application_started/stopping/stopped` |
| HTTP-запрос (метод, путь, IP, статус, ms) | INFO | `http_request_completed` |
| CRUD (с `user_id`) | INFO | `user_created/retrieved/updated/deleted` |
| Ошибка валидации | WARN | `validation_failed` |
| Ошибка БД/приложения | ERROR | `database_readiness_check_failed`, `database_pool_error` |
| Job миграции | INFO | `migration_started/completed/failed` |

Пароли маскируются (`[REDACTED]`).

## Kibana

```bash
minikube service kibana --namespace yahu   # терминал держать открытым
```

Data View: Stack Management → Data Views → `fluent-bit-logs-*`, time field `@timestamp`.

Discover (KQL), колонки `level, event, message, kubernetes.pod_name`:

```
service : "health-service"
level : "ERROR"
level : "WARN"
event : "user_created" and user_id : 42
kubernetes.pod_name : *migration*
```

Визуализация: Lens → Bar vertical stacked, X `@timestamp`, Y Count, breakdown `level.keyword`.

## Генерация логов

```bash
kubectl port-forward -n yahu svc/health-service 8080:80
```

```bash
BASE=http://127.0.0.1:8080
resp=$(curl -s -X POST $BASE/user/ -H 'Content-Type: application/json' -d '{"username":"demo","firstName":"De","lastName":"Mo","email":"demo@example.com","phone":"+995555010203"}')
uid=$(echo "$resp" | sed 's/.*"id":\([0-9]*\).*/\1/')
curl -s $BASE/user/$uid ; echo
curl -s -X PUT $BASE/user/$uid -H 'Content-Type: application/json' -d '{"phone":"+995555999999"}' ; echo
curl -s -X DELETE $BASE/user/$uid ; echo
curl -s -X POST $BASE/user/ -H 'Content-Type: application/json' -d '{"username":"bad","firstName":"B","lastName":"B","email":"not-an-email"}' ; echo
curl -s $BASE/user/not-a-number ; echo
```

ERROR (БД недоступна, PVC сохраняется):

```bash
kubectl scale statefulset users-db-postgresql -n yahu --replicas=0
sleep 30
kubectl scale statefulset users-db-postgresql -n yahu --replicas=1
kubectl rollout status statefulset users-db-postgresql -n yahu --timeout=120s
```

| Запрос | HTTP | Уровень / event |
|---|---|---|
| `POST /user/` валидный | 201 | INFO `user_created` |
| `GET /user/{id}` | 200 | INFO `user_retrieved` |
| `PUT /user/{id}` | 200 | INFO `user_updated` |
| `DELETE /user/{id}` | 200 | INFO `user_deleted` |
| `POST /user/` кривой email | 400 | WARN `validation_failed` |
| `GET /user/not-a-number` | 400 | WARN `validation_failed` |
| `GET /health/ready` без БД | 503 | ERROR `database_readiness_check_failed` |

## Диагностика

```bash
kubectl logs -n yahu -l app=fluent-bit --tail=30            # не должно быть "failed to flush"
kubectl exec -n yahu elasticsearch-0 -- curl -s "http://localhost:9200/_cat/indices/fluent-bit-logs-*?v"
kubectl exec -n yahu elasticsearch-0 -- curl -s "http://localhost:9200/_cluster/health?pretty"
```

`kubectl` → `TLS handshake timeout` = Minikube упёрся в память, пересоздать:
`minikube delete && minikube start --memory=8192 --cpus=4`.

## Скриншоты

`logging/screenshots/` — 01 Data View, 02 Discover с фильтром по уровню (ERROR/WARN),
03 гистограмма по уровням, 04 логи Job миграции.
