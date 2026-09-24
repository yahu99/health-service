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

# 4. Profile Service (текущий публичный Ingress ведёт в Auth+BFF)
kubectl apply -f homework-k8s/k8s/deployment.yaml -f homework-k8s/k8s/service.yaml
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

```text
k8s/          Profile Service: secret, configmap, migration, deployment, service
helm/postgresql/values.yaml
logging/
  elasticsearch-headless-service.yaml
  elasticsearch-service.yaml
  elasticsearch-statefulset.yaml
  kibana.yaml
  fluent-bit.yaml
```

Fluent Bit работает как DaemonSet, читает `/var/log/containers/*.log`, добавляет
метаданные Kubernetes, фильтрует поды с меткой `app=health-service` и отправляет
события в индекс `fluent-bit-logs-YYYY.MM.DD`.

## Что логируется

| Событие | Уровень | `event` |
|---|---|---|
| Старт/остановка приложения | INFO | `application_started/stopping/stopped` |
| HTTP-запрос | INFO | `http_request_completed` |
| CRUD профиля | INFO | `user_created/retrieved/updated/deleted` |
| Ошибка валидации | WARN | `validation_failed` |
| Ошибка БД/приложения | ERROR | `database_readiness_check_failed`, `database_pool_error` |
| Job миграции | INFO | `migration_started/completed/failed` |

Пароли маскируются (`[REDACTED]`).

## Kibana

```bash
minikube service kibana --namespace yahu
```

Data View: Stack Management → Data Views → `fluent-bit-logs-*`, time field
`@timestamp`.

Примеры KQL:

```text
service : "health-service"
level : "ERROR"
level : "WARN"
event : "user_created" and user_id : 42
kubernetes.pod_name : *migration*
```

Визуализация: Lens → Bar vertical stacked, X `@timestamp`, Y Count, breakdown
`level.keyword`.

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

ERROR при временно недоступной БД:

```bash
kubectl scale statefulset users-db-postgresql -n yahu --replicas=0
sleep 30
kubectl scale statefulset users-db-postgresql -n yahu --replicas=1
kubectl rollout status statefulset/users-db-postgresql -n yahu --timeout=120s
```

## Диагностика

```bash
kubectl logs -n yahu -l app=fluent-bit --tail=30
kubectl exec -n yahu elasticsearch-0 -- curl -s "http://localhost:9200/_cat/indices/fluent-bit-logs-*?v"
kubectl exec -n yahu elasticsearch-0 -- curl -s "http://localhost:9200/_cluster/health?pretty"
```

`kubectl` → `TLS handshake timeout` обычно означает, что Minikube не хватает памяти.

## Скриншоты

`logging/screenshots/` содержит Data View, Discover, визуализацию уровней и логи
Job миграции.
